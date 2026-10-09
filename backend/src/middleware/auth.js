/**
 * Authentication middleware
 * Accepts signed JWTs through Authorization or X-API-Key.
 * Uses MongoDB accounts, with local accounts available outside production.
 */

import { findUserById } from '../data/hardcodedUsers.js';

import { verifyToken } from '../services/tokenService.js';

import User from '../models/User.js';
import { isMongoDBConnected } from '../db/mongodb.js';

export async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'];
  const token = authHeader?.replace('Bearer ', '') || apiKey;

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization token or API key required',
    });
  }

  try {
    // Try to verify as JWT token first
    const decoded = await verifyToken(token);

    if (decoded && decoded.userId) {
      let user = null;

      // 1. Try MongoDB if connected
      if (isMongoDBConnected() && /^[a-f0-9]{24}$/i.test(decoded.userId)) {
        const dbUser = await User.findById(decoded.userId);
        if (dbUser) {
          user = {
            id: dbUser._id.toString(),
            email: dbUser.email,
            name: dbUser.name,
            role: 'user', // Default role
          };
        }
      }

      // 2. Fallback to hardcoded users if not found in DB or DB not connected
      if (!user) {
        const localUser = findUserById(decoded.userId);
        if (localUser) {
          user = {
            id: localUser.id,
            email: localUser.email,
            name: localUser.name,
            role: localUser.role || 'user',
          };
        }
      }

      // 3. User not found anywhere
      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User not found',
        });
      }

      req.user = {
        userId: user.id,
        id: user.id, // For backward compatibility
        email: user.email,
        name: user.name,
        role: user.role,
      };
      return next();
    }

    // If token is invalid or expired
    console.error('[Auth] Token verification failed (logic flow)');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  } catch (error) {
    console.error('[Auth] Token verification failed (exception):', error.message);

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

/**
 * Optional authentication - doesn't fail if no auth provided
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'];
  const token = authHeader?.replace('Bearer ', '') || apiKey;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    // Try JWT verification
    const decoded = await verifyToken(token);

    if (decoded && decoded.userId) {
      let user = null;

      // 1. Try MongoDB
      if (isMongoDBConnected() && /^[a-f0-9]{24}$/i.test(decoded.userId)) {
        const dbUser = await User.findById(decoded.userId);
        if (dbUser) {
          user = {
            id: dbUser._id.toString(),
            email: dbUser.email,
            name: dbUser.name,
            role: 'user',
          };
        }
      }

      // 2. Fallback to local
      if (!user) {
        const localUser = findUserById(decoded.userId);
        if (localUser) {
          user = {
            id: localUser.id,
            email: localUser.email,
            name: localUser.name,
            role: localUser.role || 'user',
          };
        }
      }

      if (user) {
        req.user = {
          userId: user.id,
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      } else {
        req.user = null;
      }
    } else {
      req.user = null;
    }
  } catch (error) {
    req.user = null;
  }

  next();
}

