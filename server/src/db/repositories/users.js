import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId } from './base.js';

export const usersRepo = {
  async findById(id, clientOrDb = null) {
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM users WHERE id = $1`, [rawId]);
  },

  async findByUsername(username, clientOrDb = null) {
    if (!username) return null;
    return await queryOne(clientOrDb, `SELECT * FROM users WHERE username = $1`, [username.trim()]);
  },

  async findByEmail(email, clientOrDb = null) {
    if (!email) return null;
    return await queryOne(clientOrDb, `SELECT * FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
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

    if (filter.role_id !== undefined) {
      params.push(String(filter.role_id));
      clauses.push(`role_id = $${params.length}`);
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

    const sql = `SELECT * FROM users ${where} ${sortClause} ${limitClause}`;
    return await query(clientOrDb, sql, params);
  },

  async create(user, clientOrDb = null) {
    const id = extractId(user.id || user._id) || newId();
    const now = new Date();
    const created_at = user.created_at || now;
    const updated_at = user.updated_at || now;

    const data = { ...(user.data || {}) };
    for (const [k, v] of Object.entries(user)) {
      if (['id', '_id', 'username', 'email', 'phone', 'role_id', 'password_hash',
           'full_name', 'is_active', 'failed_attempts', 'locked_until', 'last_login_at',
           'created_at', 'updated_at', 'data'].includes(k)) continue;
      data[k] = v;
    }

    const sql = `
      INSERT INTO users (
        id, username, email, phone, role_id, password_hash, full_name,
        is_active, failed_attempts, locked_until, last_login_at, data,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::jsonb,
        $13, $14
      )
      RETURNING *
    `;

    const params = [
      id,
      user.username ? user.username.trim() : null,
      user.email ? user.email.trim().toLowerCase() : null,
      user.phone || null,
      user.role_id != null ? String(user.role_id) : '2',
      user.password_hash || null,
      user.full_name || null,
      user.is_active !== false,
      Number(user.failed_attempts || 0),
      user.locked_until || null,
      user.last_login_at || null,
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
      if (k === 'email') {
        params.push(v ? v.trim().toLowerCase() : null);
        sets.push(`email = $${params.length}`);
        continue;
      }
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }

    const sql = `
      UPDATE users
      SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, params);
  },

  async delete(id, clientOrDb = null) {
    const rawId = extractId(id);
    return await queryOne(clientOrDb, `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`, [rawId]);
  }
};
