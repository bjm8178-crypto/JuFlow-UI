import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Valid order statuses
const ORDER_STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];

function generateOrderNumber(count) {
  return 'JU-' + String(count + 1001);
}

// GET /api/orders - List orders
// ?filter=active|delivered|all  (default: active)
router.get('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const db = getDb();
    const filter = req.query.filter || 'active';

    let query = {};
    if (filter === 'active') {
      query = { status: { $nin: ['delivered', 'cancelled'] } };
    } else if (filter === 'delivered') {
      query = { status: { $in: ['delivered', 'cancelled'] } };
    }

    const orders = await db.collection('orders')
      .find(query)
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();

    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// GET /api/orders/:id - Get order by ID
router.get('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const db = getDb();
    const order = await db.collection('orders').findOne({
      _id: toObjectId(req.params.id)
    });
    if (!order) {
      return res.status(404).json({ error: 'not_found', message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// POST /api/orders - Create order
router.post('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const {
      customer_id,
      items,           // [{ name, quantity, price_centavos }]
      fee_centavos,    // delivery fee
      total_centavos,
      payment_method,  // 'cash' | 'exact' | 'gcash'
      cash_tendered_centavos,
      notes,
      // Customer snapshot (denormalized for order history)
      customer_snapshot
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'validation_error', message: 'At least one item is required' });
    }
    if (!payment_method) {
      return res.status(400).json({ error: 'validation_error', message: 'Payment method is required' });
    }
    if (total_centavos === undefined || total_centavos <= 0) {
      return res.status(400).json({ error: 'validation_error', message: 'Valid order total is required' });
    }

    const db = getDb();

    // Resolve customer
    let customer = null;
    if (customer_id) {
      customer = await db.collection('customers').findOne({ _id: toObjectId(customer_id) });
      if (!customer) {
        return res.status(404).json({ error: 'customer_not_found', message: 'Customer not found' });
      }
    }

    // Build items with validation
    const validatedItems = items.map(item => {
      if (!item.name || !item.quantity || item.price_centavos === undefined) {
        throw Object.assign(new Error('Each item must have name, quantity, and price'), { status: 400 });
      }
      return {
        name: item.name.trim(),
        quantity: parseInt(item.quantity),
        price_centavos: parseInt(item.price_centavos)
      };
    });

    // Generate order number
    const orderCount = await db.collection('orders').countDocuments();
    const orderNumber = generateOrderNumber(orderCount);

    const order = {
      order_number: orderNumber,
      customer_id: customer_id ? toObjectId(customer_id) : null,
      // Snapshot of customer at time of order (so history stays accurate)
      customer: customer_snapshot || (customer ? {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        landmark: customer.landmark,
        lat: customer.lat,
        lng: customer.lng
      } : null),
      items: validatedItems,
      fee_centavos: parseInt(fee_centavos || 0),
      total_centavos: parseInt(total_centavos),
      payment_method,
      cash_tendered_centavos: payment_method === 'cash' ? parseInt(cash_tendered_centavos || 0) : null,
      notes: notes?.trim() || null,
      status: 'received',
      rider: null,
      rider_id: null,
      payment_verified: false,
      cash_collected: false,
      created_by: toObjectId(req.user.id),
      ...timestamps()
    };

    const result = await db.collection('orders').insertOne(order);
    order._id = result.insertedId;

    res.status(201).json(order);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: 'validation_error', message: error.message });
    }
    next(error);
  }
});

// PATCH /api/orders/:id - Update order (status, rider, payment flags)
router.patch('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const { status, rider, rider_id, payment_verified, cash_collected, notes } = req.body;
    const updates = {};

    if (status !== undefined) {
      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({
          error: 'invalid_status',
          message: `Status must be one of: ${ORDER_STATUSES.join(', ')}`
        });
      }
      updates.status = status;
    }
    if (rider !== undefined) updates.rider = rider;
    if (rider_id !== undefined) updates.rider_id = rider_id ? toObjectId(rider_id) : null;
    if (payment_verified !== undefined) updates.payment_verified = payment_verified;
    if (cash_collected !== undefined) updates.cash_collected = cash_collected;
    if (notes !== undefined) updates.notes = notes?.trim() || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const db = getDb();
    const result = await db.collection('orders').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { ...updates, ...updateTimestamp() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'not_found', message: 'Order not found' });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
