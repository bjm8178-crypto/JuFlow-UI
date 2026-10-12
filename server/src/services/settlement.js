import { validateSale } from '../lib/sale.js';
import { toObjectId } from '../db/mongodb.js';

export async function settleOrder({ db, session, order, actor, eventId, reconciliation, now = new Date() }) {
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, code: 'settlement_error' }); };
  if (!session) fail('Settlement requires a transaction', 500);
  if (actor?.role_name !== 'cashier') fail('Only a cashier may confirm settlement', 403);
  if (!eventId || typeof eventId !== 'string') fail('eventId required');
  if (reconciliation?.amount_centavos !== order.total_centavos) fail('Reconciled amount must exactly match order total');
  const reference = reconciliation.payment_reference || reconciliation.reference;
  if (order.payment_method === 'gcash' && (reconciliation.verified !== true || typeof reference !== 'string' || !reference.trim())) fail('GCash requires recorded verification and reference');
  if (order.payment_method === 'gcash' && reference.trim() !== order.payment_reference) fail('GCash reference must match order');
  if (order.payment_method === 'cash' && (!Number.isSafeInteger(reconciliation.cash_tendered_centavos) || reconciliation.cash_tendered_centavos < order.total_centavos)) fail('Cash tender must cover the exact order total');
  const { sale: clean, digest } = validateSale({
    transaction_id: `order:${order._id}`, order_id: String(order._id),
    items: order.items.map(i => ({ name: i.name, quantity: i.quantity, price_centavos: i.unit_price_centavos ?? i.price_centavos })),
    fee_centavos: order.fee_centavos ?? 0, total_centavos: order.total_centavos,
    payment_method: order.payment_method, cash_tendered_centavos: reconciliation.cash_tendered_centavos ?? order.cash_tendered_centavos,
    gcash_reference: reference, occurred_at: now.toISOString(), is_test_sale: order.is_test_sale === true
  }, { now });
  const existing = await db.collection('sales').findOne({ order_id: order._id }, { session });
  if (existing) fail('Order already settled', 409);
  const sale = { ...clean, order_id: order._id, digest, source: 'order', event_id: eventId,
    occurred_at: now, sale_time: now, received_at: now, created_at: now, updated_at: now,
    recorded_by: toObjectId(actor.id), recorded_role: 'cashier',
    verification: order.payment_method === 'gcash' ? { verified: true, reference: reference.trim(), recorded_by: actor.id, recorded_at: now, provider_verified: false } : null };
  const result = await db.collection('sales').insertOne(sale, { session });
  sale._id = result.insertedId;
  return sale;
}
