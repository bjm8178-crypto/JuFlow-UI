import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;

export class ObjectId {
  constructor(id) {
    if (id instanceof ObjectId) {
      this.id = id.id;
    } else if (id && typeof id === 'object' && id.id) {
      this.id = String(id.id);
    } else {
      this.id = id ? String(id) : crypto.randomBytes(12).toString('hex');
    }
  }
  toString() { return this.id; }
  toJSON() { return this.id; }
  equals(other) {
    if (!other) return false;
    return this.id === (other instanceof ObjectId ? other.id : String(other));
  }
}

export function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
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

export async function initSchema(client = getPool()) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(sql);
  }
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
  const doc = { ...extra, ...row };
  delete doc.data;
  doc._id = row.id;
  doc.id = row.id;
  // If role_id is numeric string, parse or preserve
  if (doc.role_id && !isNaN(doc.role_id)) {
    doc.role_id = Number(doc.role_id);
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
  riders: new Set(['id', 'user_id', 'name', 'phone', 'vehicle_type', 'vehicle_plate', 'notes', 'is_available', 'is_active', 'current_lat', 'current_lng', 'last_location_at', 'data', 'created_at', 'updated_at']),
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
  media_files: new Set(['id', 'filename', 'mime_type', 'size', 'path', 'data', 'created_at', 'updated_at'])
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
    if (val && typeof val === 'object' && !(val instanceof Date) && !(val instanceof ObjectId)) {
      if ('$ne' in val) {
        if (val.$ne === null) {
          clauses.push(isCol ? `(${colName} IS NOT NULL)` : `(data->'${key}' IS NOT NULL)`);
        } else if (val.$ne === false) {
          clauses.push(isCol ? `(COALESCE(${colName}, true) IS NOT FALSE)` : `(COALESCE((data->>'${key}')::boolean, true) IS NOT FALSE)`);
        } else if (val.$ne === true) {
          clauses.push(isCol ? `(COALESCE(${colName}, false) IS NOT TRUE)` : `(COALESCE((data->>'${key}')::boolean, false) IS NOT TRUE)`);
        } else {
          const target = String(val.$ne instanceof ObjectId ? val.$ne.id : val.$ne);
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
        const mapped = val.$in.map(v => String(v instanceof ObjectId ? v.id : v));
        params.push(mapped);
        clauses.push(isCol ? `${colName} = ANY($${params.length})` : `data->>'${key}' = ANY($${params.length})`);
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
      const v = (val instanceof ObjectId) ? val.id : val;
      params.push(v);
      if (key === '_id' || key === 'id') {
        clauses.push(`id = $${params.length}::text`);
      } else if (isCol) {
        clauses.push(`(${colName} = $${params.length} OR data->>'${key}' = $${params.length}::text)`);
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
    try {
      const res = await this._query(sql, params);
      return normalizeRow(res.rows[0]);
    } catch (e) {
      return null;
    }
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
    const cols = ['id', 'data', 'created_at', 'updated_at'];
    const placeholders = ['$1', '$2::jsonb', '$3', '$4'];
    const params = [String(id), JSON.stringify(cleanDoc), cleanDoc.created_at, cleanDoc.updated_at];

    for (const [k, v] of Object.entries(cleanDoc)) {
      if (['id', 'data', 'created_at', 'updated_at'].includes(k)) continue;
      if (!validCols.has(k)) continue;
      cols.push(k);
      params.push((v instanceof ObjectId) ? v.id : (typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v));
      placeholders.push(`$${params.length}`);
    }

    const onConflictSets = ['data = EXCLUDED.data', 'updated_at = EXCLUDED.updated_at'];
    for (const col of cols) {
      if (['id', 'data', 'created_at', 'updated_at'].includes(col)) continue;
      onConflictSets.push(`${col} = EXCLUDED.${col}`);
    }

    const sql = `
      INSERT INTO ${this.name} (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET ${onConflictSets.join(', ')}
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
          if (!k.startsWith('$') && (typeof v !== 'object' || v instanceof Date || v instanceof ObjectId || v === null)) {
            const val = (v instanceof ObjectId) ? v.id : v;
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
        updatedDoc[k] = (v instanceof ObjectId) ? v.id : v;
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
        const valStr = (v instanceof ObjectId) ? v.id : v;
        if (!arr.some(item => String(item) === String(valStr))) {
          arr.push(valStr);
        }
        updatedDoc[k] = arr;
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        const arr = Array.isArray(updatedDoc[k]) ? [...updatedDoc[k]] : [];
        const valStr = (v instanceof ObjectId) ? v.id : v;
        updatedDoc[k] = arr.filter(item => String(item) !== String(valStr));
      }
    }
    updatedDoc.updated_at = new Date();

    const id = String(existing.id || existing._id);
    const validCols = await getTableColumns(this.name, this.client || getPool());
    const sets = ['data = $2::jsonb', 'updated_at = $3'];
    const params = [id, JSON.stringify(updatedDoc), updatedDoc.updated_at];

    const combined = { ...(update.$set || {}), ...(update.$inc ? updatedDoc : {}) };
    for (const [k, v] of Object.entries(combined)) {
      if (['id', 'data', 'created_at', 'updated_at'].includes(k)) continue;
      if (!validCols.has(k)) continue;
      params.push((v instanceof ObjectId) ? v.id : (typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v));
      sets.push(`${k} = $${params.length}`);
    }

    await this._query(
      `UPDATE ${this.name} SET ${sets.join(', ')} WHERE id = $1`,
      params
    );

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
    const self = this;
    const promise = (async () => {
      if (self.name === 'sales') {
        return await self._aggregateSales(pipeline);
      }
      const all = await self.find().toArray();
      return all;
    })();

    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
      toArray: () => promise
    };
  }

  async _aggregateSales(pipeline = []) {
    const p = getPool();
    // Parse match condition from first stage if present
    let matchStage = pipeline.find(s => s.$match)?.$match || {};
    const { where, params } = parseFilter(matchStage, [], 'sales');

    // 1. Group Totals
    const groupStage = pipeline.find(s => s.$group)?.$group;
    if (groupStage) {
      // By payment method
      if (groupStage._id === '$payment_method') {
        const sql = `
          SELECT payment_method AS _id,
                 COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos,
                 COUNT(*)::int AS transaction_count
          FROM sales
          WHERE ${where}
          GROUP BY payment_method
          ORDER BY total_centavos DESC
        `;
        const res = await this._query(sql, params);
        return res.rows.map(r => ({ ...r, total_centavos: Number(r.total_centavos) }));
      }

      // By hour
      if (groupStage._id && typeof groupStage._id === 'object' && groupStage._id.$hour) {
        const sql = `
          SELECT EXTRACT(HOUR FROM sale_time AT TIME ZONE 'Asia/Manila')::int AS _id,
                 COALESCE(SUM(total_centavos), 0)::bigint AS total
          FROM sales
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1
        `;
        const res = await this._query(sql, params);
        return res.rows.map(r => ({ _id: Number(r._id), total: Number(r.total) }));
      }

      // By day (last 7 days)
      if (groupStage._id && typeof groupStage._id === 'object' && groupStage._id.$dateToString && groupStage._id.$dateToString.format === '%Y-%m-%d') {
        const sql = `
          SELECT TO_CHAR(sale_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS _id,
                 COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos
          FROM sales
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1
        `;
        const res = await this._query(sql, params);
        return res.rows.map(r => ({ _id: r._id, total_centavos: Number(r.total_centavos) }));
      }

      // By month (past 6 months)
      if (groupStage._id && typeof groupStage._id === 'object' && groupStage._id.$dateToString && groupStage._id.$dateToString.format === '%Y-%m') {
        const sql = `
          SELECT TO_CHAR(sale_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS _id,
                 COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos,
                 COUNT(*)::int AS transaction_count,
                 COALESCE(SUM((
                   SELECT COALESCE(SUM((item->>'quantity')::int), 0)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS item
                 )), 0)::int AS units_sold
          FROM sales
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1
        `;
        const res = await this._query(sql, params);
        return res.rows.map(r => ({
          _id: r._id,
          total_centavos: Number(r.total_centavos),
          transaction_count: Number(r.transaction_count),
          units_sold: Number(r.units_sold)
        }));
      }

      // Overall totals: { _id: null, total_centavos: ... }
      if (groupStage._id === null) {
        const sql = `
          SELECT COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos,
                 COALESCE(SUM(food_centavos), 0)::bigint AS food_centavos,
                 COALESCE(SUM(fee_centavos), 0)::bigint AS fee_centavos,
                 COUNT(CASE WHEN source != 'refund' THEN 1 END)::int AS transaction_count,
                 COALESCE(SUM((
                   SELECT COALESCE(SUM((item->>'quantity')::int), 0)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS item
                 )), 0)::int AS units_sold,
                 COALESCE(SUM(total_centavos), 0)::bigint AS total
          FROM sales
          WHERE ${where}
        `;
        const res = await this._query(sql, params);
        const r = res.rows[0] || {};
        return [{
          _id: null,
          total: Number(r.total || 0),
          total_centavos: Number(r.total_centavos || 0),
          food_centavos: Number(r.food_centavos || 0),
          fee_centavos: Number(r.fee_centavos || 0),
          transaction_count: Number(r.transaction_count || 0),
          units_sold: Number(r.units_sold || 0)
        }];
      }
    }

    // 2. Unwind items for Top Products
    if (pipeline.some(s => s.$unwind === '$items')) {
      const sql = `
        SELECT (item->>'name') AS _id,
               COALESCE(SUM((item->>'quantity')::int), 0)::int AS units,
               COALESCE(SUM((item->>'quantity')::int * (item->>'price_centavos')::bigint), 0)::bigint AS revenue
        FROM sales,
             jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS item
        WHERE ${where} AND (item->>'quantity')::int > 0
        GROUP BY (item->>'name')
        ORDER BY units DESC, _id ASC
        LIMIT 6
      `;
      const res = await this._query(sql, params);
      return res.rows.map(r => ({
        _id: r._id,
        units: Number(r.units),
        revenue: Number(r.revenue)
      }));
    }

    return [];
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
