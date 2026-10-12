import express from 'express';
import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { shape, text, validateCustomer, invalid } from '../lib/customer.js';

export function normalizedPhone(value) {
  let phone = (value || '').replace(/[^0-9]/g, '');
  if (/^09\d{9}$/.test(phone)) phone = '63' + phone.slice(1);
  if (/^9\d{9}$/.test(phone)) phone = '63' + phone;
  return phone;
}

export function normalizedMessenger(value) {
  return (value || '').trim().toLowerCase();
}

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };

export function validateImportRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) invalid('Provide between 1 and 200 rows');
  return rows.map((row, index) => {
    shape(row, ['reference', 'name', 'phone', 'messenger', 'address', 'notes', 'lat', 'lng']);
    const reference = row.reference === undefined ? String(index + 1) : text(row.reference, 'reference', 100);
    try {
      const { reference: _, notes, ...fields } = row;
      // Imported delivery notes use the existing customer landmark field.
      if (notes !== undefined) fields.landmark = notes;
      const customer = validateCustomer(fields);
      if (!normalizedPhone(customer.phone)) invalid('Phone must contain digits');
      return { index, reference, customer };
    } catch (error) {
      if (error.status !== 400) throw error;
      return { index, reference, error: error.message };
    }
  });
}

export async function previewImport(db, rows, session) {
  const existingPhones = new Map(), existingMessengers = new Map();
  const cursor = db.collection('customers').find({}, { session, projection: { _id: 1, phone: 1, messenger: 1 } });
  for await (const customer of cursor) {
    const phone = normalizedPhone(customer.phone), messenger = normalizedMessenger(customer.messenger);
    if (phone) existingPhones.set(phone, String(customer._id));
    if (messenger) existingMessengers.set(messenger, String(customer._id));
  }
  const phones = new Map(), messengers = new Map();
  return rows.map(row => {
    if (row.error) return { ...row, selectable: false, duplicates: [] };
    const phone = normalizedPhone(row.customer.phone), messenger = normalizedMessenger(row.customer.messenger);
    const duplicates = [];
    if (existingPhones.has(phone)) duplicates.push({ kind: 'existing_phone', customer_id: existingPhones.get(phone) });
    if (messenger && existingMessengers.has(messenger)) duplicates.push({ kind: 'existing_messenger', customer_id: existingMessengers.get(messenger) });
    if (phones.has(phone)) duplicates.push({ kind: 'batch_phone', row_index: phones.get(phone) });
    if (messenger && messengers.has(messenger)) duplicates.push({ kind: 'batch_messenger', row_index: messengers.get(messenger) });
    if (!phones.has(phone)) phones.set(phone, row.index);
    if (messenger && !messengers.has(messenger)) messengers.set(messenger, row.index);
    return { ...row, selectable: !duplicates.some(item => item.kind.startsWith('existing_')), duplicates };
  });
}

export async function commitImport(db, session, body, actor) {
  shape(body, ['rows', 'selected_indices', 'preview_digest', 'idempotency_key']);
  const rows = validateImportRows(body.rows);
  const previewDigest = hash(rows);
  if (body.preview_digest !== previewDigest) fail(409, 'preview_changed', 'Review a fresh preview before committing');
  const key = text(body.idempotency_key, 'idempotency_key', 128);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) invalid('Invalid idempotency key');
  const selected = body.selected_indices;
  if (!Array.isArray(selected) || !selected.length || selected.length > 200 || selected.some(index => !Number.isSafeInteger(index) || index < 0 || index >= rows.length) || new Set(selected).size !== selected.length) invalid('Choose distinct valid row indices');
  const indices = [...selected].sort((a, b) => a - b);
  if (indices.some(index => rows[index].error)) invalid('Selected rows contain validation errors');
  const digest = hash({ rows, selected_indices: indices });
  const reportId = hash({ actor: String(actor.id), key });
  // Serializes import dedup checks and commits, including retries for different keys.
  await db.collection('integrity_guards').updateOne({ _id: 'customer_imports' }, { $inc: { revision: 1 } }, { session, upsert: true });
  const previous = await db.collection('customer_import_reports').findOne({ _id: reportId }, { session });
  if (previous) {
    if (previous.digest !== digest) fail(409, 'idempotency_conflict', 'This import key was already used for different rows or selection');
    return { ...previous, replayed: true };
  }
  const chosen = indices.map(index => rows[index]);
  const reviewed = await previewImport(db, chosen, session);
  if (reviewed.some(row => row.duplicates.length)) fail(409, 'duplicate_customer', 'Selected rows duplicate an existing customer or each other. Preview and select one row per identity.');
  const now = new Date();
  const mapping = [];
  for (const row of chosen) {
    const customerId = new ObjectId();
    await db.collection('customers').insertOne({ _id: customerId, ...row.customer, created_at: now, updated_at: now, import_report_id: reportId }, { session });
    mapping.push({ row_index: row.index, reference: row.reference, customer_id: String(customerId) });
  }
  const report = {
    _id: reportId, report_id: reportId, digest, preview_digest: previewDigest,
    created_by: String(actor.id), created_at: now, imported_count: mapping.length,
    mapping, skipped: rows.filter(row => !indices.includes(row.index)).map(row => ({ row_index: row.index, reference: row.reference, reason: row.error ? 'invalid' : 'not_selected' }))
  };
  await db.collection('customer_import_reports').insertOne(report, { session });
  await db.collection('audit_events').insertOne({
    event_id: 'customer_import:' + reportId, entity_type: 'customer_import', entity_id: reportId,
    action: 'commit', performed_by: String(actor.id), performed_role: actor.role_name,
    created_at: now, report_id: reportId, imported_count: mapping.length, mapping
  }, { session });
  return report;
}

export function createCustomerImportsRouter({ database = getDb, transaction = withTransaction, auth = authenticate, roles = requireRole } = {}) {
  const router = express.Router();
  const handle = work => async (req, res, next) => {
    try { await work(req, res); } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.code || 'validation_error', message: error.message });
      next(error);
    }
  };
  router.post('/preview', auth, roles('admin', 'cashier'), handle(async (req, res) => {
    shape(req.body, ['rows']);
    const rows = validateImportRows(req.body.rows);
    res.json({ preview_digest: hash(rows), rows: await previewImport(database(), rows), total: rows.length });
  }));
  router.post('/commit', auth, roles('admin', 'cashier'), handle(async (req, res) => {
    // Validate request shape before opening a transaction.
    shape(req.body, ['rows', 'selected_indices', 'preview_digest', 'idempotency_key']);
    validateImportRows(req.body.rows);
    const report = await transaction((db, session) => commitImport(db, session, req.body, req.user));
    res.status(report.replayed ? 200 : 201).json(report);
  }));
  return router;
}

export default createCustomerImportsRouter();
