import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
function environment(fetch, pathname = '/dashboard.html') {
  const nodes = new Map();
  const element = () => ({ style: {}, children: [], setAttribute() {}, replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); }, appendChild(child) { nodes.set(child.id, child); } });
  const context = vm.createContext({ fetch, URL, URLSearchParams, console,
    localStorage: { removeItem() { throw new Error('denied'); } },
    document: { documentElement: element(), body: element(), createElement: element, getElementById: id => nodes.get(id) },
    location: { pathname, search: '?filter=active', hash: '#orders', origin: 'https://juflow.test', replace(value) { this.redirect = value; }, reload() {} }
  });
  context.window = context;
  return context;
}
function api(context) {
  vm.runInContext(source('api.js') + '\nwindow.api = JuAPI;', context);
  return context.api;
}

test('cookie requests, storage denial, structured HTTP and network errors', async () => {
  const calls = [];
  const context = environment(async (...args) => { calls.push(args); return response(200, { user: { role_name: 'cashier' }, token: 'legacy' }); });
  const client = api(context);
  await client.login('cashier', 'password');
  await client.request('/orders', { credentials: 'omit' });
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[1][1].credentials, 'same-origin');
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(context.JUFLOW_USER.role_name, 'cashier');
  context.fetch = async () => response(403, { code: 'forbidden', message: 'Not permitted' });
  await assert.rejects(client.request('/orders'), { status: 403, code: 'forbidden', message: 'Not permitted' });
  context.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(client.request('/orders'), { status: 0, code: 'network_unavailable' });
});

test('logout preserves user on invalidation failure and clears after success', async () => {
  const context = environment(async () => response(500, { message: 'Unavailable' }));
  const client = api(context);
  context.JUFLOW_USER = { role_name: 'admin' };
  await assert.rejects(client.logout(), { status: 500 });
  assert.equal(context.JUFLOW_USER.role_name, 'admin');
  context.fetch = async () => response(204, null);
  await client.logout();
  assert.equal(context.JUFLOW_USER, null);
});

test('guard only redirects 401 to login, preserving query and fragment', async () => {
  for (const status of [401, 403, 503, 0]) {
    const context = environment(async () => {
      if (!status) throw new Error('offline');
      return response(status, { message: 'Auth unavailable' });
    });
    vm.runInContext(source('auth-guard.js'), context);
    await assert.rejects(context.JUFLOW_AUTH_READY);
    if (status === 401) assert.equal(context.location.redirect, '/login.html?next=' + encodeURIComponent('/dashboard.html?filter=active#orders'));
    else {
      assert.equal(context.location.redirect, undefined);
      const panel = context.document.getElementById('juflowAuthError');
      assert.equal(panel.children[1].textContent, 'Retry');
      if (status === 403) assert.match(panel.children[0].textContent, /Access denied/);
    }
  }
});

test('role contract and pathname gates', async () => {
  for (const role of ['admin', 'cashier', 'rider']) {
    const context = environment(async () => response(200, { user: { role_name: role } }));
    vm.runInContext(source('auth-guard.js'), context);
    const user = await context.JUFLOW_AUTH_READY;
    if (role === 'admin') assert.equal(user.role_name, role);
    else {
      assert.equal(user, null);
      assert.equal(context.location.redirect, '/' + role + '/');
    }
    const allowed = environment(async () => response(200, { role_name: role }), role === 'admin' ? '/dashboard.html' : '/' + role + '/');
    vm.runInContext(source('auth-guard.js'), allowed);
    assert.equal((await allowed.JUFLOW_AUTH_READY).role_name, role);
  }
});

