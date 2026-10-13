import { randomUUID } from 'node:crypto';
import { ObjectId } from '../db/mongodb.js';
import { objectIdString, orderError } from '../lib/order.js';
import { validateSale } from '../lib/sale.js';
import { ORDER_STATUSES, DELIVERY_STATUS_FOR, canChangeStatus } from '../lib/order-state.js';
import { appendAudit } from './audit.js';
import { notifySale } from './notifications.js';

// A delivered order becomes exactly one sale (unique index: sales.order_id).
async function recordOrderSale(db, session, order, actor, now) {
  if (await db.collection('sales').findOne({ order_id: order._id }, { session })) return null;
  const { sale: clean, digest } = validateSale({
    transaction_id: `order:${order._id}`,
    order_id: String(order._id),
    items: order.items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      price_centavos: item.unit_price_centavos ?? item.price_centavos,
      ...(item.product_id ? { product_id: String(item.product_id) } : {})
    })),
    fee_centavos: order.fee_centavos ?? 0,
    total_centavos: order.total_centavos,
    payment_method: order.payment_method,
    ...(order.payment_method === 'cash' ? { cash_tendered_centavos: order.cash_tendered_centavos } : {}),
    ...(order.payment_method === 'gcash' ? { gcash_reference: order.payment_reference } : {}),
    occurred_at: now.toISOString(),
    is_test_sale: false
  }, { now });
  const sale = {
    ...clean, order_id: order._id, digest, source: 'order', event_id: `status:${order._id}`,
    occurred_at: now, sale_time: now, received_at: now, created_at: now, updated_at: now,
    recorded_by: new ObjectId(actor.id), recorded_actor: actor.id, recorded_role: actor.role_name, verification: null
  };
  const { insertedId } = await db.collection('sales').insertOne(sale, { session });
  const saved = { ...sale, _id: insertedId };
  await notifySale(db, saved, { session });
  return saved;
}

export async function setOrderStatus({ transaction, orderId, status, actor }) {
  if (!ORDER_STATUSES.includes(status)) throw orderError('status must be preparing, on_the_way, delivered or cancelled');
  const id = new ObjectId(objectIdString(orderId, 'id'));
  return transaction(async (db, session) => {
    const order = await db.collection('orders').findOne({ _id: id }, { session });
    if (!order) throw orderError('Order not found', 404, 'not_found');
    const check = canChangeStatus(order.status, status, actor.role_name);
    if (!check.allowed) throw orderError(check.reason, 409, 'conflict');
    if (check.noop) return { order, sale: null, changed: false };

    const now = new Date();
    const stamp = {
      preparing: {},
      on_the_way: { on_the_way_at: now },
      delivered: { delivered_at: now, completed_at: now, payment_status: 'paid' },
      cancelled: { cancelled_at: now }
    }[status];
    const updated = await db.collection('orders').findOneAndUpdate(
      { _id: id, status: order.status },
      {
        $set: {
          status, delivery_status: DELIVERY_STATUS_FOR[status],
          preparation_status: status === 'cancelled' ? 'cancelled' : status === 'preparing' ? 'preparing' : 'ready',
          ...stamp, updated_at: now
        },
        $inc: { version: 1 }
      },
      { session, returnDocument: 'after' }
    );
    if (!updated) throw orderError('Order changed; refresh and try again', 409, 'conflict');

    await db.collection('deliveries').updateOne({ order_id: id }, {
      $set: {
        status: DELIVERY_STATUS_FOR[status], updated_at: now,
        ...(status === 'on_the_way' ? { pickup_time: now } : {}),
        ...(status === 'delivered' ? { delivery_time: now } : {})
      },
      $inc: { version: 1 }
    }, { session });

    const sale = status === 'delivered' ? await recordOrderSale(db, session, updated, actor, now) : null;
    await appendAudit(db, session, {
      entity_type: 'order', entity_id: id, action: `status_${status}`, actor,
      event_id: randomUUID(), from_status: order.status, to_status: status, now
    });
    return { order: updated, sale, changed: true };
  });
}
