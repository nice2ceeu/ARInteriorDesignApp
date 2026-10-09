import test from 'node:test';
import assert from 'node:assert/strict';
import { planLayouts, footprint, overlaps } from '../../src/services/layoutPlanner.js';

const request = {
  roomType: 'Bedroom', style: 'Minimalist', roomDimensions: { width: 5, depth: 4, height: 2.7 },
  budgetPHP: 30000, requiredFurniture: ['desk', 'chair'],
  constraints: { fixedObstacles: [{ position: { x: 0, z: 0, rotation: 0 }, dimensions: { width: 1, length: 1, height: 2 } }] },
};

test('generated variations obey measured boundaries, collisions, required items and PHP budget', async () => {
  const output = await planLayouts(request);
  assert.equal(output.metadata.rankingSource, 'geometric');
  assert.equal(output.metadata.confidenceScore, null);
  assert.ok(output.proposals.length >= 2);
  assert.equal(new Set(output.proposals.map(proposal => JSON.stringify(proposal.layout.furniture.map(item => item.position)))).size, output.proposals.length);
  for (const proposal of output.proposals) {
    assert.ok(proposal.estimatedCost.mid <= request.budgetPHP);
    const furniture = proposal.layout.furniture;
    assert.ok(furniture.some(item => item.type === 'desk'));
    assert.ok(furniture.some(item => item.type === 'chair'));
    for (let i = 0; i < furniture.length; i++) {
      const box = footprint(furniture[i]);
      assert.ok(box.x >= 0 && box.z >= 0);
      assert.ok(box.x + box.width <= 5 + 1e-9 && box.z + box.length <= 4 + 1e-9);
      assert.equal(overlaps(box, { x: 0, z: 0, width: 1, length: 1 }, 0.3), false);
      for (let j = i + 1; j < furniture.length; j++) assert.equal(overlaps(box, footprint(furniture[j]), 0.3), false);
    }
  }
});

test('rejects invalid dimensions, unknown required items and impossible requirements', async () => {
  await assert.rejects(planLayouts({ ...request, roomDimensions: { width: -1, depth: 4, height: 2 } }), { statusCode: 400 });
  await assert.rejects(planLayouts({ ...request, requiredFurniture: ['unknown-item'] }), { statusCode: 400 });
  await assert.rejects(planLayouts({ ...request, budgetPHP: 100 }), { statusCode: 422 });
  await assert.rejects(planLayouts({ ...request, constraints: {}, roomDimensions: { width: 0.5, depth: 0.5, height: 2.7 } }), { statusCode: 422 });
});

test('a trained ranking response determines ordering while malformed responses fall back honestly', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      const count = JSON.parse(options.body).candidates.length;
      return { ok: true, json: async () => ({ scores: Array.from({ length: count }, (_, index) => index), modelVersion: 'test-ranker' }) };
    };
    const output = await planLayouts(request);
    assert.equal(output.metadata.rankingSource, 'xgboost');
    assert.equal(output.metadata.modelVersion, 'test-ranker');
    assert.ok(output.proposals[0].rankingScore > output.proposals[1].rankingScore);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ scores: [NaN] }) });
    const fallback = await planLayouts(request);
    assert.equal(fallback.metadata.rankingSource, 'geometric');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
