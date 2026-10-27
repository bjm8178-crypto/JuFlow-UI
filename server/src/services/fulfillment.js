import { ObjectId } from '../db/mongodb.js';
import { validateOrder, calculateOrder, integer, text, objectIdString, digest, orderError } from '../lib/order.js';
import { getNextOrderNumber } from './order-number.js';
import { appendAudit } from './audit.js';
import {
  ordersRepo,
  deliveriesRepo,
  customersRepo,
  productsRepo,
  ridersRepo,
  fulfillmentEventsRepo
} from '../db/repositories/index.js';

const staff = actor => {
  if (!['admin', 'cashier'].includes(actor.role_name)) throw orderError('Staff authorization required', 403, 'forbidden');
};
const conflict = message => orderError(message, 409, 'conflict');
const id = value => new ObjectId(objectIdString(value, 'id'));
const version = doc => doc.version ?? 0;
const versionFilter = doc => doc.version === undefined ? { version: { $exists: false } } : { version: doc.version };

async function cas(db, session, collection, doc, updates) {
  if (typeof db?.collection === 'function' && typeof db?.query !== 'function') {
    const result = await db.collection(collection).findOneAndUpdate(
      { _id: doc._id, ...versionFilter(doc) },
      { $set: { ...updates, updated_at: new Date() }, $inc: { version: 1 } },
      { session, returnDocument: 'after' }
    );
    if (!result) throw conflict('State changed; refresh and retry with a new event ID');
    return result;
  }
  const result = collection === 'orders'
    ? await ordersRepo.updateNotes(doc._id, doc.version ?? 0, updates.notes, db)
    : await deliveriesRepo.updateNotes(doc._id, doc.version ?? 0, updates.notes, db);
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
  const existing = await ordersRepo.findByIdempotencyKey(input.idempotency_key, db);
  if (existing) return { order: checkReplay(existing, requestDigest), duplicate: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await transaction(async (txDb, session) => {
        const replay = await ordersRepo.findByIdempotencyKey(input.idempotency_key, txDb);
        if (replay) return { order: checkReplay(replay, requestDigest), duplicate: true };
        const customer = await customersRepo.findById(input.customer_id, txDb);
        if (!customer || customer.is_active === false) throw orderError('Active customer not found', 404, 'customer_not_found');
        const items = [];
        for (const line of input.items) {
          if (line.product_id) {
            const product = await productsRepo.findById(line.product_id, txDb);
            if (!product || product.is_active === false || product.is_available === false) throw orderError('Product is unavailable', 400, 'invalid_product');
            items.push({ product_id: product._id, name: text(product.name, 'product name'), quantity: line.quantity,
              unit_price_centavos: integer(product.price_centavos, 'product price'), pricing_source: 'menu', priced_by: null });
          } else {
            items.push({ ...line, pricing_source: 'manual', priced_by: id(actor.id) });
          }
        }
        const amounts = calculateOrder(input, items);
        const seq = await getNextOrderNumber(txDb, session);
        const now = new Date();
        const riders = await ridersRepo.find({ is_active: true }, { sort: { created_at: 1, _id: 1 }, limit: 10 }, txDb);
        const rider = riders.find(r => r.user_id != null) || null;
        const order = {
          _id: new ObjectId(), order_number: `JU-${seq}`, order_seq: seq,
          customer_id: customer._id,
          customer: Object.fromEntries(['name', 'phone', 'address', 'landmark', 'lat', 'lng', 'landmark_photo'].map(key => [key, customer[key] ?? null])),
          ...amounts, fee_centavos: input.fee_centavos, payment_method: input.payment_method,
          payment_reference: input.payment_reference, payment_status: 'pending', payment_verified: false, cash_collected: false,
          preparation_status: 'preparing', delivery_status: 'pending', status: 'preparing',
          rider_id: rider?._id ?? null, rider: rider?.full_name ?? null, notes: input.notes, version: 0,
          idempotency_key: input.idempotency_key, request_digest: requestDigest,
          created_by: id(actor.id), created_at: now, updated_at: now
        };
        const delivery = { _id: new ObjectId(), order_id: order._id, rider_id: rider?._id ?? null, status: 'pending', assigned_at: rider ? now : null, version: 0,
          notes: input.notes, pickup_time: null, delivery_time: null, created_at: now, updated_at: now };
        order.delivery_id = delivery._id;
        const savedOrder = await ordersRepo.create(order, txDb, { session });
        await deliveriesRepo.create(delivery, txDb, { session });
        await appendAudit(txDb, session, { entity_type: 'order', entity_id: order._id, action: 'created', actor, event_id: input.idempotency_key, to_status: 'preparing', now });
        return { order: savedOrder, duplicate: false };
      });
    } catch (error) {
      if (error.code !== 11000 && error.code !== '23505') throw error;
      const winner = await ordersRepo.findByIdempotencyKey(input.idempotency_key, db);
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
    const receipt = await fulfillmentEventsRepo.findById(receiptId, db);
    if (receipt) { checkReplay(receipt, requestDigest); return receipt.result; }
    const doc = entity === 'order'
      ? await ordersRepo.findById(targetId, {}, db)
      : await deliveriesRepo.findById(targetId, db);
    if (!doc) throw orderError('Record not found', 404, 'not_found');
    if (version(doc) !== expectedVersion) throw conflict('Stale version');
    const result = await cas(db, session, entity === 'order' ? 'orders' : 'deliveries', doc, { notes });
    await appendAudit(db, session, { entity_type: entity, entity_id: targetId, action: 'notes_updated', actor, event_id });
    await fulfillmentEventsRepo.create({ _id: receiptId, id: receiptId, request_digest: requestDigest, result, created_at: new Date() }, db, { session });
    return result;
  });
}
