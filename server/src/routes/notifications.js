import express from 'express';
import { getDb } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/', async (req, res, next) => {
  try {
    const col = getDb().collection('notifications'), uid = req.user.id;
    const [items, unread] = await Promise.all([
      col.find({}).sort({ created_at: -1 }).limit(30).toArray(),
      col.countDocuments({ read_by: { $ne: uid } })
    ]);
    res.json({ unread, items: items.map(({ read_by = [], ...n }) => ({ ...n, read: read_by.includes(uid) })) });
  } catch (error) { next(error); }
});

router.post('/read', async (req, res, next) => {
  try {
    await getDb().collection('notifications').updateMany({ read_by: { $ne: req.user.id } }, { $addToSet: { read_by: req.user.id } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
