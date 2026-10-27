import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId, toObjectId } from './base.js';

export const productsRepo = {
  async findById(id, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const oid = toObjectId(id);
      return (await clientOrDb.collection('products').findOne({ _id: oid })) ||
             (await clientOrDb.collection('products').findOne({ _id: id }));
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM products WHERE id = $1`, [rawId]);
  },

  async findDuplicateName(nameKey, excludeId = null, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const q = { name_key: nameKey, is_active: { $ne: false } };
      if (excludeId) q._id = { $ne: toObjectId(excludeId) };
      return await clientOrDb.collection('products').findOne(q);
    }
    const params = [nameKey.toLowerCase()];
    let sql = `SELECT * FROM products WHERE LOWER(name_key) = $1 AND COALESCE(is_active, true) IS NOT FALSE`;
    if (excludeId) {
      params.push(extractId(excludeId));
      sql += ` AND id != $${params.length}`;
    }
    return await queryOne(clientOrDb, sql + ` LIMIT 1`, params);
  },

  async find(filter = {}, options = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      let cursor = clientOrDb.collection('products').find(filter, options);
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

    if (filter.is_available !== undefined) {
      if (filter.is_available === true) {
        clauses.push(`COALESCE(is_available, true) IS NOT FALSE`);
      } else if (filter.is_available === false) {
        clauses.push(`is_available = false`);
      } else if (filter.is_available?.$ne === false) {
        clauses.push(`COALESCE(is_available, true) IS NOT FALSE`);
      }
    }

    if (filter.category_id) {
      params.push(extractId(filter.category_id));
      clauses.push(`category_id = $${params.length}`);
    }

    if (filter._id || filter.id) {
      if (typeof (filter._id || filter.id) === 'object' && (filter._id?.$in || filter.id?.$in)) {
        const rawIds = (filter._id?.$in || filter.id?.$in).map(extractId).filter(Boolean);
        params.push(rawIds);
        clauses.push(`id = ANY($${params.length}::varchar[])`);
      } else {
        params.push(extractId(filter._id || filter.id));
        clauses.push(`id = $${params.length}`);
      }
    }

    if (filter.name_key) {
      params.push(filter.name_key);
      clauses.push(`name_key = $${params.length}`);
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

    const sql = `SELECT * FROM products ${where} ${sortClause} ${limitClause}`;
    return await query(clientOrDb, sql, params);
  },

  async count(filter = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('products').countDocuments(filter);
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
    if (filter._id?.$in || filter.id?.$in) {
      const rawIds = (filter._id?.$in || filter.id?.$in).map(extractId).filter(Boolean);
      params.push(rawIds);
      clauses.push(`id = ANY($${params.length}::varchar[])`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await queryOne(clientOrDb, `SELECT COUNT(*)::int AS count FROM products ${where}`, params);
    return res ? Number(res.count) : 0;
  },

  async create(product, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const res = await clientOrDb.collection('products').insertOne(product);
      return { ...product, _id: res.insertedId || product._id || product.id };
    }
    const id = extractId(product.id || product._id) || newId();
    const now = new Date();
    const created_at = product.created_at || now;
    const updated_at = product.updated_at || now;

    const data = { ...(product.data || {}) };
    for (const [k, v] of Object.entries(product)) {
      if (['id', '_id', 'category_id', 'name', 'name_key', 'description', 'price_centavos',
           'cost_centavos', 'is_available', 'is_active', 'image_url', 'image_id', 'options',
           'tags', 'data', 'created_at', 'updated_at'].includes(k)) continue;
      data[k] = v;
    }

    const nameKey = product.name_key || (product.name ? product.name.trim().toLowerCase() : '');

    const sql = `
      INSERT INTO products (
        id, category_id, name, name_key, description, price_centavos, cost_centavos,
        is_available, is_active, image_url, image_id, options, tags, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16
      )
      RETURNING *
    `;

    const params = [
      id,
      extractId(product.category_id) || null,
      product.name || null,
      nameKey,
      product.description || null,
      Number(product.price_centavos || 0),
      Number(product.cost_centavos || 0),
      product.is_available !== false,
      product.is_active !== false,
      product.image_url || null,
      product.image_id || null,
      JSON.stringify(product.options || []),
      JSON.stringify(product.tags || []),
      JSON.stringify(data),
      created_at,
      updated_at
    ];

    return await queryOne(clientOrDb, sql, params);
  },

  async update(id, updates = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('products').findOneAndUpdate(
        { _id: id },
        { $set: updates },
        { returnDocument: 'after' }
      );
    }
    const rawId = extractId(id);
    const sets = ['updated_at = NOW()'];
    const params = [rawId];
    const COLUMNS = new Set([
      'category_id', 'name', 'name_key', 'description', 'price_centavos',
      'cost_centavos', 'is_available', 'is_active', 'image_url', 'image_id', 'options', 'tags'
    ]);

    for (const [k, v] of Object.entries(updates)) {
      if (['id', '_id', 'updated_at'].includes(k)) continue;
      if (k === 'name') {
        params.push(v);
        sets.push(`name = $${params.length}`);
        if (!updates.name_key) {
          params.push(v.trim().toLowerCase());
          sets.push(`name_key = $${params.length}`);
        }
        continue;
      }
      if (COLUMNS.has(k)) {
        params.push(k === 'category_id' ? (extractId(v) || null) : v);
        sets.push(`${k} = $${params.length}`);
      } else {
        params.push(k);
        params.push(JSON.stringify(v));
        sets.push(`data = jsonb_set(COALESCE(data, '{}'::jsonb), ARRAY[$${params.length - 1}::text], $${params.length}::jsonb)`);
      }
    }

    const sql = `
      UPDATE products
      SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, params);
  },

  async delete(id, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('products').updateOne({ _id: toObjectId(id) }, { $set: { is_active: false, updated_at: new Date() } });
    }
    const rawId = extractId(id);
    return await queryOne(clientOrDb, `UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`, [rawId]);
  }
};
