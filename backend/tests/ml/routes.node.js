import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import mlRoutes from '../../src/routes/ml.js';
import designRoutes from '../../src/routes/designs.js';
import aiDesignController from '../../src/controllers/aiDesignController.js';
import { authenticate } from '../../src/middleware/auth.js';
import { createToken } from '../../src/services/tokenService.js';
import { createUser } from '../../src/data/hardcodedUsers.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/ml', mlRoutes);
app.use('/designs', designRoutes);
app.post('/design/generate', authenticate, aiDesignController.generateLayout);
app.use(errorHandler);

test('legacy floor-plan and proposal endpoints work without Gemini or MongoDB', async () => {
  const user = createUser('layout-test@example.com', 'password123', 'Layout Test');
  const token = createToken({ userId: user.id });
  const body = { roomType: 'Bedroom', style: 'Minimalist', roomDimensions: { width: 5, depth: 4, height: 2.7 }, budgetPHP: 30000, requiredFurniture: ['desk'] };
  const legacy = await request(app).post('/design/generate').set('X-API-Key', token).send(body).expect(200);
  assert.ok(Array.isArray(legacy.body) && legacy.body.length >= 2);
  assert.ok(legacy.body[0].estimatedCostPHP <= 30000);
  assert.ok(legacy.body[0].furniture.some(item => item.type === 'desk'));
  const modern = await request(app).post('/designs/generate').send(body).expect(200);
  assert.ok(modern.body.bestFitRecommendation);
  assert.ok(modern.body.exportData.structuredData);
  const catalog = await request(app).get('/designs/furniture/Bedroom').expect(200);
  assert.equal(catalog.body.currency, 'PHP');
  const estimate = await request(app).post('/designs/estimate-cost').send({ furniture: catalog.body.furniture }).expect(200);
  assert.equal(estimate.body.average, catalog.body.furniture.reduce((sum, item) => sum + item.pricePHP, 0));
});

test('detection is authenticated, validates input and never invents results when ML is absent', async () => {
  await request(app).post('/ml/detect').send({ imageBase64: 'anything' }).expect(401);
  const user = createUser('detector-test@example.com', 'password123', 'Detector Test');
  const token = createToken({ userId: user.id });
  await request(app).post('/ml/detect').set('X-API-Key', token).send({ labels: ['chair'] }).expect(400);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('ML service offline'); };
    const absent = await request(app).post('/ml/detect').set('X-API-Key', token).send({ imageBase64: 'aGVsbG8=' }).expect(503);
    assert.equal(absent.body.detections, undefined);
    const status = await request(app).get('/ml/status').expect(200);
    assert.equal(status.body.detectorReady, false);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ model: 'owlv2', detections: [{ label: 'chair', confidence: 0.8 }] }) });
    const detected = await request(app).post('/ml/detect').set('X-API-Key', token).send({ imageBase64: 'aGVsbG8=' }).expect(200);
    assert.equal(detected.body.detections[0].label, 'chair');
  } finally { globalThis.fetch = originalFetch; }
});
