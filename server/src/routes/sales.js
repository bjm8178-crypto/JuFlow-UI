import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateSale } from '../lib/sale.js';
import { businessDate, reportRange } from '../lib/business-date.js';
import { integer, objectIdString, orderError, text } from '../lib/order.js';
import { notifySale } from '../services/notifications.js';

const router = express.Router();
function filter(req, start, end) {
  const test = req.query.is_test ?? 'false';
  if (!['true', 'false', 'all'].includes(test)) throw Object.assign(new Error('is_test must be true, false or all'), { status: 400 });
  const source = req.query.source;
  if (source && !['order', 'walk_in', 'device', 'refund'].includes(source)) throw Object.assign(new Error('Invalid source'), { status: 400 });
  return { sale_time: { $gte: start, $lt: end }, voided_at: null, ...(test === 'all' ? {} : { is_test_sale: test === 'true' }), ...(source ? { source } : {}) };
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
      aggregate([{ $match: match }, { $group: { _id: null, total_centavos: { $sum: '$total_centavos' }, food_centavos: { $sum: { $ifNull: ['$food_centavos', '$total_centavos'] } }, fee_centavos: { $sum: '$fee_centavos' }, transaction_count: { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } }, units_sold: { $sum: { $sum: '$items.quantity' } } } }]),
      aggregate([{ $match: filter(req, range.monthStart, range.monthEnd) }, { $group: { _id: null, total: { $sum: '$total_centavos' } } }]),
      aggregate([{ $match: match }, { $group: { _id: { $hour: { date: '$sale_time', timezone: 'Asia/Manila' } }, total: { $sum: '$total_centavos' } } }, { $sort: { _id: 1 } }]),
      aggregate([{ $match: match }, { $sort: { sale_time: 1 } }, { $unwind: '$items' }, { $group: { _id: { $ifNull: [{ $toString: '$items.product_id' }, '$items.name'] }, name: { $last: '$items.name' }, units: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.quantity', '$items.price_centavos'] } } } }, { $project: { _id: '$name', units: 1, revenue: 1 } }, { $sort: { units: -1, _id: 1 } }, { $match: { units: { $gt: 0 } } }, { $limit: 5 }]),
      aggregate([{ $match: match }, { $group: { _id: '$payment_method', total_centavos: { $sum: '$total_centavos' }, transaction_count: { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } } } }]),
      aggregate([{ $match: filter(req, range.weekStart, range.weekEnd) }, { $group: { _id: { $dateToString: { date: '$sale_time', format: '%Y-%m-%d', timezone: 'Asia/Manila' } }, total_centavos: { $sum: '$total_centavos' } } }, { $sort: { _id: 1 } }])
    ]);
    res.json({ total_centavos: 0, food_centavos: 0, fee_centavos: 0, transaction_count: 0, units_sold: 0, ...totals[0], month_to_date_centavos: month[0]?.total || 0, by_hour: hourly, top_products: products, by_payment: payments, last_seven_days: days });
  } catch (error) { next(error); }
});
export function createTodaySalesHandler({ database = getDb, clock = () => new Date() } = {}) {
  return async (req, res, next) => {
    try {
      const now = clock(), { start, end } = reportRange({}, now);
      const match = filter(req, start, end);
      const [summary] = await database().collection('sales').aggregate([
        { $match: match },
        { $facet: {
          totals: [{ $group: { _id: null, total_centavos: { $sum: '$total_centavos' }, food_centavos: { $sum: { $ifNull: ['$food_centavos', '$total_centavos'] } }, fee_centavos: { $sum: '$fee_centavos' }, transaction_count: { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } }, units_sold: { $sum: { $sum: '$items.quantity' } } } }, { $project: { _id: 0 } }],
          by_payment: [{ $group: { _id: '$payment_method', total_centavos: { $sum: '$total_centavos' }, transaction_count: { $sum: { $cond: [{ $eq: ['$source', 'refund'] }, 0, 1] } } } }, { $sort: { _id: 1 } }]
        } }
      ]).toArray();
      res.json({ date: businessDate(now), timezone: 'Asia/Manila', total_centavos: 0, food_centavos: 0, fee_centavos: 0, transaction_count: 0, units_sold: 0, ...summary?.totals[0], by_payment: summary?.by_payment ?? [] });
    } catch (error) { next(error); }
  };
}
router.get('/today', authenticate, requireRole('admin', 'cashier'), createTodaySalesHandler());

