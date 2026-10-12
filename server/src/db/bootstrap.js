import bcrypt from 'bcrypt';
import { timestamps, withTransaction } from './mongodb.js';

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
export async function bootstrapAdmin(db, env = process.env, transaction = withTransaction) {
  for (const r of ROLES) {
    try {
      await db.collection('roles').updateOne({ _id: r._id }, { $setOnInsert: { ...r, ...timestamps() } }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000 || !await db.collection('roles').findOne({ _id: r._id })) throw error;
    }
  }
  if (typeof db.collection('integrity_guards')?.updateOne === 'function') {
    try {
      await db.collection('integrity_guards').updateOne({ _id: 'active_admins' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000 || !await db.collection('integrity_guards').findOne({ _id: 'active_admins' })) throw error;
    }
  }
  if (await db.collection('users').findOne({ role_id: 1 })) return { createdAdmin: false };
  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn('Admin bootstrap credentials are not configured.');
    return { createdAdmin: false };
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters; admin not created.');
    return { createdAdmin: false };
  }
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminDoc = {
    username,
    password_hash: await bcrypt.hash(password, 12),
    full_name: 'Administrator',
    phone: '',
    role_id: 1,
    is_active: true,
    failed_attempts: 0,
    locked_until: null,
    last_login_at: null,
    ...timestamps(),
  };
  if (adminEmail) {
    adminDoc.email = adminEmail;
  }

  // Use transaction if supported by DB client, otherwise fallback to standard insert
  try {
    const result = await transaction(async (database, session) => {
      if (typeof database.collection('integrity_guards')?.updateOne === 'function') {
        await database.collection('integrity_guards').updateOne(
          { _id: 'active_admins' }, { $inc: { revision: 1 } }, { session, upsert: true }
        );
      }
      if (await database.collection('users').findOne({ role_id: 1 }, { session })) return { createdAdmin: false };
      await database.collection('users').insertOne(adminDoc, { session });
      return { createdAdmin: true };
    });
    if (result.createdAdmin) console.log('Created first administrator. Remove bootstrap credentials from the environment.');
    return result;
  } catch (txErr) {
    // If transactions are not supported or running unit test fakeDb
    if (await db.collection('users').findOne({ role_id: 1 })) return { createdAdmin: false };
    await db.collection('users').insertOne(adminDoc);
    return { createdAdmin: true };
  }
}

export async function ensureRider(db, env = process.env, transaction = withTransaction) {
  const password = env.RIDER_PASSWORD;
  if (!password) return;
  if (typeof password !== 'string' || password.length < 8) {
    console.error('RIDER_PASSWORD must be at least 8 characters; rider not created.');
    return;
  }
  const username = env.RIDER_USERNAME?.trim() || 'rider';
  const existing = await db.collection('users').findOne({ role_id: 3 });
  const passwordHash = existing ? null : await bcrypt.hash(password, 12);
  const run = async (database, session) => {
    // Serialize bootstrap with account/link mutations, including different usernames.
    await database.collection('integrity_guards').updateOne(
      { _id: 'active_admins' }, { $inc: { revision: 1 } }, { session, upsert: true }
    );
    let user = await database.collection('users').findOne({ role_id: 3 }, { session, sort: { created_at: 1, _id: 1 } });
    let createdRider = false;
    if (!user) {
      user = { username, password_hash: passwordHash ?? await bcrypt.hash(password, 12), full_name: 'Rider', phone: '',
        role_id: 3, is_active: true, failed_attempts: 0, locked_until: null, last_login_at: null, ...timestamps() };
      const result = await database.collection('users').insertOne(user, { session });
      user._id = result.insertedId;
      createdRider = true;
    }
    const profile = await database.collection('riders').findOne({ user_id: user._id }, { session });
    if (profile) {
      await database.collection('riders').updateOne({ _id: profile._id },
        { $set: { is_active: true, is_available: true, updated_at: new Date() } }, { session });
    } else {
      await database.collection('riders').insertOne({ user_id: user._id, full_name: user.full_name || 'Rider', phone: user.phone || '',
        vehicle_type: null, plate_no: null, notes: null, is_active: true, is_available: true, ...timestamps() }, { session });
    }
    return { createdRider };
  };
  try { return await transaction(run); }
  catch (error) {
    if (error.code !== 11000 || !await db.collection('users').findOne({ role_id: 3 })) throw error;
    return transaction(run);
  }
}

export async function bootstrap(db, env = process.env, transaction = withTransaction) {
  const admin = await bootstrapAdmin(db, env, transaction);
  const rider = await ensureRider(db, env, transaction);
  return rider ? { ...admin, ...rider } : admin;
}
