import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ObjectId } from 'mongodb';
import salesRouter, * as sales from '../src/routes/sales.js';

const now = new Date('2026-10-12T16:00:00Z');
const cashier = { id: 'a'.repeat(24), role_name: 'cashier' };
const admin = { id: 'b'.repeat(24), role_name: 'admin' };
const productId = new ObjectId('c'.repeat(24));
const saleId = new ObjectId('d'.repeat(24));
const original = (changes = {}) => ({ _id: saleId, transaction_id: 'original', source: 'walk_in',
  items: [{ product_id: productId, name: 'Meal', quantity: 2, price_centavos: 100 }],
  food_centavos: 200, fee_centavos: 30, total_centavos: 230, payment_method: 'cash',
  sale_time: now, received_at: now, is_test_sale: false, voided_at: null, digest: 'private', ...changes });
const input = (changes = {}) => ({ event_id: 'return-1', reason: 'Wrong food', items: [{ index: 0, quantity: 2 }], refund_fee: true, ...changes });
const eq = (a, b) => String(a) === String(b);
function values(doc, key) {
  return key.split('.').reduce((list, part) => list.flatMap(value => Array.isArray(value) ? value.map(item => item?.[part]) : [value?.[part]]), [doc]);
}
function matches(doc, query) {
  return Object.entries(query).every(([key, expected]) => {
    const actual = values(doc, key);
    if (expected === null) return actual.some(value => value == null);
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
      return Object.entries(expected).every(([op, value]) => {
        if (op === '$ne') return actual.every(item => !eq(item, value));
        if (op === '$in') return actual.some(item => value.some(candidate => eq(item, candidate)));
        if (op === '$gte') return actual.some(item => item >= value);
        if (op === '$lt') return actual.some(item => item < value);
        throw new Error('Unsupported fixture operator ' + op);
      });
    }
    return actual.some(value => eq(value, expected));
  });
}
const clone = doc => ({ ...doc, ...(doc.items ? { items: doc.items.map(item => ({ ...item })) } : {}), ...(doc.refund_lines ? { refund_lines: doc.refund_lines.map(line => ({ ...line })) } : {}) });
const sortRows = (rows, sort) => rows.sort((a, b) => {
  for (const [key, direction] of Object.entries(sort)) {
    if (a[key] < b[key]) return -direction;
    if (a[key] > b[key]) return direction;
  }
  return 0;
});

