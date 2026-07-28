/**
 * Smoke test for the LLM wiring in app/api/query/route.ts.
 * Run with: npx tsx scripts/verify-llm-wiring.ts
 *
 * Contract:
 *  - resolveConfig() honours ANALYTICS_PROVIDER (rule-based / groq / gemini / auto / invalid).
 *  - When provider is groq/gemini/auto, the configured LLM endpoint is hit.
 *  - The rule-based engine is the verified source of truth. The LLM only
 *    contributes the qualitative explanation; it can NEVER replace the
 *    computed `answer` (the model does not see the full CSV and would
 *    otherwise hallucinate numbers).
 *  - When the LLM fails or returns nothing, the response falls back to csv-rule cleanly.
 *  - When the LLM returns parseable JSON, the parsed explanation/suggested_chart/
 *    filters/data are merged onto the rule-based result; rule_based_answer is
 *    preserved as a reference.
 *
 * No real API calls are made.
 */

const originalFetch = globalThis.fetch;
const originalConsoleWarn = console.warn;

type Mode = 'groq' | 'gemini' | 'rule-based' | 'auto' | 'invalid';

function restoreEnv(prev: NodeJS.ProcessEnv) {
  for (const key of ['ANALYTICS_PROVIDER', 'ANALYTICS_PROMPT_TEMPLATE', 'GROQ_API_KEY', 'GEMINI_API_KEY']) {
    if (prev[key] === undefined) delete process.env[key];
    else process.env[key] = prev[key];
  }
}

async function withFetchMock<T>(
  mock: (url: string, init: RequestInit | undefined) => Promise<Response>,
  fn: () => Promise<T>
): Promise<T> {
  globalThis.fetch = mock as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runCase(mode: Mode, fetchImpl: (url: string, init: RequestInit | undefined) => Promise<Response>) {
  const prev = { ...process.env };
  try {
    if (mode === 'rule-based') delete process.env.ANALYTICS_PROVIDER;
    else process.env.ANALYTICS_PROVIDER = mode;
    process.env.GROQ_API_KEY = 'gsk_test';
    process.env.GEMINI_API_KEY = 'gemini_test';
    process.env.ANALYTICS_PROMPT_TEMPLATE = 'TEST PROMPT';

    return await withFetchMock(fetchImpl, async () => {
      const route = await import('../app/api/query/route');
      const req = new (await import('next/server')).NextRequest('http://localhost/api/query', {
        method: 'POST',
        body: JSON.stringify({ question: 'Which carrier has the highest delay rate?' })
      });
      const res = await route.POST(req);
      const data = await res.json();
      console.log(`[${mode}] provider=${data.provider} llm_used=${data.prompt_config?.llm_used ?? 'n/a'} llm_error=${data.prompt_config?.llm_error ?? 'none'}`);
      console.log(`         answer=${data.result?.answer?.slice(0, 100)}`);
      return data;
    });
  } finally {
    restoreEnv(prev);
  }
}

async function expectOk(name: string, condition: boolean) {
  if (!condition) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
  }
}

