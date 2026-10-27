import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const TEST_DB_URL = process.env.DATABASE_URL_TEST || 'postgresql://postgres:postgres@127.0.0.1:5433/juflow_test';

// The exact schema at commit f1af567
const OLD_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(50) UNIQUE,
  description TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(100) UNIQUE,
  email VARCHAR(150),
  phone VARCHAR(50),
  role_id VARCHAR(64),
  password_hash VARCHAR(255),
  full_name VARCHAR(150),
  is_active BOOLEAN DEFAULT TRUE,
  failed_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(150),
  phone VARCHAR(50),
  messenger VARCHAR(100),
  address TEXT,
  landmark TEXT,
  landmark_photo TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS riders (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  name VARCHAR(150),
  phone VARCHAR(50),
  vehicle_type VARCHAR(50),
  vehicle_plate VARCHAR(50),
  status VARCHAR(50) DEFAULT 'offline',
  is_active BOOLEAN DEFAULT TRUE,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE,
  order_seq INT,
  idempotency_key VARCHAR(100),
  customer_id VARCHAR(64),
  customer JSONB DEFAULT '{}'::jsonb,
  items JSONB DEFAULT '[]'::jsonb,
  subtotal_centavos INT DEFAULT 0,
  fee_centavos INT DEFAULT 0,
  total_centavos INT DEFAULT 0,
  cash_tendered_centavos INT,
  change_centavos INT,
  payment_method VARCHAR(50),
  payment_reference VARCHAR(100),
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_verified BOOLEAN DEFAULT FALSE,
  preparation_status VARCHAR(50) DEFAULT 'pending',
  delivery_status VARCHAR(50) DEFAULT 'pending',
  status VARCHAR(50) DEFAULT 'received',
  rider_id VARCHAR(64),
  rider TEXT,
  delivery_id VARCHAR(64),
  notes TEXT,
  version INT DEFAULT 1,
  request_digest VARCHAR(100),
  created_by VARCHAR(64),
  recorded_by VARCHAR(100),
  on_the_way_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) UNIQUE,
  customer_id VARCHAR(64),
  rider_id VARCHAR(64),
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id VARCHAR(64) PRIMARY KEY,
  transaction_id VARCHAR(100) UNIQUE,
  order_id VARCHAR(64),
  void_id VARCHAR(100),
  event_id VARCHAR(100),
  sale_time TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  source VARCHAR(50),
  payment_method VARCHAR(50),
  items JSONB DEFAULT '[]'::jsonb,
  food_centavos INT DEFAULT 0,
  fee_centavos INT DEFAULT 0,
  total_centavos INT DEFAULT 0,
  cash_tendered_centavos INT,
  gcash_reference VARCHAR(100),
  recorded_by VARCHAR(100),
  recorded_actor VARCHAR(100),
  recorded_role VARCHAR(50),
  is_test_sale BOOLEAN DEFAULT FALSE,
  digest VARCHAR(100),
  verification JSONB,
  voided_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS counters (
  id VARCHAR(64) PRIMARY KEY,
  seq BIGINT DEFAULT 1000,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(100) UNIQUE,
  entity_type VARCHAR(50),
  entity_id VARCHAR(64),
  action VARCHAR(50),
  actor VARCHAR(100),
  details JSONB DEFAULT '{}'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_files (
  id VARCHAR(64) PRIMARY KEY,
  filename VARCHAR(255),
  content_type VARCHAR(100),
  size INT,
  data JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrity_guards (
  id VARCHAR(64) PRIMARY KEY,
  revision INT DEFAULT 0,
  data JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const { runMigrations, MIGRATIONS, initSchema, getPool, close } = await import('../src/db/postgres.js');

describe('Safe Migrations on Live Data', () => {
  let pool;

  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
  });

  after(async () => {
    if (pool) await pool.end();
    await close();
  });

  it('order counter seed never resets an existing higher counter (e.g. 1500)', async () => {
    const client = await pool.connect();
    try {
      await initSchema(client);

      // Explicitly set order_number counter to 1500
      await client.query(`
        INSERT INTO counters (id, seq, data, created_at, updated_at)
        VALUES ('order_number', 1500, '{"seq": 1500}'::jsonb, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET seq = 1500, data = '{"seq": 1500}'::jsonb
      `);

      // Run migrations again
      await runMigrations(client);

      // Verify counter is still 1500
      const res = await client.query("SELECT seq FROM counters WHERE id = 'order_number'");
      assert.equal(Number(res.rows[0].seq), 1500, 'Counter must remain 1500 and never reset to 1000');
    } finally {
      client.release();
    }
  });

  it('all migrations are idempotent, run inside a transaction, and record in schema_migrations', async () => {
    const client = await pool.connect();
    try {
      await runMigrations(client);

      const res1 = await client.query('SELECT version, name FROM schema_migrations ORDER BY version ASC');
      assert.ok(res1.rows.length >= 6);
      assert.equal(res1.rows[0].name, '001-integrity');
      assert.equal(res1.rows[1].name, '002-simple-status');
      assert.equal(res1.rows[2].name, '003-backfill-orders-deliveries');
      assert.equal(res1.rows[3].name, '004-riders-columns-and-sync');
      assert.equal(res1.rows[4].name, '005-media-files-bytes');
      assert.equal(res1.rows[5].name, '006-seed-order-counter');

      // Run migrations a second time (should be completely idempotent no-op)
      await runMigrations(client);

      const res2 = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
      assert.equal(res2.rows.length, res1.rows.length);
    } finally {
      client.release();
    }
  });

  it('migrates OLD schema (commit f1af567) with existing data without data loss', async () => {
    const client = await pool.connect();
    try {
      // 1. Wipe schema and recreate pure OLD schema as it was at f1af567
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await client.query(OLD_SCHEMA_SQL);

      // 2. Populate sample legacy data into the old tables
      // User with unnormalized email
      await client.query(`
        INSERT INTO users (id, username, email, full_name, is_active, created_at, updated_at)
        VALUES ('u_old_1', 'olduser', '  OLDUSER@EXAMPLE.COM  ', 'Old User', true, NOW(), NOW())
      `);

      // Rider with only name and vehicle_plate (no full_name, no plate_no, no is_available)
      await client.query(`
        INSERT INTO riders (id, user_id, name, phone, vehicle_type, vehicle_plate, status, is_active, created_at, updated_at)
        VALUES ('r_old_1', 'u_old_1', 'Kuya Rider', '09170001111', 'motorcycle', 'PLATE-789', 'available', true, NOW(), NOW())
      `);

      // Customer
      await client.query(`
        INSERT INTO customers (id, name, phone, address, is_active, created_at, updated_at)
        VALUES ('c_old_1', 'Customer Legacy', '09180002222', 'Barangay 1', true, NOW(), NOW())
      `);

      // Orders (one with legacy status 'ready', one with null version and data JSONB)
      await client.query(`
        INSERT INTO orders (id, order_number, order_seq, customer_id, total_centavos, status, version, data, created_at, updated_at)
        VALUES ('o_old_1', 'JU-1050', 1050, 'c_old_1', 12000, 'ready', NULL, '{"order_number": "JU-1050", "total_centavos": 12000}'::jsonb, NOW(), NOW()),
               ('o_old_2', 'JU-1051', 1051, 'c_old_1', 18000, 'delivered', 1, '{"order_number": "JU-1051"}'::jsonb, NOW(), NOW())
      `);

      // Sales
      await client.query(`
        INSERT INTO sales (id, transaction_id, order_id, total_centavos, payment_method, source, sale_time, received_at, created_at, updated_at)
        VALUES ('s_old_1', 'tx_old_1', 'o_old_2', 18000, 'cash', 'order', NOW(), NOW(), NOW(), NOW())
      `);

      // Record pre-migration counts
      const preUsers = await client.query('SELECT COUNT(*)::int AS count FROM users');
      const preRiders = await client.query('SELECT COUNT(*)::int AS count FROM riders');
      const preCustomers = await client.query('SELECT COUNT(*)::int AS count FROM customers');
      const preOrders = await client.query('SELECT COUNT(*)::int AS count FROM orders');
      const preSales = await client.query('SELECT COUNT(*)::int AS count FROM sales');

      assert.equal(preUsers.rows[0].count, 1);
      assert.equal(preRiders.rows[0].count, 1);
      assert.equal(preCustomers.rows[0].count, 1);
      assert.equal(preOrders.rows[0].count, 2);
      assert.equal(preSales.rows[0].count, 1);

      // 3. RUN THE NEW MIGRATIONS
      await runMigrations(client);

      // 4. Verify post-migration counts - NO DATA LOST
      const postUsers = await client.query('SELECT COUNT(*)::int AS count FROM users');
      const postRiders = await client.query('SELECT COUNT(*)::int AS count FROM riders');
      const postCustomers = await client.query('SELECT COUNT(*)::int AS count FROM customers');
      const postOrders = await client.query('SELECT COUNT(*)::int AS count FROM orders');
      const postSales = await client.query('SELECT COUNT(*)::int AS count FROM sales');

      assert.equal(postUsers.rows[0].count, preUsers.rows[0].count, 'User count must remain unchanged');
      assert.equal(postRiders.rows[0].count, preRiders.rows[0].count, 'Rider count must remain unchanged');
      assert.equal(postCustomers.rows[0].count, preCustomers.rows[0].count, 'Customer count must remain unchanged');
      assert.equal(postOrders.rows[0].count, preOrders.rows[0].count, 'Order count must remain unchanged');
      assert.equal(postSales.rows[0].count, preSales.rows[0].count, 'Sale count must remain unchanged');

      // 5. Verify rider columns filled in from old data
      const riderRes = await client.query('SELECT name, full_name, vehicle_plate, plate_no, status, is_available FROM riders WHERE id = $1', ['r_old_1']);
      const rider = riderRes.rows[0];
      assert.equal(rider.name, 'Kuya Rider');
      assert.equal(rider.full_name, 'Kuya Rider', 'full_name should be filled from name');
      assert.equal(rider.vehicle_plate, 'PLATE-789');
      assert.equal(rider.plate_no, 'PLATE-789', 'plate_no should be filled from vehicle_plate');
      assert.equal(rider.status, 'available');
      assert.equal(rider.is_available, true, 'is_available should be true for status available');

      // 6. Verify user email normalized
      const userRes = await client.query('SELECT email FROM users WHERE id = $1', ['u_old_1']);
      assert.equal(userRes.rows[0].email, 'olduser@example.com');

      // 7. Verify order legacy status mapped
      const order1 = await client.query('SELECT status, version FROM orders WHERE id = $1', ['o_old_1']);
      assert.equal(order1.rows[0].status, 'preparing', 'ready should be mapped to preparing');
      assert.equal(order1.rows[0].version, 0, 'null version should be backfilled to 0');
    } finally {
      // Restore schema for subsequent test files
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await initSchema(client);
      client.release();
    }
  });
});
