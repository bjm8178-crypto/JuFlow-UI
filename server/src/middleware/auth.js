import crypto from 'crypto';
import { getDb, toObjectId } from '../db/mongodb.js';
import { parseCookies, SESSION_COOKIE } from './cookies.js';

/**
 * Authenticate browser sessions; device credentials have their own scoped middleware.
 */
export async function authenticate(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
    req.authVia = 'cookie';

    if (!token) {
      return res.status(401).json({
        error: 'missing_token',
        message: 'Authentication required'
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const db = getDb();

    // Find session with user and role info
    const session = await db.collection('auth_sessions').findOne({
      token_hash: tokenHash,
      expires_at: { $gt: new Date() },
      revoked_at: null
    });

    if (!session) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid or expired token'
      });
    }

    // Get user
    const user = await db.collection('users').findOne({
      _id: session.user_id,
      is_active: true
    });

    if (!user) {
      return res.status(403).json({
        error: 'user_inactive',
        message: 'User account is inactive'
      });
    }

    // Get role
    const role = await db.collection('roles').findOne({ _id: user.role_id });

    // Attach user info to request
    req.user = {
      id: user._id.toString(),
      session_id: session._id.toString(),
      username: user.username,
      full_name: user.full_name,
      role_id: user.role_id,
      role_name: role?.name || 'unknown',
      role: role?.name || 'unknown'
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(503).json({
      error: 'service_unavailable',
      message: 'Authentication service is temporarily unavailable'
    });
  }
}

/**
 * Role-based access control middleware
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'not_authenticated',
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role_name)) {
      return res.status(403).json({
        error: 'insufficient_permissions',
        message: 'You do not have permission to access this resource'
      });
    }

    next();
  };
}
