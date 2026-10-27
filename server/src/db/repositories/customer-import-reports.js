import { query, queryOne, execute, normalizeRow, getExecutor, extractId } from './base.js';

export const customerImportReportsRepo = {
  async findById(id, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      return await clientOrDb.collection('customer_import_reports').findOne({ _id: id }, options);
    }
    const rawId = extractId(id);
    if (!rawId) return null;
    return await queryOne(clientOrDb, `SELECT * FROM customer_import_reports WHERE id = $1`, [rawId]);
  },

  async create(report, clientOrDb = null, options = {}) {
    if (typeof clientOrDb?.collection === 'function' && typeof clientOrDb?.query !== 'function') {
      await clientOrDb.collection('customer_import_reports').insertOne(report, options);
      return report;
    }
    const id = report.id || report._id;
    const now = report.created_at || new Date();
    const sql = `
      INSERT INTO customer_import_reports (
        id, report_id, digest, preview_digest, created_by, imported_count, mapping, skipped, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $9
      )
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [
      id,
      report.report_id || id,
      report.digest,
      report.preview_digest,
      String(report.created_by),
      Number(report.imported_count || 0),
      JSON.stringify(report.mapping || []),
      JSON.stringify(report.skipped || []),
      now
    ]);
  }
};
