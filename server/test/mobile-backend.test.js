import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ObjectId } from 'mongodb';
import salesRouter, { cashierRouter, createTodaySalesHandler, createRecordSaleHandler } from '../src/routes/sales.js';
import { attachOrder } from '../src/routes/deliveries.js';
import { validateSale } from '../src/lib/sale.js';

const now = new Date('2026-10-12T16:00:00.000Z');
const cashier = { id: 'a'.repeat(24), role_name: 'cashier' };
const otherCashier = { id: 'b'.repeat(24), role_name: 'cashier' };
const admin = { id: 'c'.repeat(24), role_name: 'admin' };
const riderUser = { id: 'd'.repeat(24), role_name: 'rider' };
const device = { id: 'cashier-device', role_name: 'cashier' };
const input = (changes = {}) => ({ transaction_id: 'offline-1', items: [{ name: 'Meal', quantity: 2, price_centavos: 100 }], fee_centavos: 30, total_centavos: 230, payment_method: 'cash', ...changes });
const matches = (doc, query) => Object.entries(query).every(([key, expected]) => {
  if (expected === null) return doc[key] == null;
  if (expected && '$ne' in Object(expected)) return String(doc[key]) !== String(expected.$ne);
  if (expected && '$gte' in Object(expected)) return doc[key] >= expected.$gte && doc[key] < expected.$lt;
  return String(doc[key]) === String(expected);
});
const authFixture = state => (req, res, next) => {
  if (!state.actor) return res.status(401).json({ error: 'missing_token' });
  req.user = state.actor;
  next();
};
async function serve(t, app) {
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.code || 'server_error', message: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
}

// Like the existing fulfillment fixtures, this uses no live database. It checks
// the actual Mongo pipeline contract and models selection and unique-key races.
async function salesFixture(t, rows = []) {
  const state = { actor: cashier, raceWinner: null, notified: [], notifierFails: false }, pipelines = [];
  const db = { collection(name) {
    assert.equal(name, 'sales');
    return {
      async findOne(query) { return rows.find(doc => matches(doc, query)) ?? null; },
      async insertOne(sale) {
        if (state.raceWinner) { rows.push(state.raceWinner); state.raceWinner = null; throw Object.assign(new Error('Duplicate'), { code: 11000 }); }
        if (rows.some(doc => doc.transaction_id === sale.transaction_id)) throw Object.assign(new Error('Duplicate'), { code: 11000 });
        const _id = new ObjectId(); rows.push({ ...sale, _id }); return { insertedId: _id };
      },
      aggregate(stages) {
        pipelines.push(stages);
        assert.equal(stages.length, 2);
        assert.deepEqual(stages[1], { $facet: {
          totals: [{ $group: { _id: null, total_centavos: { $sum: '$total_centavos' }, food_centavos: { $sum: { $ifNull: ['$food_centavos', '$total_centavos'] } }, fee_centavos: { $sum: '$fee_centavos' }, transaction_count: { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } }, units_sold: { $sum: { $sum: '$items.quantity' } } } }, { $project: { _id: 0 } }],
          by_payment: [{ $group: { _id: '$payment_method', total_centavos: { $sum: '$total_centavos' }, transaction_count: { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } } } }, { $sort: { _id: 1 } }]
        } });
        const selected = rows.filter(doc => matches(doc, stages[0].$match));
        const total = { total_centavos: 0, food_centavos: 0, fee_centavos: 0, transaction_count: 0, units_sold: 0 }, payments = new Map();
        for (const row of selected) {
          total.total_centavos += row.total_centavos;
          total.food_centavos += row.food_centavos ?? row.total_centavos;
          total.fee_centavos += row.fee_centavos ?? 0;
          if (row.source !== 'refund') total.transaction_count++;
          total.units_sold += row.items.reduce((sum, item) => sum + item.quantity, 0);
          const payment = payments.get(row.payment_method) ?? { _id: row.payment_method, total_centavos: 0, transaction_count: 0 };
          payment.total_centavos += row.total_centavos; if (row.source !== 'refund') payment.transaction_count++;
          payments.set(row.payment_method, payment);
        }
        return { async toArray() { return [{ totals: selected.length ? [total] : [], by_payment: [...payments.values()].sort((a, b) => a._id.localeCompare(b._id)) }]; } };
      }
    };
  } };
  const app = express();
  app.use(express.json());
  const dependencies = { database: () => db, clock: () => now, notifier: async (database, sale) => { assert.equal(database, db); if (state.notifierFails) throw new Error('notifier down'); state.notified.push(sale); } };
  // Retain the real routes' role middleware while replacing only session auth
  // and injecting database/clock into their real final handlers.
  for (const [method, path, handler] of [['get', '/today', createTodaySalesHandler(dependencies)], ['post', '/', createRecordSaleHandler(dependencies)]]) {
    const route = salesRouter.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    app[method]('/api/sales' + (path === '/' ? '' : path), authFixture(state), ...route.stack.slice(1, -1).map(layer => layer.handle), handler);
  }
  app.post('/api/cashier/sales', (req, res, next) => { req.user = device; next(); }, ...cashierRouter.stack[0].route.stack.slice(0, -1).map(layer => layer.handle), createRecordSaleHandler(dependencies));
  return { state, rows, pipelines, request: await serve(t, app) };
}

