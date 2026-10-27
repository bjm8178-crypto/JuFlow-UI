import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
pg.types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;

export class ObjectId {
  constructor(id) {
    if (id instanceof ObjectId) {
      this.id = id.id;
    } else if (id && typeof id === 'object' && (id.id || typeof id.toHexString === 'function' || id._bsontype === 'ObjectId')) {
      this.id = String(id.id || (typeof id.toHexString === 'function' ? id.toHexString() : id));
    } else {
      this.id = id ? String(id) : crypto.randomBytes(12).toString('hex');
    }
  }
  toString() { return this.id; }
  toJSON() { return this.id; }
  equals(other) {
    if (!other) return false;
    return this.id === (other instanceof ObjectId ? other.id : (typeof other === 'object' && other.id ? String(other.id) : String(other)));
  }
}

export function isObjectId(v) {
  if (!v) return false;
  if (v instanceof ObjectId) return true;
  if (typeof v === 'object' && (v._bsontype === 'ObjectId' || v.constructor?.name === 'ObjectId' || typeof v.toHexString === 'function')) return true;
  return false;
}

export function extractId(v) {
  if (!v) return null;
  if (v instanceof ObjectId) return v.id;
  if (typeof v === 'object') {
    if (v.id) return String(v.id);
    if (typeof v.toHexString === 'function') return v.toHexString();
    if (typeof v.toString === 'function') return v.toString();
  }
  return String(v);
}

export function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  if (isObjectId(id)) return new ObjectId(extractId(id));
  const s = typeof id === 'object' && id.id ? String(id.id) : String(id);
  if (!/^[a-f\d]{24}$/i.test(s) && !/^\d+$/.test(s) && !/^[0-9a-f-]{36}$/i.test(s)) return null;
  return new ObjectId(s);
}

export function timestamps() {
  const now = new Date();
  return { created_at: now, updated_at: now };
}

export function updateTimestamp() {
  return { updated_at: new Date() };
}

export function getConnectionString() {
  if (process.env.DATABASE_URL_TEST && (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL)) {
    return process.env.DATABASE_URL_TEST;
  }
  return process.env.DATABASE_URL || process.env.POSTGRES_URI || process.env.PG_URL || 'postgresql://postgres:postgres@localhost:5432/juflow';
}

function shouldUseSSL(url) {
  if (!url) return false;
  if (/sslmode=require/i.test(url) || /ssl=true/i.test(url)) return true;
  if (/supabase\.co|neon\.tech|render\.com|aws|cloud/i.test(url)) return true;
  if (/localhost|127\.0\.0\.1/i.test(url)) return false;
  return true;
}

