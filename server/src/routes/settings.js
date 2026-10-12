import express from 'express';
import { getDb, toObjectId, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateSetting, validateSettingKey } from '../lib/settings.js';
import { listOptions, text } from '../lib/customer.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { limit, skip, search } = listOptions(req.query);
    const group = req.query.group === undefined ? null : text(req.query.group, 'group', 64);
    const db = getDb();
    const query = group ? { group_name: group } : {};
    if (search) query.key = { $regex: search, $options: 'i' };
    const settings = await db.collection('settings').find(query).sort({ key: 1 }).skip(skip).limit(limit).toArray();
    res.json(settings);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch settings' });
  }
});

router.get('/:key', authenticate, async (req, res) => {
  try {
    validateSettingKey(req.params.key);
    const db = getDb();
    const setting = await db.collection('settings').findOne({ key: req.params.key });
    if (!setting) return res.status(404).json({ error: 'setting_not_found', message: 'Setting not found' });
    res.json(setting);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch setting' });
  }
});

router.put('/:key', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const validated = validateSetting(req.params.key, req.body);

    const db = getDb();
    const updates = { ...validated, updated_by: toObjectId(req.user.id), ...updateTimestamp() };

    const setting = await db.collection('settings').findOneAndUpdate(
      { key: req.params.key },
      { $set: updates },
      { returnDocument: 'after', upsert: true }
    );

    res.json(setting);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'update_failed', message: 'Failed to update setting' });
  }
});

router.delete('/:key', authenticate, requireRole('admin'), async (req, res) => {
  try {
    validateSettingKey(req.params.key);
    const db = getDb();
    const result = await db.collection('settings').deleteOne({ key: req.params.key });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'setting_not_found', message: 'Setting not found' });
    }
    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'delete_failed', message: 'Failed to delete setting' });
  }
});

export default router;
