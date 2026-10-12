import { MongoClient, ObjectId } from 'mongodb';
import { pathToFileURL } from 'node:url';
import { createIndexes } from '../mongodb.js';

// This command never runs from ordinary application startup.
export async function inventory(database) {
  const issues = [];
  const emails = new Map();
  for (const user of await database.collection('users').find({}).toArray()) {
    if (typeof user.email !== 'string' || !user.email.trim()) continue;
    const email = user.email.trim().toLowerCase();
    if (emails.has(email)) issues.push(`Duplicate normalized email for users ${emails.get(email)} and ${user._id}`);
    emails.set(email, String(user._id));
  }
  const categories = new Set((await database.collection('categories').find({}).toArray()).map(c => String(c._id)));
  for (const product of await database.collection('products').find({}).toArray()) {
    if (product.category_id != null && !categories.has(String(product.category_id))) {
      issues.push(`Orphan category on product ${product._id}`);
    }
  }
  const links = new Set();
  for (const rider of await database.collection('riders').find({ user_id: { $ne: null } }).toArray()) {
    const link = String(rider.user_id);
    if (!/^[a-f\d]{24}$/i.test(link) || links.has(link)) issues.push(`Invalid or duplicate rider user link on ${rider._id}`);
    links.add(link);
  }
  return issues;
}

export function sequenceOf(order) {
  const value = order.order_seq ?? order.order_number;
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const match = typeof value === 'string' && /^(?:JU-)?(\d+)$/.exec(value);
  const number = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(number) ? number : 0;
}

export async function migrate(database, { apply = false } = {}) {
  const issues = await inventory(database);
  if (issues.length) throw new Error(`Migration requires manual resolution:\n${issues.join('\n')}`);
  const report = { migration: '001-integrity', mode: apply ? 'apply' : 'dry-run', users: 0, products: 0, riders: 0, orders: 0 };
  for (const user of await database.collection('users').find({}).toArray()) {
    report.users++;
    if (apply) await database.collection('users').updateOne({ _id: user._id },
      typeof user.email === 'string' && user.email.trim()
        ? { $set: { email: user.email.trim().toLowerCase() } }
        : { $unset: { email: '' } });
  }
  for (const product of await database.collection('products').find({ category_id: { $type: 'string' } }).toArray()) {
    report.products++;
    if (apply) await database.collection('products').updateOne({ _id: product._id }, { $set: { category_id: new ObjectId(product.category_id) } });
  }
  for (const rider of await database.collection('riders').find({ user_id: { $type: 'string' } }).toArray()) {
    report.riders++;
    if (apply) await database.collection('riders').updateOne({ _id: rider._id }, { $set: { user_id: new ObjectId(rider.user_id) } });
  }
  let sequence = 1000;
  for (const order of await database.collection('orders').find({}).toArray()) {
    sequence = Math.max(sequence, sequenceOf(order));
    report.orders++;
    // Historical completion/payment requires review, never inferred from a legacy label.
    if (apply && order.version == null) await database.collection('orders').updateOne({ _id: order._id }, { $set: { version: 0 } });
  }
  report.order_sequence = sequence;
  if (apply) {
    await database.collection('counters').updateOne({ _id: 'order_number' }, { $max: { seq: sequence } }, { upsert: true });
    // Establish and verify replacement protection before retiring old indexes.
    await createIndexes(database);
    for (const [collection, legacy] of [['users', 'email_1'], ['sales', 'transaction_id_1']]) {
      const indexes = await database.collection(collection).listIndexes().toArray();
      if (indexes.some(index => index.name === legacy)) await database.collection(collection).dropIndex(legacy);
    }
    await database.collection('schema_migrations').updateOne({ _id: report.migration }, { $set: { applied_at: new Date(), report } }, { upsert: true });
  }
  return report;
}

async function main() {
  const name = process.env.DB_NAME;
  if (!name || !process.env.MONGODB_URI) throw new Error('Explicit DB_NAME and MONGODB_URI are required');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.MIGRATION_CONFIRM_DATABASE !== name) throw new Error('Set MIGRATION_CONFIRM_DATABASE to the exact backed-up target database');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    console.log(JSON.stringify(await migrate(client.db(name), { apply }), null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