export function getPool() {
  if (!pool) {
    const connStr = getConnectionString();
    const ssl = shouldUseSSL(connStr) ? { rejectUnauthorized: false } : false;
    pool = new Pool({
      connectionString: connStr,
      ssl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }
  return pool;
}

export const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_backfill_orders_deliveries',
    sql: `
      ALTER TABLE IF EXISTS counters ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE IF EXISTS counters ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS counters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS audit_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS integrity_guards ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS media_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE IF EXISTS orders ALTER COLUMN rider TYPE TEXT;
      UPDATE orders SET
        order_number = COALESCE(order_number, data->>'order_number'),
        order_seq = COALESCE(order_seq, (data->>'order_seq')::int),
        customer_id = COALESCE(customer_id, data->>'customer_id'),
        customer = CASE WHEN customer IS NULL OR customer = '{}'::jsonb THEN COALESCE(data->'customer', '{}'::jsonb) ELSE customer END,
        items = CASE WHEN items IS NULL OR items = '[]'::jsonb THEN COALESCE(data->'items', '[]'::jsonb) ELSE items END,
        total_centavos = COALESCE(NULLIF(total_centavos, 0), (data->>'total_centavos')::int, 0),
        subtotal_centavos = COALESCE(NULLIF(subtotal_centavos, 0), (data->>'subtotal_centavos')::int, 0),
        fee_centavos = COALESCE(NULLIF(fee_centavos, 0), (data->>'fee_centavos')::int, 0),
        payment_method = COALESCE(payment_method, data->>'payment_method'),
        payment_status = COALESCE(payment_status, data->>'payment_status', 'pending'),
        status = COALESCE(data->>'status', status),
        rider_id = COALESCE(rider_id, data->>'rider_id'),
        rider = COALESCE(rider, data->>'rider'),
        notes = COALESCE(notes, data->>'notes')
      WHERE data IS NOT NULL AND data != '{}'::jsonb;
      UPDATE deliveries SET
        order_id = COALESCE(order_id, data->>'order_id'),
        customer_id = COALESCE(customer_id, data->>'customer_id'),
        rider_id = COALESCE(rider_id, data->>'rider_id'),
        status = COALESCE(data->>'status', status),
        notes = COALESCE(notes, data->>'notes')
      WHERE data IS NOT NULL AND data != '{}'::jsonb;
    `
  },
  {
    version: 2,
    name: '002_riders_columns_and_sync',
    sql: `
      ALTER TABLE IF EXISTS riders ADD COLUMN IF NOT EXISTS full_name VARCHAR(150);
      ALTER TABLE IF EXISTS riders ADD COLUMN IF NOT EXISTS plate_no VARCHAR(50);
      ALTER TABLE IF EXISTS riders ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT TRUE;
      ALTER TABLE IF EXISTS riders ADD COLUMN IF NOT EXISTS last_location JSONB DEFAULT NULL;
      UPDATE riders SET
        full_name = COALESCE(full_name, name),
        plate_no = COALESCE(plate_no, vehicle_plate)
      WHERE full_name IS NULL OR plate_no IS NULL;
    `
  },
  {
    version: 3,
    name: '003_media_files_bytes',
    sql: `
      ALTER TABLE IF EXISTS media_files ADD COLUMN IF NOT EXISTS bytes BYTEA;
    `
  }
];

export async function runMigrations(client = getPool()) {
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const res = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
    const applied = new Set(res.rows.map(r => r.version));

    for (const m of MIGRATIONS) {
      if (!applied.has(m.version)) {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())',
          [m.version, m.name]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function initSchema(client = getPool()) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(sql);
  }
  await runMigrations(client);
}

export async function connect() {
  const p = getPool();
  // Test connection
  const client = await p.connect();
  try {
    await client.query('SELECT 1');
    console.log('✅ PostgreSQL connected successfully');
    await initSchema(client);
    console.log('✅ PostgreSQL schema verified');
  } finally {
    client.release();
  }
  return getDb();
}

export async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('PostgreSQL pool closed');
  }
}

export async function readiness() {
  const p = getPool();
  await p.query('SELECT 1');
  return true;
}

export function normalizeRow(row) {
  if (!row) return null;
  const extra = (row.data && typeof row.data === 'object') ? row.data : {};
  const doc = { ...extra };
  for (const [k, v] of Object.entries(row)) {
    if (k === 'data') continue;
    if (v !== null && v !== undefined) {
      if ((v === 0 || v === '' || (Array.isArray(v) && v.length === 0)) && extra[k] !== undefined && extra[k] !== null && extra[k] !== 0 && extra[k] !== '') {
        doc[k] = extra[k];
      } else {
        doc[k] = v;
      }
    }
  }
  doc._id = row.id;
  doc.id = row.id;

  const numericKeys = [
    'role_id', 'seq', 'order_seq', 'revision', 'fee_centavos', 'total_centavos',
    'food_centavos', 'subtotal_centavos', 'price_centavos', 'cost_centavos',
    'cash_tendered_centavos', 'change_centavos'
  ];
  for (const k of numericKeys) {
    if (doc[k] !== undefined && doc[k] !== null && !isNaN(doc[k])) {
      doc[k] = Number(doc[k]);
    }
  }

  // Rider field compatibility mapping
  if (doc.full_name !== undefined || doc.name !== undefined) {
    const fn = doc.full_name || doc.name;
    doc.full_name = fn;
    doc.name = fn;
  }
  if (doc.plate_no !== undefined || doc.vehicle_plate !== undefined) {
    const pn = doc.plate_no || doc.vehicle_plate;
    doc.plate_no = pn;
    doc.vehicle_plate = pn;
  }
  if (doc.is_available === undefined && doc.status !== undefined) {
    doc.is_available = doc.status !== 'offline';
  } else if (doc.is_available !== undefined) {
    doc.is_available = Boolean(doc.is_available);
  }
  if (!doc.last_location && (row.last_lat !== undefined && row.last_lat !== null)) {
    doc.last_location = {
      lat: row.last_lat,
      lng: row.last_lng,
      occurred_at: row.last_location_at
    };
  } else if (doc.last_location && typeof doc.last_location === 'string') {
    try { doc.last_location = JSON.parse(doc.last_location); } catch (_) {}
  }

  return doc;
}