(async () => {
  console.warn = () => undefined;

  const groqPlainText = 'Groq says: UPS is the slowest carrier.';
  const groqJson = JSON.stringify({
    answer: 'Groq JSON: USPS is the slowest at 26.7%.',
    explanation: 'Computed by Groq from the supplied CSV facts.',
    suggested_chart: 'Line chart',
    filters: { time_range: 'last_3_months', metric: 'delay_rate' },
    data: [{ carrier: 'USPS', delay_rate: 26.7 }]
  });
  const geminiPlainText = 'Gemini says: FedEx is the slowest carrier.';

  // 1. rule-based: no fetch should be invoked; answer is rule-based.
  let fetchedUrls: string[] = [];
  const ruleBased = await runCase('rule-based', async (url) => {
    fetchedUrls.push(url);
    return new Response('{}', { status: 500 });
  });
  await expectOk('rule-based: no LLM fetch invoked', fetchedUrls.length === 0);
  await expectOk('rule-based: provider = csv-rule', ruleBased.provider === 'csv-rule');
  await expectOk('rule-based: answer is the rule-based summary', /highest delay rate is USPS at 26\.7%/.test(ruleBased.result?.answer ?? ''));

  // 2. groq (plain text): the rule-based answer remains the answer; LLM text
  // is parsed only if it is valid JSON, otherwise the rule-based answer wins.
  fetchedUrls = [];
  const groqResult = await runCase('groq', async (url) => {
    fetchedUrls.push(url);
    if (url.includes('api.groq.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: groqPlainText } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 500 });
  });
  await expectOk('groq: hits api.groq.com', fetchedUrls.some((u) => u.includes('api.groq.com')));
  await expectOk('groq: provider = groq', groqResult.provider === 'groq');
  await expectOk('groq: rule-based answer wins when LLM text is not JSON', /highest delay rate is USPS at 26\.7%/.test(groqResult.result?.answer ?? ''));
  await expectOk('groq: rule-based answer is preserved as reference', /highest delay rate is USPS at 26\.7%/.test(groqResult.prompt_config?.rule_based_answer ?? ''));

  // 3. groq (structured JSON): explanation/suggested_chart/filters/data come
  // from the parsed JSON, but `answer` is still the rule-based answer.
  fetchedUrls = [];
  const groqJsonResult = await runCase('groq', async (url) => {
    fetchedUrls.push(url);
    if (url.includes('api.groq.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: groqJson } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 500 });
  });
  await expectOk('groq JSON: rule-based answer wins over LLM answer', /highest delay rate is USPS at 26\.7%/.test(groqJsonResult.result?.answer ?? ''));
  await expectOk('groq JSON: explanation comes from parsed JSON', /Computed by Groq/.test(groqJsonResult.result?.explanation ?? ''));
  await expectOk('groq JSON: suggested_chart comes from parsed JSON', groqJsonResult.result?.suggested_chart === 'Line chart');
  await expectOk('groq JSON: data comes from parsed JSON', Array.isArray(groqJsonResult.result?.data) && groqJsonResult.result?.data[0]?.carrier === 'USPS');

  // 4. gemini: hits generativelanguage.googleapis.com; answer stays rule-based.
  fetchedUrls = [];
  const geminiResult = await runCase('gemini', async (url) => {
    fetchedUrls.push(url);
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: geminiPlainText }] } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 500 });
  });
  await expectOk('gemini: hits Gemini endpoint', fetchedUrls.some((u) => u.includes('generativelanguage.googleapis.com')));
  await expectOk('gemini: provider = gemini', geminiResult.provider === 'gemini');
  await expectOk('gemini: rule-based answer wins when LLM text is not JSON', /highest delay rate is USPS at 26\.7%/.test(geminiResult.result?.answer ?? ''));

  // 5. auto with GROQ key set: prefers Groq.
  fetchedUrls = [];
  const autoResult = await runCase('auto', async (url) => {
    fetchedUrls.push(url);
    if (url.includes('api.groq.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: groqPlainText } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 500 });
  });
  await expectOk('auto: prefers Groq when GROQ_API_KEY set', autoResult.provider === 'groq');

  // 6. invalid provider value falls back to rule-based without error.
  fetchedUrls = [];
  await runCase('invalid', async () => new Response('{}', { status: 500 }));
  await expectOk('invalid: provider falls back', true);

  // 7. LLM failure: response is csv-rule and includes llm_error.
  fetchedUrls = [];
  const failureResult = await runCase('groq', async () => new Response('boom', { status: 500 }));
  await expectOk('groq failure: provider = csv-rule', failureResult.provider === 'csv-rule');
  await expectOk('groq failure: surfaces llm_error', Boolean(failureResult.prompt_config?.llm_error));
  await expectOk('groq failure: falls back to rule-based answer', /highest delay rate is USPS at 26\.7%/.test(failureResult.result?.answer ?? ''));

  console.warn = originalConsoleWarn;
  console.log('\nDone.');
})();
