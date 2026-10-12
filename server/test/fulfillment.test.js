import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from '../src/db/mongodb.js';
import { validateOrder, calculateOrder, digest } from '../src/lib/order.js';
import { canChangeStatus } from '../src/lib/order-state.js';
import { createOrder, patchNotes } from '../src/services/fulfillment.js';
import { setOrderStatus } from '../src/services/simple-flow.js';
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
    assert.equal(order.delivery_status, 'pending');
    assert.equal(String(order.rider_id), String(riderId), 'single-rider association is for legacy map only');
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

describe('simple status flow: preparing -> on_the_way -> delivered', () => {
  const move = (f, order, to, actor = cashier) => setOrderStatus({ transaction: f.transaction, orderId: String(order._id), status: to, actor });

  it('permission matrix', () => {
    const ok = (from, to, role) => canChangeStatus(from, to, role).allowed === true;
    assert.ok(ok('preparing', 'on_the_way', 'cashier'));
    assert.ok(ok('preparing', 'on_the_way', 'rider'));
    assert.ok(ok('on_the_way', 'delivered', 'rider'));
    assert.ok(ok('on_the_way', 'delivered', 'cashier'));
    assert.ok(ok('on_the_way', 'preparing', 'cashier'), 'cashier may fix a mistake');
    assert.ok(!ok('on_the_way', 'preparing', 'rider'), 'rider cannot go back');
    assert.ok(ok('preparing', 'cancelled', 'cashier'));
    assert.ok(!ok('preparing', 'cancelled', 'rider'), 'rider cannot cancel');
    assert.ok(!ok('preparing', 'delivered', 'cashier'), 'cannot skip on_the_way');
    assert.ok(!ok('preparing', 'on_the_way', 'admin'), 'admin only watches');
    assert.ok(!ok('delivered', 'preparing', 'cashier'), 'delivered is final');
    assert.ok(!ok('cancelled', 'preparing', 'cashier'), 'cancelled is final');
    const same = canChangeStatus('delivered', 'delivered', 'rider');
    assert.ok(same.allowed && same.noop, 'a retried request is a harmless no-op');
  });

  it('a new order starts as preparing', async () => {
    const f = fixture(), order = await intake(f);
    assert.equal(order.status, 'preparing');
  });

  it('same-status retries and admin never bypass role checks', async () => {
    const same = canChangeStatus('preparing', 'preparing', 'cashier');
    assert.equal(same.allowed, true);
    assert.equal(same.noop, true);
    assert.equal(canChangeStatus('preparing', 'preparing', 'admin').allowed, false);
    assert.equal(canChangeStatus('preparing', 'preparing', 'unknown').allowed, false);
    const f = fixture(), order = await intake(f);
    await assert.rejects(move(f, order, 'preparing', admin), error => error.status === 409 && /cashier.*rider/.test(error.message));
    assert.equal(f.tables.orders[0].version, 0);
  });

  it('delivered creates exactly one sale and one notification; a retry creates no second sale', async () => {
    const f = fixture(), order = await intake(f);
    await move(f, order, 'on_the_way');
    const first = await move(f, order, 'delivered', riderUser);
    assert.equal(first.order.status, 'delivered');
    assert.equal(f.tables.sales.length, 1);
    assert.equal(f.tables.sales[0].total_centavos, 250);
    assert.equal(f.tables.sales[0].source, 'order');
    assert.equal(f.tables.notifications.length, 1);
    const retry = await move(f, order, 'delivered', riderUser);
    assert.equal(retry.changed, false);
    assert.equal(f.tables.sales.length, 1);
    assert.equal(f.tables.notifications.length, 1);
    assert.equal(f.tables.deliveries[0].status, 'completed');
  });

  it('cancelled creates no sale', async () => {
    const f = fixture(), order = await intake(f);
    await move(f, order, 'cancelled');
    assert.equal(f.tables.sales.length, 0);
    assert.equal(f.tables.orders[0].status, 'cancelled');
  });

  it('rejects forbidden moves with 409 and changes nothing', async () => {
    const f = fixture(), order = await intake(f);
    await assert.rejects(move(f, order, 'delivered'), error => error.status === 409);
    await assert.rejects(move(f, order, 'on_the_way', admin), error => error.status === 409 && /cashier.*rider/.test(error.message));
    await assert.rejects(move(f, order, 'cancelled', riderUser), error => error.status === 409);
    await assert.rejects(move(f, order, 'shipped'), error => error.status === 400);
    assert.equal(f.tables.orders[0].status, 'preparing');
    assert.equal(f.tables.orders[0].delivery_status, 'pending');
    assert.equal(f.tables.deliveries[0].status, 'pending');
    assert.equal(f.tables.sales.length, 0);
  });

  it('cashier can move an order back from on_the_way to preparing; the rider cannot', async () => {
    const f = fixture(), order = await intake(f);
    await move(f, order, 'on_the_way', riderUser);
    await assert.rejects(move(f, order, 'preparing', riderUser), error => error.status === 409);
    await move(f, order, 'preparing', cashier);
    assert.equal(f.tables.orders[0].status, 'preparing');
  });

  it('generic patches cannot write lifecycle/payment fields', async () => {
    const f = fixture(), order = await intake(f);
    for (const field of ['status', 'rider_id', 'payment_verified', 'cash_collected', 'pickup_time', 'cashier_confirmation']) {
      await assert.rejects(patchNotes({ transaction: f.transaction, entity: 'order', entityId: String(order._id), actor: admin, body: { notes: 'x', version: 0, event_id: 'patch', [field]: true } }), error => error.status === 400);
    }
    assert.equal(f.tables.orders[0].version, 0);
  });

  it('delivery status, sale, notification and audit roll back together', async () => {
    for (const collection of ['sales', 'notifications', 'audit_events']) {
      const f = fixture(), order = await intake(f);
      await move(f, order, 'on_the_way');
      f.fail(collection);
      await assert.rejects(move(f, order, 'delivered', riderUser), /Injected/);
      assert.equal(f.tables.orders[0].status, 'on_the_way');
      assert.equal(f.tables.deliveries[0].status, 'on_the_way');
      assert.equal(f.tables.orders[0].version, 1);
      assert.equal(f.tables.sales.length, 0);
      assert.equal((f.tables.notifications ?? []).length, 0);
      assert.equal(f.tables.audit_events.length, 2);
    }
  });
});

