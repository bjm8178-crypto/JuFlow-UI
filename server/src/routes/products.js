import express from 'express';
import { getDb, toObjectId, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export function productUpdates(body, creating = false) {
  const updates = {};
  for (const field of ['name', 'description', 'photo_path', 'price_centavos', 'category_id', 'is_available', 'is_active']) {
    if (body[field] === undefined) continue;
    const value = body[field];
    if (field === 'price_centavos') {
      if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error('Price must be a non-negative safe integer in centavos'), { status: 400 });
      updates[field] = value;
    } else if (field === 'category_id') {
      updates[field] = toObjectId(value);
      if (!updates[field]) throw Object.assign(new Error('Valid category_id required'), { status: 400 });
    } else if (field === 'is_available' || field === 'is_active') {
      if (typeof value !== 'boolean') throw Object.assign(new Error(`${field} must be a boolean`), { status: 400 });
      updates[field] = value;
    } else {
      if (value !== null && typeof value !== 'string') throw Object.assign(new Error(`${field} must be text`), { status: 400 });
      updates[field] = value?.trim() || null;
      if (field === 'name' && !updates[field]) throw Object.assign(new Error('Name required'), { status: 400 });
    }
  }
  if (creating && (!updates.name || updates.price_centavos === undefined || !updates.category_id)) {
    throw Object.assign(new Error('Name, price and category required'), { status: 400 });
  }
  if (!creating && !Object.keys(updates).length) throw Object.assign(new Error('No fields to update'), { status: 400 });
  return updates;
}

// A real write conflicts with category deletion, unlike a snapshot-only existence read.
export async function lockProductCategory(db, session, categoryId) {
  const category = await db.collection('categories').findOneAndUpdate(
    { _id: categoryId }, { $inc: { integrity_revision: 1 } }, { session, returnDocument: 'after' }
  );
  if (!category) throw Object.assign(new Error('Referenced category does not exist'), { status: 400, code: 'invalid_category' });
}

export function createProductsRouter({ database = getDb, transaction = withTransaction, auth = authenticate, admin = requireRole('admin') } = {}) {
  const router = express.Router();
  const handleError = (error, res, next) => error.status
    ? res.status(error.status).json({ error: error.code || 'validation_error', message: error.message }) : next(error);
  router.get('/', auth, async (req, res, next) => {
    try { res.json(await database().collection('products').find({ is_active: { $ne: false } }).sort({ name: 1 }).toArray()); }
    catch (error) { next(error); }
  });
  router.get('/:id', auth, async (req, res, next) => {
    try {
      const id = toObjectId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_id' });
      const product = await database().collection('products').findOne({ _id: id });
      if (!product) return res.status(404).json({ error: 'not_found' });
      res.json(product);
    } catch (error) { next(error); }
  });
  router.post('/', auth, admin, async (req, res, next) => {
    try {
      const values = productUpdates(req.body, true);
      const product = await transaction(async (db, session) => {
        await lockProductCategory(db, session, values.category_id);
        const doc = { description: null, photo_path: null, is_active: true, is_available: true, ...values, created_at: new Date(), updated_at: new Date() };
        const result = await db.collection('products').insertOne(doc, { session });
        return { ...doc, _id: result.insertedId };
      });
      res.status(201).json(product);
    } catch (error) { handleError(error, res, next); }
  });
  for (const method of ['patch', 'delete']) router[method]('/:id', auth, admin, async (req, res, next) => {
    try {
      const id = toObjectId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_id' });
      const updates = method === 'delete' ? { is_active: false } : productUpdates(req.body);
      const product = await transaction(async (db, session) => {
        const existing = await db.collection('products').findOne({ _id: id }, { session });
        if (!existing) throw Object.assign(new Error('Product not found'), { status: 404, code: 'not_found' });
        const categoryId = updates.category_id || toObjectId(existing.category_id);
        if (!categoryId) throw Object.assign(new Error('Valid category required'), { status: 400 });
        await lockProductCategory(db, session, categoryId);
        if (existing.category_id && String(existing.category_id) !== String(categoryId)) {
          await lockProductCategory(db, session, toObjectId(existing.category_id));
        }
        return db.collection('products').findOneAndUpdate({ _id: id }, { $set: { ...updates, updated_at: new Date() } }, { session, returnDocument: 'after' });
      });
      res.json(method === 'delete' ? { message: 'Product deactivated', product } : product);
    } catch (error) { handleError(error, res, next); }
  });
  return router;
}

export default createProductsRouter();
