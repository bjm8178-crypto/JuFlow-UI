import express from 'express';
import { getDb, toObjectId, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { objectIdString, orderError } from '../lib/order.js';
import { createOrder, patchNotes } from '../services/fulfillment.js';
import { setOrderStatus } from '../services/simple-flow.js';
import { saveProof, listProofs } from '../services/delivery-proof.js';
import { ordersRepo } from '../db/repositories/index.js';

const router = express.Router();
const oid = value => toObjectId(objectIdString(value, 'id'));

// The rider only needs what is required to deliver and collect.
const RIDER_FIELDS = {
  order_number: 1, customer_id: 1, customer: 1, items: 1, notes: 1, status: 1,
  total_centavos: 1, fee_centavos: 1, subtotal_centavos: 1,
  payment_method: 1, cash_tendered_centavos: 1, change_centavos: 1,
  created_at: 1, updated_at: 1, delivered_at: 1
};
const options = actor => (actor.role_name === 'rider' ? { projection: RIDER_FIELDS } : {});
const allowed = user => {
  if (!['admin', 'cashier', 'rider'].includes(user.role_name)) throw orderError('Role is not authorized', 403, 'forbidden');
};

router.get('/', authenticate, async (req, res, next) => {
  try {
    allowed(req.user);
    const filter = req.query.filter || 'active';
    const query = {};
    if (filter === 'active') query.status = { $nin: ['delivered', 'cancelled'] };
    else if (filter === 'delivered') query.status = { $in: ['delivered', 'cancelled'] };
    else if (filter !== 'all' || req.user.role_name === 'rider') throw orderError('filter must be active or delivered');
    res.json(await ordersRepo.find(query, { ...options(req.user), sort: { created_at: -1 }, limit: 200 }));
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    allowed(req.user);
    const order = await ordersRepo.findById(req.params.id, options(req.user));
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

// The one status endpoint. Body: { "status": "preparing" | "on_the_way" | "delivered" | "cancelled" }
router.post('/:id/status', authenticate, requireRole('admin', 'cashier', 'rider'), async (req, res, next) => {
  try {
    const { order } = await setOrderStatus({ transaction: withTransaction, orderId: req.params.id, status: req.body?.status, actor: req.user });
    res.json(order);
  } catch (error) { next(error); }
});

// Proof of delivery: the rider (or cashier/admin) sends a photo; the admin views it on the Orders page.
// Body: { "image": "data:image/jpeg;base64,..." }
router.post('/:id/proof', authenticate, requireRole('admin', 'cashier', 'rider'), express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    res.status(201).json(await saveProof(req.params.id, req.user, req.body));
  } catch (error) { next(error); }
});

router.get('/:id/proof', authenticate, requireRole('admin', 'cashier', 'rider'), async (req, res, next) => {
  try {
    let proofs = await listProofs(req.params.id);
    // A rider only sees the proofs they sent themselves.
    if (req.user.role_name === 'rider') proofs = proofs.filter(p => p.uploaded_role === 'rider');
    res.json(proofs);
  } catch (error) { next(error); }
});

router.patch('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    res.json(await patchNotes({ transaction: withTransaction, entity: 'order', entityId: req.params.id, body: req.body, actor: req.user }));
  } catch (error) { next(error); }
});

export default router;
