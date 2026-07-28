import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { question } = await req.json();

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json({
      ok: false,
      answer: 'Gemini API key not configured.',
      explanation: 'Please add GEMINI_API_KEY in Vercel environment variables.'
    });
  }

  const prompt = `You are a logistics analytics assistant specialized in logistics KPI analysis over a CSV dataset.
Use ONLY the provided data and derived calculations. Do not invent values.

Rules:
- If the user asks about delayed orders, provide a concise summary and mention the relevant delay vs on-time information from the dataset.
- If the user asks about carriers, identify the carrier with the highest delay rate based on the available data.
- If the user asks about delivery late last month or another time period, compute the result from the recent dataset and explain the time filter used.
- For forecasting or recommendation questions, provide a conservative estimate and clearly state that it is based on historical patterns.
- Always respond with valid JSON only in this shape:
{
  "answer": "string",
  "explanation": "string",
  "suggested_chart": "string",
  "filters": { "time_range": "string", "status": "string|null", "carrier": "string|null", "region": "string|null", "warehouse": "string|null", "metric": "string|null", "dimension": "string|null" },
  "data": ["array of objects"],
  "query_plan": "string",
  "metrics": ["array of strings"],
  "dimensions": ["array of strings"]
}
User question: ${question}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    return Response.json({ ok: false, error: data.error?.message || 'Gemini request failed.' });
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return Response.json({ ok: true, raw: text });
}
