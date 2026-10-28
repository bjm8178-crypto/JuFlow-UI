// Gemini adapter (REST generateContent, plain fetch). It accepts the same OpenAI-style messages and
// tools as the Groq adapter and returns an OpenAI-shaped reply, so chat.js does not care which
// provider answered. One call = one API key.
import { randomUUID } from 'node:crypto';
import { upstreamError } from './groq.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function parseJson(text, fallback = {}) {
  try {
    const value = JSON.parse(text);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

const asObject = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value });

export function toGeminiRequest(messages) {
  const system = [];
  const contents = [];
  const names = new Map(); // tool_call_id -> function name, needed for functionResponse parts

  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
    } else if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] });
    } else if (message.role === 'assistant') {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.tool_calls || []) {
        names.set(call.id, call.function.name);
        const part = { functionCall: { name: call.function.name, args: asObject(parseJson(call.function.arguments, {})) } };
        // Gemini 3 requires its own thought signatures to be sent back with its function calls.
        if (call.thought_signature) part.thoughtSignature = call.thought_signature;
        parts.push(part);
      }
      if (parts.length) contents.push({ role: 'model', parts });
    } else if (message.role === 'tool') {
      const part = { functionResponse: { name: names.get(message.tool_call_id) || 'tool', response: asObject(parseJson(message.content, { text: message.content })) } };
      const last = contents[contents.length - 1];
      // All results of one round go in a single user turn.
      if (last && last.role === 'user' && last.parts.every(p => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return { system: system.join('\n\n'), contents };
}

function toGeminiTools(tools) {
  const declarations = (tools || []).map(tool => {
    const fn = tool.function;
    const declaration = { name: fn.name, description: fn.description };
    // Gemini rejects an object schema with no properties, so no-argument tools omit `parameters`.
    if (fn.parameters && fn.parameters.properties && Object.keys(fn.parameters.properties).length) declaration.parameters = fn.parameters;
    return declaration;
  });
  return declarations.length ? [{ functionDeclarations: declarations }] : undefined;
}

export function fromGeminiResponse(data) {
  if (data?.promptFeedback?.blockReason) throw upstreamError(502, 'assistant_upstream_error', 'AI service error', { upstreamStatus: 200 });
  const candidate = data?.candidates?.[0];
  if (!candidate) throw upstreamError(502, 'assistant_upstream_error', 'AI service error', { upstreamStatus: 200 });
  if (candidate.finishReason === 'MALFORMED_FUNCTION_CALL') {
    throw upstreamError(502, 'assistant_tool_call_failed', 'AI service error', { upstreamStatus: 200, retryable: true });
  }
  const parts = candidate.content?.parts || [];
  const content = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
  const toolCalls = parts.filter(p => p.functionCall).map(p => ({
    id: `call_${randomUUID()}`,
    type: 'function',
    function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
    ...(p.thoughtSignature ? { thought_signature: p.thoughtSignature } : {})
  }));
  return { choices: [{ message: { content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } }] };
}

export async function callGemini(slot, { tier = 'main', messages, tools, maxTokens = 1500, timeoutMs = 25_000 }, fetchImpl = fetch) {
  const model = slot.mainModel; // Flash-Lite serves both the gatekeeper and the main answer
  const { system, contents } = toGeminiRequest(messages);
  const generationConfig = { maxOutputTokens: maxTokens };
  // Gemini 3.5+ rejects temperature/top_p/top_k, so they are never sent.
  // The default "minimal" thinking can stop tool use too early; the main answer uses a higher level.
  if (tier === 'main' && slot.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: slot.thinkingLevel };

  const body = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(toGeminiTools(tools) ? { tools: toGeminiTools(tools) } : {}),
    generationConfig
  };

  let response;
  try {
    response = await fetchImpl(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': slot.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw upstreamError(503, 'assistant_unreachable', 'AI service is unreachable');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('Gemini API error', slot.id, response.status, data?.error?.status, data?.error?.message);
    throw upstreamError(response.status === 429 ? 429 : 502, 'assistant_upstream_error', 'AI service error', { upstreamStatus: response.status });
  }
  return fromGeminiResponse(data);
}
