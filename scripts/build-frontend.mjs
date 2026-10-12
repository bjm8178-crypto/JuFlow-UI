import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
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

export async function buildFrontend(root = projectRoot) {
  // Validate all inputs before cleaning the generated directory. No globs or repo copy.
  for (const filename of FRONTEND_FILES) {
    await assertSafePath(root, filename);
  }
  try {
    await assertSafePath(root, 'dist', true);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const output = path.join(root, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const filename of FRONTEND_FILES) {
    const input = await assertSafePath(root, filename);
    await mkdir(path.dirname(path.join(output, filename)), { recursive: true });
    await copyFile(input, path.join(output, filename));
  }
  await checkFrontend(root);
  return output;
}

export async function checkFrontend(root = projectRoot) {
  await assertSafePath(root, 'dist', true);
  const allowed = new Set(FRONTEND_FILES);
  const directories = new Set(FRONTEND_FILES.flatMap((filename) => {
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
