import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/sales - List sales
// ?date=YYYY-MM-DD  (default: today Philippine time)
// ?is_test=true|false
router.get('/', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const { date, is_test } = req.query;

    // Build date range in Philippine time (UTC+8)
    const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
    let startDate, endDate;
    if (date) {
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
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const { date } = req.query;

    const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
    let startDate, endDate;
    if (date) {
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
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const sale = await db.collection('sales').findOne({ _id: toObjectId(req.params.id) });
    if (!sale) return res.status(404).json({ error: 'not_found', message: 'Sale not found' });
    res.json(sale);
  } catch (error) {
    next(error);
  }
});

// POST /api/sales - Record a sale (cashier endpoint)
// Also accessible at POST /api/cashier/sales
router.post('/', authenticate, async (req, res, next) => {
  try {
    const {
      order_id,
      transaction_id,  // idempotency key
      items,           // [{ name, quantity, price_centavos }]
      total_centavos,
      payment_method,  // 'cash' | 'exact' | 'gcash'
      cash_tendered_centavos,
      gcash_reference,
      is_test_sale
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'validation_error', message: 'Sale items are required' });
    }
    if (total_centavos === undefined || total_centavos <= 0) {
      return res.status(400).json({ error: 'validation_error', message: 'Valid total is required' });
    }

    const db = getDb();

    // Idempotency: if same transaction_id already exists, return existing
    if (transaction_id) {
      const existing = await db.collection('sales').findOne({ transaction_id });
      if (existing) {
        return res.status(200).json(existing);
      }
    }

    const sale = {
      order_id: order_id ? toObjectId(order_id) : null,
      transaction_id: transaction_id || null,
      items: items.map(i => ({
        name: String(i.name).trim(),
        quantity: parseInt(i.quantity),
        price_centavos: parseInt(i.price_centavos)
      })),
      total_centavos: parseInt(total_centavos),
      payment_method: payment_method || 'cash',
      cash_tendered_centavos: payment_method === 'cash' ? parseInt(cash_tendered_centavos || 0) : null,
      gcash_reference: gcash_reference || null,
      is_test_sale: is_test_sale === true,
      recorded_by: toObjectId(req.user.id),
      sale_time: new Date(),
      ...timestamps()
    };

    const result = await db.collection('sales').insertOne(sale);
    sale._id = result.insertedId;

    res.status(201).json(sale);
  } catch (error) {
    next(error);
  }
});

export default router;
