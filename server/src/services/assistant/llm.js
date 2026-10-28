// Provider chain for the admin AI assistant.
// Order: every Groq key (default model openai/gpt-oss-20b), then every Gemini key (gemini-3.5-flash-lite).
// A slot that fails (rate limit, bad key, outage, malformed reply) is skipped for a while and the
// next slot is tried. Keys only ever come from environment variables and are never logged or sent
// to the browser.
import { callGroq } from './groq.js';
import { callGemini } from './gemini.js';

export const DEFAULTS = Object.freeze({
  groqMain: 'openai/gpt-oss-20b',
  groqFast: 'llama-3.1-8b-instant',
  gemini: 'gemini-3.5-flash-lite',
  geminiThinking: 'medium'
});

const MAX_KEYS_PER_PROVIDER = 5;

// Accepts one key, or several separated by commas, spaces or new lines.
function keyList(...values) {
  const keys = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const key of value.split(/[\s,;]+/)) if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.slice(0, MAX_KEYS_PER_PROVIDER);
}

export function buildSlots(env = process.env) {
  const groqKeys = keyList(env.GROQ_API_KEYS, env.GROQ_API_KEY, env.GROQ_API_KEY_1, env.GROQ_API_KEY_2, env.GROQ_API_KEY_3);
  const geminiKeys = keyList(env.GEMINI_API_KEYS, env.GEMINI_API_KEY, env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3);
  const groqMain = env.GROQ_MODEL || DEFAULTS.groqMain;
  const groqFast = env.GROQ_FAST_MODEL || DEFAULTS.groqFast;
  const geminiModel = env.GEMINI_MODEL || DEFAULTS.gemini;
  const thinking = env.GEMINI_THINKING_LEVEL === 'none' ? '' : (env.GEMINI_THINKING_LEVEL || DEFAULTS.geminiThinking);

  return [
    ...groqKeys.map((key, i) => ({ id: `groq#${i + 1}`, provider: 'groq', key, mainModel: groqMain, fastModel: groqFast })),
    ...geminiKeys.map((key, i) => ({ id: `gemini#${i + 1}`, provider: 'gemini', key, mainModel: geminiModel, fastModel: geminiModel, thinkingLevel: thinking }))
  ];
}

export function assistantConfigured(env = process.env) {
  return buildSlots(env).length > 0;
}

// Safe summary for the status endpoint: counts only, never keys.
export function providerSummary(env = process.env) {
  const slots = buildSlots(env);
  return { groq: slots.filter(s => s.provider === 'groq').length, gemini: slots.filter(s => s.provider === 'gemini').length };
}

// ---- Cooldowns: skip a slot that just failed instead of waiting for it again ----------------------
const cooldowns = new Map();

export function resetCooldowns() {
  cooldowns.clear();
}

export function isCooling(slot, now = Date.now()) {
  return (cooldowns.get(slot.id) || 0) > now;
}

export function markFailure(slot, error, now = Date.now()) {
  const upstream = error?.upstreamStatus;
  let ms = 15_000; // outage, timeout or malformed reply
  if (error?.status === 429) ms = 60_000; // rate limited
  else if (upstream === 401 || upstream === 403 || upstream === 404) ms = 10 * 60_000; // bad key or model name
  cooldowns.set(slot.id, now + ms);
}

export function callProvider(slot, params, fetchImpl = fetch) {
  return slot.provider === 'gemini' ? callGemini(slot, params, fetchImpl) : callGroq(slot, params, fetchImpl);
}
