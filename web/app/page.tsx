'use client';

import { FormEvent, useState } from 'react';

export default function HomePage() {
  const [question, setQuestion] = useState('Show delayed orders by week for the last 3 months');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAnswer('');

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await res.json();
      setAnswer(JSON.stringify(data, null, 2));
    } catch (error) {
      setAnswer(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container">
      <div className="card">
        <h1>Logistics AI Demo</h1>
        <p>Demo app for logistics analytics using Gemini API and a rule-based orchestrator.</p>
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
        <pre>{answer || 'No response yet.'}</pre>
      </div>
    </main>
  );
}
