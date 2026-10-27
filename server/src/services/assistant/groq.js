// Minimal Groq chat client (OpenAI-compatible API, plain fetch, no extra npm package needed).
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
export const DEFAULT_FAST_MODEL = 'llama-3.1-8b-instant';

export function assistantConfigured(env = process.env) {
  return Boolean(env.GROQ_API_KEY);
}

export function models(env = process.env) {
  return {
    main: env.GROQ_MODEL || DEFAULT_MODEL,
    fast: env.GROQ_FAST_MODEL || DEFAULT_FAST_MODEL
  };
}

function upstreamError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function callGroq({ model, messages, tools, maxTokens = 700, temperature = 0.2, timeoutMs = 20_000 }, env = process.env, fetchImpl = fetch) {
  const key = env.GROQ_API_KEY;
  if (!key) throw upstreamError(503, 'assistant_not_configured', 'AI assistant is not configured');

  const body = { model, messages, max_tokens: maxTokens, temperature, ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}) };
  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw upstreamError(503, 'assistant_unreachable', 'AI service is unreachable');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // Log the reason server-side only; never forward upstream details (or the key) to the browser.
    console.error('Groq API error', response.status, data?.error?.code, data?.error?.message);
    const malformedToolCall = response.status === 400 && data?.error?.code === 'tool_use_failed';
    throw Object.assign(
      upstreamError(response.status === 429 ? 429 : 502, malformedToolCall ? 'assistant_tool_call_failed' : 'assistant_upstream_error', 'AI service error'),
      { retryable: malformedToolCall }
    );
  }
  return data;
}
