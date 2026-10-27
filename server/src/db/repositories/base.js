import crypto from 'crypto';
import { getPool, ObjectId, toObjectId, extractId, isObjectId } from '../postgres.js';

export { ObjectId, toObjectId, extractId, isObjectId };

export function newId() {
  return crypto.randomBytes(12).toString('hex');
}

export function getExecutor(clientOrDb) {
  if (clientOrDb) {
    if (typeof clientOrDb.query === 'function') return clientOrDb;
    if (clientOrDb.client && typeof clientOrDb.client.query === 'function') return clientOrDb.client;
  }
  return getPool();
}

export function normalizeRow(row) {
  if (!row) return null;
  const extra = (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) ? row.data : {};
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

  const idVal = row.id != null ? String(row.id) : (doc.id != null ? String(doc.id) : null);
  if (idVal) {
    doc.id = idVal;
    doc._id = idVal;
  }

  const numericKeys = [
    'role_id', 'seq', 'order_seq', 'revision', 'fee_centavos', 'total_centavos',
    'food_centavos', 'subtotal_centavos', 'price_centavos', 'cost_centavos',
    'cash_tendered_centavos', 'change_centavos', 'version', 'sort_order'
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
      lat: Number(row.last_lat),
      lng: Number(row.last_lng),
      occurred_at: row.last_location_at || row.updated_at
    };
  }

  return doc;
}

export async function query(clientOrDb, text, params = []) {
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(text, params);
  return res.rows.map(normalizeRow);
}

export async function queryOne(clientOrDb, text, params = []) {
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(text, params);
  return res.rows[0] ? normalizeRow(res.rows[0]) : null;
}

export async function execute(clientOrDb, text, params = []) {
  const executor = getExecutor(clientOrDb);
  return await executor.query(text, params);
}