const KNOWN_TABLE_COLUMNS = {
  users: new Set(['id', 'username', 'email', 'password_hash', 'full_name', 'phone', 'role_id', 'is_active', 'failed_attempts', 'locked_until', 'last_login_at', 'data', 'created_at', 'updated_at']),
  auth_sessions: new Set(['id', 'user_id', 'token_hash', 'ip_address', 'user_agent', 'expires_at', 'revoked_at', 'data', 'created_at', 'updated_at']),
  categories: new Set(['id', 'name', 'slug', 'sort_order', 'is_active', 'data', 'created_at', 'updated_at']),
  products: new Set(['id', 'category_id', 'name', 'name_key', 'description', 'price_centavos', 'cost_centavos', 'is_available', 'is_active', 'image_url', 'image_data', 'data', 'created_at', 'updated_at']),
  customers: new Set(['id', 'name', 'phone', 'messenger', 'address', 'notes', 'latitude', 'longitude', 'is_active', 'data', 'created_at', 'updated_at']),
  delivery_zones: new Set(['id', 'name', 'fee_centavos', 'estimated_minutes', 'sort_order', 'is_active', 'coordinates', 'data', 'created_at', 'updated_at']),
  riders: new Set(['id', 'user_id', 'name', 'full_name', 'phone', 'vehicle_type', 'vehicle_plate', 'plate_no', 'status', 'notes', 'is_available', 'is_active', 'last_lat', 'last_lng', 'last_location_at', 'last_location', 'current_lat', 'current_lng', 'data', 'created_at', 'updated_at']),
  orders: new Set(['id', 'order_number', 'order_seq', 'idempotency_key', 'customer_id', 'customer', 'items', 'subtotal_centavos', 'fee_centavos', 'total_centavos', 'cash_tendered_centavos', 'change_centavos', 'payment_method', 'gcash_reference', 'status', 'notes', 'pricing_actor', 'cashier_id', 'rider_id', 'delivery', 'data', 'created_at', 'updated_at']),
  deliveries: new Set(['id', 'order_id', 'rider_id', 'status', 'notes', 'fee_centavos', 'delivery_zone_id', 'dropoff_lat', 'dropoff_lng', 'picked_up_at', 'delivered_at', 'data', 'created_at', 'updated_at']),
  sales: new Set(['id', 'transaction_id', 'order_id', 'void_id', 'event_id', 'sale_time', 'received_at', 'source', 'payment_method', 'items', 'food_centavos', 'fee_centavos', 'total_centavos', 'cash_tendered_centavos', 'gcash_reference', 'recorded_by', 'is_test_sale', 'voided_at', 'digest', 'data', 'created_at', 'updated_at']),
  settings: new Set(['id', 'key', 'value', 'description', 'data', 'created_at', 'updated_at']),
  daily_menu: new Set(['id', 'date', 'dishes', 'data', 'created_at', 'updated_at']),
  notifications: new Set(['id', 'type', 'title', 'body', 'read', 'data', 'created_at', 'updated_at']),
  counters: new Set(['id', 'seq', 'data', 'created_at', 'updated_at']),
  audit_events: new Set(['id', 'event_id', 'entity_type', 'entity_id', 'action', 'actor_id', 'actor_role', 'payload', 'data', 'created_at', 'updated_at']),
  roles: new Set(['id', 'name', 'description', 'permissions', 'data', 'created_at', 'updated_at']),
  integrity_guards: new Set(['id', 'revision', 'data', 'created_at', 'updated_at']),
  media_files: new Set(['id', 'filename', 'mime_type', 'content_type', 'size', 'bytes', 'metadata', 'path', 'data', 'created_at', 'updated_at'])
};

