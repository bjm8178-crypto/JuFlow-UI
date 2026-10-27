import { orderError } from '../lib/order.js';
import { countersRepo } from '../db/repositories/index.js';

export async function initOrderCounter(db, session) {
  const options = session ? { session } : {};
  if (await db.collection('counters').findOne({ _id: 'order_number' }, { ...options, forUpdate: Boolean(session) })) return;
  const orders = await db.collection('orders').find({}, { ...options, projection: { order_number: 1, order_seq: 1 } }).toArray();
  let seq = 1000;
  for (const order of orders) {
    const suffix = typeof order.order_number === 'string' ? /^JU-(\d+)$/.exec(order.order_number)?.[1] : order.order_number;
    for (const candidate of [order.order_seq, suffix === undefined ? undefined : Number(suffix)]) {
      if (Number.isSafeInteger(candidate) && candidate >= 0) seq = Math.max(seq, candidate);
    }
  }
  await db.collection('counters').updateOne({ _id: 'order_number' }, { $setOnInsert: { seq } }, { ...options, upsert: true });
}

export async function getNextOrderNumber(db, session) {
  if (typeof db?.collection === 'function' && typeof db?.query !== 'function') {
    await initOrderCounter(db, session);
    const result = await db.collection('counters').findOneAndUpdate(
      { _id: 'order_number' }, { $inc: { seq: 1 } }, { session, returnDocument: 'after' }
    );
    if (!result || !Number.isSafeInteger(result.seq)) throw orderError('Order counter is invalid', 503, 'counter_unavailable');
    return result.seq;
  }
  const clientOrDb = session || db;
  const seq = await countersRepo.getNext('order_number', clientOrDb);
  if (!Number.isSafeInteger(seq)) throw orderError('Order counter is invalid', 503, 'counter_unavailable');
  return seq;
}
