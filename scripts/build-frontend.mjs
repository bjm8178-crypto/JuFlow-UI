import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND_FILES = Object.freeze([
  'index.html', 'login.html', 'dashboard.html', 'orders.html',
  'delivery-map.html', 'customers.html', 'sales.html',
  'styles.css', 'app.js', 'auth-guard.js', 'api.js', 'store.js', 'workflow.js',
  'analytics.js', 'delivery-state.js', 'admin-deliveries.js',
  'map-config.js', 'landmarks.js', 'customer-map.js',
]);

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildFrontend(root = projectRoot) {
  // Validate all inputs before cleaning the generated directory. No globs or repo copy.
  for (const filename of FRONTEND_FILES) {
    if (!(await lstat(path.join(root, filename))).isFile()) {
      throw new Error(`Frontend input must be a regular file: ${filename}`);
    }
  }
  const output = path.join(root, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(output);
  for (const filename of FRONTEND_FILES) {
    await copyFile(path.join(root, filename), path.join(output, filename));
  }
  return output;
}

export async function checkFrontend(root = projectRoot) {
  const entries = await readdir(path.join(root, 'dist'), { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile()) ||
      JSON.stringify(entries.map((entry) => entry.name).sort()) !==
      JSON.stringify([...FRONTEND_FILES].sort())) {
    throw new Error('dist does not match the frontend allowlist');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await checkFrontend();
  else await buildFrontend();
  console.log('Frontend allowlist verified');
}
