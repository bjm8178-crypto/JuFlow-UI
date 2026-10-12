import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import customers from '../src/routes/customers.js';
import settings from '../src/routes/settings.js';
import zones from '../src/routes/delivery-zones.js';
import { validateCustomer, validateZone, validId, listOptions } from '../src/lib/customer.js';
import { validateSetting } from '../src/lib/settings.js';
import { DELIVERY_AREAS, getDeliveryArea } from '../src/lib/delivery-areas.js';

const customer = { name: ' Jane ', phone: ' 0917 ', address: ' Main Street ' };
const bad = fn => assert.throws(fn, error => error.status === 400);

test('customer create and update share bounded, trimmed string validation', () => {
  assert.equal(validateCustomer(customer).name, 'Jane');
  assert.deepEqual(validateCustomer({ messenger: '  ' }, true), { messenger: null });
  for (const body of [null, [], 'x', 3, { ...customer, extra: 1 }, { ...customer, name: {} }, { ...customer, phone: ' ' }, { ...customer, address: 'x'.repeat(1001) }]) bad(() => validateCustomer(body));
  for (const body of [{}, { name: '' }, { phone: [] }, { is_active: 'false' }, { messenger: 3 }, { landmark: {} }]) bad(() => validateCustomer(body, true));
  assert.deepEqual(validateCustomer({ is_active: false }, true), { is_active: false });
});

test('customer coordinates require finite complete pairs and media is reserved', () => {
  for (const body of [{ lat: 1 }, { lng: 1 }, { lat: null, lng: 1 }, { lat: NaN, lng: 1 }, { lat: Infinity, lng: 1 }, { lat: '1', lng: 1 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }]) {
    bad(() => validateCustomer({ ...customer, ...body }));
    bad(() => validateCustomer(body, true));
  }
  assert.deepEqual(validateCustomer({ lat: null, lng: null }, true), { lat: null, lng: null });
  assert.deepEqual(validateCustomer({ lat: -90, lng: 180 }, true), { lat: -90, lng: 180 });
  for (const photo of ['https://example.com/photo.jpg', 'data:image/png;base64,abc', '/uploads/a.png', {}, 123]) bad(() => validateCustomer({ landmark_photo: photo }, true));
  assert.equal(validateCustomer({ landmark_photo: null }, true).landmark_photo, null);
});

test('Saog delivery areas are exactly Within Saog at ₱20 and Outside Saog at ₱50', () => {
  assert.deepEqual(DELIVERY_AREAS.map(({ _id, name, fee_centavos }) => ({ _id, name, fee_centavos })), [
    { _id: 'within_saog', name: 'Within Saog', fee_centavos: 2000 },
    { _id: 'outside_saog', name: 'Outside Saog', fee_centavos: 5000 }
  ]);
  assert.equal(getDeliveryArea('within_saog').fee_centavos, 2000);
  assert.equal(getDeliveryArea('outside_saog').fee_centavos, 5000);
  assert.equal(getDeliveryArea('Iligan Zone 1'), null);
});

test('zone creates and updates validate the same fields and preserve zero', () => {
  assert.deepEqual(validateZone({ name: ' A ', fee_centavos: 0, estimated_minutes: 0, sort_order: 0 }), { name: 'A', fee_centavos: 0, min_order_centavos: 0, estimated_minutes: 0, sort_order: 0, is_active: true });
  for (const key of ['fee_centavos', 'min_order_centavos', 'estimated_minutes', 'sort_order']) {
    for (const value of [NaN, Infinity, -1, 0.5, '10', null, Number.MAX_SAFE_INTEGER + 1]) {
      bad(() => validateZone({ name: 'A', fee_centavos: 0, [key]: value }));
      bad(() => validateZone({ [key]: value }, true));
    }
  }
  for (const body of [null, [], {}, { name: {} }, { is_active: 1 }, { lat: 1, lng: 2 }]) bad(() => validateZone(body, true));
});

