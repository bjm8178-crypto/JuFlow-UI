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

const { getDb, close, initSchema, runMigrations } = await import('../src/db/postgres.js');
const { todayTotals, byPayment, byHour, byDay, byMonth, topProducts, dishCounts } = await import('../src/db/sales-queries.js');
const { replaceLandmark, authorizedMedia } = await import('../src/services/media.js');

describe('Phase 1 - Confirmed Bugs Verification', () => {
  let pool;

  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
    const client = await pool.connect();
    try {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
      await client.query(schemaSql);
      await runMigrations(client);
    } finally {
      client.release();
    }
    await close();
  });

  after(async () => {
    await close();
    if (pool) await pool.end();
  });

  describe('Bug 1: findOne() error propagation', () => {
    it('propagates SQL error rather than returning null on bad query / table', async () => {
      const db = getDb();
      // Querying a non-existent table must throw an error, not return null
      await assert.rejects(async () => {
        await db.collection('completely_non_existent_table').findOne({ id: '1' });
      }, /relation "completely_non_existent_table" does not exist/);
    });
  });

  describe('Bug 2: Sales explicit query functions & topProducts return shape', () => {
    before(async () => {
      const db = getDb();
      await db.collection('sales').deleteMany({});

      const baseDate = new Date('2026-10-28T10:00:00Z');
      await db.collection('sales').insertOne({
        id: 'sale_p1_1',
        transaction_id: 'tx_p1_1',
        sale_time: baseDate,
        source: 'walk_in',
        payment_method: 'cash',
        food_centavos: 30000,
        fee_centavos: 0,
        total_centavos: 30000,
        items: [
          { product_id: 'prod_pork', name: 'Pork Sinigang', quantity: 2, price_centavos: 15000 }
        ],
        is_test_sale: false,
        voided_at: null
      });

      await db.collection('sales').insertOne({
        id: 'sale_p1_2',
        transaction_id: 'tx_p1_2',
        sale_time: baseDate,
        source: 'order',
        payment_method: 'gcash',
        food_centavos: 20000,
        fee_centavos: 5000,
        total_centavos: 25000,
        items: [
          { product_id: 'prod_pork', name: 'Pork Sinigang', quantity: 1, price_centavos: 15000 },
          { product_id: 'prod_rice', name: 'Plain Rice', quantity: 5, price_centavos: 1000 }
        ],
        is_test_sale: false,
        voided_at: null
      });
    });

    it('topProducts returns {_id, units, revenue} rather than {_id, quantity}', async () => {
      const filter = {
        sale_time: {
          $gte: new Date('2026-10-28T00:00:00Z'),
          $lt: new Date('2026-10-28T23:59:59Z')
        }
      };

      const top = await topProducts(filter);
      assert.ok(Array.isArray(top));
      assert.ok(top.length >= 2);

      const pork = top.find(t => t._id === 'Pork Sinigang');
      assert.ok(pork, 'Top products must include Pork Sinigang');
      // Pork: 2 + 1 = 3 units
      assert.equal(pork.units, 3);
      // Revenue: 3 * 15000 = 45000 centavos
      assert.equal(pork.revenue, 45000);
      // Ensure quantity property is NOT what it returns
      assert.equal(pork.quantity, undefined);

      const rice = top.find(t => t._id === 'Plain Rice');
      assert.ok(rice);
      assert.equal(rice.units, 5);
      assert.equal(rice.revenue, 5000);
    });

    it('dishCounts returns product_id and quantity mapping', async () => {
      const filter = {
        sale_time: {
          $gte: new Date('2026-10-28T00:00:00Z'),
          $lt: new Date('2026-10-28T23:59:59Z')
        }
      };

      const counts = await dishCounts(filter);
      assert.ok(Array.isArray(counts));
      const porkCount = counts.find(c => c._id === 'prod_pork');
      assert.ok(porkCount);
      assert.equal(porkCount.quantity, 3);
    });

    it('all named query functions return correct results', async () => {
      const filter = {
        sale_time: {
          $gte: new Date('2026-10-28T00:00:00Z'),
          $lt: new Date('2026-10-28T23:59:59Z')
        }
      };

      const totals = await todayTotals(filter);
      assert.equal(totals.total_centavos, 55000);
      assert.equal(totals.food_centavos, 50000);
      assert.equal(totals.fee_centavos, 5000);
      assert.equal(totals.transaction_count, 2);
      assert.equal(totals.units_sold, 8); // 3 pork + 5 rice

      const payments = await byPayment(filter);
      assert.equal(payments.length, 2);

      const hourly = await byHour(filter);
      assert.ok(Array.isArray(hourly));

      const daily = await byDay(filter);
      assert.ok(Array.isArray(daily));

      const monthly = await byMonth(filter);
      assert.ok(Array.isArray(monthly));
    });
  });

  describe('Bug 3: aggregate() throws unsupported pipeline & SQL join for rider media access', () => {
    it('calling aggregate() on any collection throws "unsupported pipeline"', async () => {
      const db = getDb();
      assert.throws(() => {
        db.collection('sales').aggregate([]);
      }, /unsupported pipeline/);

      assert.throws(() => {
        db.collection('deliveries').aggregate([]);
      }, /unsupported pipeline/);
    });

    it('rider media access check uses real SQL join and only allows assigned rider on active order', async () => {
      const db = getDb();
      const customerId = '507f1f77bcf86cd799439021';
      const orderId = '507f1f77bcf86cd799439022';
      const riderUserId = '507f1f77bcf86cd799439023';
      const otherRiderUserId = '507f1f77bcf86cd799439024';
      const riderId = '507f1f77bcf86cd799439025';
      const otherRiderId = '507f1f77bcf86cd799439026';
      const mediaId = '507f1f77bcf86cd799439027';

      // 1. Create customer with landmark photo
      await db.collection('customers').insertOne({
        id: customerId,
        name: 'Landmark Customer',
        landmark_photo: `/api/media/${mediaId}`
      });

      // 2. Create media file in ready state
      await db.collection('media_files').insertOne({
        id: mediaId,
        filename: 'landmark.jpg',
        content_type: 'image/jpeg',
        size: 100,
        bytes: Buffer.from('test-image-bytes'),
        metadata: {
          customer_id: customerId,
          content_type: 'image/jpeg',
          state: 'ready'
        }
      });

      // 3. Create riders
      await db.collection('riders').insertOne({
        id: riderId,
        user_id: riderUserId,
        full_name: 'Assigned Rider',
        is_active: true
      });
      await db.collection('riders').insertOne({
        id: otherRiderId,
        user_id: otherRiderUserId,
        full_name: 'Unassigned Rider',
        is_active: true
      });

      // 4. Create active order for customer
      await db.collection('orders').insertOne({
        id: orderId,
        order_number: 'JU-PHOTO-1',
        customer_id: customerId,
        status: 'on_the_way'
      });

      // 5. Create delivery assigned to riderId
      await db.collection('deliveries').insertOne({
        id: 'deliv_photo_1',
        order_id: orderId,
        customer_id: customerId,
        rider_id: riderId,
        status: 'on_the_way'
      });

      // Admin has access
      const adminAccess = await authorizedMedia(mediaId, { id: '507f1f77bcf86cd799439028', role_name: 'admin' });
      assert.ok(adminAccess.file);
      assert.equal(adminAccess.file.id, mediaId);

      // Assigned rider has access
      const riderAccess = await authorizedMedia(mediaId, { id: riderUserId, role_name: 'rider' });
      assert.ok(riderAccess.file);
      assert.equal(riderAccess.file.id, mediaId);

      // Other rider is forbidden (403)
      await assert.rejects(async () => {
        await authorizedMedia(mediaId, { id: otherRiderUserId, role_name: 'rider' });
      }, (err) => err.status === 403 && err.message.includes('Media access denied'));

      // If delivery is completed, assigned rider loses access
      await db.collection('deliveries').updateOne({ id: 'deliv_photo_1' }, { $set: { status: 'completed' } });
      await assert.rejects(async () => {
        await authorizedMedia(mediaId, { id: riderUserId, role_name: 'rider' });
      }, (err) => err.status === 403 && err.message.includes('Media access denied'));
    });
  });

  describe('Bug 4: Riders schema and code agreement', () => {
    it('supports sorting by full_name, creating, and updating rider fields', async () => {
      const db = getDb();
      await db.collection('riders').deleteMany({});

      // Create riders with full_name, plate_no, is_available, last_location
      await db.collection('riders').insertOne({
        id: 'rider_b',
        user_id: 'u_b',
        full_name: 'Ben Santos',
        phone: '09111111111',
        vehicle_type: 'Motorcycle',
        plate_no: 'XYZ-789',
        is_available: true,
        is_active: true
      });

      await db.collection('riders').insertOne({
        id: 'rider_a',
        user_id: 'u_a',
        full_name: 'Alan Cruz',
        phone: '09222222222',
        vehicle_type: 'Motorcycle',
        plate_no: 'ABC-123',
        is_available: false,
        is_active: true
      });

      // Test sort by full_name ASC in real PostgreSQL
      const riders = await db.collection('riders').find({}).sort({ full_name: 1 }).toArray();
      assert.equal(riders.length, 2);
      assert.equal(riders[0].full_name, 'Alan Cruz');
      assert.equal(riders[1].full_name, 'Ben Santos');

      // Verify mapped fields
      assert.equal(riders[0].name, 'Alan Cruz');
      assert.equal(riders[0].plate_no, 'ABC-123');
      assert.equal(riders[0].vehicle_plate, 'ABC-123');
      assert.equal(riders[0].is_available, false);
      assert.equal(riders[1].is_available, true);

      // Test updating location
      const newLoc = {
        lat: 14.756,
        lng: 120.954,
        accuracy: 10,
        occurred_at: new Date().toISOString()
      };
      await db.collection('riders').updateOne({ id: 'rider_a' }, { $set: { last_location: newLoc, is_available: true } });

      const updated = await db.collection('riders').findOne({ id: 'rider_a' });
      assert.equal(updated.is_available, true);
      assert.deepEqual(updated.last_location, newLoc);
    });
  });

  describe('Bug 5: Landmark photo storage on Postgres (media_files table)', () => {
    it('replaces, downloads, and cleans up landmark photos using PostgreSQL media_files', async () => {
      const db = getDb();
      const customerId = '507f1f77bcf86cd799439031';
      await db.collection('customers').insertOne({
        id: customerId,
        name: 'Photo Customer'
      });

      const user = { id: '507f1f77bcf86cd799439032', role_name: 'admin' };
      const image = {
        bytes: Buffer.from('fake-jpeg-photo-bytes'),
        width: 800,
        height: 600,
        contentType: 'image/jpeg'
      };

      // 1. Upload photo
      const res = await replaceLandmark(customerId, user, image);
      assert.ok(res.landmark_photo);
      assert.match(res.landmark_photo, /^\/api\/media\/[a-f\d]{24}$/);

      const cust = await db.collection('customers').findOne({ id: customerId });
      assert.equal(cust.landmark_photo, res.landmark_photo);

      // 2. Authorize and download
      const mediaId = res.landmark_photo.replace('/api/media/', '');
      const download = await authorizedMedia(mediaId, user);
      assert.ok(download.file);
      assert.equal(download.file.length, image.bytes.length);

      const chunks = [];
      for await (const chunk of download.stream) {
        chunks.push(chunk);
      }
      const streamBytes = Buffer.concat(chunks);
      assert.equal(streamBytes.toString(), 'fake-jpeg-photo-bytes');

      // 3. Delete landmark photo
      const delRes = await replaceLandmark(customerId, user, null);
      assert.equal(delRes.landmark_photo, null);

      const custAfter = await db.collection('customers').findOne({ id: customerId });
      assert.equal(custAfter.landmark_photo, null);

      // Old media file should be cleaned up
      const oldFile = await db.collection('media_files').findOne({ id: mediaId });
      assert.equal(oldFile, null);
    });
  });

  describe('Bug 6: Numbered migrations table', () => {
    it('tracks applied migrations in schema_migrations table and avoids re-running', async () => {
      const pool = new pg.Pool({ connectionString: TEST_DB_URL });
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT version, name FROM schema_migrations ORDER BY version ASC');
        assert.ok(res.rows.length >= 3);
        assert.equal(res.rows[0].version, 1);
        assert.equal(res.rows[1].version, 2);
        assert.equal(res.rows[2].version, 3);

        // Calling runMigrations again should be a no-op
        await runMigrations(client);
        const res2 = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
        assert.equal(res2.rows.length, res.rows.length);
      } finally {
        client.release();
        await pool.end();
      }
    });
  });
});