test('today sales and sale recording are admin/cashier-only', async t => {
  const s = await salesFixture(t);
  for (const actor of [riderUser, { ...admin, role_name: 'kitchen' }]) {
    s.state.actor = actor;
    assert.equal((await s.request('/api/sales/today')).status, 403);
    assert.equal((await s.request('/api/sales', 'POST', input())).status, 403);
  }
  s.state.actor = null;
  assert.equal((await s.request('/api/sales/today')).status, 401);
  assert.equal((await s.request('/api/sales', 'POST', input())).status, 401);
  assert.equal(s.pipelines.length, 0); assert.equal(s.rows.length, 0);
});

test('a recorded sale notifies the admin; a failing notifier never loses the sale', async t => {
  const s = await salesFixture(t);
  assert.equal((await s.request('/api/sales', 'POST', input({ transaction_id: 'n-1' }))).status, 201);
  assert.equal(s.state.notified.length, 1);
  assert.equal(s.state.notified[0].transaction_id, 'n-1');
  s.state.notifierFails = true;
  assert.equal((await s.request('/api/sales', 'POST', input({ transaction_id: 'n-2' }))).status, 201);
  assert.equal(s.rows.length, 2);
  // A retried (duplicate) request must not notify twice.
  s.state.notifierFails = false;
  assert.equal((await s.request('/api/sales', 'POST', input({ transaction_id: 'n-1' }))).status, 200);
  assert.equal(s.state.notified.length, 1);
});


test('today summary is shop-wide: Manila day, cents, payment breakdown, refunds net out', async t => {
  const row = (time, amount, method, actor = cashier, changes = {}) => ({ sale_time: new Date(time), total_centavos: amount, recorded_by: actor ? new ObjectId(actor.id) : null, is_test_sale: false, payment_method: method, items: [{ quantity: 1 }], ...changes });
  const f = await salesFixture(t, [
    row('2026-10-12T15:59:59.999Z', 9999, 'cash'),
    row(now, 230, 'cash', cashier, { food_centavos: 200, fee_centavos: 30, items: [{ quantity: 2 }] }),
    row('2026-10-13T00:00:00Z', 110, 'exact'),
    row('2026-10-13T15:59:59.999Z', 350, 'gcash', cashier, { source: 'order' }),
    row(now, 500, 'gcash', otherCashier), row(now, 90, 'cash', null, { source: 'device' }),
    row(now, 700, 'cash', cashier, { is_test_sale: true }),
    row('2026-10-13T16:00:00Z', 9999, 'cash')
  ]);
  // Query-string attempts to widen the range or pick another cashier are ignored.
  const today = await f.request('/api/sales/today?recorded_by=' + otherCashier.id + '&date=2000-01-01&from=2000-01-01&to=2099-01-01');
  assert.equal(today.status, 200);
  assert.deepEqual(today.body, { date: '2026-10-13', timezone: 'Asia/Manila', total_centavos: 1280, food_centavos: 1250, fee_centavos: 30, transaction_count: 5, units_sold: 6, by_payment: [
    { _id: 'cash', total_centavos: 320, transaction_count: 2 }, { _id: 'exact', total_centavos: 110, transaction_count: 1 }, { _id: 'gcash', total_centavos: 850, transaction_count: 2 }
  ] });
  assert.deepEqual(f.pipelines[0][0].$match, { sale_time: { $gte: now, $lt: new Date('2026-10-13T16:00:00Z') }, voided_at: null, is_test_sale: { $ne: true } });
  f.state.actor = admin;
  assert.equal((await f.request('/api/sales/today')).body.total_centavos, 1280);
  f.state.actor = cashier;
  // Test/demo sales can no longer be requested: the is_test parameter is ignored.
  assert.equal((await f.request('/api/sales/today?is_test=all')).body.total_centavos, 1280);
  assert.equal((await f.request('/api/sales/today?is_test=true')).body.total_centavos, 1280);
  assert.equal((await f.request('/api/sales/today?source=order')).body.total_centavos, 350);
});

