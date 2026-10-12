import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../workflow.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const customer = { _id: 'customer-1', name: 'Customer', phone: '123', address: 'Doorstep', lat: null, lng: null };
const order = { _id: 'order-1', order_number: 'JU-1001', customer_id: customer._id, customer, created_at: '2026-10-12T00:00:00Z', status: 'on_the_way', version: 3, items: [{ name: 'Meal', quantity: 2, price_centavos: 15000 }], fee_centavos: 1000, total_centavos: 31000, payment_method: 'gcash' };

function fixture(page = 'customers', request = async endpoint => endpoint === '/customers' ? [customer] : []) {
  const nodes = new Map();
  const items = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', dataset: {}, disabled: false, hidden: false, checked: true, innerHTML: '', listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; }, showModal() { this.open = true; }, close() { this.open = false; }, reset() {}, append(row) { items.push(row); }, querySelector(selector) { return selector === '.form-error' ? node(id + '-error') : null; }, querySelectorAll() { return []; } });
    return nodes.get(id);
  };
  const pageIds = page === 'customers' ? ['customer-list', 'customer-search', 'customer-profile', 'customer-form', 'customer-dialog', 'order-form', 'order-dialog', 'new-customer', 'add-item'] : ['order-list', 'order-filter'];
  pageIds.forEach(node);
  ['workflow-status', 'refresh-records', 'item-rows', 'payment-method', 'delivery-area', 'cash-tendered', 'payment-reference', 'order-notes', 'address-confirm'].forEach(node);
  node('payment-method').value = 'cash'; node('delivery-area').value = 'within_saog'; node('cash-tendered').value = '400'; node('order-filter').value = 'all';
  const calls = [], mapCalls = [];
  let resolveAuth;
  const auth = new Promise(resolve => { resolveAuth = resolve; });
  const window = { JUFLOW_AUTH_READY: auth, location: { origin: 'https://juflow.test' }, Landmarks: { begin() {}, value() { return ''; } }, openCustomerPin(c) { mapCalls.push(c); } };
  const document = {
    querySelector(selector) {
      const id = selector.slice(1);
      if ((id === 'customer-list' && page !== 'customers') || (id === 'order-list' && page !== 'orders')) return null;
      return node(id);
    },
    querySelectorAll(selector) { if (selector === '.item-row') return items; if (selector === '[data-order-error]') return [node('assignment-error')]; return []; },
    createElement() {
      const inputs = [{ value: 'Meal' }, { value: '2' }, { value: '150' }];
      return { className: '', innerHTML: '', querySelector() { return {}; }, querySelectorAll() { return inputs; }, remove() {} };
    }
  };
  vm.runInNewContext(source, { window, document, JuAPI: { async request(endpoint, options) { calls.push({ endpoint, options, body: options?.body ? JSON.parse(options.body) : undefined }); return request(endpoint, options); } }, JuStore: { escape: value => String(value ?? ''), money: value => 'PHP ' + value / 100, read() { throw Error('Business storage forbidden'); }, save() { throw Error('Business storage forbidden'); } }, setInterval() { return 0; }, crypto: { randomUUID: () => '8af2bcb0-0000-4000-8000-000000000001' }, URL });
  return { node, calls, mapCalls, window, resolveAuth, async ready() { resolveAuth({ role_name: 'admin' }); await tick(); await tick(); }, async submit(id) { node(id).onsubmit({ preventDefault() {}, currentTarget: node(id) }); await tick(); await tick(); } };
}

test('all business requests wait for authenticated role and customer history is server-fetched', async () => {
  const app = fixture();
  assert.equal(app.calls.length, 0);
  await app.ready();
  assert.deepEqual(app.calls.map(call => call.endpoint), ['/customers', '/customers/customer-1/orders']);
  assert.match(app.node('customer-profile').innerHTML, /No pin saved/);
  app.node('edit-customer').onclick();
  assert.equal(app.mapCalls[0], null);
});

test('cross-role auth never starts business requests', async () => {
  const app = fixture(); app.resolveAuth({ role_name: 'rider' }); await tick();
  assert.equal(app.calls.length, 0);
  assert.match(app.node('workflow-status').textContent, /administrator or cashier/);
});

test('failed order submission keeps UUID, rejects changed retry and never claims success', async () => {
  let attempts = 0, release;
  const app = fixture('customers', async (endpoint, options) => {
    if (endpoint === '/customers') return [customer];
    if (endpoint === '/orders') {
      attempts++;
      if (attempts === 1) return new Promise((resolve, reject) => { release = () => reject(Error('Network unavailable')); });
      return { ...order, total_centavos: 32000 };
    }
    return [];
  });
  await app.ready(); app.node('create-order').onclick();
  const form = app.node('order-form');
  form.onsubmit({ preventDefault() {}, currentTarget: form });
  await tick();
  assert.equal(form.dataset.busy, 'true');
  form.onsubmit({ preventDefault() {}, currentTarget: form });
  assert.equal(attempts, 1);
  release(); await tick(); await tick();
  assert.match(app.node('order-form-error').textContent, /Network unavailable/);
  assert.equal(app.node('order-dialog').open, true);
  assert.doesNotMatch(app.node('workflow-status').textContent, /Order JU-1001 saved/);
  app.node('order-notes').value = 'Changed'; await app.submit('order-form');
  assert.equal(attempts, 1);
  assert.match(app.node('order-form-error').textContent, /uncertain result/);
  app.node('order-notes').value = ''; await app.submit('order-form');
  const posts = app.calls.filter(call => call.endpoint === '/orders');
  assert.equal(posts.length, 2); assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal(posts[0].body.delivery_area, 'within_saog');
  assert.equal(posts[0].body.fee_centavos, 2000);
  assert.equal(posts[0].body.items[0].price_centavos, 15000);
  assert.equal(posts[0].body.customer_id, customer._id);
  assert.equal(posts[0].body.total_centavos, undefined);
  assert.match(app.node('workflow-status').textContent, /Confirmed total PHP 320/);
});

