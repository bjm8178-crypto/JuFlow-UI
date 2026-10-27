import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId, toObjectId } from './base.js';

function projectDoc(doc, projection) {
  if (!doc || !projection || Object.keys(projection).length === 0) return doc;
  const projected = { _id: doc._id, id: doc.id };
  for (const k of Object.keys(projection)) {
    if (projection[k] && doc[k] !== undefined) {
      projected[k] = doc[k];
    }
  }
  return projected;
}

export const ordersRepo = {
  async findById(id, options = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const oid = toObjectId(id);
      return (await clientOrDb.collection('orders').findOne({ _id: oid }, options)) ||
             (await clientOrDb.collection('orders').findOne({ _id: id }, options));
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    const doc = await queryOne(clientOrDb, `SELECT * FROM orders WHERE id = $1`, [rawId]);
    return options.projection ? projectDoc(doc, options.projection) : doc;
  },

  async findByIdempotencyKey(key, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('orders').findOne({ idempotency_key: key });
    }
    if (!key) return null;
    return await queryOne(clientOrDb, `SELECT * FROM orders WHERE idempotency_key = $1`, [key]);
  },

  async find(filter = {}, options = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      let cursor = clientOrDb.collection('orders').find(filter, options);
      if (typeof cursor?.toArray === 'function') return await cursor.toArray();
      return cursor;
    }
    const params = [];
    const clauses = [];

    if (filter.status) {
      if (typeof filter.status === 'string') {
        params.push(filter.status);
        clauses.push(`status = $${params.length}`);
      } else if (filter.status.$in && Array.isArray(filter.status.$in)) {
        params.push(filter.status.$in);
        clauses.push(`status = ANY($${params.length}::varchar[])`);
      } else if (filter.status.$nin && Array.isArray(filter.status.$nin)) {
        params.push(filter.status.$nin);
        clauses.push(`status != ALL($${params.length}::varchar[])`);
      }
    }

    if (filter.customer_id) {
      params.push(extractId(filter.customer_id));
      clauses.push(`customer_id = $${params.length}`);
    }

    if (filter.rider_id) {
      params.push(extractId(filter.rider_id));
      clauses.push(`rider_id = $${params.length}`);
    }

    if (filter.idempotency_key) {
      params.push(filter.idempotency_key);
      clauses.push(`idempotency_key = $${params.length}`);
    }

    if (filter.order_number) {
      params.push(filter.order_number);
      clauses.push(`order_number = $${params.length}`);
    }

    if (filter._id || filter.id) {
      params.push(extractId(filter._id || filter.id));
      clauses.push(`id = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    let sortClause = 'ORDER BY created_at DESC';
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

    const sql = `SELECT * FROM orders ${where} ${sortClause} ${limitClause}`;
    const docs = await query(clientOrDb, sql, params);
    if (options.projection) {
      return docs.map(d => projectDoc(d, options.projection));
    }
    return docs;
  },

  async create(order, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const res = await clientOrDb.collection('orders').insertOne(order, options);
      return { ...order, _id: res.insertedId || order._id || order.id };
    }
    const id = extractId(order.id || order._id) || newId();
    const now = new Date();
    const created_at = order.created_at || now;
    const updated_at = order.updated_at || now;

    const data = { ...(order.data || {}) };
    for (const [k, v] of Object.entries(order)) {
      if (['id', '_id', 'order_number', 'order_seq', 'idempotency_key', 'customer_id',
           'customer', 'items', 'subtotal_centavos', 'fee_centavos', 'total_centavos',
           'cash_tendered_centavos', 'change_centavos', 'payment_method', 'payment_reference',
           'payment_status', 'payment_verified', 'preparation_status', 'delivery_status',
           'status', 'rider_id', 'rider', 'delivery_id', 'notes', 'version',
           'request_digest', 'created_by', 'recorded_by', 'on_the_way_at', 'completed_at',
           'delivered_at', 'cancelled_at', 'created_at', 'updated_at', 'data'].includes(k)) continue;
      data[k] = v;
    }

    const sql = `
      INSERT INTO orders (
        id, order_number, order_seq, idempotency_key, customer_id, customer, items,
        subtotal_centavos, fee_centavos, total_centavos, cash_tendered_centavos,
        change_centavos, payment_method, payment_reference, payment_status,
        payment_verified, preparation_status, delivery_status, status, rider_id,
        rider, delivery_id, notes, version, request_digest, created_by, recorded_by,
        on_the_way_at, completed_at, delivered_at, cancelled_at, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27,
        $28, $29, $30, $31, $32::jsonb, $33, $34
      )
      RETURNING *
    `;

    const params = [
      id,
      order.order_number || null,
      order.order_seq != null ? Number(order.order_seq) : null,
      order.idempotency_key || null,
      extractId(order.customer_id) || null,
      JSON.stringify(order.customer || {}),
      JSON.stringify(order.items || []),
      Number(order.subtotal_centavos || 0),
      Number(order.fee_centavos || 0),
      Number(order.total_centavos || 0),
      order.cash_tendered_centavos != null ? Number(order.cash_tendered_centavos) : null,
      order.change_centavos != null ? Number(order.change_centavos) : null,
      order.payment_method || null,
      order.payment_reference || null,
      order.payment_status || 'pending',
      Boolean(order.payment_verified),
      order.preparation_status || 'preparing',
      order.delivery_status || 'pending',
      order.status || 'preparing',
      extractId(order.rider_id) || null,
      order.rider || null,
      extractId(order.delivery_id) || null,
      order.notes || null,
      order.version != null ? Number(order.version) : 0,
      order.request_digest || null,
      extractId(order.created_by) || null,
      order.recorded_by || null,
      order.on_the_way_at || null,
      order.completed_at || null,
      order.delivered_at || null,
      order.cancelled_at || null,
      JSON.stringify(data),
      created_at,
      updated_at
    ];

    return await queryOne(clientOrDb, sql, params);
  },

  async updateStatus(id, fromStatus, updates = {}, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('orders').findOneAndUpdate(
        { _id: id, status: fromStatus },
        { $set: updates, $inc: { version: 1 } },
        { ...options, returnDocument: 'after' }
      );
    }
    const rawId = extractId(id);
    const sets = ['version = version + 1', 'updated_at = NOW()'];
    const params = [rawId, fromStatus];

    for (const [k, v] of Object.entries(updates)) {
      if (['version', 'updated_at', 'id', '_id'].includes(k)) continue;
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }

    const sql = `
      UPDATE orders
      SET ${sets.join(', ')}
      WHERE id = $1 AND status = $2
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, params);
  },

  async updateNotes(id, expectedVersion, notes, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('orders').findOneAndUpdate(
        { _id: id, version: expectedVersion },
        { $set: { notes }, $inc: { version: 1 } },
        { returnDocument: 'after' }
      );
    }
    const rawId = extractId(id);
    const sql = `
      UPDATE orders
      SET notes = $1, version = version + 1, updated_at = NOW()
      WHERE id = $2 AND version = $3
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [notes, rawId, expectedVersion]);
  },

  async count(filter = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('orders').countDocuments(filter);
    }
    const params = [];
    const clauses = [];
    if (filter.status) {
      if (typeof filter.status === 'string') {
        params.push(filter.status);
        clauses.push(`status = $${params.length}`);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await queryOne(clientOrDb, `SELECT COUNT(*)::int AS count FROM orders ${where}`, params);
    return res ? Number(res.count) : 0;
  }
};