export function createCountsSalesHandler({ database = getDb, clock = () => new Date() } = {}) {
  return async (req, res, next) => {
    try {
      const now = clock(), { start, end } = reportRange({}, now);
      const rows = await database().collection('sales').aggregate([
        { $match: { sale_time: { $gte: start, $lt: end }, voided_at: null, is_test_sale: false } },
        { $unwind: '$items' },
        { $match: { 'items.product_id': { $ne: null } } },
        { $group: { _id: { $toString: '$items.product_id' }, quantity: { $sum: '$items.quantity' } } }
      ]).toArray();
      res.json({ date: businessDate(now), counts: Object.fromEntries(rows.map(row => [row._id, row.quantity])) });
    } catch (error) { next(error); }
  };
}
router.get('/counts', authenticate, requireRole('admin', 'cashier'), createCountsSalesHandler());

export function createSinceSalesHandler({ database = getDb, clock = () => new Date() } = {}) {
  return async (req, res, next) => {
    try {
      const now = clock();
      if (req.query.after === undefined) return res.json({ cursor: now.toISOString(), items: [] });
      const after = typeof req.query.after === 'string' ? new Date(req.query.after) : new Date(NaN);
      if (!Number.isFinite(after.getTime())) throw orderError('after must be a valid date');
      const from = new Date(Math.max(now.getTime() - 86400000, after.getTime() - 10000));
      const items = await database().collection('sales').find(
        { received_at: { $gt: from }, voided_at: null, is_test_sale: false },
        { projection: { items: 1, total_centavos: 1, payment_method: 1, received_at: 1 } }
      ).sort({ received_at: 1, _id: 1 }).limit(50).toArray();
      res.json({ cursor: items.length === 50 ? new Date(items.at(-1).received_at).toISOString() : now.toISOString(), items });
    } catch (error) { next(error); }
  };
}
router.get('/since', authenticate, requireRole('admin'), createSinceSalesHandler());

const SAFE_ID = /^[A-Za-z0-9_-]{8,80}$/;
function tapInput(body, key) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw orderError('JSON object required');
  const productId = toObjectId(objectIdString(body.product_id, 'product_id'));
  if (typeof body[key] !== 'string' || !SAFE_ID.test(body[key])) throw orderError(`Invalid ${key}`);
  return { productId, keyId: body[key] };
}

export function createTapSaleHandler({ database = getDb, clock = () => new Date() } = {}) {
  return async (req, res, next) => {
    try {
      const { productId, keyId } = tapInput(req.body, 'tap_id');
      const method = req.body.payment_method ?? 'cash';
      if (!['cash', 'gcash'].includes(method)) throw orderError('payment_method must be cash or gcash');
      const now = clock(), db = database(), transactionId = `tap:${keyId}`;
      const findExisting = () => db.collection('sales').findOne({ transaction_id: transactionId });
      const respond = existing => {
        if (existing.tap !== true || existing.source !== 'walk_in' || String(existing.recorded_by) !== String(req.user.id) ||
            existing.items?.length !== 1 || String(existing.items[0].product_id) !== String(productId) || existing.payment_method !== method) {
          throw orderError('Tap ID already exists with different content or owner', 409, 'transaction_conflict');
        }
        return res.status(200).json({ ...existing, duplicate: true });
      };
      const existing = await findExisting();
      if (existing) return respond(existing);
      const menu = await db.collection('daily_menu').findOne({ date: businessDate(now) });
      if (!menu?.product_ids?.some(id => String(id) === String(productId))) throw orderError('Product is not on the current menu', 400, 'invalid_product');
      const product = await db.collection('products').findOne({ _id: productId, is_active: { $ne: false }, is_available: { $ne: false } });
      if (!product) throw orderError('Product is unavailable', 400, 'invalid_product');
      const price = integer(product.price_centavos, 'product price', 1, 10000000);
      const sale = { transaction_id: transactionId, items: [{ product_id: productId, name: text(product.name, 'product name'), quantity: 1, price_centavos: price }],
        food_centavos: price, fee_centavos: 0, total_centavos: price, payment_method: method,
        cash_tendered_centavos: method === 'cash' ? price : null, gcash_reference: null, is_test_sale: false,
        source: 'walk_in', tap: true, recorded_by: toObjectId(req.user.id), recorded_actor: req.user.id, recorded_role: req.user.role_name,
        sale_time: now, occurred_at: now, received_at: now, voided_at: null, created_at: now, updated_at: now };
      try {
        const result = await db.collection('sales').insertOne(sale);
        res.status(201).json({ ...sale, _id: result.insertedId });
      } catch (error) {
        if (error.code === 11000) { const winner = await findExisting(); if (winner) return respond(winner); }
        throw error;
      }
    } catch (error) { next(error); }
  };
}
router.post('/tap', authenticate, requireRole('admin', 'cashier'), createTapSaleHandler());

