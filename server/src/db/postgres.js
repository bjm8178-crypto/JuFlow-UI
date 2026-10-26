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

// Convert Mongo-style filter to PostgreSQL WHERE clause
function parseFilter(filter = {}, params = []) {
  if (!filter || Object.keys(filter).length === 0) return { where: '1=1', params };
  const clauses = [];

  for (const [key, val] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(val)) {
      const orClauses = [];
      for (const item of val) {
        const sub = parseFilter(item, params);
        orClauses.push(`(${sub.where})`);
      }
      clauses.push(`(${orClauses.join(' OR ')})`);
      continue;
    }
    if (key === '$and' && Array.isArray(val)) {
      const andClauses = [];
      for (const item of val) {
        const sub = parseFilter(item, params);
        andClauses.push(`(${sub.where})`);
      }
      clauses.push(`(${andClauses.join(' AND ')})`);
      continue;
    }

    const colName = (key === '_id' || key === 'id') ? 'id' : key;

    // Handle operator objects: { $ne, $gte, $lt, $gt, $lte, $in, $regex }
    if (val && typeof val === 'object' && !(val instanceof Date) && !(val instanceof ObjectId)) {
      if ('$ne' in val) {
        if (val.$ne === null) {
          clauses.push(`(${colName} IS NOT NULL OR data->>'${key}' IS NOT NULL)`);
        } else if (val.$ne === false) {
          clauses.push(`(COALESCE(${colName}, true) IS NOT FALSE)`);
        } else if (val.$ne === true) {
          clauses.push(`(COALESCE(${colName}, false) IS NOT TRUE)`);
        } else {
          params.push(String(val.$ne instanceof ObjectId ? val.$ne.id : val.$ne));
          clauses.push(`(${colName} IS DISTINCT FROM $${params.length})`);
        }
      }
      if ('$gte' in val) {
        params.push(val.$gte);
        clauses.push(`${colName} >= $${params.length}`);
      }
      if ('$gt' in val) {
        params.push(val.$gt);
        clauses.push(`${colName} > $${params.length}`);
      }
      if ('$lte' in val) {
        params.push(val.$lte);
        clauses.push(`${colName} <= $${params.length}`);
      }
      if ('$lt' in val) {
        params.push(val.$lt);
        clauses.push(`${colName} < $${params.length}`);
      }
      if ('$in' in val && Array.isArray(val.$in)) {
        const mapped = val.$in.map(v => String(v instanceof ObjectId ? v.id : v));
        params.push(mapped);
        clauses.push(`${colName} = ANY($${params.length})`);
      }
      if ('$regex' in val) {
        params.push(`%${val.$regex}%`);
        clauses.push(`(${colName}::text ILIKE $${params.length} OR data->>'${key}' ILIKE $${params.length})`);
      }
      continue;
    }

    // Direct value match
    if (val === null) {
      clauses.push(`(${colName} IS NULL OR data->>'${key}' IS NULL)`);
    } else {
      const v = (val instanceof ObjectId) ? val.id : val;
      params.push(v);
      if (key === '_id' || key === 'id') {
        clauses.push(`id = $${params.length}::text`);
      } else {
        clauses.push(`(${colName} = $${params.length} OR data->>'${key}' = $${params.length}::text)`);
      }
    }
  }

  return { where: clauses.length ? clauses.join(' AND ') : '1=1', params };
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
    const { where, params } = parseFilter(filter);
    const sql = `SELECT * FROM ${this.name} WHERE ${where} LIMIT 1`;
    try {
      const res = await this._query(sql, params);
      return normalizeRow(res.rows[0]);
    } catch (e) {
      // If table doesn't exist or column error, check fallback
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
        const { where, params } = parseFilter(filter);
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
    const { where, params } = parseFilter(filter);
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

    // Extract table-specific fields
    const keys = Object.keys(cleanDoc);
    const values = Object.values(cleanDoc);

    // Save full document in data JSONB
    const sql = `
      INSERT INTO ${this.name} (id, data, created_at, updated_at)
      VALUES ($1, $2::jsonb, $3, $4)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
      RETURNING *
    `;
    await this._query(sql, [String(id), JSON.stringify(cleanDoc), cleanDoc.created_at, cleanDoc.updated_at]);

    // Also update known columns if columns exist in the table
    try {
      const updates = [];
      const colParams = [String(id)];
      for (const [k, v] of Object.entries(cleanDoc)) {
        if (['id', 'data', 'created_at', 'updated_at'].includes(k)) continue;
        const val = (v instanceof ObjectId) ? v.id : (typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v);
        colParams.push(val);
        updates.push(`${k} = $${colParams.length}`);
      }
      if (updates.length) {
        await this._query(`UPDATE ${this.name} SET ${updates.join(', ')} WHERE id = $1`, colParams);
      }
    } catch (_) {
      // Ignore column update if column doesn't exist; data JSONB has the authoritative document
    }

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
        const newDoc = {
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
    updatedDoc.updated_at = new Date();

    const id = String(existing.id || existing._id);
    await this._query(
      `UPDATE ${this.name} SET data = $2::jsonb, updated_at = $3 WHERE id = $1`,
      [id, JSON.stringify(updatedDoc), updatedDoc.updated_at]
    );

    // Also update known columns
    try {
      const updates = [];
      const colParams = [id];
      const combined = { ...(update.$set || {}), ...(update.$inc ? updatedDoc : {}) };
      for (const [k, v] of Object.entries(combined)) {
        if (['id', 'data'].includes(k)) continue;
        const val = (v instanceof ObjectId) ? v.id : (typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v);
        colParams.push(val);
        updates.push(`${k} = $${colParams.length}`);
      }
      if (updates.length) {
        await this._query(`UPDATE ${this.name} SET ${updates.join(', ')} WHERE id = $1`, colParams);
      }
    } catch (_) {}

    return { matchedCount: 1, modifiedCount: 1 };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const before = await this.findOne(filter);
    if (!before) {
      if (options.upsert) {
        const id = filter._id || filter.id || crypto.randomBytes(12).toString('hex');
        const setOnInsert = update.$setOnInsert || {};
        const setFields = update.$set || {};
        const doc = { ...setOnInsert, ...setFields, id };
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
    const { where, params } = parseFilter(filter);
    const res = await this._query(`DELETE FROM ${this.name} WHERE ${where}`, params);
    return { deletedCount: res.rowCount };
  }

  async aggregate(pipeline = []) {
    // Specialized high-performance aggregation for sales and general reports
    if (this.name === 'sales') {
      return this._aggregateSales(pipeline);
    }
    // Generic fallback for in-memory or simple operations
    const all = await this.find().toArray();
    return all;
  }

  async _aggregateSales(pipeline = []) {
    const p = getPool();
    // Parse match condition from first stage if present
    let matchStage = pipeline.find(s => s.$match)?.$match || {};
    const { where, params } = parseFilter(matchStage);

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
      if (typeof groupStage._id === 'object' && groupStage._id.$hour) {
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
      if (typeof groupStage._id === 'object' && groupStage._id.$dateToString && groupStage._id.$dateToString.format === '%Y-%m-%d') {
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
      if (typeof groupStage._id === 'object' && groupStage._id.$dateToString && groupStage._id.$dateToString.format === '%Y-%m') {
        const sql = `
          SELECT TO_CHAR(sale_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS _id,
                 COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos,
                 COUNT(*)::int AS transaction_count,
                 COALESCE(SUM((
                   SELECT COALESCE(SUM((item->>'quantity')::int), 0)
                   FROM jsonb_array_elements(items) AS item
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
                   FROM jsonb_array_elements(items) AS item
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
             jsonb_array_elements(items) AS item
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
