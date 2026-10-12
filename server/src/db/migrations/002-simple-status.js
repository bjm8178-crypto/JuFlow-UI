import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';

const ORDER_MAP = {
  received: 'preparing', preparing: 'preparing', ready: 'preparing', assigned: 'preparing',
  picked_up: 'on_the_way', on_the_way: 'on_the_way', arrived: 'on_the_way', awaiting_cashier_confirmation: 'on_the_way',
  delivered: 'delivered', cancelled: 'cancelled'
};
const DELIVERY_MAP = { preparing: 'pending', on_the_way: 'on_the_way', delivered: 'completed', cancelled: 'cancelled' };

export async function migrate(database, { apply = false } = {}) {
  const report = { migration: '002-simple-status', mode: apply ? 'apply' : 'dry-run', orders: 0, unknown: [] };
  for (const order of await database.collection('orders').find({}).toArray()) {
    const status = ORDER_MAP[order.status];
    if (!status) { report.unknown.push(String(order._id)); continue; }
    if (status === order.status) continue;
    report.orders++;
    if (apply) {
      await database.collection('orders').updateOne({ _id: order._id }, { $set: { status, delivery_status: DELIVERY_MAP[status], preparation_status: status === 'preparing' ? 'preparing' : status === 'cancelled' ? 'cancelled' : 'ready' } });
      await database.collection('deliveries').updateOne({ order_id: order._id }, { $set: { status: DELIVERY_MAP[status] } });
    }
  }
  return report;
}

async function main() {
  const name = process.env.DB_NAME;
  if (!name || !process.env.MONGODB_URI) throw new Error('Explicit DB_NAME and MONGODB_URI are required');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.MIGRATION_CONFIRM_DATABASE !== name) throw new Error('Set MIGRATION_CONFIRM_DATABASE to the exact, backed-up target database');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try { await client.connect(); console.log(JSON.stringify(await migrate(client.db(name), { apply }), null, 2)); }
  finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