export function createUntapSaleHandler({ database = getDb, transaction = withTransaction, clock = () => new Date() } = {}) {
  return async (req, res, next) => {
    try {
      const { productId, keyId } = tapInput(req.body, 'undo_id');
      const now = clock(), { start, end } = reportRange({}, now);
      const replay = existing => {
        if (String(existing.voided_by) !== String(req.user.id) || existing.items?.length !== 1 ||
            String(existing.items[0].product_id) !== String(productId) || new Date(existing.sale_time) < start || new Date(existing.sale_time) >= end) {
          throw orderError('Undo ID already exists with different content, owner or business day', 409, 'undo_conflict');
        }
        return { sale: existing, duplicate: true };
      };
      let result;
      try {
        result = await transaction(async (db, session) => {
          const existing = await db.collection('sales').findOne({ void_id: keyId }, { session });
          if (existing) return replay(existing);
          const sale = await db.collection('sales').findOneAndUpdate(
            { sale_time: { $gte: start, $lt: end }, voided_at: null, is_test_sale: false, tap: true, source: 'walk_in',
              'items.product_id': { $in: [productId, String(productId)] } },
            { $set: { voided_at: now, voided_by: toObjectId(req.user.id), void_id: keyId, ...updateTimestamp(), updated_at: now } },
            { session, sort: { sale_time: -1, _id: -1 }, returnDocument: 'after' }
          );
          if (!sale) throw orderError('No tap sale to undo for this product today', 409, 'nothing_to_undo');
          return { sale, duplicate: false };
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        // The failed transaction rolls back any second sale selected by this undo.
        const winner = await database().collection('sales').findOne({ void_id: keyId });
        if (!winner) throw error;
        result = replay(winner);
      }
      res.json({ ...result.sale, duplicate: result.duplicate });
    } catch (error) { next(error); }
  };
}
router.post('/untap', authenticate, requireRole('admin', 'cashier'), createUntapSaleHandler());

// Today's sales for the cashier "Today" tab (includes refund rows as negatives).
router.get('/today/list', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const { start, end } = reportRange({}, new Date());
    const rows = await getDb().collection('sales')
      .find({ sale_time: { $gte: start, $lt: end }, voided_at: null, is_test_sale: false })
      .sort({ sale_time: -1, _id: -1 }).limit(200).toArray();
    res.json(rows.map(({ digest, ...sale }) => sale));
  } catch (error) { next(error); }
});

export function validateRefund(body) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'validation_error' }); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSON object required');
  const event_id = typeof body.event_id === 'string' && body.event_id.trim() && body.event_id.length <= 100 ? body.event_id.trim() : fail('event_id is required');
  const reason = typeof body.reason === 'string' && body.reason.trim() && body.reason.length <= 200 ? body.reason.trim() : fail('reason is required');
  if (!Array.isArray(body.items) || body.items.length > 100) fail('items must be a list');
  const items = body.items.map(i => {
    if (!i || !Number.isInteger(i.index) || i.index < 0) fail('Each item needs an index');
    if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 999) fail('Invalid quantity');
    return { index: i.index, quantity: i.quantity };
  });
  if (new Set(items.map(i => i.index)).size !== items.length) fail('Duplicate item index');
  if (!items.length && body.refund_fee !== true) fail('Nothing to return');
  return { event_id, reason, items, refund_fee: body.refund_fee === true };
}

