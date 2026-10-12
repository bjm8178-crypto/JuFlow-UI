import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateZone, validId, listOptions } from '../lib/customer.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { limit, skip, search } = listOptions(req.query);
    const db = getDb();
    const query = search ? { name: { $regex: search, $options: 'i' } } : {};
    const zones = await db.collection('delivery_zones').find(query).sort({ sort_order: 1 }).skip(skip).limit(limit).toArray();
    res.json(zones);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch delivery zones' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    validId(req.params.id);
    const db = getDb();
    const zone = await db.collection('delivery_zones').findOne({ _id: toObjectId(req.params.id) });
    if (!zone) return res.status(404).json({ error: 'zone_not_found', message: 'Delivery zone not found' });
    res.json(zone);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch zone' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const updates = validateZone(req.body);

    const db = getDb();
    const result = await db.collection('delivery_zones').insertOne({
      ...updates, ...timestamps()
    });

    const zone = await db.collection('delivery_zones').findOne({ _id: result.insertedId });
    res.status(201).json(zone);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'create_failed', message: 'Failed to create delivery zone' });
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    validId(req.params.id);
    const updates = validateZone(req.body, true);

    const db = getDb();
    const zone = await db.collection('delivery_zones').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { ...updates, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!zone) return res.status(404).json({ error: 'zone_not_found', message: 'Delivery zone not found' });
    res.json(zone);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'update_failed', message: 'Failed to update zone' });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    validId(req.params.id);
    const db = getDb();
    const zone = await db.collection('delivery_zones').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { is_active: false, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!zone) return res.status(404).json({ error: 'zone_not_found', message: 'Delivery zone not found' });
    res.json({ message: 'Delivery zone deactivated', zone });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
    res.status(500).json({ error: 'delete_failed', message: 'Failed to deactivate zone' });
  }
});

export default router;
