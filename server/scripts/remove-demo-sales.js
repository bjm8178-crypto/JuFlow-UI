// One-off cleanup: list, then remove, demo/test sales from the database named in your .env.
//
//   node scripts/remove-demo-sales.js                     lists matches only (nothing is changed)
//   node scripts/remove-demo-sales.js --delete <id> ...   deletes only the sale ids you name
//
// A sale counts as demo/test when is_test_sale is true or its transaction_id starts with "demo-".
// Sales linked to a real order (order_id set) are never deleted by this script.
import 'dotenv/config';
import { connect, close, toObjectId } from '../src/db/mongodb.js';

const args = process.argv.slice(2);
const del = args.includes('--delete');
const ids = args.filter(a => !a.startsWith('--'));

const db = await connect();
const sales = db.collection('sales');
const demo = { $or: [{ is_test_sale: true }, { transaction_id: /^demo-/ }] };
console.log(`Database: ${db.databaseName}\n`);

try {
  const rows = await sales.find(demo).sort({ sale_time: -1 }).toArray();
  if (!rows.length) console.log('No demo/test sales found.');
  rows.forEach(r => console.log(
    `${r._id}  ${new Date(r.sale_time).toISOString()}  PHP ${((r.total_centavos || 0) / 100).toFixed(2)}  ` +
    `${r.source || '-'}  ${r.transaction_id || '-'}${r.order_id ? '  [linked to an order: will be skipped]' : ''}${r.voided_at ? '  [voided]' : ''}`));

  if (!del) {
    if (rows.length) console.log('\nNothing was changed. To delete specific ones: node scripts/remove-demo-sales.js --delete <id> <id> ...');
  } else {
    if (!ids.length) throw new Error('Name the sale ids to delete after --delete.');
    let removed = 0;
    for (const id of ids) {
      const result = await sales.deleteOne({ $and: [{ _id: toObjectId(id) }, demo, { order_id: null }] });
      console.log(`${id}: ${result.deletedCount ? 'deleted' : 'not deleted (not a demo/test sale, or linked to an order)'}`);
      removed += result.deletedCount;
    }
    console.log(`\nDeleted ${removed} sale(s).`);
  }
} finally {
  await close();
}
