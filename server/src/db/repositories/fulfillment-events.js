import { query, queryOne, execute, normalizeRow, getExecutor } from './base.js';

export const fulfillmentEventsRepo = {
  async findById(id, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('fulfillment_events').findOne({ _id: id });
    }
    if (!id) return null;
    return await queryOne(clientOrDb, `SELECT * FROM fulfillment_events WHERE id = $1`, [id]);
  },

  async create(event, clientOrDb = null) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      await clientOrDb.collection('fulfillment_events').insertOne(event);
      return event;
    }
    const id = event.id || event._id;
    const now = event.created_at || new Date();
    const sql = `
      INSERT INTO fulfillment_events (id, request_digest, result, data, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $5)
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [
      id,
      event.request_digest || null,
      JSON.stringify(event.result || {}),
      JSON.stringify(event.data || {}),
      now
    ]);
  }
};
