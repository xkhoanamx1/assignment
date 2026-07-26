import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { question } = await req.json();

  const grokKey = process.env.GROK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  const prompt = `You are a logistics analytics assistant. Always respond with JSON: {"answer": string, "explanation": string, "suggested_chart": string, "filters": string[]}. User question: ${question}`;

  const tryGrok = async () => {
    if (!grokKey) {
      throw new Error('GROK_API_KEY not configured');
    }

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${grokKey}`
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Grok request failed');
    }

    const text = data.choices?.[0]?.message?.content || '';
    return Response.json({ ok: true, provider: 'grok', raw: text });
  };

  const tryGemini = async () => {
    if (!geminiKey) {
      throw new Error('Gemini API key not configured');
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini request failed');
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return Response.json({ ok: true, provider: 'gemini', raw: text });
  };

  try {
    return await tryGrok();
  } catch (grokError) {
    try {
      return await tryGemini();
    } catch (geminiError) {
      return Response.json({
        ok: false,
        error: grokError instanceof Error ? grokError.message : 'Grok failed',
        fallbackError: geminiError instanceof Error ? geminiError.message : 'Gemini failed'
      });
    }
  }
}
