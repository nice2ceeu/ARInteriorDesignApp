import test from 'node:test';
import assert from 'node:assert/strict';
import { planLayouts, footprint, overlaps } from '../../src/services/layoutPlanner.js';

const request = {
  roomType: 'Bedroom', style: 'Minimalist', roomDimensions: { width: 5, depth: 4, height: 2.7 },
  budgetPHP: 30000, requiredFurniture: ['desk', 'chair'],
  constraints: { fixedObstacles: [{ position: { x: 0, z: 0, rotation: 0 }, dimensions: { width: 1, length: 1, height: 2 } }] },
};

// Runs a test with the ML service mocked: handlers map an ML path to a JSON response or an Error
async function withML(handlers, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const handler = handlers[new URL(url).pathname];
    if (!handler) throw new Error('ML service offline');
    const body = typeof handler === 'function' ? handler(JSON.parse(options.body)) : handler;
    return { ok: true, json: async () => body };
  };
  try { return await run(); } finally { globalThis.fetch = originalFetch; }
}

test('generated variations obey measured boundaries, collisions, required items and PHP budget', async () => {
  const output = await withML({}, () => planLayouts(request));
  assert.equal(output.metadata.algorithm, 'constraint-placement');
  assert.ok(output.metadata.warnings.some(warning => warning.includes('optimizer is offline')));
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
  const rank = ({ candidates }) => ({ scores: candidates.map((_, index) => index), modelVersion: 'test-ranker' });
  const output = await withML({ '/rank': rank }, () => planLayouts(request));
  assert.equal(output.metadata.rankingSource, 'xgboost');
  assert.equal(output.metadata.modelVersion, 'test-ranker');
  assert.ok(output.proposals[0].rankingScore > output.proposals[1].rankingScore);
  const fallback = await withML({ '/rank': { scores: [NaN] } }, () => planLayouts(request));
  assert.equal(fallback.metadata.rankingSource, 'geometric');
});

test('guideline-optimized layouts are used and explained, and malformed ones are rejected', async () => {
  let sent;
  const layout = (deskX, passed) => ({
    furniture: [
      { id: 'desk-0', x: deskX, z: 3.25, rotation: 180 },
      { id: 'chair-0', x: deskX + 0.4, z: 2.6, rotation: 0 },
    ],
    score: passed ? 100 : 50, omitted: [],
    checks: [{ rule: 'Writing Desk against a wall', passed: true }, { rule: 'Desk near the window for daylight', passed }],
  });
  const optimize = body => {
    sent = body;
    const ids = Object.fromEntries(body.items.map(item => [item.type, item.id]));
    const rename = l => ({ ...l, furniture: l.furniture.map(f => ({ ...f, id: ids[f.id.split('-')[0]] })) });
    return { layouts: [rename(layout(1.5, true)), rename(layout(3.5, false))] };
  };
  const withDoor = { ...request, requiredFurniture: ['desk', 'chair'], budgetPHP: 6300, constraints: {},
    openings: [{ type: 'door', wall: 'south', offset: 0.2 }, { type: 'window', wall: 'north' }] };
  const output = await withML({ '/optimize-layout': optimize }, () => planLayouts(withDoor));
  assert.equal(output.metadata.algorithm, 'guideline-annealing');
  assert.deepEqual(sent.openings, [
    { type: 'door', wall: 'south', offset: 0.2, width: 0.9 },
    { type: 'window', wall: 'north', offset: 0.5, width: 1.2 },
  ]);
  const [best, second] = output.proposals;
  assert.equal(best.performanceScore.overall, 100);
  assert.ok(best.pros.includes('Desk near the window for daylight'));
  assert.ok(second.cons.includes('Not met: Desk near the window for daylight'));
  assert.equal(best.layout.furniture.find(item => item.type === 'desk').position.rotation, 180);
  assert.equal(best.designChecks.length, 2);

  const outside = () => ({ layouts: [{ furniture: [{ id: 'desk-x', x: 9, z: 9, rotation: 0 }], checks: [], omitted: [] }] });
  const rejected = await withML({ '/optimize-layout': outside }, () => planLayouts(withDoor));
  assert.equal(rejected.metadata.algorithm, 'constraint-placement');
  await assert.rejects(planLayouts({ ...withDoor, openings: [{ type: 'door', wall: 'up' }] }), { statusCode: 400 });
});
