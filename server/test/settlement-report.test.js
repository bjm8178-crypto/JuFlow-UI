import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { validateSale } from '../src/lib/sale.js';
import { businessDate, dateStart, reportRange } from '../src/lib/business-date.js';
import { settleOrder } from '../src/services/settlement.js';

const now = new Date('2026-10-12T07:00:00Z');
const input = () => ({ transaction_id: 'stable', items: [{ name: 'Food', quantity: 2, price_centavos: 100 }], fee_centavos: 30, total_centavos: 230, payment_method: 'cash' });
test('sales require stable IDs and include association, occurrence and fees in digest', () => {
  const a = input();
  assert.throws(() => validateSale({ ...a, transaction_id: undefined }));
  const original = validateSale(a, { now });
  assert.equal(original.sale.food_centavos, 200);
  assert.equal(original.sale.cash_tendered_centavos, 230);
  for (const change of [{ order_id: 'a'.repeat(24) }, { occurred_at: now.toISOString() }, { fee_centavos: 40, total_centavos: 240 }]) assert.notEqual(original.digest, validateSale({ ...a, ...change }, { now }).digest);
});
test('UTC occurrence rejects rollover, offsets, excessive future and backdating', () => {
  for (const occurred_at of ['2026-02-30T00:00:00Z', '2026-10-12T24:00:00Z', '2026-10-12T07:00:00+00:00', '2026-10-12T07:05:01Z', '2026-10-05T06:59:59Z']) assert.throws(() => validateSale({ ...input(), occurred_at }, { now }));
  validateSale({ ...input(), occurred_at: '2026-10-05T07:00:00Z' }, { now });
  assert.throws(() => validateSale({ ...input(), occurred_at: '2026-10-11T07:00:00Z' }, { now, allowBackdating: false }));
});
test('Manila calendar dates and selected-month/seven-day bounds are real and bounded', () => {
  assert.equal(businessDate(new Date('2026-10-11T16:00:00Z')), '2026-10-12');
  assert.equal(dateStart('2024-02-29').toISOString(), '2024-02-28T16:00:00.000Z');
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01']) assert.throws(() => dateStart(value));
  const r = reportRange({ date: '2025-02-10' }, now);
  assert.equal(r.monthStart.toISOString(), '2025-01-31T16:00:00.000Z');
  assert.equal(r.monthEnd.toISOString(), '2025-02-10T16:00:00.000Z');
  assert.equal(r.weekEnd - r.weekStart, 7 * 86400000);
  assert.throws(() => reportRange({ from: '2026-10-12', to: '2026-10-10' }, now));
});
function setup(method = 'cash') {
  const session = {}, calls = [];
  const order = { _id: new ObjectId(), items: [{ name: 'Food', quantity: 2, unit_price_centavos: 100 }], fee_centavos: 30, total_centavos: 230, payment_method: method, payment_reference: 'REF', cash_tendered_centavos: 300 };
  const db = { collection: () => ({ findOne: async (q, options) => { calls.push(options); return null; }, insertOne: async (s, options) => { calls.push(options); return { insertedId: new ObjectId() }; } }) };
  return { db, session, order, actor: { id: String(new ObjectId()), role_name: 'cashier' }, eventId: 'event', reconciliation: { amount_centavos: 230, cash_tendered_centavos: 300 }, now, calls };
}
test('settlement uses caller session, exact money and cashier attribution', async () => {
  const s = setup();
  const sale = await settleOrder(s);
  assert.equal(sale.food_centavos, 200); assert.equal(sale.fee_centavos, 30);
  assert.equal(sale.order_id, s.order._id); assert.equal(String(sale.recorded_by), s.actor.id);
  assert.ok(s.calls.every(o => o.session === s.session));
  await assert.rejects(settleOrder({ ...s, actor: { ...s.actor, role_name: 'admin' } }));
  await assert.rejects(settleOrder({ ...s, session: null }));
  await assert.rejects(settleOrder({ ...s, reconciliation: { amount_centavos: 229 } }));
  await assert.rejects(settleOrder({ ...s, reconciliation: { amount_centavos: 230, cash_tendered_centavos: 229 } }));
});
test('GCash settlement is explicit recorded verification, never provider proof', async () => {
  const s = setup('gcash');
  await assert.rejects(settleOrder(s));
  await assert.rejects(settleOrder({ ...s, reconciliation: { amount_centavos: 230, verified: true, payment_reference: 'wrong' } }));
  const sale = await settleOrder({ ...s, reconciliation: { amount_centavos: 230, verified: true, payment_reference: 'REF' } });
  assert.equal(sale.verification.provider_verified, false);
  assert.equal(sale.verification.verified, true);
});
test('existing order settlement cannot insert a second sale', async () => {
  const s = setup();
  s.db = { collection: () => ({ findOne: async () => ({ _id: new ObjectId() }), insertOne: async () => assert.fail('duplicate insert') }) };
  await assert.rejects(settleOrder(s), e => e.status === 409);
});
