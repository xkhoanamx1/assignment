'use client';

import { FormEvent, useState } from 'react';

type ResultData = {
  answer?: string;
  explanation?: string;
  suggested_chart?: string;
  filters?: Record<string, unknown>;
  data?: Array<Record<string, unknown>>;
};

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
        <p>Demo app for logistics analytics using Groq and a structured response format.</p>
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
            <div>
              <strong>Data:</strong>
              <pre>{JSON.stringify(result.data || [], null, 2)}</pre>
            </div>
          </div>
        ) : (
          <p>No response yet.</p>
        )}
      </div>
    </main>
  );
}
