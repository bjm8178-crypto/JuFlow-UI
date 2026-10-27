import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId } from './base.js';

export const notificationsRepo = {
  async find(options = {}, clientOrDb = null) {
    const limit = Number.isSafeInteger(Number(options.limit)) ? Number(options.limit) : 50;
    const sql = `SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1`;
    return await query(clientOrDb, sql, [limit]);
  },

  async countUnread(clientOrDb = null) {
    const res = await queryOne(clientOrDb, `SELECT COUNT(*)::int AS count FROM notifications WHERE read = false`);
    return res ? Number(res.count) : 0;
  },

  async create(notification, clientOrDb = null) {
    const id = extractId(notification.id || notification._id) || newId();
    const now = new Date();
    const created_at = notification.created_at || now;
    const updated_at = notification.updated_at || now;

    const title = notification.title || '';
    const body = notification.body || notification.message || '';
    const type = notification.type || 'info';

    const sql = `
      INSERT INTO notifications (
        id, type, title, body, read, data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8
      )
      RETURNING *
    `;

    const params = [
      id,
      type,
      title,
      body,
      Boolean(notification.read || notification.is_read),
      JSON.stringify(notification.data || {}),
      created_at,
      updated_at
    ];

    return await queryOne(clientOrDb, sql, params);
  },

  async markAllRead(clientOrDb = null) {
    return await execute(clientOrDb, `UPDATE notifications SET read = true, updated_at = NOW() WHERE read = false`);
  },

  async markRead(id, clientOrDb = null) {
    const rawId = extractId(id);
    return await queryOne(clientOrDb, `UPDATE notifications SET read = true, updated_at = NOW() WHERE id = $1 RETURNING *`, [rawId]);
  }
};
