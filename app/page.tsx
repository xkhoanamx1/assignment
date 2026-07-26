'use client';

import { FormEvent, useState } from 'react';

type ResultData = {
  answer?: string;
  explanation?: string;
  suggested_chart?: string;
  filters?: Record<string, unknown>;
  data?: Array<Record<string, unknown>>;
};

function SimpleBarChart({ data }: { data: Array<Record<string, unknown>> }) {
  if (!data.length) {
    return <p>No chart data available.</p>;
  }

  const first = data[0];
  const metricKey = Object.keys(first).find((key) => /count|orders|rate|value|cost|amount|total|delay/i.test(key)) || Object.keys(first)[1] || 'value';
  const labelKey = Object.keys(first).find((key) => key !== metricKey) || 'label';
  const values = data.map((row) => Number(row[metricKey] || 0));
  const maxValue = Math.max(...values, 1);

  return (
    <svg viewBox="0 0 500 240" className="chart">
      <line x1="40" y1="200" x2="480" y2="200" stroke="#94a3b8" />
      <line x1="40" y1="20" x2="40" y2="200" stroke="#94a3b8" />
      {data.map((row, index) => {
        const value = Number(row[metricKey] || 0);
        const height = (value / maxValue) * 140;
        const x = 60 + index * 80;
        const y = 200 - height;
        const label = String(row[labelKey] ?? '');

        return (
          <g key={`${label}-${index}`}>
            <rect x={x} y={y} width="40" height={height} rx="4" fill="#3b82f6" />
            <text x={x + 20} y="220" textAnchor="middle" fontSize="10" fill="#e2e8f0">
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

export default function HomePage() {
  const [question, setQuestion] = useState('Show delayed orders by week for the last 3 months');
  const [result, setResult] = useState<ResultData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Unknown error');
      } else {
        setResult(data.result || null);
      }
    } catch (err) {
      setError(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container">
      <div className="card">
        <h1>Logistics AI Demo</h1>
        <p>Demo app for logistics analytics using the real CSV dataset and a structured response format.</p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} />
          <br /><br />
          <button type="submit" disabled={loading}>{loading ? 'Thinking...' : 'Ask'}</button>
        </form>
      </div>

      <div className="card">
        <h3>Response</h3>
        {error ? (
          <p className="error">{error}</p>
        ) : result ? (
          <div>
            <p><strong>Answer:</strong> {result.answer}</p>
            <p><strong>Explanation:</strong> {result.explanation}</p>
            <p><strong>Suggested chart:</strong> {result.suggested_chart}</p>
            <p><strong>Filters:</strong> {JSON.stringify(result.filters || {}, null, 2)}</p>
            {result.data && result.data.length > 0 ? (
              <div>
                <strong>Chart:</strong>
                <SimpleBarChart data={result.data} />
                <pre>{JSON.stringify(result.data || [], null, 2)}</pre>
              </div>
            ) : null}
          </div>
        ) : (
          <p>No response yet.</p>
        )}
      </div>
    </main>
  );
}
