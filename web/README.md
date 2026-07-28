# `web/` — legacy prototype (NOT the canonical source)

The canonical Next.js application lives at the repository root in `app/`. This `web/` directory is an earlier Gemini-only prototype kept for historical reference only.

## Why is this archived?

The root `app/` build contains:

- The full rule-based analytics engine covering 10 reference Q&A pairs.
- The Forecasting Tool (linear regression / moving average + inventory recommendation).
- Explainability fields (`metrics`, `dimensions`, `query_plan`) on every response.
- Dynamic chart selection (Bar / Line / KPI / Table / Scatter).
- A documented LLM fallback chain (`groq → gemini`).
- A comprehensive `README.md` covering setup, architecture, and limitations.

This `web/` prototype predates those features and is **not** the deploy target. The plan is to remove it once the canonical build is stable; see `README.md` → *Future Improvements → Deprecate `web/`*.

## If you still need to run this prototype

```bash
cd web
npm install
npm run dev
```

The prototype only supports the Gemini provider and exposes a subset of the questions. Tests that depend on forecasting or on the explainability fields will fail here.

## For the real project

Read [`../README.md`](../README.md).
