import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from '../src/db/mongodb.js';
import { validateOrder, calculateOrder, digest } from '../src/lib/order.js';
import { canTransitionDelivery, getOrderNextStatusForAction } from '../src/lib/order-state.js';
import { createOrder, mutateFulfillment, deliveryScope, patchNotes } from '../src/services/fulfillment.js';
import { getNextOrderNumber } from '../src/services/order-number.js';

const customerId = new ObjectId('507f1f77bcf86cd799439011');
const productId = new ObjectId('507f1f77bcf86cd799439012');
const admin = { id: '507f1f77bcf86cd799439013', role_name: 'admin' };
const cashier = { id: '507f1f77bcf86cd799439014', role_name: 'cashier' };
const riderUser = { id: '507f1f77bcf86cd799439015', role_name: 'rider' };
const riderId = new ObjectId('507f1f77bcf86cd799439016');
const body = () => ({ customer_id: String(customerId), idempotency_key: 'intake-1',
  items: [{ product_id: String(productId), quantity: 2 }], fee_centavos: 50, payment_method: 'exact' });
const clone = value => value instanceof ObjectId ? new ObjectId(value) : value instanceof Date ? new Date(value) :
  Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
function matches(doc, query) {
  return Object.entries(query).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
      if ('$ne' in expected) return String(actual) !== String(expected.$ne);
      if ('$exists' in expected) return Object.hasOwn(doc, key) === expected.$exists;
      if ('$in' in expected) return expected.$in.some(value => String(actual) === String(value));
    }
    return String(actual) === String(expected);
  });
}

// Deliberately no MongoClient/connect or environment-based database URI. This
// fake models transaction rollback and checks every mutation receives a session;
// it is not evidence of MongoDB's live concurrency/retry behavior.
function fixture() {
  let tables = {
    customers: [{ _id: customerId, name: 'Database Customer', phone: '123', address: 'Server address', is_active: true }],
    products: [{ _id: productId, name: 'Menu meal', price_centavos: 100, is_active: true, is_available: true }],
    riders: [{ _id: riderId, user_id: new ObjectId(riderUser.id), full_name: 'Rider', is_active: true, is_available: true }],
    users: [{ _id: new ObjectId(riderUser.id), role_id: 3, is_active: true }], roles: [{ _id: 3, name: 'rider' }],
    orders: [], deliveries: [], counters: [], audit_events: [], fulfillment_events: [], sales: []
  };
  let failCollection = null;
  const session = { fake: true };
  const requireSession = options => assert.equal(options?.session, session, 'mutation must use the transaction session');
  const db = { collection(name) {
    tables[name] ??= [];
    return {
      async findOne(query) { return clone(tables[name].find(doc => matches(doc, query)) ?? null); },
      find(query) { return { async toArray() { return clone(tables[name].filter(doc => matches(doc, query))); } }; },
      async insertOne(doc, options) {
        requireSession(options);
        doc._id ??= new ObjectId();
        if (failCollection === name) throw new Error(`Injected ${name} failure`);
        if (tables[name].some(other => String(other._id) === String(doc._id) ||
          name === 'orders' && (other.idempotency_key === doc.idempotency_key || other.order_number === doc.order_number))) {
          throw Object.assign(new Error('Duplicate key'), { code: 11000 });
        }
        tables[name].push(clone(doc)); return { insertedId: doc._id };
      },
      async updateOne(query, update, options) {
        requireSession(options);
        let doc = tables[name].find(doc => matches(doc, query));
        if (!doc && options?.upsert) { doc = { ...query, ...clone(update.$setOnInsert) }; tables[name].push(doc); }
        if (doc) { Object.assign(doc, clone(update.$set)); for (const [key, n] of Object.entries(update.$inc ?? {})) doc[key] = (doc[key] ?? 0) + n; }
        return { matchedCount: doc ? 1 : 0 };
      },
      async findOneAndUpdate(query, update, options) {
        requireSession(options);
        const doc = tables[name].find(doc => matches(doc, query));
        if (!doc) return null;
        Object.assign(doc, clone(update.$set));
        for (const [key, n] of Object.entries(update.$inc ?? {})) doc[key] = (doc[key] ?? 0) + n;
        return clone(doc);
      }
    };
  } };
  let tail = Promise.resolve();
  const transaction = work => {
    const task = tail.then(async () => {
      const before = clone(tables);
      try { return await work(db, session); }
      catch (error) { tables = before; throw error; }
    });
    tail = task.catch(() => {});
    return task;
  };
  return { db, transaction, session, get tables() { return tables; }, fail(name) { failCollection = name; } };
}

