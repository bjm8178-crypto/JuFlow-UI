import express from 'express';
import { getDb } from '../db/mongodb.js';
import { ObjectId } from 'mongodb';
import { authenticate, requireRole } from '../middleware/auth.js';

export const phToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const router = express.Router();

// GET /api/menu/today -> dishes the admin picked for today (cashier + admin)
router.get('/today', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const db = getDb(), date = phToday();
    const menu = await db.collection('daily_menu').findOne({ date });
    const ids = menu?.product_ids || [];
    const dishes = ids.length ? await db.collection('products')
      .find({ _id: { $in: ids }, is_active: { $ne: false }, is_available: { $ne: false } })
      .project({ name: 1, price_centavos: 1, photo_path: 1 }).sort({ name: 1 }).toArray() : [];
    res.json({ date, dishes });
  } catch (e) { next(e); }
});

// PUT /api/menu/today  { product_ids: [...] }  (admin only)
router.put('/today', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const raw = req.body?.product_ids;
    if (!Array.isArray(raw) || raw.length > 200 || !raw.every(i => typeof i === 'string' && /^[a-f0-9]{24}$/i.test(i))) {
      return res.status(400).json({ error: 'validation_error', message: 'product_ids must be an array of ids' });
    }
    const ids = [...new Set(raw)].map(i => new ObjectId(i));
    const db = getDb();
    const found = await db.collection('products').countDocuments({ _id: { $in: ids }, is_active: { $ne: false } });
    if (found !== ids.length) return res.status(400).json({ error: 'validation_error', message: 'Unknown or deleted dish in list' });
    const date = phToday();
    await db.collection('daily_menu').updateOne({ date },
      { $set: { date, product_ids: ids, updated_by: req.user.id, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
      { upsert: true });
    res.json({ date, product_ids: ids });
  } catch (e) { next(e); }
});

export default router;
