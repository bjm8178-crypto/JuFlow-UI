import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSale } from '../src/lib/sale.js';
import { businessDate, dateStart, reportRange } from '../src/lib/business-date.js';
import { validateRefund } from '../src/routes/sales.js';
import { notifySale } from '../src/services/notifications.js';

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

test('refund input: needs event_id, reason and something to return', () => {
  const ok = { event_id: 'e1', reason: 'Wrong food', items: [{ index: 0, quantity: 1 }] };
  assert.deepEqual(validateRefund(ok), { event_id: 'e1', reason: 'Wrong food', items: [{ index: 0, quantity: 1 }], refund_fee: false });
  assert.equal(validateRefund({ ...ok, items: [], refund_fee: true }).refund_fee, true);
  for (const bad of [
    { ...ok, event_id: '' }, { ...ok, reason: '  ' }, { ...ok, items: [] },
    { ...ok, items: [{ index: 0, quantity: 0 }] }, { ...ok, items: [{ index: -1, quantity: 1 }] },
    { ...ok, items: [{ index: 0, quantity: 1.5 }] },
    { ...ok, items: [{ index: 0, quantity: 1 }, { index: 0, quantity: 1 }] }, null, []
  ]) assert.throws(() => validateRefund(bad), error => error.status === 400);
});

test('admin notification text for delivery, walk-in and return', async () => {
  const saved = [];
  const db = { collection: () => ({ insertOne: async doc => { saved.push(doc); } }) };
  await notifySale(db, { source: 'order', items: [{ quantity: 2 }], total_centavos: 25000 });
  await notifySale(db, { source: 'walk_in', items: [{ quantity: 1 }], total_centavos: 7500 });
  await notifySale(db, { source: 'refund', items: [{ quantity: -1 }], total_centavos: -7500 });
  assert.deepEqual(saved.map(n => n.type), ['sale', 'sale', 'refund']);
  assert.match(saved[0].body, /Delivery · 2 items · ₱250\.00/);
  assert.match(saved[1].body, /Walk-in · 1 item · ₱75\.00/);
  assert.match(saved[2].body, /Return · 1 item · ₱75\.00/);
  assert.equal(saved[2].title, 'Items returned');
});
