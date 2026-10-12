import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const zones = await db.collection('delivery_zones').find({}).sort({ sort_order: 1 }).toArray();
    res.json(zones);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch delivery zones' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const zone = await db.collection('delivery_zones').findOne({ _id: toObjectId(req.params.id) });
    if (!zone) return res.status(404).json({ error: 'zone_not_found', message: 'Delivery zone not found' });
    res.json(zone);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch zone' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, fee_centavos, min_order_centavos, estimated_minutes, sort_order } = req.body;
    if (!name || fee_centavos === undefined) {
      return res.status(400).json({ error: 'missing_fields', message: 'Name and fee required' });
    }

    const db = getDb();
    const result = await db.collection('delivery_zones').insertOne({
      name, fee_centavos, min_order_centavos: min_order_centavos || 0,
      estimated_minutes: estimated_minutes || 30, sort_order: sort_order || 999,
      is_active: true, ...timestamps()
    });

    const zone = await db.collection('delivery_zones').findOne({ _id: result.insertedId });
    res.status(201).json(zone);
  } catch (error) {
    res.status(500).json({ error: 'create_failed', message: 'Failed to create delivery zone' });
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, fee_centavos, min_order_centavos, estimated_minutes, sort_order, is_active } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (fee_centavos !== undefined) updates.fee_centavos = fee_centavos;
    if (min_order_centavos !== undefined) updates.min_order_centavos = min_order_centavos;
    if (estimated_minutes !== undefined) updates.estimated_minutes = estimated_minutes;
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const db = getDb();
    const zone = await db.collection('delivery_zones').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { ...updates, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!zone) return res.status(404).json({ error: 'zone_not_found', message: 'Delivery zone not found' });
    res.json(zone);
  } catch (error) {
    res.status(500).json({ error: 'update_failed', message: 'Failed to update zone' });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const zone = await db.collection('delivery_zones').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { is_active: false, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!zone) return res.status(404).json({ error: 'zone_not_found', message: 'Delivery zone not found' });
    res.json({ message: 'Delivery zone deactivated', zone });
  } catch (error) {
    res.status(500).json({ error: 'delete_failed', message: 'Failed to deactivate zone' });
  }
});

export default router;
