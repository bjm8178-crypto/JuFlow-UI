import { query, queryOne, execute, normalizeRow, getExecutor } from './base.js';

export const integrityGuardsRepo = {
  async findById(id, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('integrity_guards').findOne({ _id: id }, options);
    }
    return await queryOne(clientOrDb, `SELECT * FROM integrity_guards WHERE id = $1`, [id]);
  },

  async increment(id, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('integrity_guards').updateOne(
        { _id: id },
        { $inc: { revision: 1 } },
        { ...options, upsert: true }
      );
    }
    const sql = `
      INSERT INTO integrity_guards (id, revision, created_at, updated_at)
      VALUES ($1, 1, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET revision = integrity_guards.revision + 1,
          updated_at = NOW()
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [id]);
  }
};
