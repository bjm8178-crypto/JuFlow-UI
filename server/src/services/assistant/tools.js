import { getPool } from '../../db/postgres.js';
import { buildWhere, todayTotals, byPayment, byDay, topProducts } from '../../db/sales-queries.js';
import { businessDate, dateStart } from '../../lib/business-date.js';

// READ-ONLY business data for the admin AI assistant.
// Every query is parameterised, returns only the fields listed here (no phone numbers, passwords,
// tokens or user accounts), and is capped in size. The assistant can never write anything.

const DAY = 86_400_000;
const MAX_RESULT_CHARS = 24_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const peso = centavos => Math.round(Number(centavos || 0)) / 100;
const manila = value => (value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : null);
const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);

function toolError(message) {
  return Object.assign(new Error(message), { toolError: true });
}

function parseRange(input = {}) {
  const today = businessDate();
  const from = typeof input.from === 'string' && input.from ? input.from : `${today.slice(0, 8)}01`; // default: this month
  const to = typeof input.to === 'string' && input.to ? input.to : today;
  let start, endDay;
  try { start = dateStart(from); endDay = dateStart(to); } catch { throw toolError('Dates must be real calendar dates in YYYY-MM-DD format'); }
  const end = new Date(endDay.getTime() + DAY);
  if (end <= start) throw toolError('"to" must not be before "from"');
  if (end - start > 366 * DAY) throw toolError('The date range can be at most 366 days');
  return { from, to, start, end, days: Math.round((end - start) / DAY) };
}

function limitOf(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback;
}

function itemsText(items) {
  return (Array.isArray(items) ? items : []).map(i => `${i.quantity}x ${i.name}`).join(', ');
}

function orderRow(row) {
  return {
    order_number: row.order_number,
    status: row.status,
    customer: row.customer_name || null,
    address: row.customer_address || null,
    items: itemsText(row.items),
    total_pesos: peso(row.total_centavos),
    delivery_fee_pesos: peso(row.fee_centavos),
    payment_method: row.payment_method || null,
    rider: row.rider_name || row.rider || null,
    created_at: manila(row.created_at),
    on_the_way_at: manila(row.on_the_way_at),
    delivered_at: manila(row.delivered_at),
    minutes_to_deliver: minutesBetween(row.created_at, row.delivered_at),
    notes: row.notes || null
  };
}

const ORDER_COLUMNS = `o.order_number, o.status, o.customer->>'name' AS customer_name, o.customer->>'address' AS customer_address,
  o.items, o.total_centavos, o.fee_centavos, o.payment_method, o.rider, r.name AS rider_name,
  o.created_at, o.on_the_way_at, o.delivered_at, o.notes`;

