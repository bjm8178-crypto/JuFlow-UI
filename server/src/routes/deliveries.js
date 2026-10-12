import express from 'express';
import { getDb, toObjectId } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { objectIdString, orderError } from '../lib/order.js';

const router = express.Router();
const oid = value => toObjectId(objectIdString(value, 'id'));

export async function attachOrder(db, delivery, actor) {
  const projection = actor.role_name === 'rider' ? {
    order_number: 1, customer_id: 1, customer: 1, items: 1, notes: 1, total_centavos: 1, payment_method: 1,
    cash_tendered_centavos: 1, change_centavos: 1, status: 1
  } : undefined;
  const order = await db.collection('orders').findOne({ _id: delivery.order_id }, { projection });
  const rider = actor.role_name === 'rider' || !delivery.rider_id ? null : await db.collection('riders').findOne({ _id: delivery.rider_id });
  const latest_location = delivery.rider_id ? await db.collection('rider_locations').findOne({ rider_id: delivery.rider_id }, { sort: { occurred_at: -1, received_at: -1, _id: -1 } }) : null;
  return { ...delivery, order, latest_location, ...(rider ? { rider } : {}) };
}

// Deliveries are now read-only history for the admin delivery map. Status changes go through POST /api/orders/:id/status.
const staff = requireRole('admin', 'cashier');

router.get('/', authenticate, staff, async (req, res, next) => {
  try {
    const db = getDb();
    const query = {};
    const filter = req.query.filter || 'active';
    if (filter === 'active') query.status = { $nin: ['completed', 'cancelled', 'failed'] };
    else if (filter === 'completed') query.status = { $in: ['completed', 'cancelled', 'failed'] };
    else if (filter !== 'all') throw orderError('filter must be active, completed or all');
    const deliveries = await db.collection('deliveries').find(query).sort({ created_at: -1 }).limit(100).toArray();
    res.json(await Promise.all(deliveries.map(delivery => attachOrder(db, delivery, req.user))));
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, staff, async (req, res, next) => {
  try {
    const db = getDb();
    const delivery = await db.collection('deliveries').findOne({ _id: oid(req.params.id) });
    if (!delivery) throw orderError('Delivery not found', 404, 'not_found');
    res.json(await attachOrder(db, delivery, req.user));
  } catch (error) { next(error); }
});

export default router;