// Snapshot fixture with per-document write conflicts and retry, NOT a serialized
// transaction queue. Independent insert-only transactions can both commit;
// touching the source sale is what makes concurrent refund attempts conflict.
async function fixture(t, initial = [original()]) {
  const state = { actor: cashier, rows: initial.map(clone), versions: new Map(), notified: [], retries: 0,
    notifierFails: false, concurrent: 0, arrivals: 0, release: null, gate: null, failInsert: false, forceWinner: null };
  const makeDb = (rows, session = null, writes = new Set()) => ({ collection(name) {
    if (name === 'daily_menu') return { findOne: async () => ({ product_ids: [productId] }) };
    if (name === 'products') return { findOne: async () => ({ _id: productId, name: 'Meal', price_centavos: 100 }) };
    assert.equal(name, 'sales');
    const check = options => { if (session) assert.equal(options?.session, session, 'all transactional operations use the same session'); };
    const update = (row, change) => {
      Object.assign(row, change.$set || {});
      for (const [key, amount] of Object.entries(change.$inc || {})) row[key] = (row[key] || 0) + amount;
      writes.add(String(row._id));
    };
    return {
      async findOne(query, options) { check(options); return rows.find(row => matches(row, query)) ?? null; },
      find(query, options) {
        check(options);
        let selected = rows.filter(row => matches(row, query));
        return { sort(order) { sortRows(selected, order); return this; }, limit(n) { selected = selected.slice(0, n); return this; }, async toArray() { return selected; } };
      },
      async updateOne(query, change, options) {
        check(options); const row = rows.find(row => matches(row, query));
        if (row) update(row, change);
        return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
      },
      async findOneAndUpdate(query, change, options) {
        check(options); const candidates = rows.filter(row => matches(row, query));
        if (options.sort) sortRows(candidates, options.sort);
        const row = candidates[0]; if (row) update(row, change);
        return row ?? null;
      },
      async insertOne(doc, options) {
        check(options);
        if (state.failInsert) throw new Error('insert failed');
        if (state.forceWinner) {
          state.rows.push(state.forceWinner); state.forceWinner = null;
          throw Object.assign(new Error('duplicate'), { code: 11000 });
        }
        if (rows.some(row => row.transaction_id === doc.transaction_id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        const _id = new ObjectId(); rows.push({ ...doc, _id }); writes.add(String(_id));
        return { insertedId: _id };
      },
      aggregate(stages) {
        const selected = rows.filter(row => matches(row, stages[0].$match));
        assert.deepEqual(stages[1].$facet.totals[0].$group.transaction_count, { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } });
        const totals = { total_centavos: 0, food_centavos: 0, fee_centavos: 0, transaction_count: 0, units_sold: 0 };
        for (const row of selected) {
          for (const key of ['total_centavos', 'food_centavos', 'fee_centavos']) totals[key] += row[key] ?? 0;
          totals.transaction_count += row.source === 'refund' ? 0 : 1;
          totals.units_sold += row.items.reduce((sum, item) => sum + item.quantity, 0);
        }
        return { toArray: async () => [{ totals: [totals], by_payment: [] }] };
      }
    };
  } });
  const database = () => makeDb(state.rows);
  const transaction = async work => {
    let waited = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const snapshot = state.rows.map(clone), base = new Map(state.versions), writes = new Set(), session = {};
      const result = await work(makeDb(snapshot, session, writes), session);
      if (state.concurrent && !waited) {
        waited = true; state.arrivals++;
        if (!state.gate) state.gate = new Promise(resolve => { state.release = resolve; });
        if (state.arrivals === state.concurrent) state.release();
        await state.gate;
      }
      if ([...writes].some(id => (state.versions.get(id) || 0) !== (base.get(id) || 0))) { state.retries++; continue; }
      for (const row of snapshot.filter(row => writes.has(String(row._id)))) {
        const duplicate = state.rows.find(other => !eq(other._id, row._id) && (other.transaction_id === row.transaction_id || (row.void_id && other.void_id === row.void_id)));
        if (duplicate) throw Object.assign(new Error('duplicate'), { code: 11000 });
      }
      for (const id of writes) {
        const row = snapshot.find(row => String(row._id) === id), index = state.rows.findIndex(row => String(row._id) === id);
        if (index === -1) state.rows.push(row); else state.rows[index] = row;
        state.versions.set(id, (state.versions.get(id) || 0) + 1);
      }
      return result;
    }
    throw new Error('fixture retries exhausted');
  };
  const deps = { database, transaction, clock: () => now, notifier: async (db, sale) => {
    if (state.notifierFails) throw new Error('notifier failed'); state.notified.push(sale);
  } };
  const app = express(); app.use(express.json());
  const routes = [['post', '/:id/refund', 'createRefundSaleHandler'], ['post', '/tap', 'createTapSaleHandler'],
    ['post', '/untap', 'createUntapSaleHandler'], ['get', '/today', 'createTodaySalesHandler'], ['get', '/today/list', 'createTodaySalesListHandler'], ['post', '/', 'createRecordSaleHandler']];
  for (const [method, path, factory] of routes) {
    if (!sales[factory]) continue;
    const route = salesRouter.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    app[method]('/api/sales' + (path === '/' ? '' : path), (req, res, next) => {
      if (!state.actor) return res.status(401).json({ error: 'missing_token' });
      req.user = state.actor; next();
    }, ...route.stack.slice(1, -1).map(layer => layer.handle), sales[factory](deps));
  }
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.code || 'server_error', message: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, method = 'POST', body = input()) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sales${path}`, { method,
      headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  return { state, request, deps };
}
const refundPath = `/${saleId}/refund`;

test('HTTP refund stores a negative sale and nets the original totals and units to zero', async t => {
  assert.equal(typeof sales.createRefundSaleHandler, 'function', 'refund handler provides database/transaction injection');
  const f = await fixture(t), created = await f.request(refundPath);
  assert.equal(created.status, 201);
  assert.equal(created.body.source, 'refund'); assert.equal(created.body.refund_of, String(saleId));
  assert.equal(created.body.total_centavos, -230); assert.equal(created.body.food_centavos, -200); assert.equal(created.body.fee_centavos, -30);
  assert.equal(created.body.items[0].quantity, -2); assert.equal(created.body.items[0].product_id, String(productId));
  assert.equal(created.body.recorded_by, cashier.id); assert.equal(created.body.sale_time, now.toISOString());
  const summary = await f.request('/today', 'GET');
  assert.equal(summary.body.total_centavos, 0); assert.equal(summary.body.food_centavos, 0); assert.equal(summary.body.fee_centavos, 0);
  assert.equal(summary.body.units_sold, 0); assert.equal(summary.body.transaction_count, 1);
  assert.equal(f.state.notified.length, 1); assert.equal(f.state.notified[0].source, 'refund');
  assert.equal(f.state.rows[0].has_refunds, true); assert.equal(f.state.rows[0].refund_version, 1);
});
