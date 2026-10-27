import { notificationsRepo } from '../db/repositories/index.js';

export async function notifySale(db, sale, { session } = {}) {
  const refund = sale.source === 'refund';
  const units = (sale.items || []).reduce((sum, item) => sum + Math.abs(item.quantity), 0);
  const peso = '₱' + (Math.abs(sale.total_centavos) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const where = { order: 'Delivery', walk_in: 'Walk-in', device: 'Walk-in', refund: 'Return' }[sale.source] || 'Sale';

  const doc = {
    type: refund ? 'refund' : 'sale',
    title: refund ? 'Items returned' : 'Something sold',
    body: `${where} · ${units} item${units === 1 ? '' : 's'} · ${peso}`,
    sale_id: sale._id ?? null,
    order_id: sale.order_id ?? null,
    total_centavos: sale.total_centavos,
    read_by: [],
    created_at: new Date()
  };

  if (db && typeof db.collection === 'function' && typeof db.query !== 'function') {
    return await db.collection('notifications').insertOne(doc, { session });
  }

  await notificationsRepo.create(doc, db);
}
