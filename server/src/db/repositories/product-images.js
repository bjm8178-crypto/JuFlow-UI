import { query, queryOne, execute, normalizeRow, getExecutor, extractId, toObjectId } from './base.js';

export const productImagesRepo = {
  async findById(id, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return (await clientOrDb.collection('product_images').findOne({ _id: toObjectId(id) })) ||
             (await clientOrDb.collection('product_images').findOne({ _id: id }));
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM product_images WHERE id = $1`, [rawId]);
  },

  async upsert(id, contentType, buffer, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const { Binary } = await import('mongodb');
      return await clientOrDb.collection('product_images').updateOne(
        { _id: toObjectId(id) },
        { $set: { content_type: contentType, data: new Binary(buffer), updated_at: new Date() } },
        { upsert: true }
      );
    }
    const rawId = extractId(id);
    const sql = `
      INSERT INTO product_images (id, content_type, data, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET content_type = EXCLUDED.content_type,
          data = EXCLUDED.data,
          updated_at = NOW()
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [rawId, contentType, buffer]);
  },

  async delete(id, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('product_images').deleteOne({ _id: toObjectId(id) });
    }
    const rawId = extractId(id);
    return await queryOne(clientOrDb, `DELETE FROM product_images WHERE id = $1 RETURNING *`, [rawId]);
  }
};
