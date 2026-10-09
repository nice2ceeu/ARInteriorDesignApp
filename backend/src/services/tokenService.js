import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';

const configuredSecret = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' &&
    (!configuredSecret || configuredSecret === 'your-secret-key-change-in-production')) {
  throw new Error('A private JWT_SECRET must be configured in production');
}
const secret = configuredSecret || randomBytes(32).toString('hex');

export function createToken(payload) {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}
