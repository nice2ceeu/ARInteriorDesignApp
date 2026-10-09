import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import userRoutes from '../../src/routes/users.js';
import { authenticate, optionalAuth } from '../../src/middleware/auth.js';
import { createToken, verifyToken } from '../../src/services/tokenService.js';
import { findUserByEmail } from '../../src/data/hardcodedUsers.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/users', userRoutes);
app.get('/optional', optionalAuth, (req, res) => res.json({ user: req.user }));
app.get('/protected', authenticate, (req, res) => res.json({ user: req.user }));
app.use(errorHandler);

test('local signup and login issue signed tokens; forged credentials fail closed', async () => {
  const email = 'regression@example.com';
  const signup = await request(app).post('/users/signup')
    .send({ email, password: 'correct-password', name: 'Regression' }).expect(201);
  assert.equal(signup.body.user.email, email);
  assert.notEqual(findUserByEmail(email).password, 'correct-password');
  const token = signup.body.token;
  const userId = signup.body.user.id;
  assert.equal(verifyToken(token).userId, userId);
  await request(app).post('/users/login').send({ email, password: 'wrong' }).expect(401);
  await request(app).post('/users/login').send({ email, password: 'correct-password' }).expect(200);
  await request(app).get('/users/me').set('Authorization', `Bearer ${token}`).expect(200);
  await request(app).get('/users/me').set('X-API-Key', token).expect(200);
  await request(app).get('/protected').expect(401);

  const payload = Buffer.from(JSON.stringify({ userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const forged = `e30.${payload}.invalid`;
  const wrongKey = jwt.sign({ userId }, 'attacker-controlled-key');
  const expired = createToken({ userId, iat: Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60 });
  for (const invalid of [forged, wrongKey, expired, 'malformed']) {
    assert.equal(verifyToken(invalid), null);
    await request(app).get('/protected').set('Authorization', `Bearer ${invalid}`).expect(401);
    const optional = await request(app).get('/optional').set('X-API-Key', invalid).expect(200);
    assert.equal(optional.body.user, null);
  }
  const previousEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    await request(app).get('/protected').expect(401);
    await request(app).get('/protected').set('Authorization', `Bearer ${forged}`).expect(401);
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
