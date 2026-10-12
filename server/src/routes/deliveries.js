import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

const DELIVERY_STATUSES = ['pending', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'completed', 'failed', 'cancelled'];

// GET /api/deliveries - List deliveries
// ?filter=active|completed|all  (default: active)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const filter = req.query.filter || 'active';

    let query = {};
    if (filter === 'active') {
      query = { status: { $nin: ['completed', 'failed', 'cancelled'] } };
    } else if (filter === 'completed') {
      query = { status: { $in: ['completed', 'failed', 'cancelled'] } };
    }

    const deliveries = await db.collection('deliveries')
      .find(query)
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    // Attach order info
    const withOrders = await Promise.all(deliveries.map(async (d) => {
      const order = d.order_id
        ? await db.collection('orders').findOne({ _id: d.order_id })
        : null;
      const rider = d.rider_id
        ? await db.collection('riders').findOne({ _id: d.rider_id })
        : null;
      return { ...d, order, rider };
    }));

    res.json(withOrders);
  } catch (error) {
    next(error);
  }
});

// GET /api/deliveries/:id - Get delivery by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const delivery = await db.collection('deliveries').findOne({
      _id: toObjectId(req.params.id)
    });
    if (!delivery) {
      return res.status(404).json({ error: 'not_found', message: 'Delivery not found' });
    }
    res.json(delivery);
  } catch (error) {
    next(error);
  }
});

// POST /api/deliveries - Create delivery for an order
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { order_id, rider_id, notes } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: 'validation_error', message: 'order_id is required' });
    }

    const db = getDb();
    const order = await db.collection('orders').findOne({ _id: toObjectId(order_id) });
    if (!order) {
      return res.status(404).json({ error: 'order_not_found', message: 'Order not found' });
    }

    // Check if delivery already exists for this order
    const existing = await db.collection('deliveries').findOne({ order_id: toObjectId(order_id) });
    if (existing) {
      return res.status(409).json({ error: 'delivery_exists', message: 'A delivery already exists for this order' });
    }

    const delivery = {
      order_id: toObjectId(order_id),
      rider_id: rider_id ? toObjectId(rider_id) : null,
      status: rider_id ? 'assigned' : 'pending',
      notes: notes?.trim() || null,
      pickup_time: null,
      delivery_time: null,
      ...timestamps()
    };

    const result = await db.collection('deliveries').insertOne(delivery);
    delivery._id = result.insertedId;

    // Update the order status to out_for_delivery if rider is assigned
    if (rider_id) {
      await db.collection('orders').updateOne(
        { _id: toObjectId(order_id) },
        { $set: { status: 'out_for_delivery', rider_id: toObjectId(rider_id), ...updateTimestamp() } }
      );
    }

    res.status(201).json(delivery);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/deliveries/:id - Update delivery status/rider
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { status, rider_id, notes, pickup_time, delivery_time } = req.body;
    const updates = {};

    if (status !== undefined) {
      if (!DELIVERY_STATUSES.includes(status)) {
        return res.status(400).json({
          error: 'invalid_status',
          message: `Status must be one of: ${DELIVERY_STATUSES.join(', ')}`
        });
      }
      updates.status = status;
      if (status === 'picked_up') updates.pickup_time = new Date();
      if (status === 'completed' || status === 'failed') updates.delivery_time = new Date();
    }
    if (rider_id !== undefined) updates.rider_id = rider_id ? toObjectId(rider_id) : null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;
    if (pickup_time !== undefined) updates.pickup_time = pickup_time ? new Date(pickup_time) : null;
    if (delivery_time !== undefined) updates.delivery_time = delivery_time ? new Date(delivery_time) : null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const db = getDb();
    const result = await db.collection('deliveries').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { ...updates, ...updateTimestamp() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'not_found', message: 'Delivery not found' });
    }

    // Sync order status when delivery is completed
    if (status === 'completed' && result.order_id) {
      await db.collection('orders').updateOne(
        { _id: result.order_id },
        { $set: { status: 'delivered', ...updateTimestamp() } }
      );
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
