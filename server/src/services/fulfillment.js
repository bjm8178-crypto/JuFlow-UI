import { ObjectId } from '../db/mongodb.js';
import { validateOrder, calculateOrder, integer, text, objectIdString, digest, orderError } from '../lib/order.js';
import { canTransitionDelivery, getOrderNextStatusForAction, displayOrderStatus } from '../lib/order-state.js';
import { getNextOrderNumber } from './order-number.js';
import { appendAudit } from './audit.js';

const staff = actor => {
  if (!['admin', 'cashier'].includes(actor.role_name)) throw orderError('Staff authorization required', 403, 'forbidden');
};
const conflict = message => orderError(message, 409, 'conflict');
const id = value => new ObjectId(objectIdString(value, 'id'));
const version = doc => doc.version ?? 0;
const versionFilter = doc => doc.version === undefined ? { version: { $exists: false } } : { version: doc.version };
const preparation = order => order.preparation_status ?? (['received', 'preparing', 'ready', 'cancelled'].includes(order.status) ? order.status : 'ready');

async function cas(db, session, collection, doc, updates) {
  const result = await db.collection(collection).findOneAndUpdate(
    { _id: doc._id, ...versionFilter(doc) },
    { $set: { ...updates, updated_at: new Date() }, $inc: { version: 1 } },
    { session, returnDocument: 'after' }
  );
  if (!result) throw conflict('State changed; refresh and retry with a new event ID');
  return result;
}

export function checkReplay(existing, requestDigest) {
  if (existing.request_digest !== requestDigest) throw conflict('Idempotency key was already used with different content');
  return existing;
}

export async function createOrder({ db, transaction, body, actor }) {
  staff(actor);
  const input = validateOrder(body);
  const requestDigest = digest(input);
  const existing = await db.collection('orders').findOne({ idempotency_key: input.idempotency_key });
  if (existing) return { order: checkReplay(existing, requestDigest), duplicate: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await transaction(async (txDb, session) => {
        const replay = await txDb.collection('orders').findOne({ idempotency_key: input.idempotency_key }, { session });
        if (replay) return { order: checkReplay(replay, requestDigest), duplicate: true };
        const customer = await txDb.collection('customers').findOne({ _id: id(input.customer_id), is_active: { $ne: false } }, { session });
        if (!customer) throw orderError('Active customer not found', 404, 'customer_not_found');
        const items = [];
        for (const line of input.items) {
          if (line.product_id) {
            const product = await txDb.collection('products').findOne({ _id: id(line.product_id), is_active: { $ne: false }, is_available: { $ne: false } }, { session });
            if (!product) throw orderError('Product is unavailable', 400, 'invalid_product');
            items.push({ product_id: product._id, name: text(product.name, 'product name'), quantity: line.quantity,
              unit_price_centavos: integer(product.price_centavos, 'product price'), pricing_source: 'menu', priced_by: null });
          } else {
            items.push({ ...line, pricing_source: 'manual', priced_by: id(actor.id) });
          }
        }
        const amounts = calculateOrder(input, items);
        const seq = await getNextOrderNumber(txDb, session);
        const now = new Date();
        const order = {
          _id: new ObjectId(), order_number: `JU-${seq}`, order_seq: seq,
          customer_id: customer._id,
          customer: Object.fromEntries(['name', 'phone', 'address', 'landmark', 'lat', 'lng', 'landmark_photo'].map(key => [key, customer[key] ?? null])),
          ...amounts, fee_centavos: input.fee_centavos, payment_method: input.payment_method,
          payment_reference: input.payment_reference, payment_status: 'pending', payment_verified: false, cash_collected: false,
          preparation_status: 'received', delivery_status: 'pending', status: 'received',
          rider_id: null, rider: null, notes: input.notes, version: 0,
          idempotency_key: input.idempotency_key, request_digest: requestDigest,
          created_by: id(actor.id), created_at: now, updated_at: now
        };
        const delivery = { _id: new ObjectId(), order_id: order._id, rider_id: null, status: 'pending', version: 0,
          notes: input.notes, pickup_time: null, delivery_time: null, created_at: now, updated_at: now };
        order.delivery_id = delivery._id;
        await txDb.collection('orders').insertOne(order, { session });
        await txDb.collection('deliveries').insertOne(delivery, { session });
        await appendAudit(txDb, session, { entity_type: 'order', entity_id: order._id, action: 'created', actor, event_id: input.idempotency_key, to_status: 'received', now });
        return { order, duplicate: false };
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const winner = await db.collection('orders').findOne({ idempotency_key: input.idempotency_key });
      if (winner) return { order: checkReplay(winner, requestDigest), duplicate: true };
      // A concurrent first counter initializer may win its upsert. Retry the
      // entire aborted transaction, never only the remaining child inserts.
      if (attempt === 2) throw conflict('Concurrent order creation conflict; retry the same idempotency key');
    }
  }
}

export function eventInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw orderError('Event body must be an object');
  const event_id = text(body.event_id, 'event_id', 120);
  const expectedVersion = integer(body.version, 'version', 0, Number.MAX_SAFE_INTEGER - 1);
  return { event_id, expectedVersion };
}

