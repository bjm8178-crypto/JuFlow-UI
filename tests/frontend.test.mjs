import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink, lstat, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FRONTEND_FILES, assertSafePath, buildFrontend, checkFrontend, projectRoot } from '../scripts/build-frontend.mjs';
const { createFrontendServer } = createRequire(import.meta.url)('../serve.js');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'juflow-frontend-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of FRONTEND_FILES) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), name);
  }
  return root;
}

test('build copies only explicit assets and removes stale output', async (t) => {
  const root = await fixture(t);
  const secrets = ['.env', '.cashier-token', '.juflow-sales.sqlite3', 'admin.html', 'dashboard-mongo.html', 'surprise.js',
    'cashier/.env', 'cashier/secret.json', 'cashier/README.md', 'rider/private.js',
    'shared/credentials.json', 'icons/generate.js', '.well-known/private.json'];
  for (const name of secrets) {
    await writeFile(path.join(root, name), 'private');
  }
  await mkdir(path.join(root, 'cashier', 'scripts'));
  await writeFile(path.join(root, 'cashier', 'scripts', 'generate.js'), 'private');
  await symlink(path.join(root, '.env'), path.join(root, 'shared', 'leaked.json'), 'file');
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'stale.txt'), 'private');
  await buildFrontend(root);
  await checkFrontend(root);
  assert.equal(await readFile(path.join(root, 'dist', 'login.html'), 'utf8'), 'login.html');
  assert.equal(await readFile(path.join(root, 'dist', 'cashier', 'boot.js'), 'utf8'), 'cashier/boot.js');
  for (const name of [...secrets, 'cashier/scripts/generate.js', 'shared/leaked.json']) {
    await assert.rejects(lstat(path.join(root, 'dist', name)), { code: 'ENOENT' });
  }
  for (const name of ['unexpected.js', 'cashier/unexpected.js', '.well-known/extra.json']) {
    await writeFile(path.join(root, 'dist', name), 'unexpected');
    await assert.rejects(checkFrontend(root), /allowlist/);
    await rm(path.join(root, 'dist', name));
  }
  await mkdir(path.join(root, 'dist', 'shared', 'scripts'));
  await assert.rejects(checkFrontend(root), /allowlist/);
  await rm(path.join(root, 'dist', 'shared', 'scripts'), { recursive: true });
  await symlink(path.join(root, '.env'), path.join(root, 'dist', 'shared', 'leaked.json'), 'file');
  await assert.rejects(checkFrontend(root), /allowlist/);
  await rm(path.join(root, 'dist', 'shared', 'leaked.json'));
  await writeFile(path.join(root, 'dist', 'unexpected.js'), 'unexpected');
  await rm(path.join(root, 'login.html'));
  await assert.rejects(buildFrontend(root));
  assert.equal(await readFile(path.join(root, 'dist', 'unexpected.js'), 'utf8'), 'unexpected');
});

