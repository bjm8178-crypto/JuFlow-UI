import { orderError } from '../lib/order.js';

export async function initOrderCounter(db, session) {
  const options = session ? { session } : {};
  if (await db.collection('counters').findOne({ _id: 'order_number' }, { ...options, forUpdate: Boolean(session) })) return;
  // Legacy business numbers are strings, not Mongo numeric values. Initialization
  // happens inside the creation transaction; concurrent initializers retry it.
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
  const client = db?.client || (typeof db?.query === 'function' ? db : null);
  if (client) {
    const res = await client.query(`
      UPDATE counters
      SET seq = seq + 1,
          updated_at = NOW()
      WHERE id = 'order_number'
      RETURNING seq
    `);
    if (res.rows && res.rows.length > 0) {
      return Number(res.rows[0].seq);
    }
  }
  await initOrderCounter(db, session);
  if (client) {
    const res = await client.query(`
      UPDATE counters
      SET seq = seq + 1,
          updated_at = NOW()
      WHERE id = 'order_number'
      RETURNING seq
    `);
    if (res.rows && res.rows.length > 0) {
      return Number(res.rows[0].seq);
    }
  }
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: 'order_number' }, { $inc: { seq: 1 } }, { session, returnDocument: 'after' }
  );
  if (!result || !Number.isSafeInteger(result.seq)) throw orderError('Order counter is invalid', 503, 'counter_unavailable');
  return result.seq;
}
