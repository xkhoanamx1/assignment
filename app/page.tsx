'use client';

import { FormEvent, useEffect, useState } from 'react';
import { LOGISTICS_TEST_CASES, type LogisticsTestCase } from './testCases';

type DashboardSummary = {
  total_orders: number;
  delivered: number;
  delayed: number;
  on_time_rate: number;
  avg_delivery_days: number;
};

type DashboardPayload = {
  summary: DashboardSummary;
  monthly_trend: Array<Record<string, unknown>>;
  carrier_delay_rates: Array<Record<string, unknown>>;
  status_breakdown: Array<Record<string, unknown>>;
};

type ResultData = {
  answer: string;
  explanation: string;
  suggested_chart: string;
  filters: Record<string, unknown>;
  data: Array<Record<string, unknown>>;
  metrics?: string[];
  dimensions?: string[];
  query_plan?: string;
  forecast_meta?: {
    method: string;
    slope: number;
    intercept: number;
    historical_points: number;
    recommendation_units: number;
    safety_stock_factor: number;
    horizon_months: number;
  };
  dashboard?: DashboardPayload;
  provider?: string;
  prompt_config?: {
    provider: string;
    prompt_source: string;
    llm_used?: boolean;
    llm_provider?: 'groq' | 'gemini';
    llm_error?: string;
    llm_status?: string;
    rule_based_answer?: string;
  };
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function TrendChart({ data }: { data: Array<Record<string, unknown>> }) {
  if (!data.length) return <p>No trend data.</p>;

  const values = data.map((row) => Number(row.delivered || 0));
  const maxValue = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = 40 + index * 70;
      const y = 180 - (value / maxValue) * 120;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 480 220" className="chart">
      <line x1="20" y1="180" x2="460" y2="180" stroke="#64748b" />
      <line x1="20" y1="20" x2="20" y2="180" stroke="#64748b" />
      <polyline fill="none" stroke="#38bdf8" strokeWidth="3" points={points} />
      {data.map((row, index) => {
        const value = Number(row.delivered || 0);
        const x = 40 + index * 70;
        const y = 180 - (value / maxValue) * 120;
        return <circle key={`${row.month}-${index}`} cx={x} cy={y} r="4" fill="#f8fafc" />;
      })}
    </svg>
  );
}

