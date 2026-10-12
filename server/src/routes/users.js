import express from 'express';
import bcrypt from 'bcrypt';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

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
    const { username, password, full_name, email, phone, role_id } = req.body;
    if (!username || !password || !full_name || role_id === undefined) {
      return res.status(400).json({ error: 'missing_fields', message: 'Username, password, full name, and role required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 6 characters' });
    }

    const db = getDb();

    // Validate role exists
    const role = await db.collection('roles').findOne({ _id: Number(role_id) });
    if (!role) {
      return res.status(400).json({ error: 'invalid_role', message: 'Specified role does not exist' });
    }

    const existing = await db.collection('users').findOne({ username });
    if (existing) return res.status(409).json({ error: 'username_exists', message: 'Username already exists' });

    if (email) {
      const existingEmail = await db.collection('users').findOne({ email });
      if (existingEmail) return res.status(409).json({ error: 'email_exists', message: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({
      username,
      password_hash: passwordHash,
      full_name,
      email: email || null,
      phone: phone || null,
      role_id: Number(role_id),
      is_active: true,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
      ...timestamps()
    });

    res.status(201).json({
      _id: result.insertedId,
      username,
      full_name,
      email: email || null,
      phone: phone || null,
      role_id: Number(role_id),
      role_name: role.name,
      is_active: true
    });
  } catch (error) {
    res.status(500).json({ error: 'create_failed', message: 'Failed to create user' });
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role_id, is_active } = req.body;
    const updates = {};

    const db = getDb();
    const targetUser = await db.collection('users').findOne({ _id: toObjectId(id) });
    if (!targetUser) return res.status(404).json({ error: 'user_not_found', message: 'User not found' });

    // Prevent self-deactivation
    if (is_active === false && req.user.id.toString() === id) {
      return res.status(400).json({ error: 'cannot_deactivate_self', message: 'You cannot deactivate your own account' });
    }

    // Role validation
    if (role_id !== undefined) {
      const role = await db.collection('roles').findOne({ _id: Number(role_id) });
      if (!role) {
        return res.status(400).json({ error: 'invalid_role', message: 'Specified role does not exist' });
      }
      updates.role_id = Number(role_id);
    }

    // Prevent removing the last active administrator
    if ((is_active === false || (role_id !== undefined && Number(role_id) !== 1)) && targetUser.role_id === 1) {
      const activeAdminCount = await db.collection('users').countDocuments({ role_id: 1, is_active: true });
      if (activeAdminCount <= 1) {
        return res.status(400).json({
          error: 'cannot_remove_last_admin',
          message: 'Cannot deactivate or demote the last remaining active administrator'
        });
      }
    }

    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email || null;
    if (phone !== undefined) updates.phone = phone || null;
    if (is_active !== undefined) {
      updates.is_active = is_active;
      // If deactivating user, revoke all active sessions immediately
      if (is_active === false) {
        await db.collection('auth_sessions').updateMany(
          { user_id: targetUser._id },
          { $set: { revoked_at: new Date(), ...updateTimestamp() } }
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const result = await db.collection('users').findOneAndUpdate(
      { _id: toObjectId(id) },
      { $set: { ...updates, ...updateTimestamp() } },
      { returnDocument: 'after' }
    );

    const role = await db.collection('roles').findOne({ _id: result.role_id });
    // Never expose password_hash
    const { password_hash: _, ...safeResult } = result;
    res.json({ ...safeResult, role_name: role?.name });
  } catch (error) {
    res.status(500).json({ error: 'update_failed', message: 'Failed to update user' });
  }
});

router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;
    if (!new_password) return res.status(400).json({ error: 'missing_password', message: 'New password required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 6 characters' });

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
