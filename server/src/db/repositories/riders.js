import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId, toObjectId } from './base.js';

export const ridersRepo = {
  async findById(id, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const oid = toObjectId(id);
      return (await clientOrDb.collection('riders').findOne({ _id: oid })) ||
             (await clientOrDb.collection('riders').findOne({ _id: id }));
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM riders WHERE id = $1`, [rawId]);
  },

  async findByUserId(userId, clientOrDb = null) {
    const rawId = extractId(userId);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM riders WHERE user_id = $1`, [rawId]);
  },

  async find(filter = {}, options = {}, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      let cursor = clientOrDb.collection('riders').find(filter, options);
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

    if (filter.user_id) {
      if (typeof filter.user_id === 'object' && filter.user_id.$exists) {
        clauses.push(`user_id IS NOT NULL`);
      } else {
        params.push(extractId(filter.user_id));
        clauses.push(`user_id = $${params.length}`);
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

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    let sortClause = 'ORDER BY full_name ASC, name ASC';
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

    const sql = `SELECT * FROM riders ${where} ${sortClause} ${limitClause}`;
    return await query(clientOrDb, sql, params);
  },

  async create(rider, clientOrDb = null) {
    const id = extractId(rider.id || rider._id) || newId();
    const now = new Date();
    const created_at = rider.created_at || now;
    const updated_at = rider.updated_at || now;

    const data = { ...(rider.data || {}) };
    for (const [k, v] of Object.entries(rider)) {
      if (['id', '_id', 'user_id', 'name', 'full_name', 'phone', 'vehicle_type',
           'vehicle_plate', 'plate_no', 'status', 'is_available', 'is_active',
           'last_lat', 'last_lng', 'last_location_at', 'last_location',
           'created_at', 'updated_at', 'data'].includes(k)) continue;
      data[k] = v;
    }

    const fullName = rider.full_name || rider.name || 'Rider';
    const plateNo = rider.plate_no || rider.vehicle_plate || '';
    const status = rider.status || (rider.is_available ? 'available' : 'offline');

    const sql = `
      INSERT INTO riders (
        id, user_id, name, full_name, phone, vehicle_type, vehicle_plate,
        plate_no, status, is_available, is_active, last_lat, last_lng,
        last_location_at, last_location, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15::jsonb, $16::jsonb, $17, $18
      )
      RETURNING *
    `;

    const params = [
      id,
      extractId(rider.user_id) || null,
      fullName,
      fullName,
      rider.phone || '',
      rider.vehicle_type || null,
      plateNo,
      plateNo,
      status,
      rider.is_available !== false,
      rider.is_active !== false,
      rider.last_lat != null ? Number(rider.last_lat) : null,
      rider.last_lng != null ? Number(rider.last_lng) : null,
      rider.last_location_at || null,
      JSON.stringify(rider.last_location || {}),
      JSON.stringify(data),
      created_at,
      updated_at
    ];

    return await queryOne(clientOrDb, sql, params);
  },

  async update(id, updates = {}, clientOrDb = null) {
    const rawId = extractId(id);
    const sets = ['updated_at = NOW()'];
    const params = [rawId];

    for (const [k, v] of Object.entries(updates)) {
      if (['id', '_id', 'updated_at'].includes(k)) continue;
      if (k === 'full_name' || k === 'name') {
        params.push(v);
        sets.push(`full_name = $${params.length}, name = $${params.length}`);
        continue;
      }
      if (k === 'plate_no' || k === 'vehicle_plate') {
        params.push(v);
        sets.push(`plate_no = $${params.length}, vehicle_plate = $${params.length}`);
        continue;
      }
      if (k === 'is_available') {
        params.push(Boolean(v));
        sets.push(`is_available = $${params.length}`);
        if (!updates.status) {
          sets.push(`status = CASE WHEN $${params.length} THEN 'available' ELSE 'offline' END`);
        }
        continue;
      }
      if (k === 'last_location' && typeof v === 'object' && v !== null) {
        if (v.lat != null) {
          params.push(Number(v.lat));
          sets.push(`last_lat = $${params.length}`);
        }
        if (v.lng != null) {
          params.push(Number(v.lng));
          sets.push(`last_lng = $${params.length}`);
        }
        params.push(v.occurred_at || new Date());
        sets.push(`last_location_at = $${params.length}`);
        params.push(JSON.stringify(v));
        sets.push(`last_location = $${params.length}::jsonb`);
        continue;
      }
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }

    const sql = `
      UPDATE riders
      SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, params);
  },

  async delete(id, clientOrDb = null) {
    const rawId = extractId(id);
    return await queryOne(clientOrDb, `UPDATE riders SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`, [rawId]);
  }
};