// ---------------------------------------------------------------------------------------------
const HANDLERS = {
  async get_business_overview() {
    const pool = getPool();
    const today = businessDate();
    const todayRange = parseRange({ from: today, to: today });
    const monthRange = parseRange({});
    const [todaySales, monthSales, open, ordersToday, riders, dishes] = await Promise.all([
      todayTotals({ start: todayRange.start, end: todayRange.end }),
      todayTotals({ start: monthRange.start, end: monthRange.end }),
      pool.query(`SELECT status, COUNT(*)::int AS n FROM orders WHERE status NOT IN ('delivered','cancelled') GROUP BY status`),
      pool.query(`SELECT status, COUNT(*)::int AS n FROM orders WHERE created_at >= $1 AND created_at < $2 GROUP BY status`, [todayRange.start, todayRange.end]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_available)::int AS available FROM riders WHERE is_active IS NOT FALSE`),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_available)::int AS available FROM products WHERE is_active IS NOT FALSE`)
    ]);
    const counts = rows => Object.fromEntries(rows.map(r => [r.status, r.n]));
    return {
      today: today,
      today_sales_pesos: peso(todaySales.total_centavos),
      today_transactions: todaySales.transaction_count,
      today_units_sold: todaySales.units_sold,
      month_to_date_sales_pesos: peso(monthSales.total_centavos),
      month_to_date_transactions: monthSales.transaction_count,
      open_orders_by_status: counts(open.rows),
      orders_created_today_by_status: counts(ordersToday.rows),
      riders: riders.rows[0],
      dishes: dishes.rows[0]
    };
  },

  async get_sales_summary(input) {
    const { from, to, start, end, days } = parseRange(input);
    const criteria = { start, end };
    const [totals, payments, top, daily, hourly, weekday] = await Promise.all([
      todayTotals(criteria),
      byPayment(criteria),
      topProducts(criteria, null, 10),
      byDay(criteria),
      (async () => {
        const { where, params } = buildWhere(criteria);
        const res = await getPool().query(
          `SELECT EXTRACT(HOUR FROM sale_time AT TIME ZONE 'Asia/Manila')::int AS hour, COALESCE(SUM(total_centavos),0)::bigint AS total
           FROM sales WHERE ${where} GROUP BY 1 ORDER BY 1`, params);
        return res.rows;
      })(),
      (async () => {
        const { where, params } = buildWhere(criteria);
        const res = await getPool().query(
          `SELECT EXTRACT(ISODOW FROM sale_time AT TIME ZONE 'Asia/Manila')::int AS dow,
                  COALESCE(SUM(total_centavos),0)::bigint AS total,
                  COUNT(DISTINCT (sale_time AT TIME ZONE 'Asia/Manila')::date)::int AS days_with_sales
           FROM sales WHERE ${where} GROUP BY 1 ORDER BY 1`, params);
        return res.rows;
      })()
    ]);
    const bestDay = daily.reduce((best, d) => (!best || d.total_centavos > best.total_centavos ? d : best), null);
    const bestHour = hourly.reduce((best, h) => (!best || Number(h.total) > Number(best.total) ? h : best), null);
    return {
      period: { from, to, days_in_period: days },
      note: 'Sales are completed sales only (delivered orders and walk-in cashier sales). Test and voided sales are excluded.',
      total_sales_pesos: peso(totals.total_centavos),
      food_sales_pesos: peso(totals.food_centavos),
      delivery_fees_pesos: peso(totals.fee_centavos),
      transactions: totals.transaction_count,
      units_sold: totals.units_sold,
      average_sale_pesos: totals.transaction_count ? Math.round(totals.total_centavos / totals.transaction_count) / 100 : 0,
      days_with_sales: daily.filter(d => d.total_centavos > 0).length,
      best_day: bestDay ? { date: bestDay._id, sales_pesos: peso(bestDay.total_centavos) } : null,
      by_payment_method: payments.map(p => ({ method: p._id, sales_pesos: peso(p.total_centavos), transactions: p.transaction_count })),
      top_dishes: top.map(p => ({ dish: p._id, units: p.units, sales_pesos: peso(p.revenue) })),
      sales_by_day: days <= 62 ? daily.map(d => ({ date: d._id, sales_pesos: peso(d.total_centavos) })) : 'omitted (range longer than 62 days)',
      sales_by_hour_of_day: hourly.map(h => ({ hour: `${String(h.hour).padStart(2, '0')}:00`, sales_pesos: peso(h.total) })),
      busiest_hour: bestHour ? { hour: `${String(bestHour.hour).padStart(2, '0')}:00`, sales_pesos: peso(bestHour.total) } : null,
      sales_by_weekday: weekday.map(w => ({
        weekday: WEEKDAYS[w.dow - 1], sales_pesos: peso(w.total), days_with_sales: w.days_with_sales,
        average_per_day_pesos: w.days_with_sales ? Math.round(Number(w.total) / w.days_with_sales) / 100 : 0
      }))
    };
  },

  async list_orders(input) {
    const status = ['preparing', 'on_the_way', 'delivered', 'cancelled', 'active', 'all'].includes(input.status) ? input.status : 'all';
    const limit = limitOf(input.limit, 15, 40);
    const params = [];
    const where = [];
    if (input.from || input.to) {
      const { start, end } = parseRange(input);
      params.push(start, end);
      where.push(`o.created_at >= $${params.length - 1} AND o.created_at < $${params.length}`);
    }
    if (status === 'active') where.push(`o.status NOT IN ('delivered','cancelled')`);
    else if (status !== 'all') { params.push(status); where.push(`o.status = $${params.length}`); }
    if (typeof input.customer_name === 'string' && input.customer_name.trim()) {
      params.push(`%${input.customer_name.trim().slice(0, 60).replace(/[\\%_]/g, m => '\\' + m)}%`);
      where.push(`o.customer->>'name' ILIKE $${params.length}`);
    }
    params.push(limit);
    const res = await getPool().query(
      `SELECT ${ORDER_COLUMNS} FROM orders o LEFT JOIN riders r ON r.id = o.rider_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT $${params.length}`, params);
    return { count: res.rows.length, limit, orders: res.rows.map(orderRow) };
  },

  async get_order(input) {
    const number = typeof input.order_number === 'string' ? input.order_number.trim().slice(0, 50) : '';
    if (!number) throw toolError('order_number is required');
    const pool = getPool();
    const res = await pool.query(
      `SELECT ${ORDER_COLUMNS}, o.id FROM orders o LEFT JOIN riders r ON r.id = o.rider_id WHERE LOWER(o.order_number) = LOWER($1) LIMIT 1`, [number]);
    if (!res.rows.length) return { found: false };
    const row = res.rows[0];
    const proof = await pool.query(
      `SELECT COUNT(*)::int AS n FROM media_files WHERE metadata->>'kind' = 'delivery_proof' AND metadata->>'order_id' = $1`, [row.id]);
    return { found: true, ...orderRow(row), proof_of_delivery_photos: proof.rows[0].n };
  },

  async get_deliveries_and_riders() {
    const pool = getPool();
    const [riders, active] = await Promise.all([
      pool.query(`SELECT name, full_name, status, is_available, last_location_at FROM riders WHERE is_active IS NOT FALSE ORDER BY name LIMIT 30`),
      pool.query(
        `SELECT ${ORDER_COLUMNS} FROM orders o LEFT JOIN riders r ON r.id = o.rider_id
         WHERE o.status NOT IN ('delivered','cancelled') ORDER BY o.created_at ASC LIMIT 30`)
    ]);
    const now = Date.now();
    return {
      riders: riders.rows.map(r => ({
        name: r.full_name || r.name, status: r.status, available: Boolean(r.is_available),
        location_last_shared: manila(r.last_location_at),
        minutes_since_location: r.last_location_at ? Math.round((now - new Date(r.last_location_at)) / 60000) : null
      })),
      active_orders: active.rows.map(row => ({ ...orderRow(row), minutes_open: minutesBetween(row.created_at, new Date()) }))
    };
  },

  async list_dishes(input) {
    const onlyAvailable = input.only_available === true;
    const res = await getPool().query(
      `SELECT name, price_centavos, cost_centavos, is_available FROM products
       WHERE is_active IS NOT FALSE ${onlyAvailable ? 'AND is_available IS TRUE' : ''} ORDER BY name LIMIT 100`);
    return {
      count: res.rows.length,
      dishes: res.rows.map(d => ({
        name: d.name, price_pesos: peso(d.price_centavos),
        cost_pesos: d.cost_centavos ? peso(d.cost_centavos) : null,
        profit_per_unit_pesos: d.cost_centavos ? peso(d.price_centavos - d.cost_centavos) : null,
        available_today: Boolean(d.is_available)
      }))
    };
  },

  async top_customers(input) {
    const { from, to, start, end } = parseRange(input);
    const limit = limitOf(input.limit, 10, 15);
    const res = await getPool().query(
      `SELECT COALESCE(NULLIF(customer->>'name',''), 'Unknown') AS name, COUNT(*)::int AS orders, COALESCE(SUM(total_centavos),0)::bigint AS total
       FROM orders WHERE status = 'delivered' AND delivered_at >= $1 AND delivered_at < $2
       GROUP BY customer_id, 1 ORDER BY total DESC, orders DESC LIMIT $3`, [start, end, limit]);
    return { period: { from, to }, customers: res.rows.map(c => ({ name: c.name, delivered_orders: c.orders, spent_pesos: peso(c.total) })) };
  }
};

