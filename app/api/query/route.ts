import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ question: '' }));
  const { question } = body;
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const prompt = `You are a logistics analytics assistant. Respond with a valid JSON object containing answer, explanation, suggested_chart, and filters. User question: ${question}`;

  if (!groqKey) {
    return Response.json(
      {
        ok: false,
        error: 'GROQ_API_KEY is not configured on this environment.',
        hint: 'Add GROQ_API_KEY in Vercel Settings → Environment Variables and redeploy.'
      },
      { status: 500 }
    );
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a helpful logistics analytics assistant. Return only JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return Response.json(
        {
          ok: false,
          error: data.error?.message || 'Groq request failed.',
          hint: 'Check that GROQ_API_KEY is valid and that the account still has quota.'
        },
        { status: 502 }
      );
    }

    const text = data.choices?.[0]?.message?.content || '';
    return Response.json({ ok: true, provider: 'groq', raw: text });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected Groq error.'
      },
      { status: 502 }
    );
  }
}