test('cashier and rider are restricted to their own prefix, including root admin entrypoints', async () => {
  for (const role of ['cashier', 'rider']) {
    const route = `/${role}/`;
    const user = { role_name: role };
    const client = api(environment(async () => response(200, { user })));
    assert.equal(client.defaultRoute(user), route);
    for (const pathname of [`/${role}`, route, `${route}index.html`, `${route}nested/screen.html`]) {
      assert.equal(client.canAccess(pathname, user), true, pathname);
      const context = environment(async () => response(200, { user }), pathname);
      vm.runInContext(source('auth-guard.js'), context);
      assert.equal((await context.JUFLOW_AUTH_READY).role_name, role);
      assert.equal(context.location.redirect, undefined);
    }
    for (const pathname of ['/', '/index.html', '/dashboard.html', '/orders.html', '/users.html', '/sales.html',
      '/customers.html', '/dishes.html', '/delivery-map.html', '/admin.html', '/dashboard-mongo.html',
      '/cashier.html', '/rider.html', `/${role === 'rider' ? 'cashier' : 'rider'}/`, `${route.slice(0, -1)}-other/`,
      `${route}../dashboard.html`, `${route}%2e%2e/dashboard.html`, `${route}..\\dashboard.html`]) {
      assert.equal(client.canAccess(pathname, user), false, pathname);
      const context = environment(async () => response(200, { user }), pathname);
      vm.runInContext(source('auth-guard.js'), context);
      assert.equal(await context.JUFLOW_AUTH_READY, null, pathname);
      assert.equal(context.location.redirect, route, pathname);
      assert.equal(context.document.documentElement.style.visibility, 'hidden');
      assert.equal(context.JUFLOW_USER, undefined);
    }
    assert.equal(client.canAccess(route, { role_name: 'unknown' }), false);
  }
});

test('guard logout never redirects after failed invalidation', async () => {
  const context = environment(async () => response(200, { role_name: 'admin' }));
  vm.runInContext(source('auth-guard.js'), context);
  await context.JUFLOW_AUTH_READY;
  context.fetch = async () => response(503, { message: 'Try later' });
  await assert.rejects(context.juflowLogout(), { status: 503 });
  assert.equal(context.location.redirect, undefined);
  context.fetch = async () => response(204, null);
  await context.juflowLogout();
  assert.equal(context.location.redirect, '/login.html');
});

test('login safeNext blocks external, login loops and other-role pages', () => {
  const context = environment(async () => response(200, {}));
  api(context);
  const html = source('login.html');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.slice(0, script.indexOf('const loginForm')), context);
  for (const role of ['admin', 'cashier', 'rider']) {
    const user = { role_name: role };
    const fallback = context.api.defaultRoute(user);
    for (const value of ['//evil.test/', '/\\evil.test', '/login.html', 'https://evil.test']) assert.equal(context.safeNext(value, user), fallback);
    assert.equal(context.safeNext(fallback + '?x=1', user), fallback + '?x=1');
    if (role !== 'admin') {
      for (const value of ['/admin.html', '/', '/index.html', '/dashboard.html', '/cashier.html', '/rider.html',
        '/cashier-other/', `/${role}/../dashboard.html`, `/${role}/%2e%2e/dashboard.html`,
        `/${role}/%2f..%2f..%2fdashboard.html`]) assert.equal(context.safeNext(value, user), fallback, value);
      assert.equal(context.safeNext(`/${role}/index.html?x=1#/me`, user), `/${role}/index.html?x=1#/me`);
    }
  }
});

test('thin controller methods use existing backend endpoints', async () => {
  const calls = [];
  const client = api(environment(async (url, options) => { calls.push([url, options]); return response(200, {}); }));
  await client.getCustomerOrders('a/b');
  await client.orderAction('1', { action: 'accept' });
  await client.deliveryEvent('2', { event: 'arrived' });
  await client.confirmDelivery('2', {});
  await client.createDelivery({ order_id: '1' });
  assert.deepEqual(calls.map(([url]) => url), ['/api/customers/a%2Fb/orders', '/api/orders/1/actions', '/api/deliveries/2/events', '/api/deliveries/2/confirm', '/api/deliveries']);
  assert.equal(calls[1][1].method, 'POST');
});

test('owned HTML inline scripts compile', () => {
  for (const file of ['login.html', 'index.html']) {
    for (const match of source(file).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      new vm.Script(match[1], { filename: file });
    }
  }
});

test('auth readiness stays pending and content hidden until session lookup completes', async () => {
  let resolve;
  const context = environment(() => new Promise(done => { resolve = done; }));
  vm.runInContext(source('auth-guard.js'), context);
  let ready = false;
  context.JUFLOW_AUTH_READY.then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(context.document.documentElement.style.visibility, 'hidden');
  resolve(response(200, { role_name: 'admin' }));
  await context.JUFLOW_AUTH_READY;
  assert.equal(ready, true);
  assert.equal(context.document.documentElement.style.visibility, '');
});