async function eligibleRider(db, session, riderId) {
  const rider = await db.collection('riders').findOne({ _id: id(riderId), is_active: true, is_available: true }, { session });
  if (!rider?.user_id) throw orderError('Rider must be active, available and linked to an account', 400, 'invalid_rider');
  const user = await db.collection('users').findOne({ _id: rider.user_id, is_active: true }, { session });
  const role = user && await db.collection('roles').findOne({ _id: user.role_id }, { session });
  if (role?.name !== 'rider') throw orderError('Rider account must be active with rider role', 400, 'invalid_rider');
  return rider;
}

async function authorizeDelivery(db, session, delivery, actor) {
  if (!['admin', 'cashier', 'rider'].includes(actor.role_name)) throw orderError('Role is not authorized', 403, 'forbidden');
  if (actor.role_name !== 'rider') return;
  const rider = await db.collection('riders').findOne({ user_id: id(actor.id), is_active: true }, { session });
  if (!rider || String(delivery.rider_id) !== String(rider._id)) throw orderError('Delivery is not assigned to you', 403, 'forbidden');
}

// All fulfillment mutations and their replay receipt live in the same transaction.
// The receipt's _id has Mongo's built-in unique constraint, independent of migrations.
export async function mutateFulfillment({ db, transaction, entity, entityId, operation, body, actor, settlement }) {
  const { event_id, expectedVersion } = eventInput(body);
  const targetId = id(entityId);
  const receiptId = `${entity}:${targetId}:${event_id}`;
  const normalized = { entity, entityId: String(targetId), operation, version: expectedVersion, actor: actor.id,
    role: actor.role_name, rider_id: body.rider_id === undefined ? null : objectIdString(body.rider_id, 'rider_id'),
    reason: text(body.reason, 'reason', 500, true), reconciliation: null };
  if (operation === 'confirm') {
    const r = body.reconciliation;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw orderError('Reconciliation evidence is required');
    normalized.reconciliation = { amount_centavos: integer(r.amount_centavos, 'amount_centavos', 1, Number.MAX_SAFE_INTEGER),
      cash_tendered_centavos: r.cash_tendered_centavos === undefined ? null : integer(r.cash_tendered_centavos, 'cash_tendered_centavos', 0, Number.MAX_SAFE_INTEGER),
      payment_reference: text(r.payment_reference, 'payment_reference', 100, true), verified: r.verified === true };
  }
  const requestDigest = digest(normalized);
  const run = async (txDb, session) => {
    const target = await txDb.collection(entity === 'order' ? 'orders' : 'deliveries').findOne({ _id: targetId }, { session });
    if (!target) throw orderError('Record not found', 404, 'not_found');
    if (entity === 'order') staff(actor); else await authorizeDelivery(txDb, session, target, actor);
    if (operation === 'confirm' && actor.role_name !== 'cashier') throw orderError('Only a cashier can confirm delivery', 403, 'forbidden');
    const receipt = await txDb.collection('fulfillment_events').findOne({ _id: receiptId }, { session });
    if (receipt) { checkReplay(receipt, requestDigest); return { result: receipt.result, duplicate: true }; }
    if (version(target) !== expectedVersion) throw conflict('Stale version; refresh before submitting a new event');
    const order = entity === 'order' ? target : await txDb.collection('orders').findOne({ _id: target.order_id }, { session });
    const delivery = entity === 'delivery' ? target : await txDb.collection('deliveries').findOne({ order_id: target._id }, { session });
    if (!order || !delivery) throw conflict('Order/delivery linkage is incomplete');
    if (['completed', 'cancelled'].includes(delivery.status) || ['delivered', 'cancelled'].includes(order.status)) throw conflict('Terminal fulfillment cannot be reopened');
    const prep = preparation(order);
    const now = new Date();
    let orderUpdates = {}, deliveryUpdates = null;
    if (operation === 'assign') {
      staff(actor);
      if (prep !== 'ready' || !['pending', 'assigned'].includes(delivery.status)) throw conflict('Assignment requires a ready order and pending/assigned delivery');
      const rider = await eligibleRider(txDb, session, normalized.rider_id);
      deliveryUpdates = { rider_id: rider._id, status: 'assigned' };
      orderUpdates = { rider_id: rider._id, rider: rider.full_name, delivery_status: 'assigned', status: 'assigned' };
    } else if (operation === 'cancel') {
      staff(actor);
      if (!normalized.reason) throw orderError('Cancellation reason is required');
      if (order.payment_status === 'paid') throw conflict('Paid orders require an audited refund before cancellation');
      orderUpdates = { preparation_status: 'cancelled', delivery_status: 'cancelled', status: 'cancelled', status_reason: normalized.reason };
      deliveryUpdates = { status: 'cancelled', status_reason: normalized.reason };
    } else if (['set_preparing', 'set_ready'].includes(operation)) {
      staff(actor);
      if (delivery.status !== 'pending') throw conflict('Preparation cannot change after assignment');
      const check = getOrderNextStatusForAction(prep, operation, actor.role_name);
      if (!check.allowed) throw conflict(check.reason);
      orderUpdates = { preparation_status: check.nextStatus, delivery_status: delivery.status, status: displayOrderStatus(check.nextStatus, delivery.status) };
    } else if (['picked_up', 'on_the_way', 'arrived', 'report_delivered', 'confirm'].includes(operation)) {
      const next = operation === 'report_delivered' ? 'awaiting_cashier_confirmation' : operation === 'confirm' ? 'completed' : operation;
      const check = canTransitionDelivery(delivery.status, next, actor.role_name);
      if (!check.allowed) throw conflict(check.reason);
      if (prep !== 'ready') throw conflict('Delivery requires a ready order');
      deliveryUpdates = { status: next };
      if (next === 'picked_up') deliveryUpdates.pickup_time = now;
      orderUpdates = { preparation_status: prep, delivery_status: next, status: displayOrderStatus(prep, next) };
      if (operation === 'confirm') {
        const r = normalized.reconciliation;
        if (r.amount_centavos !== order.total_centavos) throw orderError('Reconciliation amount must equal order total');
        if (order.payment_method === 'cash' && (r.cash_tendered_centavos === null || r.cash_tendered_centavos < order.total_centavos)) throw orderError('Actual cash tender must cover the total');
        if (order.payment_method === 'gcash' && (!r.verified || !r.payment_reference || r.payment_reference !== order.payment_reference)) throw orderError('Verified matching GCash reference is required');
        const settle = settlement ?? (await import('./settlement.js')).settleOrder;
        const sale = await settle({ db: txDb, session, order, actor, eventId: event_id, reconciliation: r, now });
        const cashier_confirmation = { confirmed_at: now, confirmed_by: id(actor.id), source: 'cashier', role_name: 'cashier' };
        orderUpdates = { ...orderUpdates, payment_status: 'paid', payment_verified: true, cash_collected: order.payment_method !== 'gcash',
          completed_at: now, confirmed_at: now, confirmed_by: id(actor.id), cashier_confirmation, settlement_id: sale._id };
        deliveryUpdates = { ...deliveryUpdates, delivery_time: now, confirmed_at: now, confirmed_by: id(actor.id), cashier_confirmation };
      }
    } else {
      throw orderError('Unknown fulfillment action');
    }
    const updatedOrder = await cas(txDb, session, 'orders', order, orderUpdates);
    const updatedDelivery = deliveryUpdates ? await cas(txDb, session, 'deliveries', delivery, deliveryUpdates) : delivery;
    const result = entity === 'order' ? updatedOrder : updatedDelivery;
    await appendAudit(txDb, session, { entity_type: entity, entity_id: targetId, action: operation, actor, event_id,
      from_status: target.status, to_status: result.status, reason: normalized.reason, now });
    await txDb.collection('fulfillment_events').insertOne({ _id: receiptId, request_digest: requestDigest, result, created_at: now }, { session });
    return { result, duplicate: false };
  };
  try { return await transaction(run); }
  catch (error) {
    if (error.code !== 11000) throw error;
    // A winner may have committed the receipt while this transaction aborted.
    // Re-enter the transaction so current ownership is checked before replay.
    return transaction(run);
  }
}

