import express from 'express';
import { getDb, toObjectId } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { Binary } from 'mongodb';

const router = express.Router();

// Returns { fields } or { error }. Used by POST (full) and PATCH (partial).
function parse(body, partial) {
  const f = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) return { error: 'Name is required (max 120 chars)' };
    f.name = body.name.trim(); f.name_key = f.name.toLowerCase();
  }
  if (!partial || body.price_centavos !== undefined) {
    const p = Number(body.price_centavos);
    if (!Number.isInteger(p) || p < 1 || p > 10_000_000) return { error: 'Price must be a whole number of centavos, at least 1' };
    f.price_centavos = p;
  }
  if (body.description !== undefined) f.description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null;
  if (body.category_id !== undefined) f.category_id = body.category_id || null;
  if (body.is_available !== undefined) f.is_available = body.is_available !== false;
  return { fields: f };
}

// GET /api/products -> list active products (all authenticated users)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const list = await getDb().collection('products')
      .find({ is_active: { $ne: false } }).sort({ name: 1 }).toArray();
    res.json(list);
  } catch (e) { next(e); }
});

// GET /api/products/:id -> one product
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const p = await getDb().collection('products').findOne({ _id: id });
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json(p);
  } catch (e) { next(e); }
});

// POST /api/products -> create new product (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { fields, error } = parse(req.body, false);
    if (error) return res.status(400).json({ error: 'validation_error', message: error });
    const db = getDb();
    const dup = await db.collection('products').findOne({ name_key: fields.name_key, is_active: { $ne: false } });
    if (dup) return res.status(409).json({ error: 'conflict', message: 'A dish with this name already exists' });
    const doc = { ...fields, is_active: true, photo_path: null, created_at: new Date(), updated_at: new Date() };
    const r = await db.collection('products').insertOne(doc);
    res.status(201).json({ ...doc, _id: r.insertedId });
  } catch (e) { next(e); }
});

// PATCH /api/products/:id -> edit product (admin only)
router.patch('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const { fields, error } = parse(req.body, true);
    if (error) return res.status(400).json({ error: 'validation_error', message: error });
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'validation_error', message: 'No fields to update' });
    const db = getDb();
    if (fields.name_key) {
      const dup = await db.collection('products').findOne({ _id: { $ne: id }, name_key: fields.name_key, is_active: { $ne: false } });
      if (dup) return res.status(409).json({ error: 'conflict', message: 'A dish with this name already exists' });
    }
    const updated = await db.collection('products').findOneAndUpdate(
      { _id: id }, { $set: { ...fields, updated_at: new Date() } }, { returnDocument: 'after' }
    );
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json(updated);
  } catch (e) { next(e); }
});

// DELETE /api/products/:id -> soft delete + remove from today's menu (admin only)
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const db = getDb();
    const r = await db.collection('products').updateOne({ _id: id }, { $set: { is_active: false, updated_at: new Date() } });
    if (!r.matchedCount) return res.status(404).json({ error: 'not_found' });
    await db.collection('daily_menu').updateMany({}, { $pull: { product_ids: id } });
    await db.collection('product_images').deleteOne({ _id: id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/products/:id/image -> upload dish photo (admin only)
// Stores the image inside MongoDB (collection: product_images) so you don't need S3.
// Accepts: { data_url: "data:image/jpeg;base64,..." } (must be resized to <= 300 KB by the browser)
router.post('/:id/image', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const { data_url } = req.body || {};
    if (typeof data_url !== 'string') return res.status(400).json({ error: 'validation_error', message: 'data_url is required' });
    const m = data_url.match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'validation_error', message: 'Invalid data URL (only jpeg, png, webp)' });
    const contentType = m[1];
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 300 * 1024) return res.status(400).json({ error: 'too_large', message: 'Image must be under 300 KB' });
    const db = getDb();
    const product = await db.collection('products').findOne({ _id: id });
    if (!product) return res.status(404).json({ error: 'not_found' });
    await db.collection('product_images').updateOne(
      { _id: id },
      { $set: { content_type: contentType, data: new Binary(buf), updated_at: new Date() } },
      { upsert: true }
    );
    const photoPath = `/api/products/${id}/image?v=${Date.now()}`;
    await db.collection('products').updateOne({ _id: id }, { $set: { photo_path: photoPath, updated_at: new Date() } });
    res.json({ photo_path: photoPath });
  } catch (e) { next(e); }
});

// GET /api/products/:id/image -> serve dish photo (public/cached)
router.get('/:id/image', async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).end();
    const row = await getDb().collection('product_images').findOne({ _id: id });
    if (!row) return res.status(404).end();
    res.set({
      'Content-Type': row.content_type,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    });
    res.send(row.data.buffer);
  } catch (e) { next(e); }
});

export default router;