async function intake(f, input = body()) {
  return (await createOrder({ ...f, body: input, actor: admin })).order;
}
let eventSeq = 0;
async function act(f, order, operation, extra = {}, actor = cashier) {
  const current = f.tables.orders.find(doc => String(doc._id) === String(order._id));
  return mutateFulfillment({ ...f, entity: 'order', entityId: String(order._id), operation,
    body: { version: current.version, event_id: `event-${++eventSeq}`, ...extra }, actor });
}
async function ready(f, order) { await act(f, order, 'set_preparing'); await act(f, order, 'set_ready'); }
async function assign(f, order) { await ready(f, order); await act(f, order, 'assign', { rider_id: String(riderId) }); }
async function event(f, delivery, operation, extra = {}, actor = riderUser, settlement) {
  const current = f.tables.deliveries.find(doc => String(doc._id) === String(delivery._id));
  return mutateFulfillment({ ...f, entity: 'delivery', entityId: String(delivery._id), operation,
    body: { version: current.version, event_id: `event-${++eventSeq}`, ...extra }, actor, settlement });
}
async function reported(f, order) {
  await assign(f, order);
  const delivery = f.tables.deliveries[0];
  for (const step of ['picked_up', 'on_the_way', 'arrived', 'report_delivered']) await event(f, delivery, step);
  return delivery;
}