function hasColumn(tableName, col) {
  if (col === 'id' || col === '_id') return true;
  if (tableColumnCache.has(tableName)) {
    return tableColumnCache.get(tableName).has(col);
  }
  if (KNOWN_TABLE_COLUMNS[tableName]) {
    return KNOWN_TABLE_COLUMNS[tableName].has(col);
  }
  return false;
}

// Convert Mongo-style filter to PostgreSQL WHERE clause
function parseFilter(filter = {}, params = [], tableName = null) {
  if (!filter || Object.keys(filter).length === 0) return { where: '1=1', params };
  const clauses = [];

  for (const [key, val] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(val)) {
      const orClauses = [];
      for (const item of val) {
        const sub = parseFilter(item, params, tableName);
        orClauses.push(`(${sub.where})`);
      }
      clauses.push(`(${orClauses.join(' OR ')})`);
      continue;
    }
    if (key === '$and' && Array.isArray(val)) {
      const andClauses = [];
      for (const item of val) {
        const sub = parseFilter(item, params, tableName);
        andClauses.push(`(${sub.where})`);
      }
      clauses.push(`(${andClauses.join(' AND ')})`);
      continue;
    }

    const isCol = (key === '_id' || key === 'id') || (tableName && hasColumn(tableName, key));
    const colName = (key === '_id' || key === 'id') ? 'id' : key;

    // Handle operator objects: { $ne, $gte, $lt, $gt, $lte, $in, $regex }
    if (val && typeof val === 'object' && !(val instanceof Date) && !isObjectId(val)) {
      if ('$ne' in val) {
        if (val.$ne === null) {
          clauses.push(isCol ? `(${colName} IS NOT NULL)` : `(data->'${key}' IS NOT NULL)`);
        } else if (val.$ne === false) {
          clauses.push(isCol ? `(COALESCE(${colName}, true) IS NOT FALSE)` : `(COALESCE((data->>'${key}')::boolean, true) IS NOT FALSE)`);
        } else if (val.$ne === true) {
          clauses.push(isCol ? `(COALESCE(${colName}, false) IS NOT TRUE)` : `(COALESCE((data->>'${key}')::boolean, false) IS NOT TRUE)`);
        } else {
          const target = String(isObjectId(val.$ne) ? extractId(val.$ne) : val.$ne);
          params.push(target);
          if (isCol) {
            clauses.push(`(${colName} IS DISTINCT FROM $${params.length})`);
          } else {
            clauses.push(`(data->'${key}' IS NULL OR (CASE WHEN jsonb_typeof(data->'${key}') = 'array' THEN NOT (data->'${key}' ? $${params.length}) ELSE data->>'${key}' IS DISTINCT FROM $${params.length} END))`);
          }
        }
      }
      if ('$gte' in val) {
        params.push(val.$gte);
        clauses.push(isCol ? `${colName} >= $${params.length}` : `(data->>'${key}')::numeric >= $${params.length}`);
      }
      if ('$gt' in val) {
        params.push(val.$gt);
        clauses.push(isCol ? `${colName} > $${params.length}` : `(data->>'${key}')::numeric > $${params.length}`);
      }
      if ('$lte' in val) {
        params.push(val.$lte);
        clauses.push(isCol ? `${colName} <= $${params.length}` : `(data->>'${key}')::numeric <= $${params.length}`);
      }
      if ('$lt' in val) {
        params.push(val.$lt);
        clauses.push(isCol ? `${colName} < $${params.length}` : `(data->>'${key}')::numeric < $${params.length}`);
      }
      if ('$in' in val && Array.isArray(val.$in)) {
        const mapped = val.$in.map(v => String(isObjectId(v) ? extractId(v) : v));
        params.push(mapped);
        clauses.push(isCol ? `${colName} = ANY($${params.length})` : `data->>'${key}' = ANY($${params.length})`);
      }
      if ('$nin' in val && Array.isArray(val.$nin)) {
        const mapped = val.$nin.map(v => String(isObjectId(v) ? extractId(v) : v));
        params.push(mapped);
        clauses.push(isCol
          ? `(${colName} IS NULL OR NOT (${colName} = ANY($${params.length})))`
          : `(data->>'${key}' IS NULL OR NOT (data->>'${key}' = ANY($${params.length})))`
        );
      }
      if ('$exists' in val) {
        if (val.$exists) {
          clauses.push(isCol ? `${colName} IS NOT NULL` : `(data->'${key}' IS NOT NULL)`);
        } else {
          clauses.push(isCol ? `${colName} IS NULL` : `(data->'${key}' IS NULL)`);
        }
      }
      if ('$regex' in val) {
        params.push(`%${val.$regex}%`);
        clauses.push(isCol ? `(${colName}::text ILIKE $${params.length} OR data->>'${key}' ILIKE $${params.length})` : `data->>'${key}' ILIKE $${params.length}`);
      }
      continue;
    }

    // Direct value match
    if (val === null) {
      clauses.push(isCol ? `(${colName} IS NULL)` : `(data->'${key}' IS NULL)`);
    } else {
      const v = isObjectId(val) ? extractId(val) : val;
      params.push(v);
      if (key === '_id' || key === 'id') {
        clauses.push(`id = $${params.length}::text`);
      } else if (isCol) {
        clauses.push(`(${colName} = $${params.length} OR data->>'${key}' = ($${params.length})::text)`);
      } else {
        clauses.push(`(CASE WHEN jsonb_typeof(data->'${key}') = 'array' THEN data->'${key}' ? $${params.length}::text ELSE data->>'${key}' = $${params.length}::text END)`);
      }
    }
  }

  return { where: clauses.length ? clauses.join(' AND ') : '1=1', params };
}