export async function deliveryScope(db, actor) {
  if (['admin', 'cashier'].includes(actor.role_name)) return {};
  if (actor.role_name !== 'rider') throw orderError('Role is not authorized', 403, 'forbidden');
  const rider = await db.collection('riders').findOne({ user_id: id(actor.id), is_active: true });
  return { rider_id: rider?._id ?? { $in: [] } };
}

export function rejectLifecyclePatch(body, entity) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw orderError('Patch body must be an object');
  const forbidden = ['status', 'preparation_status', 'delivery_status', 'payment_status', 'rider', 'rider_id', 'payment_verified', 'cash_collected', 'pickup_time', 'delivery_time', 'confirmed_at', 'confirmed_by', 'cashier_confirmation', 'completed_at', 'settlement_id'];
  if (forbidden.some(key => Object.hasOwn(body, key))) throw orderError(`${entity} lifecycle fields require action endpoints`);
  if (Object.keys(body).some(key => !['notes', 'version', 'event_id'].includes(key))) throw orderError('Unsupported patch field');
  if (!Object.hasOwn(body, 'notes')) throw orderError('notes is required');
}

export async function patchNotes({ transaction, entity, entityId, body, actor }) {
  staff(actor);
  rejectLifecyclePatch(body, entity);
  const { event_id, expectedVersion } = eventInput(body);
  const notes = text(body.notes, 'notes', 500, true);
  const targetId = id(entityId), receiptId = `${entity}:${targetId}:${event_id}`;
  const requestDigest = digest({ action: 'notes', notes, version: expectedVersion, actor: actor.id });
  return transaction(async (db, session) => {
    const receipt = await db.collection('fulfillment_events').findOne({ _id: receiptId }, { session });
    if (receipt) { checkReplay(receipt, requestDigest); return receipt.result; }
    const collection = entity === 'order' ? 'orders' : 'deliveries';
    const doc = await db.collection(collection).findOne({ _id: targetId }, { session });
    if (!doc) throw orderError('Record not found', 404, 'not_found');
    if (version(doc) !== expectedVersion) throw conflict('Stale version');
    const result = await cas(db, session, collection, doc, { notes });
    await appendAudit(db, session, { entity_type: entity, entity_id: targetId, action: 'notes_updated', actor, event_id });
    await db.collection('fulfillment_events').insertOne({ _id: receiptId, request_digest: requestDigest, result, created_at: new Date() }, { session });
    return result;
  });
}
