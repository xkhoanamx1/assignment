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

function DynamicResultChart({ data }: { data: Array<Record<string, unknown>> }) {
  if (!data.length) return null;

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
            <p><strong>Filters:</strong> {JSON.stringify(result.filters || {}, null, 2)}</p>
            <p><strong>Provider:</strong> {result.provider || 'csv-rule'}</p>
            {result.data && result.data.length > 0 ? (
              <div className="result-block">
                <strong>Chart:</strong>
                <DynamicResultChart data={result.data} />
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