const tableColumnCache = new Map();
async function getTableColumns(tableName, client) {
  if (tableColumnCache.has(tableName)) return tableColumnCache.get(tableName);
  try {
    const res = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
    `, [tableName]);
    const set = new Set(res.rows.map(r => r.column_name));
    tableColumnCache.set(tableName, set);
    return set;
  } catch (_) {
    return KNOWN_TABLE_COLUMNS[tableName] || new Set();
  }
}

export class PostgresCollection {
  constructor(name, client = null) {
    this.name = name;
    this.client = client; // null uses pool
  }

  async _query(sql, params = []) {
    const executor = this.client || getPool();
    return executor.query(sql, params);
  }

  async findOne(filter = {}, options = {}) {
    const { where, params } = parseFilter(filter, [], this.name);
    const sql = `SELECT * FROM ${this.name} WHERE ${where} LIMIT 1`;
    const res = await this._query(sql, params);
    return normalizeRow(res.rows[0]);
  }

  find(filter = {}, options = {}) {
    const self = this;
    let sortClause = '';
    let skipVal = 0;
    let limitVal = null;
    let projection = options.projection || null;

    const cursor = {
      sort(s) {
        if (s && typeof s === 'object') {
          const parts = [];
          for (const [k, dir] of Object.entries(s)) {
            const col = (k === '_id' || k === 'id') ? 'id' : k;
            parts.push(`${col} ${dir === -1 || dir === 'desc' ? 'DESC' : 'ASC'}`);
          }
          if (parts.length) sortClause = ` ORDER BY ${parts.join(', ')}`;
        }
        return cursor;
      },
      skip(n) {
        skipVal = Number(n) || 0;
        return cursor;
      },
      limit(n) {
        limitVal = Number(n) || null;
        return cursor;
      },
      project(p) {
        projection = p;
        return cursor;
      },
      async toArray() {
        const { where, params } = parseFilter(filter, [], self.name);
        let sql = `SELECT * FROM ${self.name} WHERE ${where}${sortClause}`;
        if (limitVal !== null && limitVal > 0) {
          sql += ` LIMIT ${limitVal}`;
        }
        if (skipVal > 0) {
          sql += ` OFFSET ${skipVal}`;
        }
        const res = await self._query(sql, params);
        return res.rows.map(r => normalizeRow(r));
      }
    };

    return cursor;
  }

  async countDocuments(filter = {}) {
    const { where, params } = parseFilter(filter, [], this.name);
    const sql = `SELECT COUNT(*)::int AS count FROM ${this.name} WHERE ${where}`;
    const res = await this._query(sql, params);
    return res.rows[0]?.count || 0;
  }

  async insertOne(doc) {
    const id = doc.id || doc._id || crypto.randomBytes(12).toString('hex');
    const cleanDoc = { ...doc };
    delete cleanDoc._id;
    cleanDoc.id = String(id);
    cleanDoc.created_at = cleanDoc.created_at || new Date();
    cleanDoc.updated_at = cleanDoc.updated_at || new Date();

    const validCols = await getTableColumns(this.name, this.client || getPool());
    const cols = ['id'];
    const placeholders = ['$1'];
    const params = [String(id)];

    if (validCols.has('data')) {
      cols.push('data');
      params.push(JSON.stringify(cleanDoc));
      placeholders.push(`$${params.length}::jsonb`);
    }
    if (validCols.has('created_at')) {
      cols.push('created_at');
      params.push(cleanDoc.created_at);
      placeholders.push(`$${params.length}`);
    }
    if (validCols.has('updated_at')) {
      cols.push('updated_at');
      params.push(cleanDoc.updated_at);
      placeholders.push(`$${params.length}`);
    }

    for (const [k, v] of Object.entries(cleanDoc)) {
      if (['id', 'data', 'created_at', 'updated_at'].includes(k)) continue;
      if (!validCols.has(k)) continue;
      cols.push(k);
      params.push(isObjectId(v) ? extractId(v) : (typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v));
      placeholders.push(`$${params.length}`);
    }

    const onConflictSets = [];
    if (validCols.has('data')) onConflictSets.push('data = EXCLUDED.data');
    if (validCols.has('updated_at')) onConflictSets.push('updated_at = EXCLUDED.updated_at');
    for (const col of cols) {
      if (['id', 'data', 'created_at', 'updated_at'].includes(col)) continue;
      onConflictSets.push(`${col} = EXCLUDED.${col}`);
    }

    const conflictClause = onConflictSets.length > 0
      ? `ON CONFLICT (id) DO UPDATE SET ${onConflictSets.join(', ')}`
      : 'ON CONFLICT (id) DO NOTHING';

    const sql = `
      INSERT INTO ${this.name} (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      ${conflictClause}
      RETURNING *
    `;
    await this._query(sql, params);

    return { insertedId: id, acknowledged: true };
  }

  async insertMany(docs) {
    for (const d of docs) {
      await this.insertOne(d);
    }
    return { insertedCount: docs.length, acknowledged: true };
  }

  async updateOne(filter, update, options = {}) {
    const existing = await this.findOne(filter);
    if (!existing) {
      if (options.upsert) {
        const filterFields = {};
        for (const [k, v] of Object.entries(filter || {})) {
          if (!k.startsWith('$') && (typeof v !== 'object' || v instanceof Date || isObjectId(v) || v === null)) {
            const val = isObjectId(v) ? extractId(v) : v;
            filterFields[k === '_id' ? 'id' : k] = val;
            if (k === '_id') filterFields._id = val;
          }
        }
        const newDoc = {
          ...filterFields,
          ...(options.$setOnInsert || update.$setOnInsert || {}),
          ...(update.$set || {})
        };
        const id = filter._id || filter.id || newDoc.id || newDoc._id || crypto.randomBytes(12).toString('hex');
        await this.insertOne({ ...newDoc, id });
        return { matchedCount: 0, modifiedCount: 1, upsertedId: id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    let updatedDoc = { ...existing };
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        updatedDoc[k] = isObjectId(v) ? extractId(v) : v;
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        updatedDoc[k] = (Number(updatedDoc[k]) || 0) + Number(v);
      }
    }
    if (update.$addToSet) {
      for (const [k, v] of Object.entries(update.$addToSet)) {
        const arr = Array.isArray(updatedDoc[k]) ? [...updatedDoc[k]] : [];
        const valStr = isObjectId(v) ? extractId(v) : v;
        if (!arr.some(item => String(item) === String(valStr))) {
          arr.push(valStr);
        }
        updatedDoc[k] = arr;
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        const arr = Array.isArray(updatedDoc[k]) ? [...updatedDoc[k]] : [];
        const valStr = isObjectId(v) ? extractId(v) : v;
        updatedDoc[k] = arr.filter(item => String(item) !== String(valStr));
      }
    }
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) {
        delete updatedDoc[k];
      }
    }
    updatedDoc.updated_at = new Date();

    const id = String(existing.id || existing._id);
    const validCols = await getTableColumns(this.name, this.client || getPool());
    const sets = [];
    const params = [id];
    if (validCols.has('data')) {
      params.push(JSON.stringify(updatedDoc));
      sets.push(`data = $${params.length}::jsonb`);
    }
    if (validCols.has('updated_at')) {
      params.push(updatedDoc.updated_at);
      sets.push(`updated_at = $${params.length}`);
    }

    const combined = { ...(update.$set || {}), ...(update.$inc ? updatedDoc : {}) };
    for (const [k, v] of Object.entries(combined)) {
      if (['id', 'data', 'created_at', 'updated_at'].includes(k)) continue;
      if (!validCols.has(k)) continue;
      params.push(isObjectId(v) ? extractId(v) : (typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v));
      sets.push(`${k} = $${params.length}`);
    }

    if (sets.length > 0) {
      await this._query(
        `UPDATE ${this.name} SET ${sets.join(', ')} WHERE id = $1`,
        params
      );
    }

    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(filter = {}, update = {}, options = {}) {
    const docs = await this.find(filter).toArray();
    let modifiedCount = 0;
    for (const doc of docs) {
      const res = await this.updateOne({ id: doc.id || doc._id }, update, { ...options, upsert: false });
      if (res.modifiedCount) modifiedCount += res.modifiedCount;
    }
    return { matchedCount: docs.length, modifiedCount };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const before = await this.findOne(filter);
    if (!before) {
      if (options.upsert) {
        const filterFields = {};
        for (const [k, v] of Object.entries(filter || {})) {
          if (!k.startsWith('$') && (typeof v !== 'object' || v instanceof Date || v instanceof ObjectId || v === null)) {
            const val = (v instanceof ObjectId) ? v.id : v;
            filterFields[k === '_id' ? 'id' : k] = val;
            if (k === '_id') filterFields._id = val;
          }
        }
        const id = filter._id || filter.id || crypto.randomBytes(12).toString('hex');
        const setOnInsert = update.$setOnInsert || {};
        const setFields = update.$set || {};
        const doc = { ...filterFields, ...setOnInsert, ...setFields, id };
        await this.insertOne(doc);
        return options.returnDocument === 'after' ? doc : null;
      }
      return null;
    }

    await this.updateOne(filter, update, options);
    if (options.returnDocument === 'after') {
      return await this.findOne(filter);
    }
    return before;
  }

  async deleteOne(filter) {
    const existing = await this.findOne(filter);
    if (!existing) return { deletedCount: 0 };
    const id = String(existing.id || existing._id);
    await this._query(`DELETE FROM ${this.name} WHERE id = $1`, [id]);
    return { deletedCount: 1 };
  }

  async deleteMany(filter) {
    const { where, params } = parseFilter(filter, [], this.name);
    const res = await this._query(`DELETE FROM ${this.name} WHERE ${where}`, params);
    return { deletedCount: res.rowCount };
  }

  aggregate(pipeline = []) {
    throw new Error('unsupported pipeline');
  }
}

export class PostgresDatabase {
  constructor(client = null) {
    this.client = client;
  }

  collection(name) {
    return new PostgresCollection(name, this.client);
  }

  async listCollections() {
    const res = await (this.client || getPool()).query(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    return res.rows;
  }

  async createCollection(name) {
    await (this.client || getPool()).query(`
      CREATE TABLE IF NOT EXISTS ${name} (
        id VARCHAR(64) PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return this.collection(name);
  }
}

let defaultDb = null;
export function getDb() {
  if (!defaultDb) {
    defaultDb = new PostgresDatabase();
  }
  return defaultDb;
}

export async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const txDb = new PostgresDatabase(client);
    const result = await work(txDb, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createIndexes() {
  await initSchema();
}
