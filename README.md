# AI-Powered Logistics Analytics Dashboard

A Next.js 14 (App Router) + TypeScript application that turns a 400-row logistics CSV into an interactive dashboard, a natural-language analytics API, and a forecasting tool. The project pairs a deterministic rule-based analytics engine with an optional LLM overlay (Groq or Google Gemini) that explains and rephrases results.

## 1. Setup

### Requirements

- Node.js 18.17+ (Next.js 14.2.15)
- npm 9+

### Install & run

```bash
npm install
npm run dev          # default port 3000
# or
PORT=4101 npm run dev
```

The dashboard is served at `http://localhost:3000` (or the port you set). The single HTTP API entry point is `POST /api/query` with JSON body `{ "question": "..." }`.

### Production build

```bash
npm run build
npm start
```

### Environment variables

Create `.env.local` at the repo root. All variables are optional except for one of the LLM providers when `ANALYTICS_PROVIDER` is set to `groq` or `gemini`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANALYTICS_PROVIDER` | No | `rule-based` | One of `rule-based`, `groq`, `gemini`, `auto`. Controls whether the LLM is invoked on top of the rule-based engine. |
| `ANALYTICS_PROMPT_TEMPLATE` | No | (built-in) | Override the system prompt sent to the LLM. The default prompt is in `app/api/query/route.ts`. |
| `GROQ_API_KEY` | When `ANALYTICS_PROVIDER=groq` or `auto` with no Gemini key | – | Groq Cloud API key (`gsk_...`). |
| `GEMINI_API_KEY` | When `ANALYTICS_PROVIDER=gemini` | – | Google AI Studio key (`AIza...`). The current value in `.env.local` looks like an Azure gateway token and will fail; rotate it from <https://aistudio.google.com/apikey>. |

The route handler degrades gracefully: if the LLM call fails (rate-limit, bad key, network error), the response falls back to the rule-based answer and surfaces the LLM error in `prompt_config.llm_error`.

### Smoke test

```bash
npx tsx scripts/verify-llm-wiring.ts
```

This mocks `fetch` and exercises all four `ANALYTICS_PROVIDER` modes plus an invalid-key and a network-failure case, printing the chosen provider and any `llm_error`. It never makes a real network call.

## 2. Architecture

```
                ┌──────────────────────────────────────────────┐
                │                Browser (React)               │
                │  app/page.tsx — dashboard, NL input,         │
                │              dynamic chart, test-case panel   │
                └────────────────────┬─────────────────────────┘
                                     │ POST /api/query
                                     ▼
        ┌────────────────────────────────────────────────────────┐
        │                 app/api/query/route.ts                  │
        │                                                        │
        │   loadOrders()  ──▶  parseCsv()  ──▶  OrderRow[]       │
        │         │                                              │
        │         ▼                                              │
        │   buildAnalyticsResult() ── regex routing ──▶          │
        │     ├── buildSummaryResult            (default)        │
        │     ├── buildDelayedByWeekResult      (delay + week)   │
        │     ├── buildLastMonthDelayedResult   (last month)     │
        │     ├── buildCarrierDelayResult       (carrier)        │
        │     ├── buildRouteCostResult          (route + value)  │
        │     ├── buildExceptionCountResult / InTransit          │
        │     ├── buildAvgDeliveryResult                         │
        │     ├── buildTopRegionResult / PromoOrders             │
        │     └── buildForecastResult ◀── forecast|predict|      │
        │             │                  demand|inventory|sku    │
        │             ▼                                          │
        │      Linear regression (≥2 pts) or                     │
        │      moving average 3 mo (fallback) on                 │
        │      monthly SKU quantity                              │
        │                                                        │
        │   tryLlm() ──▶ Groq ──▶ Gemini (fallback chain)        │
        │      │                                                 │
        │      └─ wraps baseResult, preserves metrics/dimensions/│
        │         query_plan, returns primaryResult              │
        └────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                       JSON { answer, explanation,
                              suggested_chart, filters,
                              metrics, dimensions, query_plan,
                              data, forecast_meta?, dashboard?,
                              provider, prompt_config }
```

### Project layout

```
app/
  api/query/route.ts          # analytics + LLM overlay
  page.tsx                    # dashboard + NL Q&A UI
  testCases.ts                # auto-generated reference Q&A
  layout.tsx, globals.css
data/
  mock_logistics_data.csv     # 400 rows, 17 columns
scripts/
  verify-llm-wiring.ts       # offline LLM smoke test
  generate-test-cases.mjs    # regenerates app/testCases.ts from CSV
