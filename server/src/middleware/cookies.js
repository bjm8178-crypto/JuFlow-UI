// Minimal cookie helpers (no dependency needed).
export const SESSION_COOKIE = 'juflow_session';

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;
    let val = part.slice(i + 1).trim();
    try { val = decodeURIComponent(val); } catch { /* keep raw */ }
    out[key] = val;
  }
  return out;
}

export function sessionCookie(token, maxAgeMs, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
