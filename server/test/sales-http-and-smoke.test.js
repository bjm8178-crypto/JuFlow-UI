import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Test against local PostgreSQL only
process.env.DATABASE_URL_TEST = 'postgresql://postgres:postgres@127.0.0.1:5433/juflow_test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.NODE_ENV = 'test';

const { getPool, initSchema, close } = await import('../src/db/postgres.js');
const { default: app } = await import('../src/index.js');

describe('Sales HTTP Integration & Role GET Smoke Tests', () => {
  let server;
  let baseUrl;
  let pool;

  let adminCookie;
  let cashierCookie;
  let riderCookie;

  const testIds = {
    adminUser: '507f1f77bcf86cd799439201',
    cashierUser: '507f1f77bcf86cd799439202',
    riderUser: '507f1f77bcf86cd799439203',
    rider: '507f1f77bcf86cd799439204',
    customer: '507f1f77bcf86cd799439205',
    category: 'cat_drinks',
    product1: 'prod_juice_001',
    product2: 'prod_pie_002',
    order: '507f1f77bcf86cd799439206',
    delivery: '507f1f77bcf86cd799439207',
    deliveryZone: '507f1f77bcf86cd799439208',
    notification: '507f1f77bcf86cd799439209',
    mediaFile: 'ce58981e05710b039faeae72',
    saleCash: '507f1f77bcf86cd799439210',
    saleGcash: '507f1f77bcf86cd799439211',
    saleRefund: '507f1f77bcf86cd799439212',
    saleVoided: '507f1f77bcf86cd799439213',
    saleTest: '507f1f77bcf86cd799439214'
  };

  const now = new Date();
  const manilaDateStr = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const manilaMonthStr = manilaDateStr.slice(0, 7);
  const currentManilaHour = new Date(now.getTime() + 8 * 3600000).getUTCHours();

  before(async () => {
    pool = getPool();
    await initSchema();

    // Clean tables
    await pool.query(`
      TRUNCATE TABLE deliveries, orders, sales, audit_events, media_files, rider_locations,
                     customers, products, categories, daily_menu, notifications, settings,
                     delivery_zones, riders, auth_sessions, users RESTART IDENTITY CASCADE
    `);

    // Ensure roles exist
    await pool.query(`
      INSERT INTO roles (id, name, permissions)
      VALUES (1, 'admin', '["*"]'::jsonb),
             (2, 'cashier', '["orders", "sales"]'::jsonb),
             (3, 'rider', '["deliveries"]'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `);

    // Create users for admin, cashier, rider
    await pool.query(`
      INSERT INTO users (id, username, password_hash, role_id, full_name, is_active, created_at, updated_at)
      VALUES ($1, 'smoke_admin', 'hash', 1, 'Smoke Admin', true, NOW(), NOW()),
             ($2, 'smoke_cashier', 'hash', 2, 'Smoke Cashier', true, NOW(), NOW()),
             ($3, 'smoke_rider', 'hash', 3, 'Smoke Rider', true, NOW(), NOW())
    `, [testIds.adminUser, testIds.cashierUser, testIds.riderUser]);

    // Create sessions
    const adminToken = 'admin_sess_token_' + crypto.randomBytes(16).toString('hex');
    const adminTokenHash = crypto.createHash('sha256').update(adminToken).digest('hex');
    const cashierToken = 'cashier_sess_token_' + crypto.randomBytes(16).toString('hex');
    const cashierTokenHash = crypto.createHash('sha256').update(cashierToken).digest('hex');
    const riderToken = 'rider_sess_token_' + crypto.randomBytes(16).toString('hex');
    const riderTokenHash = crypto.createHash('sha256').update(riderToken).digest('hex');

    await pool.query(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW(), NOW()),
             ($4, $5, $6, NOW() + INTERVAL '1 day', NOW(), NOW()),
             ($7, $8, $9, NOW() + INTERVAL '1 day', NOW(), NOW())
    `, [
      'sess_admin', testIds.adminUser, adminTokenHash,
      'sess_cashier', testIds.cashierUser, cashierTokenHash,
      'sess_rider', testIds.riderUser, riderTokenHash
    ]);

    adminCookie = `juflow_session=${adminToken}`;
    cashierCookie = `juflow_session=${cashierToken}`;
    riderCookie = `juflow_session=${riderToken}`;

    // Seed rider record
    await pool.query(`
      INSERT INTO riders (id, user_id, name, full_name, phone, vehicle_plate, plate_no, status, is_available, created_at, updated_at)
      VALUES ($1, $2, 'Smoke Rider', 'Smoke Rider', '09187654321', 'PLT 123', 'PLT 123', 'available', true, NOW(), NOW())
    `, [testIds.rider, testIds.riderUser]);

    // Seed categories and products
    await pool.query(`
      INSERT INTO categories (id, name, sort_order, is_active, created_at, updated_at)
      VALUES ($1, 'Drinks', 1, true, NOW(), NOW())
    `, [testIds.category]);

    const jpegBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).jpeg().toBuffer();

    await pool.query(`
      INSERT INTO products (id, name, name_key, price_centavos, category_id, is_active, created_at, updated_at)
      VALUES ($1, 'Mango Juice', 'mango juice', 10000, $3, true, NOW(), NOW()),
             ($2, 'Apple Pie', 'apple pie', 15000, $3, true, NOW(), NOW())
    `, [testIds.product1, testIds.product2, testIds.category]);

    // Seed customer
    await pool.query(`
      INSERT INTO customers (id, name, phone, address, notes, created_at, updated_at)
      VALUES ($1, 'Juan Dela Cruz', '09123456789', '123 Test St, Manila', 'Near mango tree', NOW(), NOW())
    `, [testIds.customer]);

    // Seed landmark photo for customer
    const mediaMeta = JSON.stringify({
      customer_id: testIds.customer,
      state: 'ready',
      content_type: 'image/jpeg'
    });
    await pool.query(`
      INSERT INTO media_files (id, filename, content_type, size, bytes, metadata, data, created_at, updated_at)
      VALUES ($1, 'landmark.jpg', 'image/jpeg', $2, $3, $4::jsonb, $4::jsonb, NOW(), NOW())
    `, [testIds.mediaFile, jpegBuffer.length, jpegBuffer, mediaMeta]);

    await pool.query(`
      UPDATE customers SET landmark_photo = $1 WHERE id = $2
    `, [`/api/media/${testIds.mediaFile}`, testIds.customer]);

    // Seed order & delivery
    await pool.query(`
      INSERT INTO orders (id, order_number, customer_id, customer,
                          items, subtotal_centavos, fee_centavos, total_centavos, status, version, created_at, updated_at)
      VALUES ($1, 'JU-1001', $2, '{"name": "Juan Dela Cruz", "phone": "09123456789", "address": "123 Test St, Manila"}'::jsonb,
              '[{"product_id": "prod_juice_001", "name": "Mango Juice", "quantity": 1, "price_centavos": 10000}]'::jsonb,
              10000, 5000, 15000, 'assigned', 1, NOW(), NOW())
    `, [testIds.order, testIds.customer]);

    await pool.query(`
      INSERT INTO deliveries (id, order_id, rider_id, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'assigned', NOW(), NOW())
    `, [testIds.delivery, testIds.order, testIds.rider]);

    // Seed delivery zone
    await pool.query(`
      INSERT INTO delivery_zones (id, name, fee_centavos, is_active, created_at, updated_at)
      VALUES ($1, 'Manila Zone 1', 5000, true, NOW(), NOW())
    `, [testIds.deliveryZone]);

    // Seed setting
    await pool.query(`
      INSERT INTO settings (id, key, value, created_at, updated_at)
      VALUES ('set_biz', 'business_name', '"JuFlow Fresh"'::jsonb, NOW(), NOW())
    `);

    // Seed daily_menu
    await pool.query(`
      INSERT INTO daily_menu (id, date, dishes, created_at, updated_at)
      VALUES ('menu_1', $1, '[{"dish_id": "prod_juice_001", "serving_count": 50}]'::jsonb, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `, [manilaDateStr]);

    // Seed notification
    await pool.query(`
      INSERT INTO notifications (id, type, title, body, read, created_at, updated_at)
      VALUES ($1, 'order', 'New Order', 'Order JU-1001 placed', false, NOW(), NOW())
    `, [testIds.notification]);

    // Seed sales scenario as specified:
    // Cash sale: 3 Mango Juice (10000 ea) + 2 Apple Pie (15000 ea), fee: 5000, food: 60000, total: 65000
    // GCash sale: 2 Mango Juice (10000 ea) + 4 Apple Pie (15000 ea), fee: 0, food: 80000, total: 80000
    // Refund sale: -1 Mango Juice (10000 ea), fee: 0, food: -10000, total: -10000 (cash)
    // Voided sale: 10 Mango Juice (total: 100000), voided_at: NOW() (must be excluded)
    // Test sale: 10 Apple Pie (total: 150000), is_test_sale: true (must be excluded)
    await pool.query(`
      INSERT INTO sales (id, transaction_id, order_id, sale_time, received_at, source, payment_method,
                         food_centavos, fee_centavos, total_centavos, items, voided_at, is_test_sale, created_at, updated_at)
      VALUES
        ($1, 'tx_cash_1', $6, $7, $7, 'order', 'cash',
         60000, 5000, 65000,
         '[{"product_id": "prod_juice_001", "name": "Mango Juice", "quantity": 3, "price_centavos": 10000},
           {"product_id": "prod_pie_002", "name": "Apple Pie", "quantity": 2, "price_centavos": 15000}]'::jsonb,
         NULL, false, NOW(), NOW()),

        ($2, 'tx_gcash_1', NULL, $7, $7, 'walk_in', 'gcash',
         80000, 0, 80000,
         '[{"product_id": "prod_juice_001", "name": "Mango Juice", "quantity": 2, "price_centavos": 10000},
           {"product_id": "prod_pie_002", "name": "Apple Pie", "quantity": 4, "price_centavos": 15000}]'::jsonb,
         NULL, false, NOW(), NOW()),

        ($3, 'tx_refund_1', NULL, $7, $7, 'refund', 'cash',
         -10000, 0, -10000,
         '[{"product_id": "prod_juice_001", "name": "Mango Juice", "quantity": -1, "price_centavos": 10000}]'::jsonb,
         NULL, false, NOW(), NOW()),

        ($4, 'tx_voided_1', NULL, $7, $7, 'walk_in', 'cash',
         100000, 0, 100000,
         '[{"product_id": "prod_juice_001", "name": "Mango Juice", "quantity": 10, "price_centavos": 10000}]'::jsonb,
         $7, false, NOW(), NOW()),

        ($5, 'tx_test_1', NULL, $7, $7, 'order', 'gcash',
         150000, 0, 150000,
         '[{"product_id": "prod_pie_002", "name": "Apple Pie", "quantity": 10, "price_centavos": 15000}]'::jsonb,
         NULL, true, NOW(), NOW())
    `, [
      testIds.saleCash,
      testIds.saleGcash,
      testIds.saleRefund,
      testIds.saleVoided,
      testIds.saleTest,
      testIds.order,
      now
    ]);

    // Start server
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await close();
  });

  describe('Item 3: HTTP-level sales integration tests on real PostgreSQL via Express app', () => {
    it('GET /api/sales/today returns exact aggregated numbers (voided/test excluded, refund netted)', async () => {
      const res = await fetch(`${baseUrl}/api/sales/today`, {
        headers: { Cookie: adminCookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.date, manilaDateStr);
      assert.equal(data.timezone, 'Asia/Manila');

      // Net calculations:
      // total_centavos: 65000 (cash) + 80000 (gcash) - 10000 (refund) = 135000
      assert.equal(data.total_centavos, 135000);
      // food_centavos: 60000 + 80000 - 10000 = 130000
      assert.equal(data.food_centavos, 130000);
      // fee_centavos: 5000
      assert.equal(data.fee_centavos, 5000);
      // transaction_count: 2 (refund is excluded from transaction_count)
      assert.equal(data.transaction_count, 2);
      // units_sold: 4 Mango Juice + 6 Apple Pie = 10 units
      assert.equal(data.units_sold, 10);

      // by_payment breakdown:
      // cash: 65000 - 10000 = 55000, count: 1
      // gcash: 80000, count: 1
      assert.ok(Array.isArray(data.by_payment));
      const cash = data.by_payment.find((p) => p._id === 'cash');
      const gcash = data.by_payment.find((p) => p._id === 'gcash');

      assert.ok(cash, 'cash payment exists in by_payment');
      assert.equal(cash.total_centavos, 55000);
      assert.equal(cash.transaction_count, 1);

      assert.ok(gcash, 'gcash payment exists in by_payment');
      assert.equal(gcash.total_centavos, 80000);
      assert.equal(gcash.transaction_count, 1);
    });

    it('GET /api/sales/summary returns exact numbers (totals, payment, hourly, top products, weekly/monthly)', async () => {
      const res = await fetch(`${baseUrl}/api/sales/summary`, {
        headers: { Cookie: adminCookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      // Top level summary
      assert.equal(data.total_centavos, 135000);
      assert.equal(data.food_centavos, 130000);
      assert.equal(data.fee_centavos, 5000);
      assert.equal(data.transaction_count, 2);
      assert.equal(data.units_sold, 10);

      // by_payment
      assert.ok(Array.isArray(data.by_payment));
      const cash = data.by_payment.find((p) => p._id === 'cash');
      const gcash = data.by_payment.find((p) => p._id === 'gcash');
      assert.equal(cash.total_centavos, 55000);
      assert.equal(gcash.total_centavos, 80000);

      // hourly
      assert.ok(Array.isArray(data.by_hour));
      const thisHour = data.by_hour.find((h) => h._id === currentManilaHour);
      assert.ok(thisHour, `Hour ${currentManilaHour} exists in by_hour`);
      assert.equal(thisHour.total, 135000);

      // top products with units AND revenue
      // Apple Pie: 6 units @ 15000 = 90000 revenue
      // Mango Juice: (3 + 2 - 1) = 4 units @ 10000 = 40000 revenue
      assert.ok(Array.isArray(data.top_products));
      assert.equal(data.top_products.length, 2);
      assert.equal(data.top_products[0]._id, 'Apple Pie');
      assert.equal(data.top_products[0].units, 6);
      assert.equal(data.top_products[0].revenue, 90000);

      assert.equal(data.top_products[1]._id, 'Mango Juice');
      assert.equal(data.top_products[1].units, 4);
      assert.equal(data.top_products[1].revenue, 40000);

      // weekly/monthly top products
      assert.ok(Array.isArray(data.top_products_weekly));
      assert.equal(data.top_products_weekly[0]._id, 'Apple Pie');
      assert.equal(data.top_products_weekly[0].units, 6);
      assert.equal(data.top_products_weekly[0].revenue, 90000);

      assert.ok(Array.isArray(data.top_products_monthly));
      assert.equal(data.top_products_monthly[0]._id, 'Apple Pie');
      assert.equal(data.top_products_monthly[0].units, 6);
      assert.equal(data.top_products_monthly[0].revenue, 90000);

      // last_seven_days includes today's total
      assert.ok(Array.isArray(data.last_seven_days));
      const todayDay = data.last_seven_days.find((d) => d._id === manilaDateStr);
      assert.ok(todayDay);
      assert.equal(todayDay.total_centavos, 135000);

      // by_month includes current month's totals
      assert.ok(Array.isArray(data.by_month));
      const currentMonth = data.by_month.find((m) => m._id === manilaMonthStr);
      assert.ok(currentMonth);
      assert.equal(currentMonth.total_centavos, 135000);
      assert.equal(currentMonth.transaction_count, 2);
      assert.equal(currentMonth.units_sold, 10);
    });

    it('GET /api/sales/counts returns exact dish counts netting out refunds', async () => {
      const res = await fetch(`${baseUrl}/api/sales/counts`, {
        headers: { Cookie: adminCookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.date, manilaDateStr);
      assert.ok(data.counts);
      // Apple Pie: 2 + 4 = 6
      assert.equal(data.counts.prod_pie_002, 6);
      // Mango Juice: 3 + 2 - 1 = 4
      assert.equal(data.counts.prod_juice_001, 4);
    });
  });

  describe('Item 4: Role Smoke Tests (admin, cashier, rider call every permitted GET route)', () => {
    it('Admin can call every admin GET route without any status >= 500', async () => {
      const routes = [
        '/api/auth/me',
        '/api/users',
        '/api/riders',
        `/api/riders/${testIds.rider}`,
        '/api/orders',
        `/api/orders/${testIds.order}`,
        '/api/deliveries',
        `/api/deliveries/${testIds.delivery}`,
        '/api/customers',
        `/api/customers/${testIds.customer}`,
        `/api/customers/${testIds.customer}/orders`,
        '/api/sales',
        '/api/sales/today',
        '/api/sales/today/list',
        '/api/sales/summary',
        '/api/sales/counts',
        '/api/sales/since?after=2026-01-01T00:00:00Z',
        '/api/sales/export.csv',
        `/api/sales/${testIds.saleCash}`,
        '/api/menu/today',
        '/api/products',
        `/api/products/${testIds.product1}`,
        `/api/products/${testIds.product1}/image`,
        '/api/categories',
        `/api/categories/${testIds.category}`,
        '/api/notifications',
        '/api/settings',
        '/api/settings/business_name',
        '/api/delivery-zones',
        `/api/delivery-zones/${testIds.deliveryZone}`,
        `/api/media/${testIds.mediaFile}`
      ];

      for (const route of routes) {
        const res = await fetch(`${baseUrl}${route}`, {
          headers: { Cookie: adminCookie }
        });
        assert.ok(res.status < 500, `Admin GET ${route} failed with status ${res.status}`);
      }
    });

    it('Cashier can call every cashier GET route without any status >= 500', async () => {
      const routes = [
        '/api/auth/me',
        '/api/riders',
        `/api/riders/${testIds.rider}`,
        '/api/orders',
        `/api/orders/${testIds.order}`,
        '/api/customers',
        `/api/customers/${testIds.customer}`,
        `/api/customers/${testIds.customer}/orders`,
        '/api/sales/today',
        '/api/sales/today/list',
        '/api/sales/counts',
        '/api/menu/today',
        '/api/products',
        `/api/products/${testIds.product1}`,
        `/api/products/${testIds.product1}/image`,
        '/api/categories',
        `/api/categories/${testIds.category}`,
        '/api/notifications',
        '/api/settings',
        '/api/settings/business_name',
        '/api/delivery-zones',
        `/api/delivery-zones/${testIds.deliveryZone}`,
        `/api/media/${testIds.mediaFile}`
      ];

      for (const route of routes) {
        const res = await fetch(`${baseUrl}${route}`, {
          headers: { Cookie: cashierCookie }
        });
        assert.ok(res.status < 500, `Cashier GET ${route} failed with status ${res.status}`);
      }
    });

    it('Rider can call every rider GET route without any status >= 500', async () => {
      const routes = [
        '/api/auth/me',
        '/api/riders/me',
        '/api/riders',
        `/api/riders/${testIds.rider}`,
        '/api/orders',
        `/api/orders/${testIds.order}`,
        '/api/deliveries',
        `/api/deliveries/${testIds.delivery}`,
        '/api/products',
        `/api/products/${testIds.product1}`,
        `/api/products/${testIds.product1}/image`,
        '/api/categories',
        `/api/categories/${testIds.category}`,
        '/api/notifications',
        '/api/settings',
        '/api/delivery-zones',
        `/api/media/${testIds.mediaFile}`
      ];

      for (const route of routes) {
        const res = await fetch(`${baseUrl}${route}`, {
          headers: { Cookie: riderCookie }
        });
        assert.ok(res.status < 500, `Rider GET ${route} failed with status ${res.status}`);
      }
    });
  });
});
