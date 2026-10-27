import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

process.env.NODE_ENV = 'test';
const TEST_DB_URL = process.env.DATABASE_URL_TEST;
if (!TEST_DB_URL) {
  throw new Error('DATABASE_URL_TEST must be set to run integration tests against a local PostgreSQL database');
}
process.env.DATABASE_URL = TEST_DB_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import database functions after environment variables are set
const { getDb, close, initSchema, withTransaction } = await import('../src/db/postgres.js');

describe('PostgreSQL Real Integration Tests (Phase 0)', () => {
  let pool;

  before(async () => {
    // Connect directly to reset schema
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
    const client = await pool.connect();
    try {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
      await client.query(schemaSql);
    } finally {
      client.release();
    }
    // Also reset postgres module's internal pool
    await close();
  });

  after(async () => {
    await close();
    if (pool) {
      await pool.end();
    }
  });

  const tables = [
    { name: 'roles', doc: { id: 'role_test', name: 'tester', permissions: ['read', 'write'] }, update: { $set: { description: 'Updated role' } }, verifyKey: 'description', verifyVal: 'Updated role' },
    { name: 'users', doc: { id: 'u_test', username: 'testuser', email: 'test@example.com', full_name: 'Test User' }, update: { $set: { phone: '09123456789' } }, verifyKey: 'phone', verifyVal: '09123456789' },
    { name: 'auth_sessions', doc: { id: 's_test', user_id: 'u_test', token_hash: 'hash123' }, update: { $set: { ip_address: '127.0.0.1' } }, verifyKey: 'ip_address', verifyVal: '127.0.0.1' },
    { name: 'categories', doc: { id: 'cat_test', name: 'Main Dishes', slug: 'main-dishes' }, update: { $set: { sort_order: 1 } }, verifyKey: 'sort_order', verifyVal: 1 },
    { name: 'products', doc: { id: 'p_test', name: 'Sinigang', price_centavos: 15000, is_available: true, is_active: true }, update: { $set: { price_centavos: 16000 } }, verifyKey: 'price_centavos', verifyVal: 16000 },
    { name: 'customers', doc: { id: 'c_test', name: 'Juan Dela Cruz', phone: '09111111111', address: '123 Test St' }, update: { $set: { notes: 'VIP' } }, verifyKey: 'notes', verifyVal: 'VIP' },
    { name: 'delivery_zones', doc: { id: 'z_test', name: 'Zone 1', fee_centavos: 5000 }, update: { $set: { estimated_minutes: 25 } }, verifyKey: 'estimated_minutes', verifyVal: 25 },
    { name: 'riders', doc: { id: 'r_test', name: 'Rider 1', phone: '09222222222', vehicle_plate: 'ABC-123' }, update: { $set: { vehicle_type: 'Motorcycle' } }, verifyKey: 'vehicle_type', verifyVal: 'Motorcycle' },
    { name: 'orders', doc: { id: 'o_test', order_number: 'JU-1001', total_centavos: 25000, status: 'received' }, update: { $set: { status: 'preparing' } }, verifyKey: 'status', verifyVal: 'preparing' },
    { name: 'deliveries', doc: { id: 'd_test', order_id: 'o_test', status: 'pending' }, update: { $set: { status: 'on_the_way' } }, verifyKey: 'status', verifyVal: 'on_the_way' },
    { name: 'sales', doc: { id: 'sale_test', transaction_id: 'tx_001', total_centavos: 25000, payment_method: 'cash' }, update: { $set: { food_centavos: 20000 } }, verifyKey: 'food_centavos', verifyVal: 20000 },
    { name: 'settings', doc: { id: 'set_test', key: 'store_open', value: { open: true } }, update: { $set: { description: 'Store Hours' } }, verifyKey: 'description', verifyVal: 'Store Hours' },
    { name: 'daily_menu', doc: { id: 'm_test', date: '2026-10-28', dishes: ['p_test'] }, update: { $set: { dishes: ['p_test', 'p2'] } }, verifyKey: 'dishes', verifyVal: ['p_test', 'p2'] },
    { name: 'notifications', doc: { id: 'n_test', type: 'order', title: 'New order', body: 'JU-1001 placed' }, update: { $set: { read: true } }, verifyKey: 'read', verifyVal: true },
    { name: 'counters', doc: { id: 'order_number_test', seq: 1000 }, update: { $set: { seq: 1001 } }, verifyKey: 'seq', verifyVal: 1001 },
    { name: 'audit_events', doc: { id: 'a_test', event_id: 'evt_1', entity_type: 'order', action: 'create' }, update: { $set: { actor: 'admin' } }, verifyKey: 'actor', verifyVal: 'admin' },
    { name: 'media_files', doc: { id: 'mf_test', filename: 'landmark.jpg', content_type: 'image/jpeg', size: 1024 }, update: { $set: { size: 2048 } }, verifyKey: 'size', verifyVal: 2048 },
    { name: 'integrity_guards', doc: { id: 'ig_test', revision: 1 }, update: { $inc: { revision: 1 } }, verifyKey: 'revision', verifyVal: 2 }
  ];

  describe('CRUD operations for every table against real PostgreSQL', () => {
    for (const t of tables) {
      it(`CRUD operations on ${t.name}`, async () => {
        const db = getDb();
        const col = db.collection(t.name);

        // 1. Create
        const insertRes = await col.insertOne(t.doc);
        assert.ok(insertRes.acknowledged, `${t.name} insert acknowledged`);

        // 2. Read
        const found = await col.findOne({ id: t.doc.id });
        assert.ok(found, `${t.name} findOne found document`);
        assert.equal(found.id, t.doc.id);
        assert.equal(found._id, t.doc.id);

        const list = await col.find({ id: t.doc.id }).toArray();
        assert.equal(list.length, 1);
        assert.equal(list[0].id, t.doc.id);

        // 3. Update
        const updateRes = await col.updateOne({ id: t.doc.id }, t.update);
        assert.equal(updateRes.matchedCount, 1);
        assert.equal(updateRes.modifiedCount, 1);

        const updated = await col.findOne({ id: t.doc.id });
        assert.deepEqual(updated[t.verifyKey], t.verifyVal, `${t.name} field updated`);

        // 4. Delete
        const delRes = await col.deleteOne({ id: t.doc.id });
        assert.equal(delRes.deletedCount, 1);

        const afterDel = await col.findOne({ id: t.doc.id });
        assert.equal(afterDel, null, `${t.name} deleted`);
      });
    }
  });

  describe('End-to-End Order Creation Flow', () => {
    it('creates an order, generates order number, links delivery and transitions statuses', async () => {
      const db = getDb();

      // Seed customer
      const custId = 'cust_e2e_1';
      await db.collection('customers').insertOne({
        id: custId,
        name: 'Maria Santos',
        phone: '09171234567',
        address: 'Barangay 1, Marilao',
        is_active: true
      });

      // Seed product
      const prodId = 'prod_e2e_1';
      await db.collection('products').insertOne({
        id: prodId,
        name: 'Kare-Kare',
        price_centavos: 18000,
        is_available: true,
        is_active: true
      });

      // Initialize counter
      await db.collection('counters').insertOne({
        id: 'order_number',
        seq: 5000
      });

      // Get next sequence
      const counter = await db.collection('counters').findOneAndUpdate(
        { id: 'order_number' },
        { $inc: { seq: 1 } },
        { returnDocument: 'after' }
      );
      const seq = counter.seq;
      const orderNumber = `JU-${seq}`;
      assert.equal(seq, 5001);

      // Create order
      const orderId = 'order_e2e_1';
      const items = [{ product_id: prodId, name: 'Kare-Kare', quantity: 2, price_centavos: 18000 }];
      const subtotalCentavos = 36000;
      const feeCentavos = 4000;
      const totalCentavos = 40000;

      await db.collection('orders').insertOne({
        id: orderId,
        order_number: orderNumber,
        order_seq: seq,
        customer_id: custId,
        customer: { id: custId, name: 'Maria Santos', phone: '09171234567' },
        items,
        subtotal_centavos: subtotalCentavos,
        fee_centavos: feeCentavos,
        total_centavos: totalCentavos,
        payment_method: 'cash',
        status: 'preparing'
      });

      // Create linked delivery
      const deliveryId = 'deliv_e2e_1';
      await db.collection('deliveries').insertOne({
        id: deliveryId,
        order_id: orderId,
        customer_id: custId,
        status: 'pending',
        fee_centavos: feeCentavos
      });

      // Read back order and verify shapes
      const savedOrder = await db.collection('orders').findOne({ id: orderId });
      assert.ok(savedOrder);
      assert.equal(savedOrder.order_number, 'JU-5001');
      assert.equal(savedOrder.total_centavos, 40000);
      assert.equal(savedOrder._id, orderId);
      assert.equal(savedOrder.id, orderId);

      // Transition to on_the_way
      await db.collection('orders').updateOne({ id: orderId }, { $set: { status: 'on_the_way' } });
      await db.collection('deliveries').updateOne({ order_id: orderId }, { $set: { status: 'on_the_way' } });

      let orderCheck = await db.collection('orders').findOne({ id: orderId });
      assert.equal(orderCheck.status, 'on_the_way');

      // Transition to delivered & record sale
      await db.collection('orders').updateOne({ id: orderId }, { $set: { status: 'delivered' } });
      await db.collection('deliveries').updateOne({ order_id: orderId }, { $set: { status: 'completed' } });

      const saleId = 'sale_e2e_1';
      await db.collection('sales').insertOne({
        id: saleId,
        transaction_id: `order:${orderId}`,
        order_id: orderId,
        items,
        food_centavos: subtotalCentavos,
        fee_centavos: feeCentavos,
        total_centavos: totalCentavos,
        payment_method: 'cash',
        source: 'order',
        sale_time: new Date()
      });

      const savedSale = await db.collection('sales').findOne({ order_id: orderId });
      assert.ok(savedSale);
      assert.equal(savedSale.total_centavos, 40000);
      assert.equal(savedSale.food_centavos, 36000);

      const deliveryCheck = await db.collection('deliveries').findOne({ order_id: orderId });
      assert.equal(deliveryCheck.status, 'completed');
    });
  });

  describe('Sales Aggregations', () => {
    before(async () => {
      const db = getDb();
      // Clean up sales table for aggregation test
      await db.collection('sales').deleteMany({});

      const baseDate = new Date('2026-10-28T12:00:00Z');
      const salesData = [
        {
          id: 's_agg_1',
          transaction_id: 'tx_agg_1',
          sale_time: baseDate,
          source: 'walk_in',
          payment_method: 'cash',
          food_centavos: 10000,
          fee_centavos: 0,
          total_centavos: 10000,
          items: [{ product_id: 'prod_1', name: 'Burger', quantity: 2, price_centavos: 5000 }],
          is_test_sale: false,
          voided_at: null
        },
        {
          id: 's_agg_2',
          transaction_id: 'tx_agg_2',
          sale_time: baseDate,
          source: 'order',
          payment_method: 'gcash',
          food_centavos: 20000,
          fee_centavos: 5000,
          total_centavos: 25000,
          items: [
            { product_id: 'prod_1', name: 'Burger', quantity: 1, price_centavos: 5000 },
            { product_id: 'prod_2', name: 'Fries', quantity: 3, price_centavos: 5000 }
          ],
          is_test_sale: false,
          voided_at: null
        },
        {
          id: 's_agg_3',
          transaction_id: 'tx_agg_3',
          sale_time: baseDate,
          source: 'refund',
          payment_method: 'cash',
          food_centavos: -5000,
          fee_centavos: 0,
          total_centavos: -5000,
          items: [{ product_id: 'prod_1', name: 'Burger', quantity: -1, price_centavos: 5000 }],
          is_test_sale: false,
          voided_at: null
        }
      ];

      for (const s of salesData) {
        await db.collection('sales').insertOne(s);
      }
    });

    it('aggregates today totals via $facet pipeline', async () => {
      const db = getDb();
      const pipeline = [
        { $match: { voided_at: null, is_test_sale: { $ne: true } } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total_centavos: { $sum: '$total_centavos' },
                  food_centavos: { $sum: '$food_centavos' },
                  fee_centavos: { $sum: '$fee_centavos' },
                  transaction_count: { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } },
                  units_sold: { $sum: { $sum: '$items.quantity' } }
                }
              }
            ],
            by_payment: [
              {
                $group: {
                  _id: '$payment_method',
                  total_centavos: { $sum: '$total_centavos' },
                  transaction_count: { $sum: 1 }
                }
              }
            ]
          }
        }
      ];

      const res = await db.collection('sales').aggregate(pipeline).toArray();
      assert.equal(res.length, 1);
      const totals = res[0].totals[0];
      // 10000 + 25000 - 5000 = 30000
      assert.equal(totals.total_centavos, 30000);
      assert.equal(totals.food_centavos, 25000);
      assert.equal(totals.fee_centavos, 5000);
      assert.equal(totals.transaction_count, 2); // refund not counted in transaction_count
      // units sold: 2 + 4 - 1 = 5
      assert.equal(totals.units_sold, 5);

      const byPayment = res[0].by_payment;
      assert.ok(Array.isArray(byPayment));
      assert.ok(byPayment.length >= 2);
    });

    it('aggregates by payment method', async () => {
      const db = getDb();
      const pipeline = [
        { $match: { voided_at: null, is_test_sale: { $ne: true } } },
        {
          $group: {
            _id: '$payment_method',
            total_centavos: { $sum: '$total_centavos' },
            transaction_count: { $sum: 1 }
          }
        }
      ];

      const res = await db.collection('sales').aggregate(pipeline).toArray();
      assert.ok(Array.isArray(res));
      const cash = res.find(r => r._id === 'cash');
      const gcash = res.find(r => r._id === 'gcash');
      assert.ok(cash);
      assert.ok(gcash);
      // Cash: 10000 - 5000 = 5000
      assert.equal(cash.total_centavos, 5000);
      // GCash: 25000
      assert.equal(gcash.total_centavos, 25000);
    });
  });

  describe('Concurrency and Transactions', () => {
    it('handles concurrent inserts cleanly', async () => {
      const db = getDb();
      const count = 10;
      const ids = Array.from({ length: count }, (_, i) => `concurrent_prod_${i}`);

      await Promise.all(
        ids.map(id =>
          db.collection('products').insertOne({
            id,
            name: `Concurrent Product ${id}`,
            price_centavos: 1000,
            is_active: true
          })
        )
      );

      for (const id of ids) {
        const item = await db.collection('products').findOne({ id });
        assert.ok(item);
        assert.equal(item.id, id);
      }
    });

    it('executes atomic transactions with withTransaction', async () => {
      const db = getDb();
      const orderId = 'tx_order_test';
      const delivId = 'tx_deliv_test';

      await withTransaction(async (txDb) => {
        await txDb.collection('orders').insertOne({
          id: orderId,
          order_number: 'JU-TX-1',
          total_centavos: 5000,
          status: 'received'
        });
        await txDb.collection('deliveries').insertOne({
          id: delivId,
          order_id: orderId,
          status: 'pending'
        });
      });

      const order = await db.collection('orders').findOne({ id: orderId });
      const delivery = await db.collection('deliveries').findOne({ id: delivId });
      assert.ok(order);
      assert.ok(delivery);

      // Verify rollback on error inside transaction
      await assert.rejects(async () => {
        await withTransaction(async (txDb) => {
          await txDb.collection('orders').insertOne({
            id: 'rollback_order',
            order_number: 'JU-ROLLBACK',
            total_centavos: 1000
          });
          throw new Error('Simulated failure');
        });
      }, /Simulated failure/);

      const rollbackOrder = await db.collection('orders').findOne({ id: 'rollback_order' });
      assert.equal(rollbackOrder, null, 'Transaction must roll back on error');
    });
  });
});
