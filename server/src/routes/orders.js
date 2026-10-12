import express from 'express';
import { getDb, toObjectId, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { objectIdString, orderError } from '../lib/order.js';
import { createOrder, mutateFulfillment, patchNotes, deliveryScope } from '../services/fulfillment.js';

const router = express.Router();
const oid = value => toObjectId(objectIdString(value, 'id'));

async function orderScope(db, actor) {
  if (actor.role_name !== 'rider') {
    if (!['admin', 'cashier'].includes(actor.role_name)) throw orderError('Role is not authorized', 403, 'forbidden');
    return {};
  }
  return deliveryScope(db, actor);
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const query = await orderScope(db, req.user);
    const filter = req.query.filter || 'active';
    if (filter === 'active') query.status = { $nin: ['delivered', 'cancelled'] };
    else if (filter === 'delivered') query.status = { $in: ['delivered', 'cancelled'] };
    else if (filter !== 'all') throw orderError('filter must be active, delivered or all');
    const projection = req.user.role_name === 'rider' ? { customer: 1, order_number: 1, items: 1, notes: 1, status: 1, delivery_status: 1, rider_id: 1, delivery_id: 1, version: 1 } : undefined;
    res.json(await db.collection('orders').find(query, { projection }).sort({ created_at: -1 }).limit(200).toArray());
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const query = { _id: oid(req.params.id), ...await orderScope(db, req.user) };
    const projection = req.user.role_name === 'rider' ? { customer: 1, order_number: 1, items: 1, notes: 1, status: 1, delivery_status: 1, rider_id: 1, delivery_id: 1, version: 1 } : undefined;
    const order = await db.collection('orders').findOne(query, { projection });
    if (!order) throw orderError('Order not found', 404, 'not_found');
    res.json(order);
  } catch (error) { next(error); }
});

router.post('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const { order, duplicate } = await createOrder({ db: getDb(), transaction: withTransaction, body: req.body, actor: req.user });
    res.status(duplicate ? 200 : 201).json(order);
  } catch (error) { next(error); }
});

router.post('/:id/actions', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    if (!['set_preparing', 'set_ready', 'assign', 'cancel'].includes(req.body?.action)) throw orderError('Unknown order action');
    const { result } = await mutateFulfillment({ db: getDb(), transaction: withTransaction,
      entity: 'order', entityId: req.params.id, operation: req.body.action, body: req.body, actor: req.user });
    res.json(result);
  } catch (error) { next(error); }
});

router.patch('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    res.json(await patchNotes({ transaction: withTransaction, entity: 'order', entityId: req.params.id, body: req.body, actor: req.user }));
  } catch (error) { next(error); }
});

export default router;
