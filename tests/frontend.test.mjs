import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FRONTEND_DIRS, FRONTEND_FILES, buildFrontend, checkFrontend, projectRoot } from '../scripts/build-frontend.mjs';
const { createFrontendServer } = createRequire(import.meta.url)('../serve.js');

test('build copies only explicit assets and removes stale output', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'juflow-frontend-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of FRONTEND_FILES) await writeFile(path.join(root, name), name);
  for (const name of ['.env', '.cashier-token', 'admin.html', 'dashboard-mongo.html', 'surprise.js']) {
    await writeFile(path.join(root, name), 'private');
  }
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'stale.txt'), 'private');
  await buildFrontend(root);
  await checkFrontend(root);
  assert.equal(await readFile(path.join(root, 'dist', 'login.html'), 'utf8'), 'login.html');
  await writeFile(path.join(root, 'dist', 'unexpected.js'), 'unexpected');
  await assert.rejects(checkFrontend(root), /allowlist/);
  await rm(path.join(root, 'login.html'));
  await assert.rejects(buildFrontend(root));
  assert.equal(await readFile(path.join(root, 'dist', 'unexpected.js'), 'utf8'), 'unexpected');
});

test('deployment uses generated output and keeps the existing API destination', async () => {
  const config = JSON.parse(await readFile(path.join(projectRoot, 'vercel.json'), 'utf8'));
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.buildCommand, 'node scripts/build-frontend.mjs');
  assert.deepEqual(config.rewrites, [
    { source: '/api/:path*', destination: 'https://juflow-api.onrender.com/api/:path*' },
  ]);
});

test('current HTML local links and scripts are all allowlisted', async () => {
  for (const name of FRONTEND_FILES.filter((name) => name.endsWith('.html'))) {
    const html = await readFile(path.join(projectRoot, name), 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const reference = match[1];
      if (/^(?:https?:|data:|#|mailto:)/.test(reference)) continue;
      const target = reference.replace(/^\//, '').split(/[?#]/)[0];
      if (FRONTEND_DIRS.some((dir) => target === dir + '/' || target.startsWith(dir + '/'))) continue;
      assert.ok(FRONTEND_FILES.includes(target), `${name}: ${reference}`);
    }
  }
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
  for (const url of ['/server/package.json', '/package.json', '/.env', '/.cashier-token', '/admin.html',
    '/dashboard-mongo.html', '/../package.json', '/%2e%2e%2fpackage.json', '/node_modules/express/package.json']) {
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
