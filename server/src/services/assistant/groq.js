// Groq adapter (OpenAI-compatible chat completions, plain fetch, no extra npm package needed).
// One call = one API key. Key rotation and fallback to other providers live in llm.js.
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function upstreamError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

export async function callGroq(slot, { tier = 'main', messages, tools, maxTokens = 1500, temperature = 0.2, timeoutMs = 25_000 }, fetchImpl = fetch) {
  const model = tier === 'fast' ? slot.fastModel : slot.mainModel;
  const body = { model, messages, max_tokens: maxTokens, temperature, ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}) };
  // gpt-oss models reason before answering; keep it short so replies stay fast and cheap.
  if (/^openai\/gpt-oss/.test(model)) body.reasoning_effort = 'low';

  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${slot.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw upstreamError(503, 'assistant_unreachable', 'AI service is unreachable');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // Log the reason server-side only; never forward upstream details (or the key) to the browser.
    console.error('Groq API error', slot.id, response.status, data?.error?.code, data?.error?.message);
    const malformedToolCall = response.status === 400 && data?.error?.code === 'tool_use_failed';
    throw upstreamError(
      response.status === 429 ? 429 : 502,
      malformedToolCall ? 'assistant_tool_call_failed' : 'assistant_upstream_error',
      'AI service error',
      { upstreamStatus: response.status, retryable: malformedToolCall }
    );
  }
  return data;
}