test('build and validation reject allowlisted leaf, parent and output symlinks before deleting output', async (t) => {
  const root = await fixture(t);
  await buildFrontend(root);
  await writeFile(path.join(root, 'private.json'), 'private');
  await rm(path.join(root, 'shared', 'db.js'));
  await symlink(path.join(root, 'private.json'), path.join(root, 'shared', 'db.js'), 'file');
  await assert.rejects(buildFrontend(root), /regular file/);
  assert.equal(await readFile(path.join(root, 'dist', 'shared', 'db.js'), 'utf8'), 'shared/db.js');
  await rm(path.join(root, 'shared', 'db.js'));
  await writeFile(path.join(root, 'shared', 'db.js'), 'shared/db.js');
  await rm(path.join(root, 'rider'), { recursive: true });
  await symlink(path.join(root, 'dist', 'rider'), path.join(root, 'rider'), 'junction');
  await assert.rejects(buildFrontend(root), /regular directory/);
  await rm(path.join(root, 'rider'));
  await mkdir(path.join(root, 'rider'));
  for (const name of FRONTEND_FILES.filter(name => name.startsWith('rider/'))) await writeFile(path.join(root, name), name);
  await rm(path.join(root, 'dist', 'cashier'), { recursive: true });
  await symlink(path.join(root, 'cashier'), path.join(root, 'dist', 'cashier'), 'junction');
  await assert.rejects(checkFrontend(root), /allowlist/);
  await rm(path.join(root, 'dist'), { recursive: true });
  await mkdir(path.join(root, 'private-output'));
  await writeFile(path.join(root, 'private-output', 'secret.json'), 'private');
  await symlink(path.join(root, 'private-output'), path.join(root, 'dist'), 'junction');
  await assert.rejects(buildFrontend(root), /regular directory/);
  await assert.rejects(checkFrontend(root), /regular directory/);
  assert.equal(await readFile(path.join(root, 'private-output', 'secret.json'), 'utf8'), 'private');
  await mkdir(path.join(root, 'private-output', 'child'));
  await writeFile(path.join(root, 'private-output', 'child', 'login.html'), 'private');
  await symlink(path.join(root, 'private-output'), path.join(root, 'linked-parent'), 'junction');
  await assert.rejects(assertSafePath(path.join(root, 'linked-parent', 'child'), 'login.html'), /parents must be regular/);
  for (const name of ['../private.json', 'shared/../private.json', 'shared\\db.js', '/login.html', 'C:/private.json']) {
    await assert.rejects(assertSafePath(root, name), /Unsafe frontend path/);
  }
});

test('actual source assets build byte-for-byte into a temporary output, not the main dist', async (t) => {
  const root = await fixture(t);
  for (const name of FRONTEND_FILES) await copyFile(await assertSafePath(projectRoot, name), path.join(root, name));
  await buildFrontend(root);
  await checkFrontend(root);
  for (const name of FRONTEND_FILES) {
    assert.deepEqual(await readFile(path.join(root, 'dist', name)), await readFile(path.join(projectRoot, name)), name);
  }
});

test('deployment uses generated output and keeps the existing API destination', async () => {
  const config = JSON.parse(await readFile(path.join(projectRoot, 'vercel.json'), 'utf8'));
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.buildCommand, 'node scripts/build-frontend.mjs');
  assert.deepEqual(config.rewrites, [
    { source: '/api/:path*', destination: 'https://juflow-api.onrender.com/api/:path*' },
  ]);
  assert.deepEqual(config.redirects.map((r) => [r.source, r.destination]), [
    ['/cashier.html', '/cashier/'], ['/rider.html', '/rider/'],
  ]);
  for (const app of ['cashier', 'rider']) {
    assert.deepEqual(config.headers.find(entry => entry.source === `/${app}/sw.js`).headers, [
      { key: 'Cache-Control', value: 'no-cache' },
      { key: 'Service-Worker-Allowed', value: `/${app}/` },
    ]);
  }
});

function localReference(name, reference) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
  const url = new URL(reference, `https://juflow.test/${name}`);
  let target = decodeURIComponent(url.pathname).slice(1);
  if (target === '') target = 'login.html';
  if (/^(cashier|rider)\/?$/.test(target)) target = target.replace(/\/?$/, '/index.html');
  if (/^(cashier|rider)\.html$/.test(target)) target = target.replace('.html', '/index.html');
  return target;
}

async function checkReference(name, reference) {
  const target = localReference(name, reference);
  if (target === null) return;
  assert.ok(FRONTEND_FILES.includes(target), `${name}: ${reference} is not allowlisted (${target})`);
  await assertSafePath(projectRoot, target);
}

test('ALL shipped HTML local references and manifest icons resolve to allowlisted regular files', async () => {
  for (const name of FRONTEND_FILES.filter((name) => name.endsWith('.html'))) {
    const html = await readFile(path.join(projectRoot, name), 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      await checkReference(name, match[1]);
    }
  }
  for (const name of FRONTEND_FILES.filter(name => name.endsWith('.webmanifest'))) {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, name), 'utf8'));
    const app = name.split('/')[0];
    assert.equal(manifest.scope, `/${app}/`);
    for (const reference of [manifest.id, manifest.start_url, manifest.scope]) await checkReference(name, reference);
    for (const item of [manifest, ...manifest.shortcuts]) {
      if (item.url) await checkReference(name, item.url);
      for (const icon of item.icons) await checkReference(name, icon.src);
    }
  }
});