test('GCash requires reference before posting an order', async () => {
  const app = fixture(); await app.ready(); app.node('create-order').onclick();
  app.node('payment-method').value = 'gcash'; await app.submit('order-form');
  assert.equal(app.calls.filter(call => call.endpoint === '/orders').length, 0);
  assert.match(app.node('order-form-error').textContent, /GCash payment reference/);
});

test('customer PATCH failures leave dialog open and display server validation error', async () => {
  const app = fixture('customers', async (endpoint, options) => {
    if (endpoint === '/customers') return [customer];
    if (options?.method === 'PATCH') throw Error('Phone is invalid');
    return [];
  });
  await app.ready(); app.node('edit-customer').onclick(); await app.submit('customer-form');
  const update = app.calls.find(call => call.options?.method === 'PATCH');
  assert.equal(update.endpoint, '/customers/customer-1');
  assert.match(app.node('customer-form-error').textContent, /Phone is invalid/);
  assert.equal(app.node('customer-dialog').open, true);
  assert.notEqual(app.node('customer-form').dataset.busy, 'true');
  assert.doesNotMatch(app.node('workflow-status').textContent, /Customer saved/);
});

test('history outage is distinguishable from empty history and can be retried', async () => {
  let unavailable = true;
  const app = fixture('customers', async endpoint => {
    if (endpoint === '/customers') return [customer];
    if (unavailable) throw Error('History unavailable');
    return [order];
  });
  await app.ready();
  assert.match(app.node('customer-profile').innerHTML, /Could not load history: History unavailable/);
  assert.doesNotMatch(app.node('customer-profile').innerHTML, /No orders yet/);
  unavailable = false; await app.node('retry-history').onclick();
  assert.match(app.node('customer-profile').innerHTML, /JU-1001/);
  assert.match(app.node('customer-profile').innerHTML, /On the way/);
});

test('customer errors remain visible and photo data is never included in customer JSON', async () => {
  const app = fixture('customers', async (endpoint, options) => {
    if (endpoint === '/customers' && !options) return [customer];
    if (endpoint === '/customers' && options) return { ...customer, _id: 'new-customer' };
    if (endpoint.endsWith('/landmark')) throw Error('Upload failed');
    return [];
  });
  await app.ready(); app.node('new-customer').onclick();
  for (const [id, value] of Object.entries({ 'customer-name': 'New', phone: '123', address: 'Door', lat: '', lng: '' })) app.node(id).value = value;
  app.window.Landmarks.value = () => 'data:image/jpeg;base64,aGVsbG8=';
  await app.submit('customer-form');
  const create = app.calls.find(call => call.endpoint === '/customers' && call.options);
  assert.equal(create.body.lat, null); assert.equal(create.body.lng, null);
  assert.doesNotMatch(JSON.stringify(create.body), /data:|landmarkPhoto|landmark_photo/);
  assert.equal(app.node('customer-id').value, 'new-customer');
  assert.equal(app.node('customer-dialog').open, true);
  assert.match(app.node('customer-form-error').textContent, /details saved.*photo was not confirmed/);
});

test('admin orders page shows the three-step status and never offers rider assignment', async () => {
  const app = fixture('orders', async endpoint => {
    if (endpoint.startsWith('/orders?')) return [order, { ...order, _id: 'order-2', order_number: 'JU-1002', status: 'preparing' }, { ...order, _id: 'order-3', order_number: 'JU-1003', status: 'delivered' }];
    throw Error('Unexpected request ' + endpoint);
  });
  await app.ready();
  const html = app.node('order-list').innerHTML;
  assert.match(html, /Preparing/); assert.match(html, /On the way/); assert.match(html, /Delivered/);
  assert.doesNotMatch(html, /Assign rider|<select/);
  assert.equal(app.calls.some(call => call.endpoint === '/riders' || call.endpoint.endsWith('/actions')), false);
});

test('owned pages load API before guard/controller and have reference/status controls', async () => {
  for (const name of ['customers', 'orders']) {
    const html = await readFile(new URL(`../${name}.html`, import.meta.url), 'utf8');
    assert.ok(html.indexOf('src="api.js"') < html.indexOf('src="/auth-guard.js"'));
    assert.ok(html.indexOf('src="api.js"') < html.indexOf('src="workflow.js"'));
    assert.match(html, /id="workflow-status"/); assert.match(html, /id="refresh-records"/);
    if (name === 'customers') assert.match(html, /id="payment-reference"/);
  }
  assert.doesNotMatch(source, /JuStore\.(read|save)|\bS\.(read|save)/);
});
