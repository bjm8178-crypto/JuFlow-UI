import crypto from 'crypto';

/**
 * Authenticates the cashier device with a static secret (CASHIER_API_TOKEN),
 * as described in CASHIER_INTEGRATION.md. Fails closed when no token is configured.
 */
export function checkCashierToken(authHeader, expected) {
  if (!expected || expected.length < 24) return false;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return false;
  const a = crypto.createHash('sha256').update(authHeader.slice(7)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function cashierTokenAuth(req, res, next) {
  if (!checkCashierToken(req.headers.authorization, process.env.CASHIER_API_TOKEN)) {
    return res.status(401).json({ error: 'invalid_cashier_token', message: 'Cashier API token required' });
  }
  // Not a real user id on purpose: toObjectId() returns null for it, so recorded_by stays null.
  req.user = { id: 'cashier-device', username: 'cashier-device', role_name: 'cashier' };
  next();
}
