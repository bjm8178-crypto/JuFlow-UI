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
      return { ...user, role_name: role?.name };
    }));
    res.json(usersWithRoles);
  } catch (error) {
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch users' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, full_name, email, phone, role_id } = req.body;
    if (!username || !password || !full_name || !role_id) {
      return res.status(400).json({ error: 'missing_fields', message: 'Username, password, full name, and role required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 6 characters' });
    }

    const db = getDb();
    const existing = await db.collection('users').findOne({ username });
    if (existing) return res.status(409).json({ error: 'username_exists', message: 'Username already exists' });

    if (email) {
      const existingEmail = await db.collection('users').findOne({ email });
      if (existingEmail) return res.status(409).json({ error: 'email_exists', message: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({
      username, password_hash: passwordHash, full_name, email: email || null, phone: phone || null,
      role_id, is_active: true, failed_attempts: 0, locked_until: null, last_login_at: null, ...timestamps()
    });

    const role = await db.collection('roles').findOne({ _id: role_id });
    res.status(201).json({ _id: result.insertedId, username, full_name, email, phone, role_id, role_name: role?.name, is_active: true });
  } catch (error) {
    res.status(500).json({ error: 'create_failed', message: 'Failed to create user' });
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role_id, is_active } = req.body;
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email || null;
    if (phone !== undefined) updates.phone = phone || null;
    if (role_id !== undefined) updates.role_id = role_id;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const db = getDb();
    const result = await db.collection('users').findOneAndUpdate(
      { _id: toObjectId(id) },
      { $set: { ...updates, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'user_not_found', message: 'User not found' });
    const role = await db.collection('roles').findOne({ _id: result.role_id });
    res.json({ ...result, role_name: role?.name });
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
      { $set: { password_hash: passwordHash, failed_attempts: 0, locked_until: null, ...updateTimestamp() }},
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'user_not_found', message: 'User not found' });
    res.json({ message: 'Password reset successfully', user: { id: result._id, username: result.username, full_name: result.full_name }});
  } catch (error) {
    res.status(500).json({ error: 'reset_failed', message: 'Failed to reset password' });
  }
});

export default router;