for (const app of ['cashier', 'rider']) test(`${app} service worker precache references resolve`, async () => {
  const name = `${app}/sw.js`;
  const source = await readFile(path.join(projectRoot, name), 'utf8');
  const precache = source.match(/const PRECACHE_FILES = \[([\s\S]*?)\];/);
  assert.ok(precache, 'Expected a static precache asset list');
  const references = [...precache[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const reference of references) await checkReference(name, reference);
  assert.ok(!references.some(reference => reference.startsWith('/api/')));
  if (app === 'cashier') {
    assert.ok(references.includes('/cashier/boot.js'));
    assert.ok(references.includes('/cashier/cashier.css'));
  }
});

test('rider shell uses existing shared styles, icons and app-first screen scripts', async () => {
  const html = await readFile(path.join(projectRoot, 'rider', 'index.html'), 'utf8');
  assert.match(html, /href="\/shared\/styles.css"/);
  assert.match(html, /href="\/icons\/rider-192.png"/);
  assert.doesNotMatch(html, /shared\/app-shell\.js|rider-icon\.svg/);
  assert.deepEqual([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]),
    ['/rider/app.js', '/rider/pin.js', '/rider/jobs.js', '/rider/history.js', '/rider/me.js']);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, 'localhost', resolve));
}
function request(server, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: server.address().port, path: url, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('local server denies repo files and forwards API method, query, body and auth', async (t) => {
  const backend = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'test=1; HttpOnly' });
      res.end(JSON.stringify({ method: req.method, url: req.url, body,
        auth: req.headers.authorization, cookie: req.headers.cookie, origin: req.headers.origin }));
    });
  });
  await listen(backend);
  const frontend = await createFrontendServer({ apiPort: backend.address().port });
  await listen(frontend);
  t.after(() => { frontend.close(); backend.close(); });
  assert.equal((await request(frontend, '/')).headers.location, '/login.html');
  assert.equal((await request(frontend, '/login.html?test=1')).status, 200);
  assert.equal((await request(frontend, '/styles.css', { method: 'HEAD' })).text, '');
  for (const app of ['cashier', 'rider']) {
    for (const route of [`/${app}`, `/${app}.html`]) {
      const redirect = await request(frontend, route + '?source=legacy');
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.location, `/${app}/?source=legacy`);
    }
    assert.equal((await request(frontend, `/${app}/`)).status, 200);
    const worker = await request(frontend, `/${app}/sw.js`);
    assert.equal(worker.headers['service-worker-allowed'], `/${app}/`);
    assert.equal(worker.headers['cache-control'], 'no-cache');
    assert.match(worker.headers['content-type'], /^text\/javascript/);
    const manifest = await request(frontend, `/${app}/manifest.webmanifest`);
    assert.match(manifest.headers['content-type'], /^application\/manifest\+json/);
    const icon = await request(frontend, `/icons/${app}-192.png`);
    assert.equal(icon.headers['content-type'], 'image/png');
    assert.ok(Number(icon.headers['content-length']) > 0);
    assert.equal((await request(frontend, `/icons/${app}-template.svg`)).headers['content-type'], 'image/svg+xml');
  }
  const assetlinks = await request(frontend, '/.well-known/assetlinks.json');
  assert.equal(assetlinks.status, 200);
  assert.match(assetlinks.headers['content-type'], /^application\/json/);
  assert.equal(assetlinks.headers['x-content-type-options'], 'nosniff');
  assert.equal(assetlinks.headers['x-frame-options'], 'DENY');
  for (const url of ['/server/package.json', '/package.json', '/.env', '/.cashier-token', '/admin.html',
    '/dashboard-mongo.html', '/../package.json', '/%2e%2e%2fpackage.json', '/node_modules/express/package.json',
    '/cashier/private.js', '/shared/secrets.json', '/.well-known/private.json', '/cashier/../login.html',
    '/cashier/%2e%2e/login.html', '/cashier%5cindex.html', '/cashier/..%5cpackage.json',
    '/cashier//index.html', '/cashier/./index.html', '/cashier/index.html%00', '/%252e%252e/package.json']) {
    assert.equal((await request(frontend, url)).status, 404, url);
  }
  assert.equal((await request(frontend, '/%xx')).status, 400);
  assert.equal((await request(frontend, '/login.html', { method: 'POST' })).status, 405);
  const response = await request(frontend, '/api/orders?q=1', {
    method: 'POST', body: '{"quantity":2}',
    headers: { authorization: 'Bearer local-test', 'Content-Type': 'application/json',
      cookie: 'juflow_session=local-test', origin: 'http://localhost:8080' },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(response.text), { method: 'POST', url: '/api/orders?q=1',
    body: '{"quantity":2}', auth: 'Bearer local-test', cookie: 'juflow_session=local-test',
    origin: 'http://localhost:8080' });
  assert.deepEqual(response.headers['set-cookie'], ['test=1; HttpOnly']);
  await new Promise((resolve) => backend.close(resolve));
  assert.equal((await request(frontend, '/api/health')).status, 502);
});

