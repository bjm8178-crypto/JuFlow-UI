import { copyFile, lstat, mkdir, readdir, rm, readFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND_FILES = Object.freeze([
  'index.html', 'login.html', 'dashboard.html', 'orders.html',
  'delivery-map.html', 'customers.html', 'sales.html', 'dishes.html',
  'styles.css', 'app.js', 'auth-guard.js', 'api.js', 'store.js', 'workflow.js',
  'analytics.js', 'delivery-state.js', 'admin-deliveries.js',
  'map-config.js', 'landmarks.js', 'customer-map.js',
  'cashier.html', 'cashier.js', 'rider.html', 'rider.js', 'outbox.js', 'users.html',
]);

export const FRONTEND_DIRS = Object.freeze(['cashier']);

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildFrontend(root = projectRoot) {
  // Validate all inputs before cleaning the generated directory. No globs or repo copy.
  for (const filename of FRONTEND_FILES) {
    if (!(await lstat(path.join(root, filename))).isFile()) {
      throw new Error(`Frontend input must be a regular file: ${filename}`);
    }
  }

  // If vercel.json is present, check the /api rewrite destination
  const vercelPath = path.join(root, 'vercel.json');
  if (existsSync(vercelPath)) {
    try {
      const config = JSON.parse(await readFile(vercelPath, 'utf8'));
      const dest = config.rewrites?.find((r) => r.source === '/api/:path*')?.destination || '';
      if (!dest.startsWith('https://') || !dest.includes('onrender.com') || dest.includes('your-render-app')) {
        console.warn(`[WARN] vercel.json /api destination may not be configured properly: ${dest}`);
      }
    } catch {
      // Ignore parse errors if any
    }
  }

  const output = path.join(root, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const filename of FRONTEND_FILES) {
    await copyFile(path.join(root, filename), path.join(output, filename));
  }

  for (const dir of FRONTEND_DIRS) {
    const dirPath = path.join(root, dir);
    if (existsSync(dirPath)) {
      await cp(dirPath, path.join(output, dir), { recursive: true });
    }
  }

  return output;
}

export async function checkFrontend(root = projectRoot) {
  const entries = await readdir(path.join(root, 'dist'), { withFileTypes: true });
  const fileEntries = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const nonFiles = entries.filter((entry) => !entry.isFile());
  if (nonFiles.some((entry) => !FRONTEND_DIRS.includes(entry.name)) ||
      JSON.stringify(fileEntries.sort()) !==
      JSON.stringify([...FRONTEND_FILES].sort())) {
    throw new Error('dist does not match the frontend allowlist');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await checkFrontend();
  else await buildFrontend();
  console.log('Frontend allowlist verified');
}
