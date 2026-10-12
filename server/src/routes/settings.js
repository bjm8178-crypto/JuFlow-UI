import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const { group } = req.query;
    const query = group ? { group_name: group } : {};
    const settings = await db.collection('settings').find(query).sort({ key: 1 }).toArray();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch settings' });
  }
});

router.get('/:key', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const setting = await db.collection('settings').findOne({ key: req.params.key });
    if (!setting) return res.status(404).json({ error: 'setting_not_found', message: 'Setting not found' });
    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch setting' });
  }
});

router.put('/:key', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { value, description, group_name } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'missing_value', message: 'Value is required' });
    }

    const db = getDb();
    const updates = { value, updated_by: toObjectId(req.user.id), ...updateTimestamp() };
    if (description !== undefined) updates.description = description;
    if (group_name !== undefined) updates.group_name = group_name;

    const setting = await db.collection('settings').findOneAndUpdate(
      { key: req.params.key },
      { $set: updates },
      { returnDocument: 'after', upsert: true }
    );

    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: 'update_failed', message: 'Failed to update setting' });
  }
});

router.delete('/:key', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const result = await db.collection('settings').deleteOne({ key: req.params.key });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'setting_not_found', message: 'Setting not found' });
    }
    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'delete_failed', message: 'Failed to delete setting' });
  }
});

export default router;
