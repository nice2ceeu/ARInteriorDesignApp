// Development-only, ephemeral accounts for running without MongoDB.
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const users = new Map();
const enabled = () => process.env.NODE_ENV !== 'production';

export function findUserByEmail(email) {
  if (!enabled() || typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return [...users.values()].find(user => user.email === normalized) || null;
}

export function findUserById(id) {
  return enabled() ? users.get(id) || null : null;
}

export function verifyPassword(user, password) {
  return enabled() && typeof password === 'string' && !!user &&
    bcrypt.compareSync(password, user.password);
}

export function createUser(email, password, name) {
  if (!enabled()) {
    const error = new Error('MongoDB is required for user accounts in production');
    error.statusCode = 503;
    throw error;
  }
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 6) {
    const error = new Error('A valid email and password of at least 6 characters are required');
    error.statusCode = 400;
    throw error;
  }
  if (findUserByEmail(email)) {
    const error = new Error('An account with this email already exists');
    error.code = 11000;
    throw error;
  }
  const user = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    password: bcrypt.hashSync(password, 10),
    name: typeof name === 'string' ? name.trim() : '',
    role: 'user',
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);
  return user;
}
