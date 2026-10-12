import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/customers - List customers (optionally search by name/phone/messenger)
router.get('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const db = getDb();
    const { search } = req.query;

    let query = { is_active: { $ne: false } };
    if (search) {
      const re = { $regex: search, $options: 'i' };
      query = { ...query, $or: [{ name: re }, { phone: re }, { messenger: re }] };
    }

    const customers = await db.collection('customers')
      .find(query)
      .sort({ name: 1 })
      .toArray();

    res.json(customers);
  } catch (error) {
    next(error);
  }
});

// GET /api/customers/:id - Get customer by ID
router.get('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const db = getDb();
    const customer = await db.collection('customers').findOne({
      _id: toObjectId(req.params.id)
    });
    if (!customer) {
      return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
});

// GET /api/customers/:id/orders - Get orders for a customer
router.get('/:id/orders', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const db = getDb();
    const customerId = toObjectId(req.params.id);
    const orders = await db.collection('orders')
      .find({ customer_id: customerId })
      .sort({ created_at: -1 })
      .toArray();
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// POST /api/customers - Create customer
router.post('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const {
      name,
      phone,
      messenger,
      address,
      landmark,
      landmark_photo,
      lat,
      lng
    } = req.body;

    if (!name || !phone || !address) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Name, phone, and address are required'
      });
    }

    if (lat !== undefined && (typeof lat !== 'number' || Math.abs(lat) > 90)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid latitude' });
    }
    if (lng !== undefined && (typeof lng !== 'number' || Math.abs(lng) > 180)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid longitude' });
    }

    const db = getDb();
    const result = await db.collection('customers').insertOne({
      name: name.trim(),
      phone: phone.trim(),
      messenger: messenger?.trim() || null,
      address: address.trim(),
      landmark: landmark?.trim() || null,
      landmark_photo: landmark_photo || null,
      lat: lat ?? null,
      lng: lng ?? null,
      is_active: true,
      ...timestamps()
    });

    const customer = await db.collection('customers').findOne({ _id: result.insertedId });
    res.status(201).json(customer);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/customers/:id - Update customer
router.patch('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const { name, phone, messenger, address, landmark, landmark_photo, lat, lng, is_active } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (messenger !== undefined) updates.messenger = messenger?.trim() || null;
    if (address !== undefined) updates.address = address.trim();
    if (landmark !== undefined) updates.landmark = landmark?.trim() || null;
    if (landmark_photo !== undefined) updates.landmark_photo = landmark_photo;
    if (lat !== undefined) updates.lat = lat;
    if (lng !== undefined) updates.lng = lng;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const db = getDb();
    const result = await db.collection('customers').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { ...updates, ...updateTimestamp() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
