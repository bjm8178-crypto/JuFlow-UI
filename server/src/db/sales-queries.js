import { getPool } from './postgres.js';

export function buildWhere(criteria = {}) {
  let start = criteria.start;
  let end = criteria.end;
  let source = criteria.source;

  if (criteria.sale_time) {
    if (criteria.sale_time.$gte) start = criteria.sale_time.$gte;
    if (criteria.sale_time.$lt) end = criteria.sale_time.$lt;
  }

  const params = [];
  const clauses = ['voided_at IS NULL', 'COALESCE(is_test_sale, false) IS NOT TRUE'];

  if (start) {
    params.push(start);
    clauses.push(`sale_time >= $${params.length}`);
  }
  if (end) {
    params.push(end);
    clauses.push(`sale_time < $${params.length}`);
  }
  if (source) {
    params.push(source);
    clauses.push(`source = $${params.length}`);
  }
  return { where: clauses.join(' AND '), params };
}

export function getExecutor(clientOrDb) {
  if (clientOrDb) {
    if (typeof clientOrDb.query === 'function') return clientOrDb;
    if (clientOrDb.client && typeof clientOrDb.client.query === 'function') return clientOrDb.client;
  }
  return getPool();
}

export async function todayTotals(criteria = {}, clientOrDb = null) {
  const { where, params } = buildWhere(criteria);
  const sql = `
    SELECT COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos,
           COALESCE(SUM(COALESCE(food_centavos, total_centavos)), 0)::bigint AS food_centavos,
           COALESCE(SUM(fee_centavos), 0)::bigint AS fee_centavos,
           COUNT(CASE WHEN source != 'refund' THEN 1 END)::int AS transaction_count,
           COALESCE(SUM((
             SELECT COALESCE(SUM((item->>'quantity')::int), 0)
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS item
           )), 0)::int AS units_sold
    FROM sales
    WHERE ${where}
  `;
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(sql, params);
  const r = res.rows[0] || {};
  const total_centavos = Number(r.total_centavos || 0);
  const food_centavos = Number(r.food_centavos || 0);
  const fee_centavos = Number(r.fee_centavos || 0);
  const transaction_count = Number(r.transaction_count || 0);
  const units_sold = Number(r.units_sold || 0);

  const byPaymentRows = await byPayment(criteria, clientOrDb);

  return {
    total_centavos,
    food_centavos,
    fee_centavos,
    transaction_count,
    units_sold,
    by_payment: byPaymentRows
  };
}

export async function byPayment(criteria = {}, clientOrDb = null) {
  const { where, params } = buildWhere(criteria);
  const sql = `
    SELECT payment_method AS _id,
           COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos,
           COUNT(CASE WHEN source != 'refund' THEN 1 END)::int AS transaction_count
    FROM sales
    WHERE ${where}
    GROUP BY payment_method
    ORDER BY _id ASC
  `;
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(sql, params);
  return res.rows.map(r => ({
    _id: r._id,
    total_centavos: Number(r.total_centavos || 0),
    transaction_count: Number(r.transaction_count || 0)
  }));
}

export async function byHour(criteria = {}, clientOrDb = null) {
  const { where, params } = buildWhere(criteria);
  const sql = `
    SELECT EXTRACT(HOUR FROM sale_time AT TIME ZONE 'Asia/Manila')::int AS _id,
           COALESCE(SUM(total_centavos), 0)::bigint AS total
    FROM sales
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(sql, params);
  return res.rows.map(r => ({
    _id: Number(r._id),
    total: Number(r.total || 0)
  }));
}

export async function byDay(criteria = {}, clientOrDb = null) {
  const { where, params } = buildWhere(criteria);
  const sql = `
    SELECT TO_CHAR(sale_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS _id,
           COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos
    FROM sales
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(sql, params);
  return res.rows.map(r => ({
    _id: r._id,
    total_centavos: Number(r.total_centavos || 0)
  }));
}

export async function byMonth(criteria = {}, clientOrDb = null) {
  const { where, params } = buildWhere(criteria);
  const sql = `
    SELECT TO_CHAR(sale_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS _id,
           COALESCE(SUM(total_centavos), 0)::bigint AS total_centavos,
           COUNT(CASE WHEN source != 'refund' THEN 1 END)::int AS transaction_count,
           COALESCE(SUM((
             SELECT COALESCE(SUM((item->>'quantity')::int), 0)
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS item
           )), 0)::int AS units_sold
    FROM sales
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(sql, params);
  return res.rows.map(r => ({
    _id: r._id,
    total_centavos: Number(r.total_centavos || 0),
    transaction_count: Number(r.transaction_count || 0),
    units_sold: Number(r.units_sold || 0)
  }));
}

export async function topProducts(criteria = {}, clientOrDb = null, limit = 6) {
  const { where, params } = buildWhere(criteria);
  const limitIdx = params.length + 1;
  params.push(limit);
  const sql = `
    SELECT (item->>'name') AS _id,
           COALESCE(SUM((item->>'quantity')::int), 0)::int AS units,
           COALESCE(SUM((item->>'quantity')::int * (item->>'price_centavos')::bigint), 0)::bigint AS revenue
    FROM sales,
         jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS item
    WHERE ${where}
    GROUP BY (item->>'name')
    HAVING SUM((item->>'quantity')::int) > 0
    ORDER BY units DESC, _id ASC
    LIMIT $${limitIdx}
  `;
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(sql, params);
  return res.rows.map(r => ({
    _id: r._id,
    units: Number(r.units || 0),
    revenue: Number(r.revenue || 0)
  }));
}

export async function dishCounts(criteria = {}, clientOrDb = null) {
  const { where, params } = buildWhere(criteria);
  const sql = `
    SELECT COALESCE(item->>'product_id', p.id) AS _id,
           COALESCE(SUM((item->>'quantity')::int), 0)::int AS quantity
    FROM sales,
         jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END) AS item
    LEFT JOIN products p ON LOWER(TRIM(p.name)) = LOWER(TRIM(item->>'name'))
    WHERE ${where} AND (item->>'product_id' IS NOT NULL OR p.id IS NOT NULL)
    GROUP BY COALESCE(item->>'product_id', p.id)
  `;
  const executor = getExecutor(clientOrDb);
  const res = await executor.query(sql, params);
  return res.rows.map(r => ({
    _id: String(r._id),
    quantity: Number(r.quantity || 0)
  }));
}