vercel.json                   # deploy config (root)
```

The `web/` directory contains an earlier Gemini-only prototype kept for reference; the canonical source is `app/` at the root (see *Future Improvements* for deprecation plans).

## 3. AI Approach

The system is **AI as orchestrator, not source of truth**. Every answer is grounded in a deterministic computation over the CSV; the LLM only rephrases, explains, and (optionally) overrides the `suggested_chart`, `filters`, and `metrics/dimensions` fields.

### Routing

`buildAnalyticsResult(question, orders)` normalizes the question and dispatches to a regex-matched builder. The dispatcher covers:

- Week-bucketed delay analysis
- Latest-month delay count
- Carrier delay rate
- Highest-value route
- Exception / in-transit counts
- Average delivery time
- Top region, promo orders
- Order-status summary (default)
- **Forecast / demand / inventory / SKU** (linear regression on monthly quantity)

### LLM fallback chain

- `rule-based` — LLM disabled; deterministic answer only.
- `groq` — calls `api.groq.com/openai/v1/chat/completions` with `llama-3.1-8b-instant`.
- `gemini` — calls `generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`.
- `auto` — tries `groq` first if `GROQ_API_KEY` is set, then `gemini`.

If the chosen provider fails, the next provider in the chain is tried. If all fail, the response continues with the rule-based answer and records `prompt_config.llm_error`. The LLM prompt instructs the model to return strict JSON with `answer`, `explanation`, `suggested_chart`, `filters`, `data`, `query_plan`, `metrics`, and `dimensions`. The code never lets the LLM replace the computed `data` for cases that have a numeric ground truth unless the parsed JSON is well-formed.

### Forecasting Tool

Mandatory for the spec. Implemented in `buildForecastResult`:

1. **SKU detection** — regex `SKU[- ]?\w+-\d+` picks up `PAPER-0197` style codes; if absent, the forecast aggregates across all SKUs.
2. **Monthly aggregation** — sum of `quantity` per `YYYY-MM` from `order_date`.
3. **Linear regression** — slope/intercept on `(monthIndex, quantity)`. With ≥2 historical points this is the default method.
4. **Fallback** — if fewer than 2 points, the code switches to a 3-month moving average and labels `forecast_meta.method = 'moving_average'`.
5. **Horizon** — defaults to 4 months; a number followed by `month`/`months`/`tháng` in the question overrides it (clamped to 1–12).
6. **Inventory recommendation** — `mean(forecast_values) × safety_stock_factor` (default 1.2). The factor is exposed in the response and explained in the `explanation` field.
7. **Visualization** — a `Line chart` is requested; the UI renders a `<ForecastChart>` with a solid historical line, a dashed forecast line, and a thin bridge segment connecting them.

The response includes `forecast_meta`: `{ method, slope, intercept, historical_points, recommendation_units, safety_stock_factor, horizon_months }`.

### Explainability

Every response carries the same five anchors required by the spec:

- `filters` — what was filtered (time range, status, carrier, SKU, region, etc.)
- `metrics` — the numeric measures computed (`delayed_orders`, `delay_rate`, `quantity`, …)
- `dimensions` — the grouping keys (`week`, `carrier`, `month`, `region`, …)
- `query_plan` — a one-line pipeline description (e.g. `filter status=delayed → group by ISO week → count`)
- `data` — the raw tabular result used by the chart

These are populated by the rule-based builders and merged with the LLM response when the LLM is enabled; an LLM that fails to return them does not strip them from the response.

## 4. Assumptions

- The "latest month" is derived from `max(order_date)` in the CSV, not from `new Date()`. This is intentional so the demo is reproducible regardless of when it runs.
- The "last 3 months" window is anchored to the same `max(order_date)`.
- The CSV is small (400 rows) and loaded into memory on every request. There is no caching or streaming.
- `quantity` is the chosen demand signal for forecasting; order count is not used. This matches the spec's "Predict demand for SKU X" wording.
- The safety-stock factor of 1.2 (20% buffer over mean forecast) is a pragmatic default; production should use a service-level-driven formula (e.g. z-score × σ).
- The dashboard "monthly trend" charts delivered vs delayed counts, not volume, because the dataset only has order-level rows.
- The Gemini provider is best-effort: if the supplied key is invalid (e.g. an Azure gateway token starting with `AQ.`), the route falls back to Groq or the rule-based answer.

## 5. Limitations

- **No streaming** — the LLM response is awaited in full before returning.
- **No query history** — every question is independent; there is no chat memory or session.
- **No persistence** — all state is in the CSV; no SQLite/Postgres layer.
- **Linear regression only** — the forecaster does not handle seasonality, holidays, or exogenous regressors. It will under-fit oscillating series.
- **No confidence intervals** — point forecasts only. Inventory recommendation is a heuristic, not a stochastic optimisation.
- **No authentication** — the API and dashboard are open. Suitable for demo only.
- **Single-tenant dataset** — the CSV is loaded from the repository; multi-tenant ingestion is not supported.
- **Two codebases** — `web/` is a parallel prototype kept for historical reference; the canonical source is `app/`.

## 6. Future Improvements

- **Query history & chat memory** — persist questions and answers in SQLite or Postgres; allow follow-up questions that reference earlier context.
- **Streaming responses** — stream LLM tokens via `ReadableStream` so the UI can show partial answers.
- **Caching layer** — cache computed analytics keyed by `(question, csv_hash)` to avoid recomputation.
- **Real database** — replace the CSV loader with a DuckDB or Postgres-backed query engine so the system scales beyond 400 rows.
- **Authentication & multi-tenancy** — add NextAuth, isolate data per tenant, gate the API.
- **Better forecasting** — add Holt-Winters, ARIMA, or Prophet; expose confidence intervals; let users choose a safety-stock strategy (z-score, service-level %).
- **Spec-aware metric catalogue** — let the LLM pick from a typed catalogue of metrics instead of free-form text.
- **Internationalisation** — the response is bilingual (English/Vietnamese) based on a character heuristic; introduce a proper locale switcher.
- **Tests** — add Vitest/Playwright coverage for the analytics builders and the UI happy paths.
- **Docker** — bundle the app with a multi-stage Dockerfile and a `docker-compose.yml` for local Postgres.
- **Deprecate `web/`** — once the codebase is stable, archive `web/` into a tagged release and remove it from the deploy surface.
