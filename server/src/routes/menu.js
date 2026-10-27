import express from 'express';
import { getDb } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { menuRepo, productsRepo, ObjectId } from '../db/repositories/index.js';

export const phToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const router = express.Router();

// GET /api/menu/today -> dishes the admin picked for today (cashier + admin)
router.get('/today', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const db = getDb(), date = phToday();
    const result = await menuRepo.getTodayDishes(date, db);
    res.json(result);
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
    const found = await productsRepo.count({ id: { $in: ids }, is_active: { $ne: false } }, db);
    if (found !== ids.length) return res.status(400).json({ error: 'validation_error', message: 'Unknown or deleted dish in list' });
    const date = phToday();
    await menuRepo.upsertToday(date, ids, req.user.id, db);
    res.json({ date, product_ids: ids });
  } catch (e) { next(e); }
});

export default router;
