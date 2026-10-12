import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseCookies, sessionCookie, clearSessionCookie, SESSION_COOKIE } from '../src/middleware/cookies.js';
import { checkCashierToken, cashierTokenAuth } from '../src/middleware/cashier.js';
import { validateSale } from '../src/lib/sale.js';
import { bootstrap } from '../src/db/bootstrap.js';

const good = () => ({
  transaction_id: 'T-1',
  items: [{ name: 'Adobo Rice', quantity: 2, price_centavos: 7500 }],
  total_centavos: 15000,
  payment_method: 'cash',
  cash_tendered_centavos: 20000,
});

describe('cookies', () => {
  it('parses cookie headers and ignores junk', () => {
    assert.deepEqual(parseCookies('a=1; juflow_session=abc%20d; bad; =x'), { a: '1', juflow_session: 'abc d' });
    assert.deepEqual(parseCookies(undefined), {});
  });
  it('first value wins for duplicate names', () => {
    assert.equal(parseCookies('juflow_session=one; juflow_session=two')[SESSION_COOKIE], 'one');
  });
  it('session cookie is HttpOnly, Lax, and Secure only when asked', () => {
    const c = sessionCookie('tok', 60_000, true);
    assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/); assert.match(c, /Secure/); assert.match(c, /Max-Age=60/);
    assert.doesNotMatch(sessionCookie('tok', 60_000, false), /Secure/);
    assert.match(clearSessionCookie(true), /Max-Age=0/);
  });
});

describe('cashier token', () => {
  const token = 'x'.repeat(40);
  it('accepts only the exact bearer token', () => {
    assert.equal(checkCashierToken('Bearer ' + token, token), true);
    assert.equal(checkCashierToken('Bearer ' + token + 'y', token), false);
    assert.equal(checkCashierToken('Basic ' + token, token), false);
    assert.equal(checkCashierToken(undefined, token), false);
  });
  it('fails closed when no (or a short) token is configured', () => {
    assert.equal(checkCashierToken('Bearer ', ''), false);
    assert.equal(checkCashierToken('Bearer short', 'short'), false);
    assert.equal(checkCashierToken('Bearer undefined', undefined), false);
  });
  it('middleware rejects with 401 and passes with a valid token', () => {
    process.env.CASHIER_API_TOKEN = token;
    let status; const res = { status(s) { status = s; return this; }, json() {} };
    cashierTokenAuth({ headers: {} }, res, () => assert.fail('should not pass'));
    assert.equal(status, 401);
    let passed = false; const req = { headers: { authorization: 'Bearer ' + token } };
    cashierTokenAuth(req, res, () => { passed = true; });
    assert.equal(passed, true); assert.equal(req.user.role_name, 'cashier');
    delete process.env.CASHIER_API_TOKEN;
  });
});

describe('validateSale', () => {
  it('accepts a valid sale and produces a stable digest', () => {
    const a = validateSale(good()), b = validateSale(good());
    assert.equal(a.sale.total_centavos, 15000);
    assert.equal(a.digest, b.digest);
  });
  it('digest changes when content changes (basis for the 409 conflict)', () => {
    const changed = good(); changed.items[0].quantity = 3; changed.total_centavos = 22500; changed.cash_tendered_centavos = 25000;
    assert.notEqual(validateSale(good()).digest, validateSale(changed).digest);
  });
  const bad = (mut, re) => { const s = good(); mut(s); assert.throws(() => validateSale(s), (e) => e.status === 400 && re.test(e.message)); };
  it('rejects tampered totals, bad quantities, prices and methods', () => {
    bad(s => { s.total_centavos = 1; }, /sum of the items/);
    bad(s => { s.items[0].quantity = -1; }, /quantity/);
    bad(s => { s.items[0].quantity = 1.5; }, /quantity/);
    bad(s => { s.items[0].price_centavos = 'abc'; }, /price/);
    bad(s => { s.items = []; }, /1 to 100/);
    bad(s => { s.payment_method = 'bitcoin'; }, /payment_method/);
    bad(s => { s.cash_tendered_centavos = 100; }, /cover the total/);
    bad(s => { s.is_test_sale = 'yes'; }, /boolean/);
  });
  it('requires a reference for GCash and ignores tender for it', () => {
    bad(s => { s.payment_method = 'gcash'; }, /gcash_reference/);
    const s = good(); s.payment_method = 'gcash'; s.gcash_reference = 'REF123';
    assert.equal(validateSale(s).sale.cash_tendered_centavos, null);
  });
  it('rejects non-objects', () => {
    assert.throws(() => validateSale(null)); assert.throws(() => validateSale([]));
  });
});

// Minimal in-memory fake of the Mongo collections bootstrap() touches
function fakeDb() {
  const data = { roles: new Map(), users: [] };
  return {
    data,
    collection(name) {
      if (name === 'roles') return { updateOne: async (f, u) => { if (!data.roles.has(f._id)) data.roles.set(f._id, u.$setOnInsert); } };
      return {
        findOne: async (f) => data.users.find(x => x.role_id === f.role_id) || null,
        insertOne: async (d) => { data.users.push(d); return { insertedId: 1 }; },
      };
    },
  };
}

describe('bootstrap', () => {
  it('creates roles but no admin without credentials', async () => {
    const db = fakeDb();
    const r = await bootstrap(db, {});
    assert.equal(r.createdAdmin, false); assert.equal(db.data.roles.size, 3); assert.equal(db.data.users.length, 0);
  });
  it('creates a hashed admin once, never twice', async () => {
    const db = fakeDb(), env = { ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'correct-horse-1' };
    assert.equal((await bootstrap(db, env)).createdAdmin, true);
    assert.equal(db.data.users.length, 1);
    assert.notEqual(db.data.users[0].password_hash, env.ADMIN_PASSWORD);
    assert.equal((await bootstrap(db, env)).createdAdmin, false);
    assert.equal(db.data.users.length, 1);
  });
  it('refuses a short admin password', async () => {
    const db = fakeDb();
    assert.equal((await bootstrap(db, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'short' })).createdAdmin, false);
  });
});