test('IDs, literal search and pagination reject coercion and query objects', () => {
  assert.equal(validId('a'.repeat(24)), 'a'.repeat(24));
  for (const id of ['bad', 'g'.repeat(24), 'a'.repeat(25), null, {}]) bad(() => validId(id));
  const escaped = listOptions({ search: ' .*+[x](a)?$^|\\ ', limit: '20', page: '2' });
  assert.equal(escaped.skip, 20);
  assert.equal(new RegExp(escaped.search).test('.*+[x](a)?$^|\\'), true);
  assert.equal(new RegExp(escaped.search).test('unrelated'), false);
  for (const query of [{ search: {} }, { search: ['a'] }, { search: 'a'.repeat(201) }, { limit: '0' }, { limit: '201' }, { limit: '1.5' }, { limit: ['1'] }, { offset: '-1' }, { offset: '1000001' }, { page: '10002' }]) bad(() => listOptions(query));
});

test('settings use concrete typed keys, including seeded compatibility keys', () => {
  for (const key of ['shop_name', 'shop_phone', 'business_name', 'business_phone', 'business_address']) {
    assert.equal(validateSetting(key, { value: ' A ' }).value, 'A');
    bad(() => validateSetting(key, { value: {} }));
    bad(() => validateSetting(key, { value: ' ' }));
  }
  for (const [key, bound] of [['shop_lat', 90], ['shop_latitude', 90], ['shop_lng', 180], ['shop_longitude', 180]]) {
    assert.equal(validateSetting(key, { value: bound }).value, bound);
    assert.equal(validateSetting(key, { value: null }).value, null);
    for (const value of [NaN, Infinity, bound + 1, '14.763649', {}, undefined]) bad(() => validateSetting(key, { value }));
  }
  for (const key of ['timezone', 'business_timezone']) {
    assert.equal(validateSetting(key, { value: 'Asia/Manila' }).value, 'Asia/Manila');
    bad(() => validateSetting(key, { value: 'UTC' }));
  }
  for (const key of ['test_mode', 'require_gcash_proof']) {
    assert.equal(validateSetting(key, { value: false }).value, false);
    bad(() => validateSetting(key, { value: 'false' }));
  }
  assert.deepEqual(validateSetting('payment_methods', { value: [' cash ', 'gcash', 'exact'] }).value, ['cash', 'gcash', 'exact']);
  for (const value of [[], {}, ['cash', ' cash '], ['bitcoin'], [false], Array(4).fill('cash')]) bad(() => validateSetting('payment_methods', { value }));
  for (const body of [null, [], {}, { value: 'A', unknown: 1 }, { value: 'A', description: {} }, { value: 'A', group_name: ['general'] }]) bad(() => validateSetting('shop_name', body));
  bad(() => validateSetting('arbitrary_secret', { value: 'A' }));
  bad(() => validateSetting('tax_rate', { value: Infinity }));
  assert.equal(validateSetting('tax_rate', { value: 12 }).value, 12);
  assert.equal(validateSetting('currency', { value: 'PHP' }).value, 'PHP');
});

test('real route handlers return HTTP 400 for malformed bodies before database access', async () => {
  // Install the actual final route handlers with a trusted-user fixture. Auth is
  // independently tested elsewhere; malformed writes must never reach MongoDB.
  const app = express();
  app.use(express.json({ strict: false }));
  app.use((req, res, next) => { req.user = { id: 'a'.repeat(24), role_name: 'admin' }; next(); });
  for (const [prefix, router] of [['/customers', customers], ['/settings', settings], ['/zones', zones]]) {
    for (const layer of router.stack.filter(layer => layer.route)) {
      const route = layer.route;
      const handler = route.stack.at(-1).handle;
      for (const method of Object.keys(route.methods)) app[method](prefix + (route.path === '/' ? '' : route.path), handler);
    }
  }
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.code || 'error' }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [method, path, body] of [
      ['POST', '/customers', null], ['POST', '/customers', []], ['POST', '/customers', { ...customer, name: {} }],
      ['PATCH', '/customers/' + 'a'.repeat(24), { lat: 1 }], ['PATCH', '/customers/bad', { name: 'A' }],
      ['POST', '/zones', { name: 'A', fee_centavos: 1.5 }], ['PATCH', '/zones/' + 'a'.repeat(24), { is_active: 'false' }],
      ['PUT', '/settings/shop_lat', { value: '14' }], ['PUT', '/settings/shop_name', null], ['PUT', '/settings/unknown', { value: 'x' }]
    ]) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400, `${method} ${path}`);
    }
    for (const path of ['/customers/bad', '/customers/bad/orders', '/zones/bad', '/customers?search[x]=a', '/zones?limit=201', '/settings?group[x]=a']) {
      assert.equal((await fetch(base + path)).status, 400, path);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