test('a refund row lowers the totals but is not counted as a transaction', async t => {
  const f = await salesFixture(t, [
    { sale_time: now, total_centavos: 230, food_centavos: 200, fee_centavos: 30, payment_method: 'cash', is_test_sale: false, source: 'walk_in', items: [{ quantity: 2 }] },
    { sale_time: now, total_centavos: -100, food_centavos: -100, fee_centavos: 0, payment_method: 'cash', is_test_sale: false, source: 'refund', items: [{ quantity: -1 }] }
  ]);
  const body = (await f.request('/api/sales/today')).body;
  assert.equal(body.total_centavos, 130);
  assert.equal(body.units_sold, 1);
  assert.equal(body.transaction_count, 1);
  assert.equal((await f.request('/api/sales/today?source=refund')).body.total_centavos, -100);
});


test('today summary returns zero totals when empty and validates reporting filters', async t => {
  const f = await salesFixture(t);
  assert.deepEqual((await f.request('/api/sales/today')).body, { date: '2026-10-13', timezone: 'Asia/Manila', total_centavos: 0, food_centavos: 0, fee_centavos: 0, transaction_count: 0, units_sold: 0, by_payment: [] });
  for (const query of ['source=invalid', 'source[x]=order']) {
    assert.equal((await f.request('/api/sales/today?' + query)).status, 400);
  }
  assert.equal(f.pipelines.length, 1);
});

test('session cashiers sync offline walk-ins through the inclusive seven-day limit with trusted attribution', async t => {
  const f = await salesFixture(t);
  for (const [index, occurred_at] of ['2026-10-05T16:00:00.000Z', '2026-10-11T16:00:00.000Z'].entries()) {
    const result = await f.request('/api/sales', 'POST', input({ transaction_id: `offline-${index}`, occurred_at, recorded_by: otherCashier.id, source: 'order', received_at: '2000-01-01T00:00:00Z' }));
    assert.equal(result.status, 201); assert.equal(result.body.recorded_by, cashier.id);
    assert.equal(result.body.recorded_actor, cashier.id); assert.equal(result.body.recorded_role, 'cashier');
    assert.equal(result.body.source, 'walk_in'); assert.equal(result.body.order_id, null);
    assert.equal(result.body.sale_time, occurred_at); assert.equal(result.body.occurred_at, occurred_at);
    assert.equal(result.body.received_at, now.toISOString());
  }
  assert.equal((await f.request('/api/sales/today')).body.transaction_count, 0);
  const online = await f.request('/api/sales', 'POST', input({ transaction_id: 'online' }));
  assert.equal(online.status, 201); assert.equal(online.body.sale_time, now.toISOString());
});

test('offline sync retains timestamp/money validation and cannot bypass or reserve order settlement', async t => {
  const f = await salesFixture(t);
  for (const changes of [{ occurred_at: '2026-10-05T15:59:59.999Z' }, { occurred_at: '2026-10-12T16:05:00.001Z' }, { occurred_at: '2026-10-12T16:00:00+00:00' }, { occurred_at: '2026-02-30T00:00:00Z' }, { total_centavos: 1 }, { cash_tendered_centavos: 229 }, { payment_method: 'gcash', gcash_reference: '' }]) {
    assert.equal((await f.request('/api/sales', 'POST', input(changes))).status, 400);
  }
  for (const path of ['/api/sales', '/api/cashier/sales']) {
    for (const changes of [{ order_id: 'e'.repeat(24) }, { transaction_id: ' order:' + 'e'.repeat(24) + ' ' }]) {
      const result = await f.request(path, 'POST', input(changes));
      assert.equal(result.status, 400); assert.equal(result.body.error, 'settlement_required');
    }
  }
  assert.equal(f.rows.length, 0);
});

test('offline sale retries are idempotent but changed content and other owners conflict without disclosure', async t => {
  const f = await salesFixture(t), body = input({ occurred_at: '2026-10-11T16:00:00.000Z' });
  const created = await f.request('/api/sales', 'POST', body);
  const replay = await f.request('/api/sales', 'POST', body);
  assert.equal(created.status, 201); assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { ...created.body, duplicate: true });
  for (const changes of [{ occurred_at: now.toISOString() }, { fee_centavos: 40, total_centavos: 240 }, { payment_method: 'exact' }, { items: [{ name: 'Other', quantity: 2, price_centavos: 100 }] }]) {
    assert.equal((await f.request('/api/sales', 'POST', { ...body, ...changes })).status, 409);
  }
  for (const actor of [otherCashier, admin]) {
    f.state.actor = actor;
    const conflict = await f.request('/api/sales', 'POST', body);
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'transaction_conflict');
    assert.equal(conflict.body.items, undefined); assert.equal(conflict.body.recorded_by, undefined);
  }
  assert.equal((await f.request('/api/cashier/sales', 'POST', body)).status, 409);
  assert.equal(f.rows.length, 1); assert.equal(String(f.rows[0].recorded_by), cashier.id);
});

