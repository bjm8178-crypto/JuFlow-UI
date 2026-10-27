import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId } from './base.js';

export const deliveryZonesRepo = {
  async findById(id, clientOrDb = null) {
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM delivery_zones WHERE id = $1`, [rawId]);
  },

  async find(filter = {}, options = {}, clientOrDb = null) {
    const params = [];
    const clauses = [];

    if (filter.is_active !== undefined) {
      if (filter.is_active === true || filter.is_active?.$ne === false) {
        clauses.push(`COALESCE(is_active, true) IS NOT FALSE`);
      } else if (filter.is_active === false) {
        clauses.push(`is_active = false`);
      }
    }

    if (filter._id || filter.id) {
      params.push(extractId(filter._id || filter.id));
      clauses.push(`id = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    let sortClause = 'ORDER BY sort_order ASC, name ASC';
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

    const sql = `SELECT * FROM delivery_zones ${where} ${sortClause}`;
    return await query(clientOrDb, sql, params);
  },

  async create(zone, clientOrDb = null) {
    const id = extractId(zone.id || zone._id) || newId();
    const now = new Date();
    const created_at = zone.created_at || now;
    const updated_at = zone.updated_at || now;

    const sql = `
      INSERT INTO delivery_zones (
        id, name, fee_centavos, estimated_minutes, sort_order, is_active, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9
      )
      RETURNING *
    `;

    const params = [
      id,
      zone.name || null,
      Number(zone.fee_centavos || 0),
      Number(zone.estimated_minutes || 30),
      Number(zone.sort_order || 0),
      zone.is_active !== false,
      JSON.stringify(zone.data || {}),
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
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }

    const sql = `
      UPDATE delivery_zones
      SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, params);
  },

  async delete(id, clientOrDb = null) {
    const rawId = extractId(id);
    return await queryOne(clientOrDb, `UPDATE delivery_zones SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`, [rawId]);
  }
};
