import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateSale } from '../lib/sale.js';

const router = express.Router();

// GET /api/sales - List sales
// ?date=YYYY-MM-DD  (default: today Philippine time)
// ?is_test=true|false
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const { date, is_test } = req.query;

    // Build date range in Philippine time (UTC+8)
    const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
    let startDate, endDate;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(String(date)))) {
        return res.status(400).json({ error: 'validation_error', message: 'date must be YYYY-MM-DD' });
      }
      const [y, m, d] = date.split('-').map(Number);
      startDate = new Date(Date.UTC(y, m - 1, d) - PH_OFFSET_MS);
      endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    } else {
      // Default: today in Philippine time
      const nowPH = new Date(Date.now() + PH_OFFSET_MS);
      const todayStr = nowPH.toISOString().slice(0, 10);
      const [y, m, d] = todayStr.split('-').map(Number);
      startDate = new Date(Date.UTC(y, m - 1, d) - PH_OFFSET_MS);
      endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const query = { sale_time: { $gte: startDate, $lt: endDate } };
    if (is_test === 'true') query.is_test_sale = true;
    else if (is_test === 'false') query.is_test_sale = false;
    else query.is_test_sale = false; // default: real sales only

    const sales = await db.collection('sales')
      .find(query)
      .sort({ sale_time: -1 })
      .toArray();

    res.json(sales);
  } catch (error) {
    next(error);
  }
});

// GET /api/sales/summary - Aggregated sales stats for today
router.get('/summary', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const { date } = req.query;

    const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
    let startDate, endDate;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(String(date)))) {
        return res.status(400).json({ error: 'validation_error', message: 'date must be YYYY-MM-DD' });
      }
      const [y, m, d] = date.split('-').map(Number);
      startDate = new Date(Date.UTC(y, m - 1, d) - PH_OFFSET_MS);
      endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    } else {
      const nowPH = new Date(Date.now() + PH_OFFSET_MS);
      const todayStr = nowPH.toISOString().slice(0, 10);
      const [y, m, d] = todayStr.split('-').map(Number);
      startDate = new Date(Date.UTC(y, m - 1, d) - PH_OFFSET_MS);
      endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const agg = await db.collection('sales').aggregate([
      {
        $match: {
          sale_time: { $gte: startDate, $lt: endDate },
          is_test_sale: false
        }
      },
      {
        $group: {
          _id: null,
          total_centavos: { $sum: '$total_centavos' },
          transaction_count: { $sum: 1 },
          units_sold: { $sum: { $sum: '$items.quantity' } }
        }
      }
    ]).toArray();

    const summary = agg[0] || { total_centavos: 0, transaction_count: 0, units_sold: 0 };

    // Month-to-date
    const nowPH2 = new Date(Date.now() + PH_OFFSET_MS);
    const monthStart = new Date(Date.UTC(nowPH2.getUTCFullYear(), nowPH2.getUTCMonth(), 1) - PH_OFFSET_MS);
    const mtdAgg = await db.collection('sales').aggregate([
      { $match: { sale_time: { $gte: monthStart }, is_test_sale: false } },
      { $group: { _id: null, month_to_date_centavos: { $sum: '$total_centavos' } } }
    ]).toArray();
    summary.month_to_date_centavos = mtdAgg[0]?.month_to_date_centavos || 0;

    // Hourly breakdown for chart
    const hourlySales = await db.collection('sales').aggregate([
      { $match: { sale_time: { $gte: startDate, $lt: endDate }, is_test_sale: false } },
      {
        $group: {
          _id: {
            $hour: { date: '$sale_time', timezone: 'Asia/Manila' }
          },
          total: { $sum: '$total_centavos' }
        }
      },
      { $sort: { '_id': 1 } }
    ]).toArray();
    summary.by_hour = hourlySales;

    // Top products
    const topProducts = await db.collection('sales').aggregate([
      { $match: { sale_time: { $gte: startDate, $lt: endDate }, is_test_sale: false } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          units: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.price_centavos'] } }
        }
      },
      { $sort: { units: -1 } },
      { $limit: 5 }
    ]).toArray();
    summary.top_products = topProducts;

    res.json(summary);
  } catch (error) {
    next(error);
  }
});

// GET /api/sales/:id - Get single sale
router.get('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const sale = await db.collection('sales').findOne({ _id: toObjectId(req.params.id) });
    if (!sale) return res.status(404).json({ error: 'not_found', message: 'Sale not found' });
    res.json(sale);
  } catch (error) {
    next(error);
  }
});

// Records a sale. Used by POST /api/sales (admin/cashier users) and
// POST /api/cashier/sales (cashier device with CASHIER_API_TOKEN).
//  - same transaction_id + same content  -> 200, returns the existing sale (safe retry)
//  - same transaction_id + different content -> 409
export async function recordSale(req, res, next) {
  try {
    const { sale: clean, digest } = validateSale(req.body);
    const db = getDb();

    const findExisting = () => clean.transaction_id ? db.collection('sales').findOne({ transaction_id: clean.transaction_id }) : null;
    const respondExisting = (existing) => existing.digest === digest
      ? res.status(200).json({ ...existing, duplicate: true })
      : res.status(409).json({ error: 'transaction_conflict', message: 'Transaction ID already exists with different content' });

    const existing = await findExisting();
    if (existing) return respondExisting(existing);

    const order_id = req.body.order_id ? toObjectId(req.body.order_id) : null;
    const sale = {
      order_id,
      ...clean,
      digest,
      recorded_by: toObjectId(req.user.id),
      sale_time: new Date(),
      ...timestamps()
    };
    if (!sale.transaction_id) delete sale.transaction_id; // partial unique index only covers real ids

    try {
      const result = await db.collection('sales').insertOne(sale);
      sale._id = result.insertedId;
      return res.status(201).json(sale);
    } catch (err) {
      // Concurrent retry with the same transaction_id lost the race on the unique index
      if (err?.code === 11000) {
        const winner = await findExisting();
        if (winner) return respondExisting(winner);
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
}

router.post('/', authenticate, requireRole('admin', 'cashier'), recordSale);

// Router mounted at /api/cashier/sales (token auth is applied in index.js)
export const cashierRouter = express.Router();
// The cashier device must always send an idempotency key so retries are safe.
cashierRouter.post('/', (req, res, next) => {
  if (typeof req.body?.transaction_id !== 'string' || !req.body.transaction_id.trim()) {
    return res.status(400).json({ error: 'validation_error', message: 'transaction_id is required' });
  }
  next();
}, recordSale);

export default router;
