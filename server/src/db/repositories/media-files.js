import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId } from './base.js';

export const mediaFilesRepo = {
  async findById(id, clientOrDb = null) {
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM media_files WHERE id = $1`, [rawId]);
  },

  async create(file, clientOrDb = null) {
    const id = extractId(file.id || file._id) || newId();
    const now = new Date();
    const metadata = file.metadata || {};
    const sql = `
      INSERT INTO media_files (
        id, filename, content_type, size, bytes, metadata, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9
      )
      RETURNING *
    `;
    const params = [
      id,
      file.filename || 'landmark.jpg',
      file.content_type || 'image/jpeg',
      Number(file.size || file.bytes?.length || 0),
      file.bytes,
      JSON.stringify(metadata),
      JSON.stringify(file.data || metadata),
      now,
      now
    ];
    return await queryOne(clientOrDb, sql, params);
  },

  async activate(id, customerId, clientOrDb = null) {
    const rawId = extractId(id);
    const rawCustId = extractId(customerId);
    const sql = `
      UPDATE media_files
      SET metadata = jsonb_set(metadata, '{state}', '"ready"'),
          updated_at = NOW()
      WHERE id = $1 AND metadata->>'customer_id' = $2 AND metadata->>'state' = 'pending'
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [rawId, rawCustId]);
  },

  async delete(id, clientOrDb = null) {
    const rawId = extractId(id);
    return await execute(clientOrDb, `DELETE FROM media_files WHERE id = $1`, [rawId]);
  }
};