describe('strict authoritative order intake', () => {
  it('requires customer ObjectId, nontruncated stable key and strict numeric fields', () => {
    for (const change of [ { customer_id: 'bad' }, { customer_id: null, customer: { name: 'x' } },
      { idempotency_key: '' }, { idempotency_key: 'x'.repeat(121) }, { fee_centavos: '50' }, { fee_centavos: true },
      { items: [{ name: 'x', quantity: true, price_centavos: 1 }] },
      { items: [{ name: 'x', quantity: 1.5, price_centavos: 1 }] },
      { items: [{ name: 'x', quantity: 1 }] }, { items: Array(101).fill({ name: 'x', quantity: 1, price_centavos: 1 }) },
      { payment_method: 'gcash' }, { payment_method: 'unsupported' } ]) {
      assert.throws(() => validateOrder({ ...body(), ...change }), error => error.status === 400);
    }
  });
  it('rejects unsafe arithmetic, zero total, mismatched totals and insufficient tender', () => {
    const input = validateOrder({ ...body(), items: [{ name: 'manual', quantity: 1, price_centavos: 1 }] });
    for (const items of [[{ quantity: 1000, unit_price_centavos: Number.MAX_SAFE_INTEGER }], [{ quantity: 1, unit_price_centavos: 0 }]]) {
      assert.throws(() => calculateOrder({ ...input, fee_centavos: 0 }, items));
    }
    assert.throws(() => calculateOrder({ ...input, submitted_total_centavos: 1 }, [{ quantity: 1, unit_price_centavos: 100 }]));
    assert.throws(() => calculateOrder({ ...input, payment_method: 'cash', cash_tendered_centavos: 1 }, [{ quantity: 1, unit_price_centavos: 100 }]));
  });
  it('snapshots DB customer, ignores submitted catalog prices, and records manual pricing actor', async () => {
    const f = fixture();
    const order = await intake(f, { ...body(), customer_snapshot: { name: 'Fake' },
      items: [{ product_id: String(productId), quantity: 2, unit_price_centavos: 1 }, { name: 'Manual extra', quantity: 1, price_centavos: 20 }] });
    assert.equal(order.customer.name, 'Database Customer');
    assert.equal(order.items[0].unit_price_centavos, 100);
    assert.equal(order.items[0].price_centavos, 100);
    assert.equal(order.items[1].pricing_source, 'manual');
    assert.equal(String(order.items[1].priced_by), admin.id);
    assert.equal(order.total_centavos, 270);
    assert.equal(order.version, 0);
    assert.equal(f.tables.deliveries[0].status, 'pending');
    assert.equal(f.tables.audit_events[0].performed_role, 'admin');
  });
  it('rejects inactive customers/products and unauthorized manual intake', async () => {
    const f = fixture(); f.tables.customers[0].is_active = false;
    await assert.rejects(intake(f), error => error.code === 'customer_not_found');
    f.tables.customers[0].is_active = true; f.tables.products[0].is_available = false;
    await assert.rejects(intake(f), error => error.code === 'invalid_product');
    await assert.rejects(createOrder({ ...f, body: body(), actor: riderUser }), error => error.status === 403);
  });
  it('rolls back order, delivery, counter and audit on child insertion failure', async () => {
    for (const collection of ['deliveries', 'audit_events']) {
      const f = fixture(); f.fail(collection);
      await assert.rejects(intake(f), /Injected/);
      for (const name of ['orders', 'deliveries', 'counters', 'audit_events']) assert.equal(f.tables[name].length, 0);
    }
  });
  it('identical concurrent retries share one order; changed content conflicts even after catalog mutation', async () => {
    const f = fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => createOrder({ ...f, body: body(), actor: admin })));
    assert.equal(new Set(results.map(result => String(result.order._id))).size, 1);
    assert.equal(f.tables.orders.length, 1); assert.equal(f.tables.deliveries.length, 1); assert.equal(f.tables.audit_events.length, 1);
    f.tables.products[0].price_centavos = 999;
    const replay = await createOrder({ ...f, body: body(), actor: cashier });
    assert.equal(replay.order.total_centavos, 250);
    await assert.rejects(createOrder({ ...f, body: { ...body(), fee_centavos: 51 }, actor: admin }), error => error.status === 409);
  });
  it('duplicate-key race rereads and returns committed winner', async () => {
    const f = fixture(), order = await intake(f);
    let reads = 0;
    const db = { collection() { return { async findOne() { return ++reads === 1 ? null : order; } }; } };
    const result = await createOrder({ db, body: body(), actor: admin, transaction: async () => { throw Object.assign(new Error('race'), { code: 11000 }); } });
    assert.equal(result.duplicate, true); assert.equal(String(result.order._id), String(order._id));
  });
  it('initializes above legacy suffixes and numeric sequences with unique sequential numbers', async () => {
    const f = fixture(); f.tables.orders.push({ _id: new ObjectId(), order_number: 'JU-1099' }, { _id: new ObjectId(), order_number: 'JU-1002', order_seq: 1105 });
    const numbers = await Promise.all(Array.from({ length: 10 }, () => f.transaction((db, session) => getNextOrderNumber(db, session))));
    assert.deepEqual(numbers, Array.from({ length: 10 }, (_, i) => 1106 + i));
  });
});

