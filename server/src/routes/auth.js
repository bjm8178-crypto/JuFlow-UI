import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate } from '../middleware/auth.js';
import { sessionCookie, clearSessionCookie } from '../middleware/cookies.js';

const SECURE = () => process.env.NODE_ENV === 'production';
const SESSION_MS = 24 * 60 * 60 * 1000;

const router = express.Router();

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const rawIdentifier = req.body?.username ?? req.body?.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const password = req.body?.password;
    if (!identifier || identifier.length > 254 || typeof password !== 'string' || !password || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'missing_credentials', message: 'Username and password required' });
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ $or: [{ username: identifier }, { email: identifier.toLowerCase() }] });
    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'account_disabled', message: 'Account disabled' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ error: 'account_locked', message: 'Account locked. Try again later.' });
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      const newFailedAttempts = (user.failed_attempts || 0) + 1;
      if (newFailedAttempts >= 5) {
        await db.collection('users').updateOne({ _id: user._id }, { 
          $set: { failed_attempts: newFailedAttempts, locked_until: new Date(Date.now() + 30*60*1000), ...updateTimestamp() }
        });
        return res.status(403).json({ error: 'account_locked', message: 'Too many failed attempts. Locked for 30 minutes.' });
      }
      await db.collection('users').updateOne({ _id: user._id }, { $set: { failed_attempts: newFailedAttempts, ...updateTimestamp() }});
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    }

    const role = await db.collection('roles').findOne({ _id: user.role_id });
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.collection('auth_sessions').insertOne({
      user_id: user._id,
      token_hash: tokenHash,
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.get('user-agent') || '',
      expires_at: new Date(Date.now() + SESSION_MS),
      revoked_at: null,
      ...timestamps()
    });

    await db.collection('users').updateOne({ _id: user._id }, { 
      $set: { failed_attempts: 0, locked_until: null, last_login_at: new Date(), ...updateTimestamp() }
    });

    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_MS, SECURE()));
    res.json({
      user: {
        id: user._id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: role?.name,
        role_name: role?.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'login_failed', message: 'Login failed' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const db = getDb();
    if (req.user?.session_id) {
      await db.collection('auth_sessions').updateOne(
        { _id: toObjectId(req.user.session_id) },
        { $set: { revoked_at: new Date(), ...updateTimestamp() } }
      );
    }
    res.setHeader('Set-Cookie', clearSessionCookie(SECURE()));
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'logout_failed', message: 'Logout failed' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne({ _id: toObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error: 'user_not_found', message: 'User not found' });
    
    const role = await db.collection('roles').findOne({ _id: user.role_id });
    const userObj = {
      id: user._id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      role_id: user.role_id,
      role_name: role?.name,
      role: role?.name,
      is_active: user.is_active,
      last_login_at: user.last_login_at
    };

    // Return both { user: ... } and top-level fields for maximum compatibility with both frontends
    res.json({
      ...userObj,
      user: userObj
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'fetch_failed', message: 'Failed to fetch user' });
  }
});

/**
 * POST /api/auth/change-password
 */
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (typeof current_password !== 'string' || typeof new_password !== 'string' || !current_password || !new_password || Buffer.byteLength(current_password) > 72 || Buffer.byteLength(new_password) > 72) {
      return res.status(400).json({ error: 'missing_fields', message: 'Current and new password required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 8 characters' });
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ _id: toObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error: 'user_not_found', message: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'invalid_password', message: 'Current password incorrect' });

    const newHash = await bcrypt.hash(new_password, 10);
    await db.collection('users').updateOne({ _id: user._id }, { $set: { password_hash: newHash, ...updateTimestamp() }});

    // Revoke all existing sessions for this user on password change
    await db.collection('auth_sessions').updateMany(
      { user_id: user._id },
      { $set: { revoked_at: new Date(), ...updateTimestamp() } }
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'change_password_failed', message: 'Failed to change password' });
  }
});

export default router;
