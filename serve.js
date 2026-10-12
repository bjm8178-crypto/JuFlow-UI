const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

async function createFrontendServer({ root = __dirname, apiPort = 3000 } = {}) {
  const { FRONTEND_FILES, assertSafePath } = await import('./scripts/build-frontend.mjs');
  const allowed = new Set(FRONTEND_FILES);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    // Forward API requests before considering any static path, preserving bodies.
    if (req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?')) {
      const headers = { ...req.headers, host: `localhost:${apiPort}` };
      const upstream = http.request({ hostname: 'localhost', port: apiPort,
        method: req.method, path: req.url, headers }, (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
        response.on('error', () => res.destroy());
      });
      upstream.setTimeout(30000, () => upstream.destroy());
      upstream.on('error', () => {
        if (res.headersSent) return res.destroy();
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Local API unavailable');
      });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(req.url.split('?')[0]); }
    catch { res.writeHead(400); res.end(); return; }
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.split('/').some((part) => part === '.' || part === '..')) {
      res.writeHead(404); res.end(); return;
    }
    if (pathname === '/') {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }
    for (const app of ['cashier', 'rider']) {
      if (pathname === '/' + app || pathname === '/' + app + '.html') {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.writeHead(302, { Location: '/' + app + '/' + query });
        res.end(); return;
      }
      if (pathname === '/' + app + '/') pathname = '/' + app + '/index.html';
    }
    const filename = pathname.slice(1);
    if (!allowed.has(filename) || !types[path.extname(filename)]) {
      res.writeHead(404); res.end(); return;
    }
    try {
      const file = await assertSafePath(root, filename);
      const content = await fs.readFile(file);
      const type = types[path.extname(file)];
      if (filename === 'cashier/sw.js' || filename === 'rider/sw.js') {
        res.setHeader('Service-Worker-Allowed', `/${filename.split('/')[0]}/`);
        res.setHeader('Cache-Control', 'no-cache');
      } else res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200, { 'Content-Type': type + (type.startsWith('image/') ? '' : '; charset=utf-8'),
        'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404); res.end(); }
  });
}

if (require.main === module) {
  createFrontendServer().then((server) => {
    server.listen(8080, '127.0.0.1', () => {
      console.log('JuFlow frontend: http://127.0.0.1:8080/login.html');
      console.log('Local /api proxy: http://localhost:3000');
    });
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { createFrontendServer };
