import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { question } = await req.json();

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  const prompt = `You are a logistics analytics assistant. Respond with a valid JSON object containing answer, explanation, suggested_chart, and filters. User question: ${question}`;

  const tryGroq = async () => {
    if (!groqKey) {
      throw new Error('GROQ_API_KEY not configured');
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`
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

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Groq request failed');
    }

    const text = data.choices?.[0]?.message?.content || '';
    return Response.json({ ok: true, provider: 'groq', raw: text });
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
    return await tryGroq();
  } catch (groqError) {
    try {
      return await tryGemini();
    } catch (geminiError) {
      return Response.json({
        ok: false,
        error: groqError instanceof Error ? groqError.message : 'Groq failed',
        fallbackError: geminiError instanceof Error ? geminiError.message : 'Gemini failed'
      });
    }
  }
}
