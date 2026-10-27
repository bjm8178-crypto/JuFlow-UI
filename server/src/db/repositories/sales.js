import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId, toObjectId } from './base.js';
import {
  todayTotals,
  byPayment,
  byHour,
  byDay,
  byMonth,
  topProducts,
  dishCounts
} from '../sales-queries.js';

export { todayTotals, byPayment, byHour, byDay, byMonth, topProducts, dishCounts };

function buildSalesWhere(filter = {}) {
  const params = [];
  const clauses = [];

  if (filter.sale_time) {
    if (filter.sale_time.$gte) {
      params.push(filter.sale_time.$gte);
      clauses.push(`sale_time >= $${params.length}`);
    }
    if (filter.sale_time.$lt) {
      params.push(filter.sale_time.$lt);
      clauses.push(`sale_time < $${params.length}`);
    }
  }

  if (filter.received_at) {
    if (filter.received_at.$gt) {
      params.push(filter.received_at.$gt);
      clauses.push(`received_at > $${params.length}`);
    }
    if (filter.received_at.$gte) {
      params.push(filter.received_at.$gte);
      clauses.push(`received_at >= $${params.length}`);
    }
  }

  if (filter.voided_at === null) {
    clauses.push(`voided_at IS NULL`);
  } else if (filter.voided_at) {
    params.push(filter.voided_at);
    clauses.push(`voided_at = $${params.length}`);
  }

  if (filter.is_test_sale !== undefined) {
    if (filter.is_test_sale === false || filter.is_test_sale?.$ne === true) {
      clauses.push(`COALESCE(is_test_sale, false) IS NOT TRUE`);
    } else if (filter.is_test_sale === true) {
      clauses.push(`is_test_sale = true`);
    }
  }

  if (filter.source) {
    params.push(filter.source);
    clauses.push(`source = $${params.length}`);
  }

  if (filter.transaction_id) {
    params.push(filter.transaction_id);
    clauses.push(`transaction_id = $${params.length}`);
  }

  if (filter.order_id) {
    params.push(extractId(filter.order_id));
    clauses.push(`order_id = $${params.length}`);
  }

  if (filter.void_id) {
    params.push(filter.void_id);
    clauses.push(`void_id = $${params.length}`);
  }

  if (filter.refund_of) {
    params.push(extractId(filter.refund_of));
    clauses.push(`(data->>'refund_of' = $${params.length} OR order_id = $${params.length})`);
  }

  if (filter._id || filter.id) {
    params.push(extractId(filter._id || filter.id));
    clauses.push(`id = $${params.length}`);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

export const salesRepo = {
  async findById(id, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const oid = toObjectId(id);
      return (await clientOrDb.collection('sales').findOne({ _id: oid }, options)) ||
             (await clientOrDb.collection('sales').findOne({ _id: id }, options));
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM sales WHERE id = $1`, [rawId]);
  },

  async findByTransactionId(transactionId, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('sales').findOne({ transaction_id: transactionId }, options);
    }
    if (!transactionId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM sales WHERE transaction_id = $1`, [transactionId]);
  },

  async findByOrderId(orderId, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const oid = toObjectId(orderId);
      return (await clientOrDb.collection('sales').findOne({ order_id: oid }, options)) ||
             (await clientOrDb.collection('sales').findOne({ order_id: orderId }, options));
    }
    const rawId = extractId(orderId);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM sales WHERE order_id = $1`, [rawId]);
  },

  async findByVoidId(voidId, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('sales').findOne({ void_id: voidId }, options);
    }
    if (!voidId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM sales WHERE void_id = $1`, [voidId]);
  },

  async findByRefundOf(saleId, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      let cursor = clientOrDb.collection('sales').find({ refund_of: saleId }, options);
      if (typeof cursor?.toArray === 'function') return await cursor.toArray();
      return cursor;
    }
    const rawId = extractId(saleId);
    if (!rawId) return [];
    return await query(clientOrDb, `SELECT * FROM sales WHERE data->>'refund_of' = $1`, [rawId]);
  },

  async find(filter = {}, options = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      let cursor = clientOrDb.collection('sales').find(filter, options);
      if (typeof cursor?.toArray === 'function') return await cursor.toArray();
      return cursor;
    }
    const { where, params } = buildSalesWhere(filter);

    let sortClause = 'ORDER BY sale_time DESC, id DESC';
    if (options.sort) {
      if (typeof options.sort === 'object') {
        const parts = [];
        for (const [k, dir] of Object.entries(options.sort)) {
          const col = (k === '_id' || k === 'id') ? 'id' : k;
          parts.push(`${col} ${dir === -1 || dir === 'desc' ? 'DESC' : 'ASC'}`);
        }
        if (parts.length) sortClause = `ORDER BY ${parts.join(', ')}`;
      }
    }

    let limitClause = '';
    if (options.limit && Number.isSafeInteger(Number(options.limit))) {
      params.push(Number(options.limit));
      limitClause = `LIMIT $${params.length}`;
    }

    let skipClause = '';
    if (options.skip && Number.isSafeInteger(Number(options.skip))) {
      params.push(Number(options.skip));
      skipClause = `OFFSET $${params.length}`;
    }

    const sql = `SELECT * FROM sales ${where} ${sortClause} ${limitClause} ${skipClause}`;
    return await query(clientOrDb, sql, params);
  },

  async count(filter = {}, clientOrDb = null) {
    const { where, params } = buildSalesWhere(filter);
    const sql = `SELECT COUNT(*)::int AS count FROM sales ${where}`;
    const res = await queryOne(clientOrDb, sql, params);
    return res ? Number(res.count) : 0;
  },

  async create(sale, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const res = await clientOrDb.collection('sales').insertOne(sale, options);
      return { ...sale, _id: res.insertedId || sale._id || sale.id };
    }
    const id = extractId(sale.id || sale._id) || newId();
    const now = new Date();
    const created_at = sale.created_at || now;
    const updated_at = sale.updated_at || now;

    const data = { ...(sale.data || {}) };
    for (const [k, v] of Object.entries(sale)) {
      if (['id', '_id', 'transaction_id', 'order_id', 'void_id', 'event_id',
           'sale_time', 'received_at', 'source', 'payment_method', 'items',
           'food_centavos', 'fee_centavos', 'total_centavos', 'cash_tendered_centavos',
           'gcash_reference', 'recorded_by', 'recorded_actor', 'recorded_role',
           'is_test_sale', 'digest', 'verification', 'voided_at', 'data',
           'created_at', 'updated_at'].includes(k)) continue;
      data[k] = v;
    }

    const sql = `
      INSERT INTO sales (
        id, transaction_id, order_id, void_id, event_id, sale_time, received_at,
        source, payment_method, items, food_centavos, fee_centavos, total_centavos,
        cash_tendered_centavos, gcash_reference, recorded_by, recorded_actor,
        recorded_role, is_test_sale, digest, verification, voided_at, data,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10::jsonb, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21::jsonb, $22, $23::jsonb,
        $24, $25
      )
      RETURNING *
    `;

    const params = [
      id,
      sale.transaction_id || null,
      extractId(sale.order_id) || null,
      sale.void_id || null,
      sale.event_id || null,
      sale.sale_time || now,
      sale.received_at || now,
      sale.source || 'walk_in',
      sale.payment_method || null,
      JSON.stringify(sale.items || []),
      Number(sale.food_centavos || 0),
      Number(sale.fee_centavos || 0),
      Number(sale.total_centavos || 0),
      sale.cash_tendered_centavos != null ? Number(sale.cash_tendered_centavos) : null,
      sale.gcash_reference || null,
      extractId(sale.recorded_by) || null,
      sale.recorded_actor || null,
      sale.recorded_role || null,
      Boolean(sale.is_test_sale),
      sale.digest || null,
      JSON.stringify(sale.verification || {}),
      sale.voided_at || null,
      JSON.stringify(data),
      created_at,
      updated_at
    ];

    return await queryOne(clientOrDb, sql, params);
  },

  async markHasRefunds(id, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('sales').updateOne({ _id: id }, { $set: { has_refunds: true }, $inc: { refund_version: 1 } }, options);
    }
    const rawId = extractId(id);
    const sql = `
      UPDATE sales
      SET data = jsonb_set(
        jsonb_set(COALESCE(data, '{}'::jsonb), '{has_refunds}', 'true'::jsonb),
        '{refund_version}',
        to_jsonb(COALESCE((data->>'refund_version')::int, 0) + 1)
      ),
      updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [rawId]);
  },

  async voidTapSale(keyId, voidedBy, productId, start, end, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('sales').findOneAndUpdate(
        {
          sale_time: { $gte: start, $lt: end },
          voided_at: null,
          is_test_sale: { $ne: true },
          tap: true,
          source: 'walk_in',
          'items.product_id': { $in: [productId, String(productId)] }
        },
        { $set: { voided_at: new Date(), voided_by: voidedBy, void_id: keyId, updated_at: new Date() } },
        { ...options, sort: { sale_time: -1, _id: -1 }, returnDocument: 'after' }
      );
    }
    const rawProductId = extractId(productId);
    const sql = `
      UPDATE sales
      SET voided_at = NOW(),
          void_id = $1,
          data = jsonb_set(COALESCE(data, '{}'::jsonb), '{voided_by}', to_jsonb($2::text)),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM sales
        WHERE sale_time >= $3 AND sale_time < $4
          AND voided_at IS NULL
          AND COALESCE(is_test_sale, false) IS NOT TRUE
          AND (data->>'tap' = 'true' OR data->'tap' = 'true'::jsonb)
          AND source = 'walk_in'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(items) elem
            WHERE elem->>'product_id' = $5
          )
        ORDER BY sale_time DESC, id DESC
        LIMIT 1
      )
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [keyId, String(voidedBy), start, end, rawProductId]);
  }
};
