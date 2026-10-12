import express from 'express';
import { getDb, toObjectId, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { objectIdString, orderError } from '../lib/order.js';
import { deliveryScope, mutateFulfillment, patchNotes } from '../services/fulfillment.js';

const router = express.Router();
const oid = value => toObjectId(objectIdString(value, 'id'));

async function attachOrder(db, delivery, actor) {
  const projection = actor.role_name === 'rider' ? {
    order_number: 1, customer: 1, items: 1, notes: 1, total_centavos: 1, payment_method: 1,
    cash_tendered_centavos: 1, change_centavos: 1, status: 1
  } : undefined;
  const order = await db.collection('orders').findOne({ _id: delivery.order_id }, { projection });
  const rider = actor.role_name === 'rider' || !delivery.rider_id ? null : await db.collection('riders').findOne({ _id: delivery.rider_id });
  const latest_location = delivery.rider_id ? await db.collection('rider_locations').findOne({ rider_id: delivery.rider_id }) : null;
  return { ...delivery, order, latest_location, ...(rider ? { rider } : {}) };
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const query = await deliveryScope(db, req.user);
    const filter = req.query.filter || 'active';
    if (filter === 'active') query.status = { $nin: ['completed', 'cancelled', 'failed'] };
    else if (filter === 'completed') query.status = { $in: ['completed', 'cancelled', 'failed'] };
    else if (filter !== 'all') throw orderError('filter must be active, completed or all');
    if (req.user.role_name !== 'rider' && req.query.rider_id !== undefined) query.rider_id = oid(req.query.rider_id);
    const deliveries = await db.collection('deliveries').find(query).sort({ created_at: -1 }).limit(100).toArray();
    res.json(await Promise.all(deliveries.map(delivery => attachOrder(db, delivery, req.user))));
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const delivery = await db.collection('deliveries').findOne({ _id: oid(req.params.id), ...await deliveryScope(db, req.user) });
    if (!delivery) throw orderError('Delivery not found', 404, 'not_found');
    res.json(await attachOrder(db, delivery, req.user));
  } catch (error) { next(error); }
});

// Intake creates its delivery atomically. A second create path must not bypass it.
router.post('/', authenticate, requireRole('admin', 'cashier'), (req, res) => {
  res.status(409).json({ error: 'delivery_managed_by_order', message: 'Delivery is created by POST /api/orders' });
});

for (const [path, roles, operation] of [
  ['assign', ['admin', 'cashier'], 'assign'],
  ['confirm', ['cashier'], 'confirm'],
  ['cancel', ['admin', 'cashier'], 'cancel']
]) {
  router.post(`/:id/${path}`, authenticate, requireRole(...roles), async (req, res, next) => {
    try {
      const { result } = await mutateFulfillment({ db: getDb(), transaction: withTransaction,
        entity: 'delivery', entityId: req.params.id, operation, body: req.body, actor: req.user });
      res.json(result);
    } catch (error) { next(error); }
  });
}

router.post('/:id/events', authenticate, requireRole('admin', 'cashier', 'rider'), async (req, res, next) => {
  try {
    if (!['picked_up', 'on_the_way', 'arrived', 'report_delivered'].includes(req.body?.event)) throw orderError('Unknown delivery event');
    const { result } = await mutateFulfillment({ db: getDb(), transaction: withTransaction,
      entity: 'delivery', entityId: req.params.id, operation: req.body.event, body: req.body, actor: req.user });
    res.json(result);
  } catch (error) { next(error); }
});

router.patch('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    res.json(await patchNotes({ transaction: withTransaction, entity: 'delivery', entityId: req.params.id, body: req.body, actor: req.user }));
  } catch (error) { next(error); }
});

export default router;
