import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId } from './base.js';

export const auditEventsRepo = {
  async create(event, clientOrDb = null) {
    const id = extractId(event.id || event._id) || newId();
    const now = event.created_at || new Date();
    const sql = `
      INSERT INTO audit_events (
        id, event_id, entity_type, entity_id, action, actor, details, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10
      )
      RETURNING *
    `;
    const params = [
      id,
      event.event_id || null,
      event.entity_type || null,
      extractId(event.entity_id) || null,
      event.action || null,
      typeof event.actor === 'object' && event.actor ? (event.actor.id || event.actor.username) : String(event.actor || ''),
      JSON.stringify(event.details || event.diff || {}),
      JSON.stringify(event.data || event),
      now,
      now
    ];
    return await queryOne(clientOrDb, sql, params);
  }
};
