import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const riders = await db.collection('riders').find({}).sort({ full_name: 1 }).toArray();
    res.json(riders);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch riders' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const rider = await db.collection('riders').findOne({ _id: toObjectId(req.params.id) });
    if (!rider) return res.status(404).json({ error: 'rider_not_found', message: 'Rider not found' });
    res.json(rider);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch rider' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { full_name, phone, vehicle_type, plate_no, notes } = req.body;
    if (!full_name || !phone) {
      return res.status(400).json({ error: 'missing_fields', message: 'Full name and phone required' });
    }

    const db = getDb();
    const result = await db.collection('riders').insertOne({
      full_name, phone, vehicle_type: vehicle_type || null, plate_no: plate_no || null,
      is_available: true, is_active: true, notes: notes || null, ...timestamps()
    });

    const rider = await db.collection('riders').findOne({ _id: result.insertedId });
    res.status(201).json(rider);
  } catch (error) {
    res.status(500).json({ error: 'create_failed', message: 'Failed to create rider' });
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { full_name, phone, vehicle_type, plate_no, is_available, is_active, notes } = req.body;
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;
    if (vehicle_type !== undefined) updates.vehicle_type = vehicle_type;
    if (plate_no !== undefined) updates.plate_no = plate_no;
    if (is_available !== undefined) updates.is_available = is_available;
    if (is_active !== undefined) updates.is_active = is_active;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const db = getDb();
    const rider = await db.collection('riders').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { ...updates, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!rider) return res.status(404).json({ error: 'rider_not_found', message: 'Rider not found' });
    res.json(rider);
  } catch (error) {
    res.status(500).json({ error: 'update_failed', message: 'Failed to update rider' });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const rider = await db.collection('riders').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { is_active: false, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!rider) return res.status(404).json({ error: 'rider_not_found', message: 'Rider not found' });
    res.json({ message: 'Rider deactivated', rider });
  } catch (error) {
    res.status(500).json({ error: 'delete_failed', message: 'Failed to deactivate rider' });
  }
});

export default router;
