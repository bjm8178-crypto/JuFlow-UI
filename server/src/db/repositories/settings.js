import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId } from './base.js';

export const settingsRepo = {
  async findByKey(key, clientOrDb = null) {
    if (!key) return null;
    return await queryOne(clientOrDb, `SELECT * FROM settings WHERE key = $1`, [key]);
  },

  async findAll(clientOrDb = null) {
    return await query(clientOrDb, `SELECT * FROM settings ORDER BY key ASC`);
  },

  async set(key, value, clientOrDb = null) {
    const id = `set_${key}`;
    const valueJson = JSON.stringify(value);
    const sql = `
      INSERT INTO settings (id, key, value, data, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $3::jsonb, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          data = EXCLUDED.data,
          updated_at = NOW()
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [id, key, valueJson]);
  }
};