// ---------------------------------------------------------------------------------------------
const dateProps = {
  from: { type: 'string', description: 'Start date YYYY-MM-DD (Philippine time). Default: first day of the current month.' },
  to: { type: 'string', description: 'End date YYYY-MM-DD, inclusive. Default: today.' }
};

export const TOOL_DEFS = [
  { name: 'get_business_overview', description: "Snapshot of the business right now: today's sales, month-to-date sales, open orders by status, orders created today, riders and dishes counts. Use for general 'how are we doing' questions.", input_schema: { type: 'object', properties: {} } },
  { name: 'get_sales_summary', description: 'Sales analytics for a date range: totals, average sale, payment methods, top dishes, sales per day, per hour of day, per weekday, best day and busiest hour. Use for any question about revenue, trends, best-selling dishes, peak days or hours, or comparing periods (call it once per period).', input_schema: { type: 'object', properties: dateProps } },
  { name: 'list_orders', description: 'List orders (newest first) with items, totals, status, rider and timestamps. Filter by status, date range (by order creation date) or customer name.', input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['preparing', 'on_the_way', 'delivered', 'cancelled', 'active', 'all'] }, ...dateProps, customer_name: { type: 'string' }, limit: { type: 'integer', description: 'Max 40, default 15' } } } },
  { name: 'get_order', description: 'Full details of one order by its order number, including delivery times and how many proof-of-delivery photos were sent.', input_schema: { type: 'object', properties: { order_number: { type: 'string' } }, required: ['order_number'] } },
  { name: 'get_deliveries_and_riders', description: 'Riders (status, availability, last shared location time) and all orders that are still open (preparing or on the way), with how long each has been open.', input_schema: { type: 'object', properties: {} } },
  { name: 'list_dishes', description: 'The menu: dish names, prices, cost and profit per unit (when cost is set) and whether each is available today.', input_schema: { type: 'object', properties: { only_available: { type: 'boolean' } } } },
  { name: 'top_customers', description: 'Customers ranked by money spent on delivered orders in a date range.', input_schema: { type: 'object', properties: { ...dateProps, limit: { type: 'integer', description: 'Max 15, default 10' } } } }
];

export async function runTool(name, input) {
  const handler = HANDLERS[name];
  if (!handler) return { error: 'Unknown tool' };
  try {
    const result = await handler(input && typeof input === 'object' && !Array.isArray(input) ? input : {});
    const text = JSON.stringify(result);
    if (text.length > MAX_RESULT_CHARS) return { error: 'Too much data for that request. Ask again with a shorter date range or fewer results.' };
    return result;
  } catch (error) {
    if (error.toolError) return { error: error.message };
    console.error('Assistant tool failed:', name, error.message);
    return { error: 'That data could not be read right now.' };
  }
}
