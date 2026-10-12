import express from 'express';
import { getDb, toObjectId, timestamps } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateSale } from '../lib/sale.js';
import { reportRange } from '../lib/business-date.js';

const router = express.Router();
function filter(req, start, end) {
  const test = req.query.is_test ?? 'false';
  if (!['true', 'false', 'all'].includes(test)) throw Object.assign(new Error('is_test must be true, false or all'), { status: 400 });
  const source = req.query.source;
  if (source && !['order', 'walk_in', 'device'].includes(source)) throw Object.assign(new Error('Invalid source'), { status: 400 });
  return { sale_time: { $gte: start, $lt: end }, ...(test === 'all' ? {} : { is_test_sale: test === 'true' }), ...(source ? { source } : {}) };
}
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { start, end } = reportRange(req.query);
    const page = Number(req.query.page ?? 1), limit = Number(req.query.limit ?? 50);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ error: 'validation_error', message: 'Invalid pagination' });
    const query = filter(req, start, end), collection = getDb().collection('sales');
    const [items, total] = await Promise.all([collection.find(query).sort({ sale_time: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(), collection.countDocuments(query)]);
    res.json({ items, total, page, limit });
  } catch (error) { next(error); }
});
router.get('/export.csv', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { start, end } = reportRange(req.query);
    const rows = await getDb().collection('sales').find(filter(req, start, end)).sort({ sale_time: -1, _id: -1 }).limit(10001).toArray();
    if (rows.length > 10000) return res.status(400).json({ error: 'export_too_large', message: 'Narrow date range to at most 10000 transactions' });
    const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "' $&").replaceAll('"', '""') + '"';
    const fields = ['transaction_id', 'order_id', 'sale_time', 'received_at', 'source', 'payment_method', 'food_centavos', 'fee_centavos', 'total_centavos', 'recorded_by', 'is_test_sale'];
    res.set('Content-Disposition', 'attachment; filename="sales.csv"').type('text/csv').send(fields.join(',') + '\r\n' + rows.map(row => fields.map(k => cell(row[k] instanceof Date ? row[k].toISOString() : row[k])).join(',')).join('\r\n'));
  } catch (error) { next(error); }
});
router.get('/summary', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb(), range = reportRange(req.query);
    const match = filter(req, range.start, range.end);
    const aggregate = stages => db.collection('sales').aggregate(stages).toArray();
    const [totals, month, hourly, products, payments, days] = await Promise.all([
      aggregate([{ $match: match }, { $group: { _id: null, total_centavos: { $sum: '$total_centavos' }, food_centavos: { $sum: { $ifNull: ['$food_centavos', '$total_centavos'] } }, fee_centavos: { $sum: '$fee_centavos' }, transaction_count: { $sum: 1 }, units_sold: { $sum: { $sum: '$items.quantity' } } } }]),
      aggregate([{ $match: filter(req, range.monthStart, range.monthEnd) }, { $group: { _id: null, total: { $sum: '$total_centavos' } } }]),
      aggregate([{ $match: match }, { $group: { _id: { $hour: { date: '$sale_time', timezone: 'Asia/Manila' } }, total: { $sum: '$total_centavos' } } }, { $sort: { _id: 1 } }]),
      aggregate([{ $match: match }, { $unwind: '$items' }, { $group: { _id: '$items.name', units: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.quantity', '$items.price_centavos'] } } } }, { $sort: { units: -1, _id: 1 } }, { $limit: 5 }]),
      aggregate([{ $match: match }, { $group: { _id: '$payment_method', total_centavos: { $sum: '$total_centavos' }, transaction_count: { $sum: 1 } } }]),
      aggregate([{ $match: filter(req, range.weekStart, range.weekEnd) }, { $group: { _id: { $dateToString: { date: '$sale_time', format: '%Y-%m-%d', timezone: 'Asia/Manila' } }, total_centavos: { $sum: '$total_centavos' } } }, { $sort: { _id: 1 } }])
    ]);
    res.json({ total_centavos: 0, food_centavos: 0, fee_centavos: 0, transaction_count: 0, units_sold: 0, ...totals[0], month_to_date_centavos: month[0]?.total || 0, by_hour: hourly, top_products: products, by_payment: payments, last_seven_days: days });
  } catch (error) { next(error); }
});
router.get('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const sale = await getDb().collection('sales').findOne({ _id: toObjectId(req.params.id) });
    if (!sale) return res.status(404).json({ error: 'not_found', message: 'Sale not found' });
    res.json(sale);
  } catch (error) { next(error); }
});
export async function recordSale(req, res, next) {
  try {
    const now = new Date();
    const { sale: clean, digest } = validateSale(req.body, { now, allowBackdating: req.user.role_name === 'admin' || !!req.cashierDevice });
    if (clean.order_id) return res.status(400).json({ error: 'settlement_required', message: 'Order-linked sales must be recorded by cashier settlement' });
    const db = getDb();
    const findExisting = () => db.collection('sales').findOne({ transaction_id: clean.transaction_id });
    const respond = existing => existing.digest === digest ? res.status(200).json({ ...existing, duplicate: true }) : res.status(409).json({ error: 'transaction_conflict', message: 'Transaction ID already exists with different content' });
    const existing = await findExisting();
    if (existing) return respond(existing);
    const occurred = clean.occurred_at ? new Date(clean.occurred_at) : now;
    const sale = { ...clean, digest, recorded_by: req.cashierDevice ? null : toObjectId(req.user.id), recorded_actor: req.user.id, recorded_role: req.user.role_name, source: req.cashierDevice ? 'device' : 'walk_in', sale_time: occurred, occurred_at: occurred, received_at: now, ...timestamps() };
    try {
      const result = await db.collection('sales').insertOne(sale);
      res.status(201).json({ ...sale, _id: result.insertedId });
    } catch (error) {
      if (error.code === 11000) { const winner = await findExisting(); if (winner) return respond(winner); }
      throw error;
    }
  } catch (error) { next(error); }
}
router.post('/', authenticate, requireRole('admin', 'cashier'), recordSale);
export const cashierRouter = express.Router();
cashierRouter.post('/', (req, res, next) => { req.cashierDevice = true; next(); }, recordSale);
export default router;
