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

  const prompt = `You are a logistics analytics assistant. Always respond with JSON: {"answer": string, "explanation": string, "suggested_chart": string, "filters": string[]}. User question: ${question}`;

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