test('duplicate-key retries resolve the winner once and recheck ownership on the race path', async t => {
  const f = await salesFixture(t), body = input();
  const attempts = await Promise.all(Array.from({ length: 8 }, () => f.request('/api/sales', 'POST', body)));
  assert.equal(attempts.filter(r => r.status === 201).length, 1);
  assert.equal(attempts.filter(r => r.status === 200 && r.body.duplicate).length, 7);
  assert.equal(new Set(attempts.map(r => r.body._id)).size, 1); assert.equal(f.rows.length, 1);
  for (const actor of [cashier, otherCashier]) {
    const racedBody = input({ transaction_id: `race-${actor.id}` });
    const { sale, digest } = validateSale(racedBody, { now });
    f.state.raceWinner = { ...sale, digest, _id: new ObjectId(), source: 'walk_in', recorded_by: new ObjectId(actor.id) };
    const result = await f.request('/api/sales', 'POST', racedBody);
    assert.equal(result.status, actor === cashier ? 200 : 409);
    if (actor === cashier) assert.equal(result.body.duplicate, true);
    else assert.equal(result.body.items, undefined);
  }
});

test('device offline sales remain idempotent and cannot be claimed by session cashiers', async t => {
  const f = await salesFixture(t), body = input({ occurred_at: '2026-10-05T16:00:00.000Z' });
  const created = await f.request('/api/cashier/sales', 'POST', body);
  assert.equal(created.status, 201); assert.equal(created.body.source, 'device'); assert.equal(created.body.recorded_by, null);
  const retry = await f.request('/api/cashier/sales', 'POST', body);
  assert.equal(retry.status, 200); assert.deepEqual(retry.body, { ...created.body, duplicate: true });
  assert.equal((await f.request('/api/sales', 'POST', body)).status, 409);
  assert.equal(f.rows.length, 1);
});

test('delivery reads choose the latest observation with deterministic ties and no unassigned location', async () => {
  const riderId = new ObjectId(), anotherRider = new ObjectId();
  const locations = [
    { _id: new ObjectId('1'.repeat(24)), rider_id: riderId, occurred_at: new Date('2026-10-12T15:00:00Z'), received_at: now },
    { _id: new ObjectId('2'.repeat(24)), rider_id: riderId, occurred_at: now, received_at: now },
    { _id: new ObjectId('3'.repeat(24)), rider_id: riderId, occurred_at: now, received_at: new Date(now.getTime() + 1) },
    { _id: new ObjectId('4'.repeat(24)), rider_id: riderId, occurred_at: now, received_at: new Date(now.getTime() + 1) },
    { _id: new ObjectId('5'.repeat(24)), rider_id: anotherRider, occurred_at: new Date(now.getTime() + 1000), received_at: now }
  ];
  let locationReads = 0;
  const db = { collection(name) { return { async findOne(query, options) {
    if (name === 'orders') return { _id: query._id, order_number: 'JU-1' };
    if (name === 'riders') return { _id: riderId, full_name: 'Rider' };
    assert.equal(name, 'rider_locations'); locationReads++;
    assert.deepEqual(options.sort, { occurred_at: -1, received_at: -1, _id: -1 });
    return locations.filter(doc => matches(doc, query)).sort((a, b) => {
      for (const [key, direction] of Object.entries(options.sort)) {
        if (a[key] < b[key]) return -direction;
        if (a[key] > b[key]) return direction;
      }
      return 0;
    })[0] ?? null;
  } }; } };
  const delivery = { _id: new ObjectId(), order_id: new ObjectId(), rider_id: riderId };
  for (const actor of [admin, cashier, riderUser]) {
    const result = await attachOrder(db, delivery, actor);
    assert.equal(result.latest_location, locations[3]);
    assert.equal(!!result.rider, actor.role_name !== 'rider');
  }
  assert.equal((await attachOrder(db, { ...delivery, rider_id: null }, admin)).latest_location, null);
  assert.equal(locationReads, 3);
  assert.equal((await attachOrder(db, { ...delivery, rider_id: new ObjectId() }, admin)).latest_location, null);
});
