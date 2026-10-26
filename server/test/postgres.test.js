import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId, toObjectId, timestamps, updateTimestamp, normalizeRow } from '../src/db/postgres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('PostgreSQL Adapter - ObjectId compatibility', async (t) => {
  await t.test('generates valid 24-character hex ID by default', () => {
    const id = new ObjectId();
    assert.match(id.toString(), /^[a-f\d]{24}$/i);
    assert.equal(id.toString().length, 24);
  });

  await t.test('wraps existing 24-char hex string accurately', () => {
    const hex = '6ac4567b7c67de33e8135b09';
    const id = new ObjectId(hex);
    assert.equal(id.toString(), hex);
    assert.equal(id.toJSON(), hex);
  });

  await t.test('supports equals comparison between ObjectId and string', () => {
    const hex = '6ac4567b7c67de33e8135b09';
    const id1 = new ObjectId(hex);
    const id2 = new ObjectId(hex);
    assert.equal(id1.equals(id2), true);
    assert.equal(id1.equals(hex), true);
    assert.equal(id1.equals('different'), false);
  });

  await t.test('toObjectId parses valid IDs and rejects junk', () => {
    assert.equal(toObjectId(null), null);
    assert.equal(toObjectId(undefined), null);
    assert.equal(toObjectId('invalid'), null);
    const valid = '6ac4567b7c67de33e8135b09';
    const parsed = toObjectId(valid);
    assert.notEqual(parsed, null);
    assert.equal(parsed.toString(), valid);
    // Integer strings like roles ('1', '2', '3')
    const roleId = toObjectId('1');
    assert.notEqual(roleId, null);
    assert.equal(roleId.toString(), '1');
  });
});

test('PostgreSQL Adapter - normalizeRow mapping', async (t) => {
  await t.test('guarantees _id matches id for backward compatibility with UI', () => {
    const row = {
      id: '6accac4017f01a9e16f670a4',
      name: 'Mika',
      phone: '0912345678',
      data: {
        address: 'Marilao, Bulacan',
        landmark: 'Red gate'
      }
    };
    const normalized = normalizeRow(row);
    assert.equal(normalized._id, '6accac4017f01a9e16f670a4');
    assert.equal(normalized.id, '6accac4017f01a9e16f670a4');
    assert.equal(normalized.name, 'Mika');
    assert.equal(normalized.address, 'Marilao, Bulacan');
    assert.equal(normalized.landmark, 'Red gate');
    assert.equal(normalized.data, undefined); // unpacks data JSONB
  });

  await t.test('normalizes numeric role_id', () => {
    const row = { id: 'user_1', username: 'admin', role_id: '1' };
    const normalized = normalizeRow(row);
    assert.equal(normalized.role_id, 1);
  });
});

test('PostgreSQL Schema - schema.sql integrity', async (t) => {
  await t.test('schema.sql file exists and defines all essential tables and indexes', () => {
    const schemaPath = path.join(__dirname, '../src/db/schema.sql');
    assert.equal(fs.existsSync(schemaPath), true);
    const sql = fs.readFileSync(schemaPath, 'utf8');

    const expectedTables = [
      'roles',
      'users',
      'auth_sessions',
      'categories',
      'products',
      'customers',
      'delivery_zones',
      'riders',
      'orders',
      'deliveries',
      'sales',
      'settings',
      'daily_menu',
      'notifications',
      'counters',
      'audit_events',
      'media_files'
    ];

    for (const table of expectedTables) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'), `Missing table ${table}`);
    }

    // Verify key indexes
    assert.match(sql, /idx_users_email_partial/i);
    assert.match(sql, /idx_orders_idempotency_unique/i);
    assert.match(sql, /idx_sales_transaction_id_unique/i);
    assert.match(sql, /idx_sales_order_settlement_unique/i);
  });
});

test('PostgreSQL Timestamps Helper', () => {
  const ts = timestamps();
  assert.ok(ts.created_at instanceof Date);
  assert.ok(ts.updated_at instanceof Date);
  const up = updateTimestamp();
  assert.ok(up.updated_at instanceof Date);
});
