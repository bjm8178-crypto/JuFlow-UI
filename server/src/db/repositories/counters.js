import { query, queryOne, execute, normalizeRow, getExecutor } from './base.js';

export const countersRepo = {
  async getNext(id = 'order_number', clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      const result = await clientOrDb.collection('counters').findOneAndUpdate(
        { _id: id }, { $inc: { seq: 1 } }, { returnDocument: 'after' }
      );
      return result ? Number(result.seq) : 1001;
    }
    const res = await queryOne(
      clientOrDb,
      `UPDATE counters SET seq = seq + 1, updated_at = NOW() WHERE id = $1 RETURNING seq`,
      [id]
    );
    if (res && res.seq != null) {
      return Number(res.seq);
    }
    await this.init(id, 1000, clientOrDb);
    const retry = await queryOne(
      clientOrDb,
      `UPDATE counters SET seq = seq + 1, updated_at = NOW() WHERE id = $1 RETURNING seq`,
      [id]
    );
    return Number(retry?.seq ?? 1001);
  },

  async init(id = 'order_number', minSeq = 1000, clientOrDb = null) {
    const sql = `
      INSERT INTO counters (id, seq, data, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET seq = GREATEST(counters.seq, EXCLUDED.seq),
          updated_at = NOW()
      RETURNING seq
    `;
    return await queryOne(clientOrDb, sql, [id, minSeq, JSON.stringify({ seq: minSeq })]);
  }
};