function SimpleBarChart({ data, labelKey, valueKey }: { data: Array<Record<string, unknown>>; labelKey: string; valueKey: string }) {
  if (!data.length) return <p>No chart data.</p>;

  const values = data.map((row) => Number(row[valueKey] || 0));
  const maxValue = Math.max(...values, 1);

  return (
    <svg viewBox="0 0 500 220" className="chart">
      {data.map((row, index) => {
        const value = Number(row[valueKey] || 0);
        const height = (value / maxValue) * 140;
        const x = 40 + index * 80;
        const y = 180 - height;
        const label = String(row[labelKey] ?? '');
        return (
          <g key={`${label}-${index}`}>
            <rect x={x} y={y} width="40" height={height} rx="4" fill="#3b82f6" />
            <text x={x + 20} y="205" textAnchor="middle" fontSize="10" fill="#e2e8f0">
              {label.length > 10 ? `${label.slice(0, 10)}...` : label}
            </text>
            <text x={x + 20} y={y - 6} textAnchor="middle" fontSize="10" fill="#e2e8f0">
              {value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data, xKey, yKey }: { data: Array<Record<string, unknown>>; xKey: string; yKey: string }) {
  if (!data.length) return <p>No chart data.</p>;
  const values = data.map((row) => Number(row[yKey] || 0));
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = Math.max(1, maxValue - minValue);
  const stepX = data.length > 1 ? 400 / (data.length - 1) : 0;

  const path = values
    .map((value, index) => {
      const x = 40 + index * stepX;
      const y = 180 - ((value - minValue) / range) * 140;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 480 220" className="chart">
      <line x1="20" y1="180" x2="460" y2="180" stroke="#64748b" />
      <line x1="20" y1="20" x2="20" y2="180" stroke="#64748b" />
      <path fill="none" stroke="#38bdf8" strokeWidth="2" d={path} />
      {data.map((row, index) => {
        const value = Number(row[yKey] || 0);
        const x = 40 + index * stepX;
        const y = 180 - ((value - minValue) / range) * 140;
        const isForecast = row[yKey] === null || row[yKey] === undefined;
        return (
          <g key={`${row[xKey]}-${index}`}>
            <circle cx={x} cy={y} r="4" fill={isForecast ? '#f59e0b' : '#f8fafc'} stroke={isForecast ? '#f59e0b' : '#38bdf8'} strokeWidth="2" />
            <text x={x} y="200" textAnchor="middle" fontSize="9" fill="#94a3b8">
              {String(row[xKey] ?? '').slice(0, 7)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type ForecastMeta = {
  method: string;
  slope: number;
  intercept: number;
  historical_points: number;
  recommendation_units: number;
  safety_stock_factor: number;
  horizon_months: number;
};

function ForecastChart({
  data,
  forecastMeta,
  scopeLabel
}: {
  data: Array<Record<string, unknown>>;
  forecastMeta?: ForecastMeta;
  scopeLabel?: string;
}) {
  if (!data.length) return <p>No chart data.</p>;

  const allValues = data.flatMap((row) => {
    const cells: number[] = [];
    if (row.historical !== null && row.historical !== undefined) cells.push(Number(row.historical));
    if (row.forecast !== null && row.forecast !== undefined) cells.push(Number(row.forecast));
    return cells;
  });
  const recommendationUnits = forecastMeta?.recommendation_units ?? 0;
  if (recommendationUnits > 0) allValues.push(recommendationUnits);

  const maxValue = Math.max(1, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const range = Math.max(1, maxValue - minValue);
  const stepX = data.length > 1 ? 400 / (data.length - 1) : 0;

  const xAt = (index: number) => 40 + index * stepX;
  const yAt = (value: number) => 180 - ((value - minValue) / range) * 140;

  const histPoints: Array<{ x: number; y: number; index: number }> = [];
  const forecastPoints: Array<{ x: number; y: number; index: number }> = [];
  data.forEach((row, index) => {
    if (row.historical !== null && row.historical !== undefined) {
      histPoints.push({ x: xAt(index), y: yAt(Number(row.historical)), index });
    }
    if (row.forecast !== null && row.forecast !== undefined) {
      forecastPoints.push({ x: xAt(index), y: yAt(Number(row.forecast)), index });
    }
  });

  const histPath = histPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
  const forecastPath = forecastPoints
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(' ');

  const bridgePoint = histPoints.length && forecastPoints.length
    ? `M ${histPoints[histPoints.length - 1].x.toFixed(1)},${histPoints[histPoints.length - 1].y.toFixed(1)} L ${forecastPoints[0].x.toFixed(1)},${forecastPoints[0].y.toFixed(1)}`
    : '';

  const recommendationY = recommendationUnits > 0 ? yAt(recommendationUnits) : null;

  // Y-axis tick lines: 0, mid, max (plus recommendation level if it falls outside)
  const tickCandidates = [0, Math.round(maxValue / 2), Math.round(maxValue)];
  if (recommendationUnits > 0 && !tickCandidates.includes(Math.round(recommendationUnits))) {
    tickCandidates.push(Math.round(recommendationUnits));
  }
  const ticks = Array.from(new Set(tickCandidates.filter((v) => v >= 0))).sort((a, b) => a - b);

  return (
    <div className="forecast-chart-wrapper">
      <div className="forecast-chart-header">
        <strong>{scopeLabel ? `Demand forecast — ${scopeLabel}` : 'Demand forecast'}</strong>
        <span className="forecast-chart-summary">
          avg <strong>{forecastMeta ? Math.round((forecastPoints.reduce((s, p) => s + Number(data[p.index]?.forecast ?? 0), 0) / Math.max(1, forecastPoints.length)) * 10) / 10 : '—'}</strong>
          {' · '}
          peak <strong>{forecastMeta ? Math.max(...forecastPoints.map((p) => Number(data[p.index]?.forecast ?? 0))).toFixed(1) : '—'}</strong>
          {' · '}
          recommendation <strong>{forecastMeta ? recommendationUnits : '—'}</strong> units
        </span>
      </div>
      <svg viewBox="0 0 540 220" className="chart">
        {/* horizontal gridlines + y-axis tick labels */}
        {ticks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={`tick-${tick}`}>
              <line x1="40" y1={y.toFixed(1)} x2="500" y2={y.toFixed(1)} stroke="#1e293b" strokeDasharray="2 4" />
              <text x="36" y={(y + 3).toFixed(1)} textAnchor="end" fontSize="9" fill="#94a3b8">
                {tick}
              </text>
            </g>
          );
        })}
        <line x1="40" y1="180" x2="500" y2="180" stroke="#64748b" />
        <line x1="40" y1="20" x2="40" y2="180" stroke="#64748b" />

        {/* recommendation reference line */}
        {recommendationY !== null ? (
          <g>
            <line x1="40" y1={recommendationY.toFixed(1)} x2="500" y2={recommendationY.toFixed(1)} stroke="#22c55e" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x="496" y={(recommendationY - 4).toFixed(1)} textAnchor="end" fontSize="10" fill="#22c55e">
              Recommendation {recommendationUnits}u
            </text>
          </g>
        ) : null}

        {/* data points + lines */}
        {histPoints.map((pt, i) => (
          <circle key={`h-${i}`} cx={pt.x} cy={pt.y} r="4" fill="#38bdf8" />
        ))}
        {forecastPoints.map((pt, i) => (
          <circle key={`f-${i}`} cx={pt.x} cy={pt.y} r="4" fill="#f59e0b" />
        ))}
        {histPath ? <path fill="none" stroke="#38bdf8" strokeWidth="2" d={histPath} /> : null}
        {bridgePoint ? <path fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" d={bridgePoint} /> : null}
        {forecastPath ? <path fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 4" d={forecastPath} /> : null}

        {/* x-axis labels: show full YY-MM for last historical + all forecasts */}
        {data.map((row, index) => {
          const monthLabel = String(row.month ?? '');
          const isForecast = row.historical === null || row.historical === undefined;
          const fill = isForecast ? '#f59e0b' : '#94a3b8';
          return (
            <text
              key={`lbl-${index}`}
              x={xAt(index)}
              y="200"
              textAnchor="middle"
              fontSize="9"
              fill={fill}
            >
              {monthLabel.slice(2)}
            </text>
          );
        })}

        {/* legend */}
        <g transform="translate(40, 12)">
          <rect x="0" y="-6" width="10" height="3" fill="#38bdf8" />
          <text x="14" y="-2" fontSize="10" fill="#cbd5e1">Historical</text>
          <rect x="78" y="-6" width="10" height="3" fill="#f59e0b" />
          <text x="92" y="-2" fontSize="10" fill="#cbd5e1">Forecast</text>
          {recommendationUnits > 0 ? (
            <>
              <line x1="148" y1="-4" x2="158" y2="-4" stroke="#22c55e" strokeDasharray="5 4" />
              <text x="162" y="-2" fontSize="10" fill="#cbd5e1">Recommendation</text>
            </>
          ) : null}
        </g>
      </svg>
    </div>
  );
}

function KpiCard({ data }: { data: Array<Record<string, unknown>> }) {
  if (!data.length) return <p>No KPI data.</p>;
  const first = data[0];
  const entries = Object.entries(first).filter(([, value]) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isNaN(Number(value)) === false));
  const display = entries.length ? entries : Object.entries(first).slice(0, 2);

  return (
    <div className="grid">
      {display.map(([key, value]) => (
        <div key={key} className="metric-card">
          <p>{key.replace(/_/g, ' ')}</p>
          <strong>{typeof value === 'number' ? value.toLocaleString() : String(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function DataTable({ data }: { data: Array<Record<string, unknown>> }) {
  if (!data.length) return <p>No table data.</p>;
  const first = data[0];
  const keys = Array.from(
    data.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  ).slice(0, 8);

  return (
    <div className="result-block">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key} style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              {keys.map((key) => (
                <td key={`${idx}-${key}`} style={{ padding: '8px', borderBottom: '1px solid #1e293b' }}>
                  {row[key] === null || row[key] === undefined ? '—' : String(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScatterChart({ data, xKey, yKey }: { data: Array<Record<string, unknown>>; xKey: string; yKey: string }) {
  if (!data.length) return <p>No scatter data.</p>;
  const xs = data.map((row) => Number(row[xKey] || 0));
  const ys = data.map((row) => Number(row[yKey] || 0));
  const maxX = Math.max(1, ...xs);
  const maxY = Math.max(1, ...ys);

  return (
    <svg viewBox="0 0 480 220" className="chart">
      <line x1="20" y1="180" x2="460" y2="180" stroke="#64748b" />
      <line x1="20" y1="20" x2="20" y2="180" stroke="#64748b" />
      {data.map((row, index) => {
        const x = 20 + (Number(row[xKey] || 0) / maxX) * 420;
        const y = 180 - (Number(row[yKey] || 0) / maxY) * 140;
        return <circle key={`${index}`} cx={x} cy={y} r="5" fill="#a78bfa" opacity="0.7" />;
      })}
    </svg>
  );
}

function DynamicResultChart({
  data,
  suggestedChart,
  forecastMeta,
  scopeLabel
}: {
  data: Array<Record<string, unknown>>;
  suggestedChart: string;
  forecastMeta?: ForecastMeta;
  scopeLabel?: string;
}) {
  if (!data.length) return null;
  const chartType = (suggestedChart || '').toLowerCase();

  if (chartType.includes('line') || data.some((row) => 'forecast' in row || 'historical' in row)) {
    if (data.some((row) => 'forecast' in row || 'historical' in row)) {
      return <ForecastChart data={data} forecastMeta={forecastMeta} scopeLabel={scopeLabel} />;
    }
    const xKey = Object.keys(data[0]).find((k) => /month|week|date|label|name|day/i.test(k)) || Object.keys(data[0])[0];
    const yKey = Object.keys(data[0]).find((k) => /count|orders|rate|value|quantity|total|amount|forecast/i.test(k)) || Object.keys(data[0])[1] || 'value';
    return <LineChart data={data} xKey={xKey} yKey={yKey} />;
  }

  if (chartType.includes('kpi') || data.length <= 1) {
    return <KpiCard data={data} />;
  }

  if (chartType.includes('table')) {
    return <DataTable data={data} />;
  }

  if (chartType.includes('scatter')) {
    const xKey = Object.keys(data[0])[0] || 'x';
    const yKey = Object.keys(data[0]).find((k) => k !== xKey) || 'y';
    return <ScatterChart data={data} xKey={xKey} yKey={yKey} />;
  }

  const first = data[0];
  const metricKey = Object.keys(first).find((key) => /count|orders|rate|value|cost|amount|total|delay/i.test(key)) || Object.keys(first)[1] || 'value';
  const labelKey = Object.keys(first).find((key) => key !== metricKey) || 'label';

  return <SimpleBarChart data={data} labelKey={labelKey} valueKey={metricKey} />;
}

function TestCasePanel({
  testCases,
  activeId,
  disabled,
  actualAnswer,
  loading,
  onFill
}: {
  testCases: LogisticsTestCase[];
  activeId: string | null;
  disabled: boolean;
  actualAnswer: string | null;
  loading: boolean;
  onFill: (testCase: LogisticsTestCase) => void;
}) {
  const evaluateMatch = (expected: string, actual: string): {
    status: 'exact' | 'partial' | 'mismatch';
    score: number;
  } => {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const e = normalize(expected);
    const a = normalize(actual);
    if (e === a) return { status: 'exact', score: 1 };
    const eTokens = new Set(e.split(' ').filter(Boolean));
    const aTokens = new Set(a.split(' ').filter(Boolean));
    if (eTokens.size === 0) return { status: 'mismatch', score: 0 };
    let overlap = 0;
    eTokens.forEach((token) => {
      if (aTokens.has(token)) overlap += 1;
    });
    const score = overlap / eTokens.size;
    if (score >= 0.6) return { status: 'partial', score };
    return { status: 'mismatch', score };
  };

  return (
    <div className="test-case-list">
      {testCases.map((testCase) => {
        const isActive = activeId === testCase.id;
        const match =
          isActive && actualAnswer !== null
            ? evaluateMatch(testCase.expectedAnswer, actualAnswer)
            : null;
        const buttonLabel = isActive && loading ? 'Running...' : isActive ? 'Re-run' : 'Fill';
        return (
          <div
            key={testCase.id}
            className={`test-case-row${isActive ? ' active' : ''}`}
          >
            <div className="test-case-head">
              <span className="test-case-id">{testCase.id}</span>
              <span className="test-case-category">{testCase.category}</span>
              <button
                type="button"
                className="test-case-fill"
                disabled={disabled}
                onClick={() => onFill(testCase)}
              >
                {buttonLabel}
              </button>
              {match ? (
                <span
                  className={`match-badge ${
                    match.status === 'exact'
                      ? 'match-ok'
                      : match.status === 'partial'
                        ? 'match-partial'
                        : 'match-fail'
                  }`}
                >
                  {match.status === 'exact'
                    ? 'Match'
                    : match.status === 'partial'
                      ? `Partial ${Math.round(match.score * 100)}%`
                      : 'Mismatch'}
                </span>
              ) : null}
            </div>
            <p className="test-case-question">
              <strong>Question:</strong> {testCase.question}
            </p>
            <p className="test-case-expected">
              <strong>Expected:</strong> {testCase.expectedAnswer}
            </p>
            {match && isActive && actualAnswer ? (
              <p className="test-case-actual">
                <strong>LLM answer:</strong> {actualAnswer}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const [question, setQuestion] = useState('Which carrier has the highest delay rate?');
  const [result, setResult] = useState<ResultData | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);

  const runQuestion = async (nextQuestion: string, testId: string | null = null) => {
    setQuestion(nextQuestion);
    setActiveTestId(testId);
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: nextQuestion })
      });
      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Unknown error');
      } else {
        setResult(data.result || null);
        setDashboard(data.result?.dashboard || null);
      }
    } catch (err) {
      setError(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: '' })
      });
      const data = await res.json();
      if (data.ok) {
        setDashboard(data.result?.dashboard || null);
        setResult(data.result || null);
      }
    } catch (err) {
      setError(`Unable to load dashboard: ${err}`);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await runQuestion(question, null);
  };

  const handleRunTestCase = (testCase: LogisticsTestCase) => {
    void runQuestion(testCase.question, testCase.id);
  };

  const activeTest = activeTestId
    ? LOGISTICS_TEST_CASES.find((testCase) => testCase.id === activeTestId)
    : null;

  const summary = dashboard?.summary;

  return (
    <main className="container">
      <section className="card hero">
        <h1>Logistics Analytics Dashboard</h1>
        <p>Build around the real logistics dataset, with KPI cards, charts, and natural-language analytics that explain the result.</p>
      </section>

      <section className="card">
        <h2>Executive summary</h2>
        {summary ? (
          <div className="grid">
            <MetricCard label="Total orders" value={summary.total_orders.toString()} />
            <MetricCard label="Delivered" value={summary.delivered.toString()} />
            <MetricCard label="Delayed" value={summary.delayed.toString()} />
            <MetricCard label="On-time rate" value={`${summary.on_time_rate.toFixed(1)}%`} />
            <MetricCard label="Avg delivery days" value={`${summary.avg_delivery_days.toFixed(1)}`} />
          </div>
        ) : (
          <p>Loading dashboard metrics…</p>
        )}
      </section>

      <section className="card">
        <h2>Ask a business question</h2>
        <p className="muted">
          Every question is sent to the configured LLM (<code>{result?.prompt_config?.provider ?? 'groq'}</code>).
          The reference Q&amp;A pairs (computed directly from
          <code> data/mock_logistics_data.csv</code>) live in the
          <em> Test case panel</em> at the bottom of the page. Use the
          <em> Fill</em> button on any test case to load the question into the
          input above and run it through the LLM, then compare the answer
          against the expected reference.
        </p>
        <form onSubmit={handleSubmit}>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} />
          <div className="actions">
            <button type="submit" disabled={loading}>{loading ? 'Thinking...' : 'Ask'}</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="grid two-col">
          <div>
            <h3>Monthly trend</h3>
            {dashboard?.monthly_trend ? <TrendChart data={dashboard.monthly_trend} /> : <p>No trend data.</p>}
          </div>
          <div>
            <h3>Carrier delay rate</h3>
            {dashboard?.carrier_delay_rates?.length ? (
              <SimpleBarChart data={dashboard.carrier_delay_rates as Array<Record<string, unknown>>} labelKey="carrier" valueKey="delay_rate" />
            ) : <p>No carrier data.</p>}
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Response</h3>
        {error ? (
          <p className="error">{error}</p>
        ) : result ? (
          <div>
            <p><strong>Answer:</strong> {result.answer}</p>
            <p><strong>Explanation:</strong> {result.explanation}</p>
            <p><strong>Suggested chart:</strong> {result.suggested_chart}</p>
            <p><strong>Filters:</strong> <code>{JSON.stringify(result.filters || {}, null, 2)}</code></p>
            {result.metrics && result.metrics.length ? (
              <p><strong>Metrics:</strong> {result.metrics.join(', ')}</p>
            ) : null}
            {result.dimensions && result.dimensions.length ? (
              <p><strong>Dimensions:</strong> {result.dimensions.join(', ')}</p>
            ) : null}
            {result.query_plan ? (
              <p><strong>Query plan:</strong> {result.query_plan}</p>
            ) : null}
            {result.forecast_meta ? (
              <div className="result-block">
                <strong>Forecast metadata:</strong>
                <pre>{JSON.stringify(result.forecast_meta, null, 2)}</pre>
              </div>
            ) : null}
            <p><strong>Provider:</strong> {result.provider || 'csv-rule'}</p>
            {result.data && result.data.length > 0 ? (
              <div className="result-block">
                <strong>Chart:</strong>
                <DynamicResultChart
                  data={result.data}
                  suggestedChart={result.suggested_chart}
                  forecastMeta={result.forecast_meta as ForecastMeta | undefined}
                  scopeLabel={
                    typeof result.filters?.sku === 'string' && result.filters.sku !== 'all'
                      ? `SKU ${result.filters.sku}`
                      : 'all SKUs'
                  }
                />
                <pre>{JSON.stringify(result.data, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        ) : (
          <p>No response yet.</p>
        )}
      </section>

      <section className="card info">
        <h3>Prompt setup</h3>
        {result?.prompt_config ? (
          <div>
            <p>
              <strong>Provider mode:</strong> {result.prompt_config.provider}
            </p>
            <p>
              <strong>Prompt source:</strong> {result.prompt_config.prompt_source}
            </p>
            <p>
              <strong>LLM called:</strong>{' '}
              {result.prompt_config.llm_used
                ? `yes (${result.prompt_config.llm_provider})`
                : 'no'}
            </p>
            {result.prompt_config.llm_error ? (
              <p className="error">
                <strong>LLM diagnostic:</strong> {result.prompt_config.llm_error}
              </p>
            ) : null}
            {result.prompt_config.llm_status ? (
              <p className="muted">
                <strong>Status:</strong> {result.prompt_config.llm_status}
              </p>
            ) : null}
          </div>
        ) : (
          <p>The provider and prompt template are configured via <code>ANALYTICS_PROVIDER</code> and <code>ANALYTICS_PROMPT_TEMPLATE</code> in <code>.env.local</code>.</p>
        )}
        <p className="muted">
          Set <code>ANALYTICS_PROVIDER=groq</code> in <code>.env.local</code> to send every question through the LLM,
          or <code>rule-based</code> for the deterministic regex answers used by the demo test cases.
        </p>
      </section>

      <section className="card">
        <h3>Test case panel</h3>
        <p className="muted">
          Reference Q&amp;A pairs computed directly from
          <code> data/mock_logistics_data.csv</code>. Click <strong>Fill</strong> on any
          row to load the question into the input above and run it through the LLM;
          the row shows a <em>Match</em> / <em>Mismatch</em> badge once the answer
          comes back.
        </p>
        <TestCasePanel
          testCases={LOGISTICS_TEST_CASES}
          activeId={activeTestId}
          disabled={loading}
          actualAnswer={activeTest && result && activeTestId === activeTest.id ? result.answer : null}
          loading={loading}
          onFill={handleRunTestCase}
        />
      </section>
    </main>
  );
}
