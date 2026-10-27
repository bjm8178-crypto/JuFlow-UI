import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId, toObjectId } from './base.js';

export const deliveriesRepo = {
  async findById(id, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const oid = toObjectId(id);
      return (await clientOrDb.collection('deliveries').findOne({ _id: oid })) ||
             (await clientOrDb.collection('deliveries').findOne({ _id: id }));
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM deliveries WHERE id = $1`, [rawId]);
  },

  async findByOrderId(orderId, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('deliveries').findOne({ order_id: orderId });
    }
    const rawId = extractId(orderId);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM deliveries WHERE order_id = $1`, [rawId]);
  },

  async find(filter = {}, options = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      let cursor = clientOrDb.collection('deliveries').find(filter, options);
      if (typeof cursor?.toArray === 'function') return await cursor.toArray();
      return cursor;
    }
    const params = [];
    const clauses = [];

    if (filter.status) {
      if (typeof filter.status === 'string') {
        params.push(filter.status);
        clauses.push(`status = $${params.length}`);
      } else if (filter.status.$nin && Array.isArray(filter.status.$nin)) {
        params.push(filter.status.$nin);
        clauses.push(`status != ALL($${params.length}::varchar[])`);
      } else if (filter.status.$in && Array.isArray(filter.status.$in)) {
        params.push(filter.status.$in);
        clauses.push(`status = ANY($${params.length}::varchar[])`);
      }
    }

    if (filter.rider_id) {
      params.push(extractId(filter.rider_id));
      clauses.push(`rider_id = $${params.length}`);
    }

    if (filter.order_id) {
      params.push(extractId(filter.order_id));
      clauses.push(`order_id = $${params.length}`);
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

    const sql = `SELECT * FROM deliveries ${where} ${sortClause} ${limitClause}`;
    return await query(clientOrDb, sql, params);
  },

  async create(delivery, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const res = await clientOrDb.collection('deliveries').insertOne(delivery, options);
      return { ...delivery, _id: res.insertedId || delivery._id || delivery.id };
    }
    const id = extractId(delivery.id || delivery._id) || newId();
    const now = new Date();
    const created_at = delivery.created_at || now;
    const updated_at = delivery.updated_at || now;

    const data = { ...(delivery.data || {}) };
    for (const [k, v] of Object.entries(delivery)) {
      if (['id', '_id', 'order_id', 'customer_id', 'rider_id', 'status', 'notes',
           'created_at', 'updated_at', 'data'].includes(k)) continue;
      data[k] = v;
    }

    const sql = `
      INSERT INTO deliveries (
        id, order_id, customer_id, rider_id, status, notes, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9
      )
      RETURNING *
    `;

    const params = [
      id,
      extractId(delivery.order_id) || null,
      extractId(delivery.customer_id) || null,
      extractId(delivery.rider_id) || null,
      delivery.status || 'pending',
      delivery.notes || null,
      JSON.stringify(data),
      created_at,
      updated_at
    ];

    return await queryOne(clientOrDb, sql, params);
  },

  async updateByOrderId(orderId, updates = {}, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('deliveries').updateOne({ order_id: orderId }, { $set: updates, $inc: { version: 1 } }, options);
    }
    const rawOrderId = extractId(orderId);
    const sets = ['updated_at = NOW()'];
    const params = [rawOrderId];

    for (const [k, v] of Object.entries(updates)) {
      if (['id', '_id', 'order_id', 'updated_at'].includes(k)) continue;
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }

    const sql = `
      UPDATE deliveries
      SET ${sets.join(', ')}
      WHERE order_id = $1
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, params);
  },

  async updateNotes(id, expectedVersion, notes, clientOrDb = null) {
    const rawId = extractId(id);
    const sql = `
      UPDATE deliveries
      SET notes = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [notes, rawId]);
  }
};
