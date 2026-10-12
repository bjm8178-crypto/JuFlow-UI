import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Real HTTP requests against the real Express app. Every case here is rejected
// before any database call, so no MongoDB is needed.
process.env.NODE_ENV = 'production';
process.env.CORS_ORIGINS = 'https://juflow.vercel.app';
process.env.CASHIER_API_TOKEN = 'c'.repeat(48);

let server, base;
before(async () => {
  const { default: app } = await import('../src/index.js');
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const json = (path, init = {}) => fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });

describe('API surface (no database needed)', () => {
  it('health check works and sets security headers', async () => {
    const r = await json('/api/health');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, 'ok');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  it('unknown routes return a JSON 404', async () => {
    const r = await json('/api/nope');
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
  });

  it('protected routes require a session', async () => {
    for (const path of ['/api/users', '/api/orders', '/api/customers', '/api/sales/summary', '/api/deliveries', '/api/riders']) {
      assert.equal((await json(path)).status, 401, path);
    }
  });

  it('login rejects missing credentials without touching the database', async () => {
    const r = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(r.status, 400);
  });

  it('blocks cookie-authenticated writes from a foreign Origin (CSRF)', async () => {
    const r = await json('/api/orders', {
      method: 'POST', body: '{}',
      headers: { Origin: 'https://evil.example', Cookie: 'juflow_session=abc' },
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'bad_origin');
  });

  it('does not send CORS allow headers to an unlisted origin', async () => {
    const r = await json('/api/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const ok = await json('/api/health', { headers: { Origin: 'https://juflow.vercel.app' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://juflow.vercel.app');
  });

  it('cashier endpoint rejects missing/wrong tokens and requires a transaction_id', async () => {
    assert.equal((await json('/api/cashier/sales', { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await json('/api/cashier/sales', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const noId = await json('/api/cashier/sales', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer ' + 'c'.repeat(48) } });
    assert.equal(noId.status, 400);
    const tampered = await json('/api/cashier/sales', {
      method: 'POST', headers: { Authorization: 'Bearer ' + 'c'.repeat(48) },
      body: JSON.stringify({ transaction_id: 'T9', items: [{ name: 'x', quantity: 1, price_centavos: 100 }], total_centavos: 1 }),
    });
    assert.equal(tampered.status, 400);
    assert.match((await tampered.json()).message, /sum of the items/);
  });

  it('a user session cannot be used on the cashier endpoint', async () => {
    const r = await json('/api/cashier/sales', { method: 'POST', body: '{}', headers: { Cookie: 'juflow_session=abc' } });
    assert.equal(r.status, 401);
  });

  it('rate-limits repeated login attempts', async () => {
    let last;
    for (let i = 0; i < 25; i++) last = await json('/api/auth/login', { method: 'POST', body: '{}' });
    assert.equal(last.status, 429);
  });
});
