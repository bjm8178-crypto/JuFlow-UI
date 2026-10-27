// Minimal Anthropic Messages API client (plain fetch, no extra npm package needed).
const API_URL = 'https://api.anthropic.com/v1/messages';

export function assistantConfigured(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export async function callClaude({ model, system, messages, tools, maxTokens = 1024, timeoutMs = 45_000 }, env = process.env, fetchImpl = fetch) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('AI assistant is not configured'), { status: 503, code: 'assistant_not_configured' });

  const body = { model, max_tokens: maxTokens, system, messages, ...(tools && tools.length ? { tools } : {}) };
  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    throw Object.assign(new Error('AI service is unreachable'), { status: 503, code: 'assistant_unreachable', cause });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // Log the reason server-side only; never forward upstream details to the browser.
    console.error('Anthropic API error', response.status, data?.error?.type, data?.error?.message);
    throw Object.assign(new Error('AI service error'), { status: response.status === 429 ? 429 : 502, code: 'assistant_upstream_error' });
  }
  return data;
}
