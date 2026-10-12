import { copyFile, lstat, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND_FILES = Object.freeze([
  'index.html', 'login.html', 'dashboard.html', 'orders.html',
  'delivery-map.html', 'customers.html', 'sales.html', 'dishes.html',
  'styles.css', 'app.js', 'auth-guard.js', 'api.js', 'store.js', 'workflow.js',
  'analytics.js', 'delivery-state.js', 'admin-deliveries.js',
  'map-config.js', 'landmarks.js', 'customer-map.js',
  'users.html',
  'cashier/index.html', 'cashier/app.js', 'cashier/boot.js', 'cashier/cashier.css',
  'cashier/pos.js', 'cashier/orders.js', 'cashier/new-order.js', 'cashier/today.js',
  'cashier/me.js', 'cashier/manifest.webmanifest', 'cashier/sw.js',
  'rider/index.html', 'rider/app.js', 'rider/jobs.js', 'rider/history.js',
  'rider/me.js', 'rider/manifest.webmanifest', 'rider/sw.js',
  'shared/db.js', 'shared/network.js', 'shared/styles.css', 'shared/utils.js',
  'icons/cashier-192.png', 'icons/cashier-512.png', 'icons/cashier-maskable-512.png',
  'icons/cashier-template.svg', 'icons/rider-192.png', 'icons/rider-512.png',
  'icons/rider-maskable-512.png', 'icons/rider-template.svg',
  '.well-known/assetlinks.json',
]);

export const FRONTEND_DIRS = Object.freeze(['cashier', 'rider', 'shared', 'icons', '.well-known']);

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * APP=admin|cashier|rider builds a standalone deploy for one Vercel project.
 * Default 'all' retains the legacy combined site's public paths.
 * Source paths remain unchanged so both forms can build from the same commit.
 */
export const APP_FILES = Object.freeze({
  admin: FRONTEND_FILES.filter(name => !name.startsWith('cashier/') && !name.startsWith('rider/')),
  cashier: FRONTEND_FILES.filter(name => name.startsWith('cashier/') || name.startsWith('shared/') ||
    name.startsWith('icons/cashier-') || name === '.well-known/assetlinks.json'),
  rider: FRONTEND_FILES.filter(name => name.startsWith('rider/') || name.startsWith('shared/') ||
    name.startsWith('icons/rider-') || name === '.well-known/assetlinks.json')
});

export function outputPlan(app = 'all') {
  if (app !== 'all' && !Object.hasOwn(APP_FILES, app)) throw new Error('APP must be admin, cashier, rider, or all');
  const files = app === 'all' ? FRONTEND_FILES : APP_FILES[app];
  const mapping = files.map(source => ({
    source,
    output: app !== 'all' && source.startsWith(app + '/') ? source.slice(app.length + 1) : source
  }));
  if (new Set(mapping.map(entry => entry.output)).size !== mapping.length) throw new Error('Duplicate frontend output');
  return mapping;
}


// Check every path component, not just the leaf: a linked app directory is unsafe too.
export async function assertSafePath(root, filename, directory = false) {
  const segments = filename.split('/');
  if (filename.includes('\\') || segments.some((part) => !part || part === '.' || part === '..' || part.includes(':') || part.includes('\0'))) {
    throw new Error(`Unsafe frontend path: ${filename}`);
  }
  let current = path.resolve(root);
  let ancestor = current;
  while (true) {
    const stat = await lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Frontend root and parents must be regular directories');
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    const isDirectory = index < segments.length - 1 || directory;
    if (stat.isSymbolicLink() || !(isDirectory ? stat.isDirectory() : stat.isFile())) {
      throw new Error(`Frontend input must be a regular ${isDirectory ? 'directory' : 'file'}: ${filename}`);
    }
  }
  return current;
}

export async function buildFrontend(root = projectRoot, app = process.env.APP || 'all') {
  const mapping = outputPlan(app);
  // Validate all inputs before cleaning the generated directory. No globs or repo copy.
  for (const { source } of mapping) {
    await assertSafePath(root, source);
  }
  try {
    await assertSafePath(root, 'dist', true);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const output = path.join(root, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const { source, output: relative } of mapping) {
    const input = await assertSafePath(root, source);
    const destination = path.join(output, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    // Only transform mobile app text assets; binary icons and shared code are copied unchanged.
    // Absolute app paths become root paths on each app's *own* origin.
    if (app !== 'all' && source.startsWith(app + '/') && /\.(?:html|js|css|webmanifest)$/.test(source)) {
      const content = await readFile(input, 'utf8');
      await writeFile(destination, content.replaceAll('/' + app + '/', '/'));
    } else {
      await copyFile(input, destination);
    }
  }
  await checkFrontend(root, app);
  return output;
}

export async function checkFrontend(root = projectRoot, app = process.env.APP || 'all') {
  await assertSafePath(root, 'dist', true);
  const selectedFiles = outputPlan(app).map(({ output }) => output);
  const allowed = new Set(selectedFiles);
  const directories = new Set(selectedFiles.flatMap((filename) => {
    const parts = filename.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }));
  const found = new Set();
  async function walk(prefix = '') {
    for (const entry of await readdir(path.join(root, 'dist', prefix), { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`dist symlink is outside the allowlist: ${name}`);
      if (entry.isDirectory() && directories.has(name)) {
        await assertSafePath(root, `dist/${name}`, true);
        await walk(name);
      } else if (entry.isFile() && allowed.has(name)) {
        await assertSafePath(root, `dist/${name}`);
        found.add(name);
      } else throw new Error(`dist does not match the frontend allowlist: ${name}`);
    }
  }
  await walk();
  if (found.size !== allowed.size) throw new Error('dist is missing frontend allowlist files');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await checkFrontend();
  else await buildFrontend();
  console.log('Frontend allowlist verified');
}
