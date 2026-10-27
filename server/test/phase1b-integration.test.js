import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';

// Point to local test postgres
process.env.DATABASE_URL_TEST = 'postgresql://postgres:postgres@127.0.0.1:5433/juflow_test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.NODE_ENV = 'test';

const { getPool, initSchema, close } = await import('../src/db/postgres.js');
const { default: app } = await import('../src/index.js');

describe('Phase 1b - Real PostgreSQL Integration Tests (A, B, C)', () => {
  let server;
  let baseUrl;
  let pool;
  let adminCookie;
  let riderCookie;
  let otherRiderCookie;
  let testCustomerId;
  let testProductId;
  let testRiderId;
  let testOtherRiderId;
  let testRiderUserId;
  let testOtherRiderUserId;

  before(async () => {
    pool = getPool();
    await initSchema();

    // Clean tables needed for testing
    await pool.query(`
      TRUNCATE TABLE deliveries, orders, sales, audit_events, media_files, rider_locations,
                     customers, products, riders, auth_sessions, users RESTART IDENTITY CASCADE
    `);

    // Ensure roles exist
    await pool.query(`
      INSERT INTO roles (id, name, permissions)
      VALUES (1, 'admin', '["*"]'::jsonb),
             (2, 'cashier', '["orders", "sales"]'::jsonb),
             (3, 'rider', '["deliveries"]'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `);

    // Reset counters for orders to 1000
    await pool.query(`
      INSERT INTO counters (id, seq, data, created_at, updated_at)
      VALUES ('order_number', 1000, '{"seq": 1000}'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET seq = 1000, data = '{"seq": 1000}'::jsonb
    `);

    // Create Admin User & Session
    const adminUserId = '507f1f77bcf86cd799439001';
    await pool.query(`
      INSERT INTO users (id, username, password_hash, role_id, full_name, is_active, created_at, updated_at)
      VALUES ($1, 'testadmin', 'hash', 1, 'Test Admin', true, NOW(), NOW())
    `, [adminUserId]);

    const adminToken = 'admin_session_token_' + crypto.randomBytes(16).toString('hex');
    const adminTokenHash = crypto.createHash('sha256').update(adminToken).digest('hex');
    await pool.query(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW(), NOW())
    `, ['admin_sess_' + crypto.randomBytes(8).toString('hex'), adminUserId, adminTokenHash]);
    adminCookie = `juflow_session=${adminToken}`;

    // Create Rider 1 User & Session
    testRiderUserId = '507f1f77bcf86cd799439002';
    await pool.query(`
      INSERT INTO users (id, username, password_hash, role_id, full_name, is_active, created_at, updated_at)
      VALUES ($1, 'testrider1', 'hash', 3, 'Rider One', true, NOW(), NOW())
    `, [testRiderUserId]);

    const riderToken = 'rider_session_token_' + crypto.randomBytes(16).toString('hex');
    const riderTokenHash = crypto.createHash('sha256').update(riderToken).digest('hex');
    await pool.query(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW(), NOW())
    `, ['rider_sess_' + crypto.randomBytes(8).toString('hex'), testRiderUserId, riderTokenHash]);
    riderCookie = `juflow_session=${riderToken}`;

    // Create Rider 2 User & Session
    testOtherRiderUserId = '507f1f77bcf86cd799439003';
    await pool.query(`
      INSERT INTO users (id, username, password_hash, role_id, full_name, is_active, created_at, updated_at)
      VALUES ($1, 'testrider2', 'hash', 3, 'Rider Two', true, NOW(), NOW())
    `, [testOtherRiderUserId]);

    const otherRiderToken = 'other_rider_token_' + crypto.randomBytes(16).toString('hex');
    const otherRiderTokenHash = crypto.createHash('sha256').update(otherRiderToken).digest('hex');
    await pool.query(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW(), NOW())
    `, ['other_rider_sess_' + crypto.randomBytes(8).toString('hex'), testOtherRiderUserId, otherRiderTokenHash]);
    otherRiderCookie = `juflow_session=${otherRiderToken}`;

    // Create Riders in riders table
    testRiderId = '507f1f77bcf86cd799439004';
    await pool.query(`
      INSERT INTO riders (id, user_id, name, full_name, phone, vehicle_type, vehicle_plate, plate_no, status, is_available, is_active, created_at, updated_at)
      VALUES ($1, $2, 'Rider One', 'Rider One', '09123456789', 'motorcycle', 'ABC 123', 'ABC 123', 'available', true, true, NOW(), NOW())
    `, [testRiderId, testRiderUserId]);

    testOtherRiderId = '507f1f77bcf86cd799439005';
    await pool.query(`
      INSERT INTO riders (id, user_id, name, full_name, phone, vehicle_type, vehicle_plate, plate_no, status, is_available, is_active, created_at, updated_at)
      VALUES ($1, $2, 'Rider Two', 'Rider Two', '09987654321', 'motorcycle', 'XYZ 999', 'XYZ 999', 'available', true, true, NOW(), NOW())
    `, [testOtherRiderId, testOtherRiderUserId]);

    // Create a customer
    testCustomerId = '507f1f77bcf86cd799439006';
    await pool.query(`
      INSERT INTO customers (id, name, phone, address, landmark, is_active, created_at, updated_at)
      VALUES ($1, 'Juan Dela Cruz', '09181234567', '123 Main St, Manila', 'Near Church', true, NOW(), NOW())
    `, [testCustomerId]);

    // Create a product
    testProductId = '507f1f77bcf86cd799439007';
    await pool.query(`
      INSERT INTO products (id, name, price_centavos, is_active, is_available, created_at, updated_at)
      VALUES ($1, 'Adobo Rice Bowl', 15000, true, true, NOW(), NOW())
    `, [testProductId]);

    // Start Express server on random available port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await close();
  });

  describe('Item A: Landmark photos via PostgreSQL bytea and auth rules', () => {
    let uploadedMediaUrl;

    it('POST /api/customers/:id/landmark with a small JPEG, then GET the returned URL', async () => {
      // 1. Generate a small valid JPEG buffer using sharp
      const jpegBuffer = await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 3,
          background: { r: 0, g: 128, b: 255 }
        }
      }).jpeg().toBuffer();

      const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

      // POST /api/customers/:id/landmark
      const uploadRes = await fetch(`${baseUrl}/api/customers/${testCustomerId}/landmark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookie
        },
        body: JSON.stringify({ image: dataUrl })
      });

      assert.equal(uploadRes.status, 201);
      const uploadBody = await uploadRes.json();
      assert.ok(uploadBody.landmark_photo);
      assert.match(uploadBody.landmark_photo, /^\/api\/media\/[a-f\d]{24}$/i);
      uploadedMediaUrl = uploadBody.landmark_photo;

      // GET /api/media/:id as Admin
      const getRes = await fetch(`${baseUrl}${uploadedMediaUrl}`, {
        headers: {
          'Cookie': adminCookie
        }
      });

      assert.equal(getRes.status, 200);
      assert.equal(getRes.headers.get('content-type'), 'image/jpeg');
      assert.equal(getRes.headers.get('cache-control'), 'private, no-store');
      const retrievedBytes = Buffer.from(await getRes.arrayBuffer());
      assert.ok(retrievedBytes.length > 0);

      // Verify the JPEG header magic bytes (0xFF, 0xD8)
      assert.equal(retrievedBytes[0], 0xFF);
      assert.equal(retrievedBytes[1], 0xD8);
    });

    it('Rider authorization: assigned rider can access photo; unassigned rider is denied 403', async () => {
      // Unassigned rider attempts to fetch photo -> 403 Forbidden
      const unassignedRes = await fetch(`${baseUrl}${uploadedMediaUrl}`, {
        headers: { 'Cookie': riderCookie }
      });
      assert.equal(unassignedRes.status, 403);

      // Now create an active order & delivery assigned to Rider 1 for this customer
      const orderId = '507f1f77bcf86cd799439010';
      const deliveryId = '507f1f77bcf86cd799439011';

      await pool.query(`
        INSERT INTO orders (id, order_number, order_seq, customer_id, total_centavos, fee_centavos, status, rider_id, delivery_id, created_at, updated_at)
        VALUES ($1, 'JU-9999', 9999, $2, 15000, 0, 'on_the_way', $3, $4, NOW(), NOW())
      `, [orderId, testCustomerId, testRiderId, deliveryId]);

      await pool.query(`
        INSERT INTO deliveries (id, order_id, rider_id, status, created_at, updated_at)
        VALUES ($1, $2, $3, 'on_the_way', NOW(), NOW())
      `, [deliveryId, orderId, testRiderId]);

      // Assigned rider 1 fetches photo -> 200 OK
      const assignedRes = await fetch(`${baseUrl}${uploadedMediaUrl}`, {
        headers: { 'Cookie': riderCookie }
      });
      assert.equal(assignedRes.status, 200);
      assert.equal(assignedRes.headers.get('content-type'), 'image/jpeg');

      // Rider 2 (not assigned) still gets 403
      const rider2Res = await fetch(`${baseUrl}${uploadedMediaUrl}`, {
        headers: { 'Cookie': otherRiderCookie }
      });
      assert.equal(rider2Res.status, 403);
    });
  });

  describe('Item B: Riders schema and code agreement (list, create, update)', () => {
    it('POST /api/riders returns 409 single_rider per business rule', async () => {
      const res = await fetch(`${baseUrl}/api/riders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookie
        },
        body: JSON.stringify({
          full_name: 'Speedy Gonzales',
          phone: '09771122334',
          plate_no: 'SPD 777',
          vehicle_type: 'scooter',
          is_available: true
        })
      });

      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error, 'single_rider');
      assert.match(body.message, /single rider is managed through bootstrap/i);
    });

    it('GET /api/riders sorts by full_name and agrees with schema without 500 error', async () => {
      const res = await fetch(`${baseUrl}/api/riders`, {
        headers: { 'Cookie': adminCookie }
      });

      assert.equal(res.status, 200);
      const list = await res.json();
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 2);

      // Verify sorting by full_name ASC
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1].full_name || list[i - 1].name || '';
        const curr = list[i].full_name || list[i].name || '';
        assert.ok(prev.localeCompare(curr) <= 0, `Expected "${prev}" <= "${curr}"`);
      }
    });

    it('PATCH /api/riders/:id updates rider fields and persists', async () => {
      const res = await fetch(`${baseUrl}/api/riders/${testRiderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookie
        },
        body: JSON.stringify({
          full_name: 'Rider One Updated',
          plate_no: 'SPD 888',
          is_available: false
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.full_name, 'Rider One Updated');
      assert.equal(body.plate_no, 'SPD 888');
      assert.equal(body.is_available, false);

      // Verify reading back via GET /api/riders/:id
      const getRes = await fetch(`${baseUrl}/api/riders/${testRiderId}`, {
        headers: { 'Cookie': adminCookie }
      });
      assert.equal(getRes.status, 200);
      const getBody = await getRes.json();
      assert.equal(getBody.full_name, 'Rider One Updated');
      assert.equal(getBody.plate_no, 'SPD 888');
      assert.equal(getBody.is_available, false);
    });
  });

  describe('Item C: 60 parallel POST /api/orders with unique, sequential numbers', () => {
    it('creates 60 orders concurrently; all return 201 with unique, strictly sequential order numbers', async () => {
      // Set counter baseline to 1000
      await pool.query(`
        UPDATE counters
        SET seq = 1000,
            data = '{"seq": 1000}'::jsonb,
            updated_at = NOW()
        WHERE id = 'order_number'
      `);

      const count = 60;
      const orderPayloads = Array.from({ length: count }, (_, i) => ({
        customer_id: testCustomerId,
        idempotency_key: `concur-order-${Date.now()}-${i}-${crypto.randomBytes(4).toString('hex')}`,
        items: [{ product_id: testProductId, quantity: 1 }],
        payment_method: 'exact'
      }));

      // Fire 60 requests in parallel
      const responses = await Promise.all(
        orderPayloads.map(body =>
          fetch(`${baseUrl}/api/orders`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': adminCookie
            },
            body: JSON.stringify(body)
          })
        )
      );

      // All 60 must return HTTP 201 Created
      const bodies = [];
      for (let i = 0; i < count; i++) {
        const resp = responses[i];
        assert.equal(
          resp.status,
          201,
          `Expected request ${i} to succeed with 201, got ${resp.status}`
        );
        bodies.push(await resp.json());
      }

      // Check order numbers and sequences
      const orderNumbers = bodies.map(b => b.order_number);
      const orderSeqs = bodies.map(b => b.order_seq);

      assert.equal(orderNumbers.length, 60);
      assert.equal(orderSeqs.length, 60);

      // All 60 order numbers must be unique
      const uniqueNumbers = new Set(orderNumbers);
      assert.equal(uniqueNumbers.size, 60, 'All 60 order numbers must be unique');

      // Sort order_seq numerically
      orderSeqs.sort((a, b) => a - b);

      // Verify each sequence is sequential: 1001, 1002, ..., 1060
      const startSeq = orderSeqs[0];
      assert.equal(startSeq, 1001, `Expected sequence to start at 1001, got ${startSeq}`);

      for (let i = 0; i < count; i++) {
        assert.equal(
          orderSeqs[i],
          1001 + i,
          `Expected sequential sequence at index ${i} to be ${1001 + i}, got ${orderSeqs[i]}`
        );
      }

      // Verify each order_number matches format JU-<seq>
      for (const order of bodies) {
        assert.equal(order.order_number, `JU-${order.order_seq}`);
      }

      // Verify DB count
      const dbCountRes = await pool.query('SELECT COUNT(*)::int AS count FROM orders WHERE order_seq BETWEEN 1001 AND 1060');
      assert.equal(dbCountRes.rows[0].count, 60);
    });
  });
});
