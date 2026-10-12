import express from 'express';
import bcrypt from 'bcrypt';
import { getDb, toObjectId, timestamps, updateTimestamp, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

export function normalizedEmail(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw Object.assign(new Error('Email must be text'), { status: 400 });
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Invalid email'), { status: 400 });
  return email;
}

export async function lockAccountIntegrity(db, session) {
  await db.collection('integrity_guards').updateOne(
    { _id: 'active_admins' }, { $inc: { revision: 1 } }, { session, upsert: true }
  );
}

export async function updateUser(db, session, id, body, actorId) {
  const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
  if (!id) fail(400, 'invalid_id', 'Invalid user id');
  const { full_name, email, phone, role_id, is_active } = body;
  if (is_active !== undefined && typeof is_active !== 'boolean') fail(400, 'validation_error', 'is_active must be a boolean');
  if (role_id !== undefined) fail(400, 'role_locked', 'Roles cannot be changed');
  await lockAccountIntegrity(db, session);
  const user = await db.collection('users').findOne({ _id: id }, { session });
  if (!user) fail(404, 'user_not_found', 'User not found');
  if (is_active === false && String(id) === String(actorId)) fail(400, 'cannot_deactivate_self', 'You cannot deactivate your own account');
  const updates = {};
  const unsets = {};
  if (user.role_id === 1 && user.is_active === true && is_active === false) {
    if (await db.collection('users').countDocuments({ role_id: 1, is_active: true }, { session }) <= 1) {
      fail(400, 'cannot_remove_last_admin', 'Cannot remove the last active administrator');
    }
  }
  if (full_name !== undefined) {
    if (typeof full_name !== 'string' || !full_name.trim()) fail(400, 'validation_error', 'Full name required');
    updates.full_name = full_name.trim();
  }
  if (email !== undefined) {
    const cleanEmail = normalizedEmail(email);
    if (cleanEmail) {
      if (await db.collection('users').findOne({ email: cleanEmail, _id: { $ne: id } }, { session })) fail(409, 'email_exists', 'Email already exists');
      updates.email = cleanEmail;
    } else unsets.email = '';
  }
  if (phone !== undefined) {
    if (phone !== null && typeof phone !== 'string') fail(400, 'validation_error', 'Phone must be text');
    updates.phone = phone?.trim() || null;
  }
  if (is_active !== undefined) updates.is_active = is_active;
  if (!Object.keys(updates).length && !Object.keys(unsets).length) fail(400, 'no_updates', 'No fields to update');
  // A linked profile must never point at an inactive or non-rider account.
  if (is_active === false) {
    const linked = await db.collection('riders').findOne({ user_id: id }, { session });
    if (linked) fail(409, 'rider_link_exists', 'Unlink the rider profile before changing this account');
  }
  const ops = { $set: { ...updates, ...updateTimestamp() } };
  if (Object.keys(unsets).length) ops.$unset = unsets;
  const result = await db.collection('users').findOneAndUpdate({ _id: id }, ops, { session, returnDocument: 'after' });
  if (is_active === false) {
    await db.collection('auth_sessions').updateMany({ user_id: id }, { $set: { revoked_at: new Date(), ...updateTimestamp() } }, { session });
  }
  const role = await db.collection('roles').findOne({ _id: result.role_id }, { session });
  const { password_hash: _, ...safe } = result;
  return { ...safe, role_name: role?.name };
}

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const users = await db.collection('users').find({}).sort({ created_at: -1 }).toArray();
    const usersWithRoles = await Promise.all(users.map(async (user) => {
      const role = await db.collection('roles').findOne({ _id: user.role_id });
      // Never expose password_hash
      const { password_hash: _, ...safeUser } = user;
      return { ...safeUser, role_name: role?.name };
    }));
    res.json(usersWithRoles);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch users' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, full_name, email, phone, role_id, is_active } = req.body;
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || typeof full_name !== 'string' || !full_name.trim() || !Number.isSafeInteger(role_id)) {
      return res.status(400).json({ error: 'missing_fields', message: 'Username, password, full name, and role required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 8 characters' });
    }
    if (is_active !== undefined && typeof is_active !== 'boolean') return res.status(400).json({ error: 'validation_error', message: 'is_active must be a boolean' });
    if (phone !== undefined && phone !== null && typeof phone !== 'string') return res.status(400).json({ error: 'validation_error', message: 'Phone must be text' });
    if (Number(role_id) !== 2) {
      return res.status(400).json({ error: 'role_not_allowed', message: 'Only cashier accounts can be created here. The rider account is created automatically.' });
    }

    const db = getDb();

    // Additional accounts are cashier-only; admin/rider accounts are bootstrapped.
    const role = await db.collection('roles').findOne({ _id: Number(role_id) });
    if (role?.name !== 'cashier') {
      return res.status(400).json({ error: 'cashier_only', message: 'Only cashier accounts can be created' });
    }

    const cleanUsername = String(username).trim();
    const cleanFullName = String(full_name).trim();
    const cleanEmail = email === undefined ? null : normalizedEmail(email);
    const cleanPhone = phone ? String(phone).trim() : null;

    const existing = await db.collection('users').findOne({ username: cleanUsername });
    if (existing) return res.status(409).json({ error: 'username_exists', message: 'Username already exists' });

    if (cleanEmail) {
      const existingEmail = await db.collection('users').findOne({ email: cleanEmail });
      if (existingEmail) return res.status(409).json({ error: 'email_exists', message: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userDoc = {
      username: cleanUsername,
      password_hash: passwordHash,
      full_name: cleanFullName,
      phone: cleanPhone,
      role_id: Number(role_id),
      is_active: is_active ?? true,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
      ...timestamps()
    };
    if (cleanEmail) {
      userDoc.email = cleanEmail;
    }

    const result = await withTransaction(async (db, session) => {
      await lockAccountIntegrity(db, session);
      return db.collection('users').insertOne(userDoc, { session });
    });

    res.status(201).json({
      _id: result.insertedId,
      username: cleanUsername,
      full_name: cleanFullName,
      email: cleanEmail,
      phone: cleanPhone,
      role_id: Number(role_id),
      role_name: role.name,
      is_active: userDoc.is_active
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: 'validation_error', message: error.message });
    if (error.code === 11000) {
      return res.status(409).json({ error: 'conflict', message: 'Username or email already exists' });
    }
    res.status(500).json({ error: 'creation_failed', message: 'Failed to create user' });
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await withTransaction((db, session) => updateUser(db, session, toObjectId(req.params.id), req.body, req.user.id));
    return res.json(result);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'conflict', message: 'Email or username already exists' });
    if (error.status) return res.status(error.status).json({ error: error.code || 'validation_error', message: error.message });
    return res.status(500).json({ error: 'update_failed', message: 'Failed to update user' });
  }
});

router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;
    if (typeof new_password !== 'string' || !new_password) return res.status(400).json({ error: 'missing_password', message: 'New password required' });
    if (new_password.length < 8) return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 8 characters' });

    const db = getDb();
    const passwordHash = await bcrypt.hash(new_password, 10);
    const result = await db.collection('users').findOneAndUpdate(
      { _id: toObjectId(id) },
      { $set: { password_hash: passwordHash, failed_attempts: 0, locked_until: null, ...updateTimestamp() } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'user_not_found', message: 'User not found' });

    // Revoke all existing sessions for this user on password reset
    await db.collection('auth_sessions').updateMany(
      { user_id: result._id },
      { $set: { revoked_at: new Date(), ...updateTimestamp() } }
    );

    res.json({ message: 'Password reset successfully', user: { id: result._id, username: result.username, full_name: result.full_name } });
  } catch (error) {
    res.status(500).json({ error: 'reset_failed', message: 'Failed to reset password' });
  }
});

export default router;