test('local server denies allowlisted leaf and parent symlinks and arbitrary nested files', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'private.json'), 'private');
  await writeFile(path.join(root, 'cashier', 'secret.json'), 'private');
  await rm(path.join(root, 'shared', 'db.js'));
  await symlink(path.join(root, 'private.json'), path.join(root, 'shared', 'db.js'), 'file');
  await rm(path.join(root, 'rider'), { recursive: true });
  await symlink(path.join(root, 'cashier'), path.join(root, 'rider'), 'junction');
  const frontend = await createFrontendServer({ root });
  await listen(frontend);
  t.after(() => new Promise(resolve => frontend.close(resolve)));
  for (const url of ['/shared/db.js', '/rider/index.html', '/cashier/secret.json', '/shared/../private.json', '/shared%5cdb.js']) {
    assert.equal((await request(frontend, url)).status, 404, url);
  }
  assert.equal((await request(frontend, '/cashier/index.html')).status, 200);
});

test('sales data selector is visible beside business date and controls the whole report', async () => {
  const sales = await readFile(path.join(projectRoot, 'sales.html'), 'utf8');
  const analytics = await readFile(path.join(projectRoot, 'analytics.js'), 'utf8');
  const toolbar = sales.match(/<div class="sales-toolbar">([\s\S]*?)<\/div>/);
  assert.ok(toolbar, 'sales toolbar must exist');
  assert.match(toolbar[1], /id="sales-date"/);
  assert.match(toolbar[1], /<select id="report-test">/);
  assert.match(toolbar[1], /value="false">Real sales/);
  assert.match(toolbar[1], /value="true">Demo sales/);
  assert.match(toolbar[1], /value="all">All sales/);
  assert.equal((sales.match(/id="report-test"/g) || []).length, 1, 'only one sales-data dropdown');
  assert.doesNotMatch(analytics, /<select id="report-test"/, 'report panel must not create a duplicate dropdown');
  assert.match(analytics, /is_test:\s*el\('report-test'\)\.value/, 'API requests use selected sales mode');
  assert.match(analytics, /'report-test',\s*'report-source'/, 'changing sales mode refreshes report');
});

test('all three JuKi apps use the consistent public brand without renaming API identifiers', async () => {
  for (const name of ['index.html', 'login.html', 'dashboard.html', 'orders.html', 'delivery-map.html',
    'customers.html', 'sales.html', 'dishes.html', 'users.html', 'cashier/index.html', 'rider/index.html']) {
    const html = await readFile(path.join(projectRoot, name), 'utf8');
    assert.match(html, /JuKi/, name + ' shows JuKi branding');
    assert.doesNotMatch(html, /\bJuki\b|Ju Kitchen|JU KITCHEN OPERATIONS/, name + ' has no stale public branding');
  }
  for (const app of ['cashier', 'rider']) {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, app, 'manifest.webmanifest'), 'utf8'));
    assert.ok(manifest.name.startsWith('JuKi '), app + ' PWA is labeled JuKi');
  }
  const config = JSON.parse(await readFile(path.join(projectRoot, 'vercel.json'), 'utf8'));
  assert.equal(config.rewrites[0].destination, 'https://juflow-api.onrender.com/api/:path*', 'retain the functional API host');
});