// Return food and/or the delivery fee. Stored as a NEGATIVE sale row so every report nets out by itself.
router.post('/:id/refund', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const saleId = toObjectId(req.params.id);
    if (!saleId) return res.status(400).json({ error: 'invalid_id', message: 'Invalid sale id' });
    const input = validateRefund(req.body);
    const db = getDb(), now = new Date();
    const transaction_id = `refund:${saleId}:${input.event_id}`;
    const replay = await db.collection('sales').findOne({ transaction_id });
    if (replay) return res.status(200).json({ ...replay, duplicate: true });

    const sale = await db.collection('sales').findOne({ _id: saleId });
    if (!sale || sale.source === 'refund') return res.status(404).json({ error: 'not_found', message: 'Sale not found' });
    if (req.user.role_name === 'cashier' && sale.sale_time < reportRange({}, now).start) {
      return res.status(403).json({ error: 'too_old', message: "Only today's sales can be changed. Ask the admin." });
    }
    const previous = await db.collection('sales').find({ refund_of: saleId }).toArray();
    const returned = new Map();
    for (const r of previous) for (const line of r.refund_lines || []) returned.set(line.index, (returned.get(line.index) || 0) + line.quantity);

    const lines = input.items.map(({ index, quantity }) => {
      const item = sale.items[index];
      if (!item) throw Object.assign(new Error('Unknown item'), { status: 400, code: 'validation_error' });
      const left = item.quantity - (returned.get(index) || 0);
      if (quantity > left) throw Object.assign(new Error(`Only ${left} left to return for ${item.name}`), { status: 409, code: 'over_refund' });
      return { index, quantity, item };
    });
    if (input.refund_fee) {
      if (!sale.fee_centavos) throw Object.assign(new Error('This sale has no delivery fee'), { status: 400, code: 'validation_error' });
      if (previous.some(r => r.refund_fee)) throw Object.assign(new Error('Delivery fee was already returned'), { status: 409, code: 'over_refund' });
    }
    const food = lines.reduce((sum, l) => sum + l.quantity * l.item.price_centavos, 0);
    const fee = input.refund_fee ? sale.fee_centavos : 0;
    const refund = {
      transaction_id, source: 'refund', refund_of: saleId, reason: input.reason, refund_fee: input.refund_fee,
      refund_lines: lines.map(({ index, quantity }) => ({ index, quantity })),
      items: lines.map(({ quantity, item }) => ({ name: item.name, quantity: -quantity, price_centavos: item.price_centavos, ...(item.product_id ? { product_id: item.product_id } : {}) })),
      food_centavos: -food, fee_centavos: -fee, total_centavos: -(food + fee),
      payment_method: sale.payment_method, cash_tendered_centavos: null, gcash_reference: null,
      order_id: null, is_test_sale: sale.is_test_sale === true, voided_at: null,
      occurred_at: now, sale_time: now, received_at: now, ...timestamps(),
      recorded_by: toObjectId(req.user.id), recorded_actor: req.user.id, recorded_role: req.user.role_name
    };
    try {
      const { insertedId } = await db.collection('sales').insertOne(refund);
      const saved = { ...refund, _id: insertedId };
      try { await notifySale(db, saved); } catch (error) { console.error('Notification failed:', error.message); }
      res.status(201).json(saved);
    } catch (error) {
      if (error.code === 11000) {
        const winner = await db.collection('sales').findOne({ transaction_id });
        if (winner) return res.status(200).json({ ...winner, duplicate: true });
      }
      throw error;
    }
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const sale = await getDb().collection('sales').findOne({ _id: toObjectId(req.params.id) });
    if (!sale) return res.status(404).json({ error: 'not_found', message: 'Sale not found' });
    res.json(sale);
  } catch (error) { next(error); }
});
export function createRecordSaleHandler({ database = getDb, clock = () => new Date(), notifier = notifySale } = {}) {
  return async (req, res, next) => {
    try {
      const now = clock();
      const { sale: clean, digest } = validateSale(req.body, { now, allowBackdating: ['admin', 'cashier'].includes(req.user.role_name) || !!req.cashierDevice });
      if (clean.order_id || clean.transaction_id.startsWith('order:')) return res.status(400).json({ error: 'settlement_required', message: 'Order-linked sales must be recorded by cashier settlement' });
      if (clean.transaction_id.startsWith('tap:')) return res.status(400).json({ error: 'tap_required', message: 'Tap IDs require the tap endpoint' });
      const db = database();
      const source = req.cashierDevice ? 'device' : 'walk_in';
      const findExisting = () => db.collection('sales').findOne({ transaction_id: clean.transaction_id });
      // Globally unique IDs must not let another actor read or claim a sale on replay.
      const respond = existing => existing.digest === digest && existing.source === source &&
        (req.cashierDevice ? existing.recorded_by == null && existing.recorded_actor === req.user.id : String(existing.recorded_by) === req.user.id)
        ? res.status(200).json({ ...existing, duplicate: true })
        : res.status(409).json({ error: 'transaction_conflict', message: 'Transaction ID already exists with different content or owner' });
      const existing = await findExisting();
      if (existing) return respond(existing);
      const occurred = clean.occurred_at ? new Date(clean.occurred_at) : now;
      const sale = { ...clean, digest, recorded_by: req.cashierDevice ? null : toObjectId(req.user.id), recorded_actor: req.user.id, recorded_role: req.user.role_name, source, sale_time: occurred, occurred_at: occurred, received_at: now, ...timestamps() };
      try {
        const result = await db.collection('sales').insertOne(sale);
        const saved = { ...sale, _id: result.insertedId };
        try { await notifier(db, saved); } catch (error) { console.error('Notification failed:', error.message); }
        res.status(201).json(saved);
      } catch (error) {
        if (error.code === 11000) { const winner = await findExisting(); if (winner) return respond(winner); }
        throw error;
      }
    } catch (error) { next(error); }
  };
}
export const recordSale = createRecordSaleHandler();
router.post('/', authenticate, requireRole('admin', 'cashier'), recordSale);
export const cashierRouter = express.Router();
cashierRouter.post('/', (req, res, next) => { req.cashierDevice = true; next(); }, recordSale);
export default router;