describe('versioned fulfillment and cashier closure', () => {
  it('role_name is authoritative and delivery transitions are strictly sequential', () => {
    assert.equal(canTransitionDelivery('assigned', 'picked_up', 'rider').allowed, true);
    assert.equal(canTransitionDelivery('on_the_way', 'awaiting_cashier_confirmation', 'rider').allowed, false);
    assert.equal(canTransitionDelivery('awaiting_cashier_confirmation', 'completed', 'admin').allowed, false);
    assert.equal(canTransitionDelivery('assigned', 'picked_up', undefined).allowed, false);
    assert.equal(getOrderNextStatusForAction('received', 'set_ready', 'cashier').allowed, false);
  });
  it('requires event IDs and versions, rejects stale writes and replays exactly once', async () => {
    const f = fixture(), order = await intake(f);
    const args = { ...f, entity: 'order', entityId: String(order._id), operation: 'set_preparing', actor: cashier };
    await assert.rejects(mutateFulfillment({ ...args, body: { event_id: 'a' } }), error => error.status === 400);
    await assert.rejects(mutateFulfillment({ ...args, body: { version: 0 } }), error => error.status === 400);
    const payload = { version: 0, event_id: 'prep' };
    await mutateFulfillment({ ...args, body: payload });
    const replay = await mutateFulfillment({ ...args, body: payload });
    assert.equal(replay.duplicate, true); assert.equal(replay.result.version, 1);
    await assert.rejects(mutateFulfillment({ ...args, body: { version: 0, event_id: 'stale' } }), error => error.status === 409);
    await assert.rejects(mutateFulfillment({ ...args, body: { ...payload, reason: 'changed' } }), error => error.status === 409);
    assert.equal(f.tables.fulfillment_events.length, 1);
  });
  it('competing same-version actions allow only one effect', async () => {
    const f = fixture(), order = await intake(f);
    const attempts = await Promise.allSettled(['one', 'two'].map(event_id => mutateFulfillment({ ...f, entity: 'order', entityId: String(order._id), operation: 'set_preparing', actor: cashier, body: { version: 0, event_id } })));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  });
  it('only assigns ready orders to active available linked rider-role accounts', async () => {
    const f = fixture(), order = await intake(f);
    await assert.rejects(act(f, order, 'assign', { rider_id: String(riderId) }), error => error.status === 409);
    await ready(f, order);
    for (const field of ['is_active', 'is_available']) {
      f.tables.riders[0][field] = false;
      await assert.rejects(act(f, order, 'assign', { rider_id: String(riderId) }), error => error.code === 'invalid_rider');
      f.tables.riders[0][field] = true;
    }
    f.tables.users[0].role_id = 1;
    await assert.rejects(act(f, order, 'assign', { rider_id: String(riderId) }), error => error.code === 'invalid_rider');
  });
  it('scopes reads and mutations to assigned active rider and blocks former owner replay', async () => {
    const f = fixture(), order = await intake(f); await assign(f, order);
    assert.equal(String((await deliveryScope(f.db, riderUser)).rider_id), String(riderId));
    const delivery = f.tables.deliveries[0], payload = { version: delivery.version, event_id: 'pickup' };
    const args = { ...f, entity: 'delivery', entityId: String(delivery._id), operation: 'picked_up', body: payload };
    await assert.rejects(mutateFulfillment({ ...args, actor: { ...riderUser, id: admin.id } }), error => error.status === 403);
    await mutateFulfillment({ ...args, actor: riderUser });
    f.tables.deliveries[0].rider_id = new ObjectId();
    await assert.rejects(mutateFulfillment({ ...args, actor: riderUser }), error => error.status === 403);
  });
  it('cancellation requires reason, updates both records and cannot reopen', async () => {
    const f = fixture(), order = await intake(f);
    await assert.rejects(act(f, order, 'cancel'), error => error.status === 400);
    await act(f, order, 'cancel', { reason: 'Customer cancelled' });
    assert.equal(f.tables.deliveries[0].status, 'cancelled'); assert.equal(f.tables.orders[0].status, 'cancelled');
    await assert.rejects(act(f, order, 'assign', { rider_id: String(riderId) }), error => error.status === 409);
  });
  it('generic patches cannot write lifecycle/payment/authoritative timestamp fields', async () => {
    const f = fixture(), order = await intake(f);
    for (const field of ['status', 'rider_id', 'payment_verified', 'cash_collected', 'pickup_time', 'cashier_confirmation']) {
      await assert.rejects(patchNotes({ transaction: f.transaction, entity: 'order', entityId: String(order._id), actor: admin, body: { notes: 'x', version: 0, event_id: 'patch', [field]: true } }), error => error.status === 400);
    }
    assert.equal(f.tables.orders[0].version, 0);
  });
  it('refuses admin final closure and premature arrived confirmation', async () => {
    const f = fixture(), order = await intake(f); await assign(f, order);
    const delivery = f.tables.deliveries[0];
    for (const step of ['picked_up', 'on_the_way', 'arrived']) await event(f, delivery, step);
    const reconciliation = { amount_centavos: 250 };
    await assert.rejects(event(f, delivery, 'confirm', { reconciliation }, cashier), error => error.status === 409);
    await event(f, delivery, 'report_delivered');
    await assert.rejects(event(f, delivery, 'confirm', { reconciliation }, admin), error => error.status === 403);
  });
  it('atomic confirmation writes trusted cashier evidence, settles once and returns identical replay', async () => {
    const f = fixture(), order = await intake(f), delivery = await reported(f, order);
    let settled = 0;
    const settlement = async ({ db, session, order, actor }) => {
      assert.equal(actor.role_name, 'cashier');
      const sale = { _id: new ObjectId(), order_id: order._id }; await db.collection('sales').insertOne(sale, { session }); settled++; return sale;
    };
    const payload = { version: f.tables.deliveries[0].version, event_id: 'confirmed', reconciliation: { amount_centavos: 250 } };
    const args = { ...f, entity: 'delivery', entityId: String(delivery._id), operation: 'confirm', body: payload, actor: cashier, settlement };
    await mutateFulfillment(args); const replay = await mutateFulfillment(args);
    assert.equal(settled, 1); assert.equal(replay.duplicate, true); assert.equal(f.tables.sales.length, 1);
    assert.equal(f.tables.orders[0].status, 'delivered'); assert.equal(f.tables.orders[0].payment_status, 'paid');
    assert.equal(f.tables.deliveries[0].cashier_confirmation.role_name, 'cashier');
    assert.equal(String(f.tables.orders[0].confirmed_by), cashier.id);
  });
  it('rejects insufficient actual cash and unverified/mismatched GCash evidence', async () => {
    for (const method of ['cash', 'gcash']) {
      const f = fixture();
      const order = await intake(f, { ...body(), payment_method: method, cash_tendered_centavos: 300, payment_reference: 'REF' });
      const delivery = await reported(f, order);
      for (const reconciliation of [{ amount_centavos: 249 }, { amount_centavos: 250 },
        { amount_centavos: 250, cash_tendered_centavos: 249, payment_reference: 'OTHER', verified: true }]) {
        await assert.rejects(event(f, delivery, 'confirm', { reconciliation }, cashier), error => error.status === 400);
      }
      assert.equal(f.tables.orders[0].payment_status, 'pending');
    }
  });
  it('settlement or audit failure leaves no partial completion or sale', async () => {
    for (const failure of ['settlement', 'audit']) {
      const f = fixture(), order = await intake(f), delivery = await reported(f, order);
      if (failure === 'audit') f.fail('audit_events');
      const settlement = async ({ db, session, order }) => {
        const sale = { _id: new ObjectId(), order_id: order._id }; await db.collection('sales').insertOne(sale, { session });
        if (failure === 'settlement') throw new Error('Injected settlement failure');
        return sale;
      };
      await assert.rejects(event(f, delivery, 'confirm', { reconciliation: { amount_centavos: 250 } }, cashier, settlement), /Injected/);
      assert.equal(f.tables.sales.length, 0); assert.equal(f.tables.deliveries[0].status, 'awaiting_cashier_confirmation');
      assert.equal(f.tables.orders[0].payment_status, 'pending');
    }
  });
});
