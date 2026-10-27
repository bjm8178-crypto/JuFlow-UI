import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId, toObjectId } from './base.js';

export const customersRepo = {
  async findById(id, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const oid = toObjectId(id);
      return (await clientOrDb.collection('customers').findOne({ _id: oid }, options)) ||
             (await clientOrDb.collection('customers').findOne({ _id: id }, options));
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM customers WHERE id = $1`, [rawId]);
  },

  async findDuplicatePhone(digits, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('customers').findOne({
        is_active: { $ne: false },
        phone: { $regex: new RegExp('^\\D*' + digits.split('').join('\\D*') + '\\D*$') }
      });
    }
    const sql = `
      SELECT * FROM customers
      WHERE COALESCE(is_active, true) IS NOT FALSE
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1
      LIMIT 1
    `;
    return await queryOne(clientOrDb, sql, [digits]);
  },

  async find(filter = {}, options = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      let cursor = clientOrDb.collection('customers').find(filter, options);
      if (typeof cursor?.toArray === 'function') return await cursor.toArray();
      return cursor;
    }
    const params = [];
    const clauses = [];

    if (filter.is_active !== undefined) {
      if (filter.is_active === true) {
        clauses.push(`COALESCE(is_active, true) IS NOT FALSE`);
      } else if (filter.is_active === false) {
        clauses.push(`is_active = false`);
      } else if (filter.is_active?.$ne === false) {
        clauses.push(`COALESCE(is_active, true) IS NOT FALSE`);
      }
    }

    if (filter.phone) {
      params.push(filter.phone);
      clauses.push(`phone = $${params.length}`);
    }

    if (filter._id || filter.id) {
      params.push(extractId(filter._id || filter.id));
      clauses.push(`id = $${params.length}`);
    }

    if (filter.landmark_photo) {
      params.push(filter.landmark_photo);
      clauses.push(`landmark_photo = $${params.length}`);
    }

    if (filter.$or && Array.isArray(filter.$or)) {
      const orParts = [];
      for (const item of filter.$or) {
        if (item.name?.$regex) {
          params.push(`%${item.name.$regex.replace(/\\/g, '')}%`);
          orParts.push(`name ILIKE $${params.length}`);
        } else if (item.phone?.$regex) {
          params.push(`%${item.phone.$regex.replace(/\\/g, '')}%`);
          orParts.push(`phone ILIKE $${params.length}`);
        } else if (item.messenger?.$regex) {
          params.push(`%${item.messenger.$regex.replace(/\\/g, '')}%`);
          orParts.push(`messenger ILIKE $${params.length}`);
        }
      }
      if (orParts.length) {
        clauses.push(`(${orParts.join(' OR ')})`);
      }
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    let sortClause = 'ORDER BY name ASC';
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

    const sql = `SELECT * FROM customers ${where} ${sortClause} ${limitClause} ${skipClause}`;
    return await query(clientOrDb, sql, params);
  },

  async count(filter = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('customers').countDocuments(filter);
    }
    const params = [];
    const clauses = [];
    if (filter.is_active !== undefined) {
      if (filter.is_active === true || filter.is_active?.$ne === false) {
        clauses.push(`COALESCE(is_active, true) IS NOT FALSE`);
      } else if (filter.is_active === false) {
        clauses.push(`is_active = false`);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await queryOne(clientOrDb, `SELECT COUNT(*)::int AS count FROM customers ${where}`, params);
    return res ? Number(res.count) : 0;
  },

  async create(customer, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const res = await clientOrDb.collection('customers').insertOne(customer);
      return { ...customer, _id: res.insertedId || customer._id || customer.id };
    }
    const id = extractId(customer.id || customer._id) || newId();
    const now = new Date();
    const created_at = customer.created_at || now;
    const updated_at = customer.updated_at || now;

    const data = { ...(customer.data || {}) };
    for (const [k, v] of Object.entries(customer)) {
      if (['id', '_id', 'name', 'phone', 'messenger', 'address', 'landmark',
           'landmark_photo', 'lat', 'lng', 'notes', 'is_active', 'created_at',
           'updated_at', 'data'].includes(k)) continue;
      data[k] = v;
    }

    const sql = `
      INSERT INTO customers (
        id, name, phone, messenger, address, landmark, landmark_photo,
        lat, lng, notes, is_active, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::jsonb, $13, $14
      )
      RETURNING *
    `;

    const params = [
      id,
      customer.name || null,
      customer.phone || null,
      customer.messenger || null,
      customer.address || null,
      customer.landmark || null,
      customer.landmark_photo || null,
      customer.lat != null ? Number(customer.lat) : null,
      customer.lng != null ? Number(customer.lng) : null,
      customer.notes || null,
      customer.is_active !== false,
      JSON.stringify(data),
      created_at,
      updated_at
    ];

    return await queryOne(clientOrDb, sql, params);
  },

  async update(id, updates = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('customers').findOneAndUpdate(
        { _id: id },
        { $set: updates },
        { returnDocument: 'after' }
      );
    }
    const rawId = extractId(id);
    const sets = ['updated_at = NOW()'];
    const params = [rawId];

    for (const [k, v] of Object.entries(updates)) {
      if (['id', '_id', 'updated_at'].includes(k)) continue;
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }

    const sql = `
      UPDATE customers
      SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, params);
  },

  async delete(id, clientOrDb = null, deletedBy = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('customers').findOneAndUpdate(
        { _id: id, is_active: { $ne: false } },
        { $set: { is_active: false, deleted_at: new Date(), deleted_by: deletedBy, updated_at: new Date() } },
        { returnDocument: 'after' }
      );
    }
    const rawId = extractId(id);
    const sql = `
      UPDATE customers
      SET is_active = false,
          deleted_at = NOW(),
          data = jsonb_set(COALESCE(data, '{}'::jsonb), '{deleted_by}', to_jsonb($2::text)),
          updated_at = NOW()
      WHERE id = $1 AND COALESCE(is_active, true) IS NOT FALSE
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [rawId, deletedBy ? String(deletedBy) : null]);
  }
};
