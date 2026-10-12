import bcrypt from 'bcrypt';
import { timestamps } from './mongodb.js';

const ROLES = [
  { _id: 1, name: 'admin', description: 'Full system access', permissions: ['*'] },
  { _id: 2, name: 'cashier', description: 'Can manage orders and sales', permissions: ['orders:read', 'orders:write', 'sales:read', 'sales:write'] },
  { _id: 3, name: 'rider', description: 'Can view assigned deliveries', permissions: ['deliveries:read'] },
];

/**
 * Non-destructive startup bootstrap (safe to run on every boot):
 *  - makes sure the three roles exist
 *  - if there is NO admin yet and ADMIN_USERNAME + ADMIN_PASSWORD are set, creates the first admin
 */
export async function bootstrap(db, env = process.env) {
  for (const r of ROLES) {
    await db.collection('roles').updateOne({ _id: r._id }, { $setOnInsert: { ...r, ...timestamps() } }, { upsert: true });
  }
  const adminExists = await db.collection('users').findOne({ role_id: 1 });
  if (adminExists) return { createdAdmin: false };

  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn('⚠️  No admin user exists. Set ADMIN_USERNAME and ADMIN_PASSWORD (min 8 chars) and restart to create one.');
    return { createdAdmin: false };
  }
  if (password.length < 8) {
    console.error('❌ ADMIN_PASSWORD must be at least 8 characters; admin not created.');
    return { createdAdmin: false };
  }
  await db.collection('users').insertOne({
    username, password_hash: await bcrypt.hash(password, 12), full_name: 'Administrator',
    email: env.ADMIN_EMAIL?.trim().toLowerCase() || null, phone: '', role_id: 1, is_active: true,
    failed_attempts: 0, locked_until: null, last_login_at: null, ...timestamps(),
  });
  console.log(`✅ Created first admin "${username}". Remove ADMIN_PASSWORD from the environment now.`);
  return { createdAdmin: true };
}
