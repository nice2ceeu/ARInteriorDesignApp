/**
 * Layout Optimizer
 * Refines a planned furniture layout by simulated annealing over a cost built from
 * interior design guidelines, following Merrell et al. (2011, "Interactive Furniture
 * Layout Using Interior Design Guidelines") and Yu et al. (2011, "Make It Home"):
 * wall placement, functional pairs, clearance zones, door swing, walkable circulation,
 * window light and visual balance.
 *
 * Ported from ml-service/layout_optimizer.py and adapted to the layout planner's frame:
 * room-local metres, x along the room width, z along its length, an optional floor
 * outline polygon. A pose {x, z, rot} puts the min corner of the rotated footprint at
 * (x, z); rot 0 faces +z, 90 faces +x, 180 faces -z, 270 faces -x.
 */

import { insidePolygon, pointInPolygon } from '../utils/roomGeometry.js';

const ROTATIONS = [0, 90, 180, 270];
const GRID = 0.15;      // metres per circulation cell
const WALKWAY = 0.6;    // minimum clear walkway width
const NEAR_WALL = 0.12; // tolerance for "against the wall"
const WALL_GAP = 0.05;  // gap kept between furniture and walls
const ITEM_GAP = 0.3;   // clearance between unrelated pieces
const PARTNER_GAP = 0.03; // between pieces that go together (side table, nightstand, chairs: 5 cm by design)
const DOOR_APPROACH = 0.4;

// Furniture whose back belongs against a wall
const WALL_ROLES = new Set(['bed', 'wardrobe', 'dresser', 'desk', 'sofa', 'storage', 'tv-stand', 'nightstand']);

// dependent role -> [anchor roles, relation, offset in metres]
const PAIRS = {
  nightstand: [['bed'], 'beside-head', 0.03],
  'desk-chair': [['desk'], 'front', 0.05],
  chair: [['desk'], 'front', 0.05],
  'coffee-table': [['sofa'], 'front', 0.45],
  armchair: [['coffee-table', 'sofa'], 'near', 1.3],
  'side-table': [['sofa', 'armchair', 'bed'], 'beside', 0.05],
  'tv-stand': [['sofa'], 'opposite', 2.6],
  lamp: [['sofa', 'armchair', 'desk', 'bed'], 'near', 0.9],
  'dining-chair': [['dining-table'], 'around', 0.05],
  stool: [['island'], 'around', 0.05],
};

// Group members that belong in front of their anchor (a lamp or side table does not)
const IN_FRONT_ROLES = new Set(['coffee-table', 'desk-chair', 'chair', 'dining-chair', 'stool', 'armchair']);

// Clear floor needed in front of an item (metres)
const FRONT_CLEARANCE = {
  bed: 0.6, wardrobe: 0.9, dresser: 0.8, desk: 0.7, sofa: 0.6, storage: 0.6, 'tv-stand': 0.5,
};

export const WEIGHTS = {
  overlap: 60, wall: 4, pair: 3, facing: 0.8, front: 4,
  door: 40, window: 2, light: 0.6, access: 3, reach: 2, balance: 1,
};

const FRONT = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };

// ---------------------------------------------------------------- geometry

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function dims(item, rot) {
  return rot % 180 === 0 ? { w: item.width, d: item.length } : { w: item.length, d: item.width };
}

function rectOf(item, pose) {
  const { w, d } = dims(item, pose.rot);
  return { x: pose.x, z: pose.z, w, d };
}

const area = (r) => Math.max(0, r.w) * Math.max(0, r.d);

function intersection(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const d = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  return w > 0 && d > 0 ? w * d : 0;
}

const grow = (r, p) => ({ x: r.x - p, z: r.z - p, w: r.w + 2 * p, d: r.d + 2 * p });
const center = (r) => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });

/**
 * Where an armchair at `from` should look: the floor in front of a sofa, or the middle of a coffee
 * table. A chair out past that floor, straight in front of the sofa, looks back at the sofa: facing
 * the point turned it away from the sofa, its back against the sofa's front (2026-11-12).
 */
function seatTarget(anchor, anchorPose, from) {
  const c = center(rectOf(anchor, anchorPose));
  if (anchor.role !== 'sofa') return c;
  const [fx, fz] = FRONT[anchorPose.rot];
  const reach = dims(anchor, 0).d / 2 + 0.8;
  if (from && (from.x - c.x) * fx + (from.z - c.z) * fz >= reach) return c;
  return { x: c.x + fx * reach, z: c.z + fz * reach };
}

/**
 * How near (centre to centre) an armchair belongs to its seating. The fixed 1.3 m was only
 * reachable with a deep sofa set and a large accent chair touching (a 1.64 m set and a 1.21 m chair
 * ended up pressed together), so it grows with the two pieces.
 */
function nearDistance(dep, anchor, offset) {
  if (dep.role !== 'armchair') return offset;
  return Math.max(offset, anchor.length / 2 + Math.max(dep.width, dep.length) / 2 + 0.45);
}

/** The piece faces `point` to within about 70°. */
function facesTowards(rect, rot, point) {
  const c = center(rect);
  const [fx, fz] = FRONT[rot];
  const dx = point.x - c.x;
  const dz = point.z - c.z;
  return (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz)) >= 0.3;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function gapBetween(a, b) {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dz = Math.max(0, b.z - (a.z + a.d), a.z - (b.z + b.d));
  return Math.hypot(dx, dz);
}

function backCenter(item, pose) {
  const r = rectOf(item, pose);
  switch (pose.rot) {
    case 0: return { x: r.x + r.w / 2, z: r.z };
    case 90: return { x: r.x, z: r.z + r.d / 2 };
    case 180: return { x: r.x + r.w / 2, z: r.z + r.d };
    default: return { x: r.x + r.w, z: r.z + r.d / 2 };
  }
}

function frontZone(r, rot, depth) {
  switch (rot) {
    case 0: return { x: r.x, z: r.z + r.d, w: r.w, d: depth };
    case 180: return { x: r.x, z: r.z - depth, w: r.w, d: depth };
    case 90: return { x: r.x + r.w, z: r.z, w: depth, d: r.d };
    default: return { x: r.x - depth, z: r.z, w: depth, d: r.d };
  }
}

/** (u, v): sideways offset from the anchor's back centre, and distance in front of its back. */
function toLocal(anchor, anchorPose, point) {
  const b = backCenter(anchor, anchorPose);
  const [fx, fz] = FRONT[anchorPose.rot];
  const dx = point.x - b.x;
  const dz = point.z - b.z;
  return { u: dx * -fz + dz * fx, v: dx * fx + dz * fz };
}

function toWorld(anchor, anchorPose, u, v) {
  const b = backCenter(anchor, anchorPose);
  const [fx, fz] = FRONT[anchorPose.rot];
  return { x: b.x + u * -fz + v * fx, z: b.z + u * fx + v * fz };
}

/** Distance from `origin` along `dir` to the nearest outline edge, or null. */
function rayToOutline(origin, dir, polygon) {
  let best = null;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const denom = dir[0] * ez - dir[1] * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const ax = a.x - origin.x;
    const az = a.z - origin.z;
    const t = (ax * ez - az * ex) / denom;
    const s = (ax * dir[1] - az * dir[0]) / denom;
    if (t >= -1e-6 && s >= -1e-6 && s <= 1 + 1e-6 && (best === null || t < best)) best = Math.max(0, t);
  }
  return best;
}

/** Distance from the item's back edge to the wall behind it. */
function wallDistance(item, pose, room, polygon) {
  const r = rectOf(item, pose);
  const boxDistance = { 0: r.z, 90: r.x, 180: room.length - (r.z + r.d), 270: room.width - (r.x + r.w) }[pose.rot];
  if (!polygon) return boxDistance;
  const [fx, fz] = FRONT[pose.rot];
  const hit = rayToOutline(backCenter(item, pose), [-fx, -fz], polygon);
  return hit === null ? boxDistance : hit;
}

function clampPose(item, pose, room) {
  const { w, d } = dims(item, pose.rot);
  return {
    x: clamp(pose.x, WALL_GAP, Math.max(WALL_GAP, room.width - w - WALL_GAP)),
    z: clamp(pose.z, WALL_GAP, Math.max(WALL_GAP, room.length - d - WALL_GAP)),
    rot: pose.rot,
  };
}

/** Area of `r` outside the room box or the floor outline (outline part sampled on a 4x4 grid). */
function outsideArea(r, room, polygon) {
  const box = area(r) - intersection(r, { x: 0, z: 0, w: room.width, d: room.length });
  if (!polygon || insidePolygon(r, polygon)) return box;
  let outside = 0;
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      const p = { x: r.x + ((i + 0.5) / 4) * r.w, z: r.z + ((j + 0.5) / 4) * r.d };
      if (!pointInPolygon(p, polygon)) outside += 1;
    }
  }
  // A concave corner can poke in between samples; still count a little so it is never free.
  return box + Math.max(0.02, (outside / 16) * area(r));
}

// ---------------------------------------------------------------- relations

function relationCost(dep, depPose, anchor, anchorPose, relation, offset) {
  const depRect = rectOf(dep, depPose);
  const anchorRect = rectOf(anchor, anchorPose);
  const { u, v } = toLocal(anchor, anchorPose, center(depRect));
  const aw = anchor.width;
  switch (relation) {
    case 'beside-head': return Math.abs(Math.abs(u) - (aw / 2 + dep.width / 2 + offset)) + Math.abs(v - dep.length / 2);
    case 'front': return Math.abs(u) + Math.abs(v - (anchor.length + dep.length / 2 + offset));
    case 'opposite': return Math.abs(u) * 0.5 + Math.max(0, Math.abs(v - (anchor.length + offset)) - 0.6);
    case 'beside':
      return Math.abs(Math.abs(u) - (aw / 2 + dep.width / 2 + offset))
        + Math.max(0, Math.abs(v - anchor.length / 2) - anchor.length / 2);
    case 'around': return Math.max(0, gapBetween(depRect, anchorRect) - offset);
    case 'near': return Math.max(0, dist(center(depRect), center(anchorRect)) - nearDistance(dep, anchor, offset));
    default: return 0;
  }
}

/** A pose that satisfies the relation, used as a proposal move. */
function idealPose(dep, anchor, anchorPose, relation, offset, rng) {
  const ar = anchorPose.rot;
  const side = rng() < 0.5 ? -1 : 1;
  let u;
  let v;
  let rot;
  if (relation === 'beside-head') {
    [u, v, rot] = [side * (anchor.width / 2 + dep.width / 2 + offset), dep.length / 2, ar];
  } else if (relation === 'front') {
    [u, v, rot] = [0, anchor.length + dep.length / 2 + offset, dep.role === 'coffee-table' ? ar : (ar + 180) % 360];
  } else if (relation === 'opposite') {
    [u, v, rot] = [0, anchor.length + offset, (ar + 180) % 360];
  } else if (relation === 'beside') {
    [u, v, rot] = [side * (anchor.width / 2 + dep.width / 2 + offset), anchor.length / 2, ar];
  } else if (relation === 'around') {
    [u, v, rot] = [(rng() - 0.5) * anchor.width, anchor.length + dep.length / 2 + offset, (ar + 180) % 360];
  } else {
    const angle = rng() * 2 * Math.PI;
    const c = center(rectOf(anchor, anchorPose));
    const near = nearDistance(dep, anchor, offset);
    const px = c.x + near * Math.cos(angle);
    const pz = c.z + near * Math.sin(angle);
    // An armchair turns towards the seating; other pieces keep the anchor's direction.
    let rot = ar;
    if (dep.role === 'armchair') {
      const t = seatTarget(anchor, anchorPose, { x: px, z: pz });
      const toward = (r) => (t.x - px) * FRONT[r][0] + (t.z - pz) * FRONT[r][1];
      rot = ROTATIONS.reduce((best, r) => (toward(r) > toward(best) ? r : best), ar);
    }
    const { w, d } = dims(dep, rot);
    return { x: px - w / 2, z: pz - d / 2, rot };
  }
  const c = toWorld(anchor, anchorPose, u, v);
  const { w, d } = dims(dep, rot);
  return { x: c.x - w / 2, z: c.z - d / 2, rot };
}

// ---------------------------------------------------------------- scoring

function createScorer(room, items, features) {
  const polygon = features.polygon || null;
  const doorZones = features.doorZones || [];
  const windowZones = features.windowZones || [];
  // Furniture already in the room: it never moves, but new pieces pair with it and keep its front clear.
  // Indices past `moving` are these fixed pieces; their footprints leave the plain obstacle list.
  const fixed = (features.existing || []).filter((f) => f && f.pose && f.width > 0 && f.length > 0);
  const fixedIds = new Set(fixed.map((f) => f.id));
  const obstacles = (features.obstacles || []).filter((o) => !fixedIds.has(o.id));
  const fixedPoses = fixed.map((f) => f.pose);
  const all = [...items, ...fixed];
  const moving = items.length;
  const full = (poses) => (fixed.length === 0 ? poses : [...poses, ...fixedPoses]);
  /** The piece at index j (moving or fixed) and its pose. */
  const anchor = (j, poses) => [all[j], j < moving ? poses[j] : fixedPoses[j - moving]];

  const pairs = new Map();
  items.forEach((item, i) => {
    const rule = PAIRS[item.role];
    if (!rule) return;
    const [anchorRoles, relation, offset] = rule;
    const anchors = all.map((o, j) => j).filter((j) => j !== i && anchorRoles.includes(all[j].role));
    if (anchors.length > 0) pairs.set(i, { anchors, relation, offset });
  });

  // Pieces allowed to touch: the planner's furniture groups, dependents and their anchors
  const partners = all.map((item, i) => new Set(
    all.map((o, j) => j).filter((j) => j !== i && item.groupKey && all[j].groupKey === item.groupKey),
  ));
  pairs.forEach(({ anchors }, i) => anchors.forEach((j) => {
    partners[i].add(j);
    partners[j].add(i);
  }));

  // Circulation grid
  const nx = Math.max(1, Math.ceil(room.width / GRID));
  const nz = Math.max(1, Math.ceil(room.length / GRID));
  const outsideCells = new Uint8Array(nx * nz);
  if (polygon) {
    for (let zi = 0; zi < nz; zi += 1) {
      for (let xi = 0; xi < nx; xi += 1) {
        if (!pointInPolygon({ x: (xi + 0.5) * GRID, z: (zi + 0.5) * GRID }, polygon)) outsideCells[zi * nx + xi] = 1;
      }
    }
  }
  const radius = Math.max(1, Math.round(WALKWAY / 2 / GRID));
  const diskX = [];
  const diskZ = [];
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dz * dz <= radius * radius) {
        diskX.push(dx);
        diskZ.push(dz);
      }
    }
  }
  const reachRadius = radius + 1;
  const stack = new Int32Array(nx * nz);
  const rowPass = new Uint8Array(nx * nz);

  const cellRange = (r) => ({
    x0: Math.max(0, Math.floor(r.x / GRID)),
    z0: Math.max(0, Math.floor(r.z / GRID)),
    x1: Math.min(nx, Math.ceil((r.x + r.w) / GRID)),
    z1: Math.min(nz, Math.ceil((r.z + r.d) / GRID)),
  });

  /** Walkway reachability from the door (or the largest open area). */
  function circulation(rects) {
    const occupied = Uint8Array.from(outsideCells);
    [...rects, ...obstacles].forEach((r) => {
      const { x0, z0, x1, z1 } = cellRange(r);
      for (let zi = z0; zi < z1; zi += 1) for (let xi = x0; xi < x1; xi += 1) occupied[zi * nx + xi] = 1;
    });
    // A cell is standable when a walkway-wide disk around it is free and inside the room
    const standable = new Uint8Array(nx * nz);
    let standCount = 0;
    for (let zi = 0; zi < nz; zi += 1) {
      for (let xi = 0; xi < nx; xi += 1) {
        if (occupied[zi * nx + xi]) continue;
        let ok = true;
        for (let k = 0; k < diskX.length && ok; k += 1) {
          const x = xi + diskX[k];
          const z = zi + diskZ[k];
          ok = x >= 0 && z >= 0 && x < nx && z < nz && !occupied[z * nx + x];
        }
        if (ok) {
          standable[zi * nx + xi] = 1;
          standCount += 1;
        }
      }
    }
    // Connected walkway areas (4-neighbour flood fill)
    const labels = new Int32Array(nx * nz).fill(-1);
    const sizes = [];
    const visit = (n, id, top) => {
      if (standable[n] && labels[n] === -1) {
        labels[n] = id;
        stack[top] = n;
        return top + 1;
      }
      return top;
    };
    for (let start = 0; start < labels.length; start += 1) {
      if (!standable[start] || labels[start] !== -1) continue;
      const id = sizes.length;
      labels[start] = id;
      stack[0] = start;
      let top = 1;
      let size = 0;
      while (top > 0) {
        top -= 1;
        const idx = stack[top];
        size += 1;
        const xi = idx % nx;
        if (xi + 1 < nx) top = visit(idx + 1, id, top);
        if (xi > 0) top = visit(idx - 1, id, top);
        if (idx + nx < labels.length) top = visit(idx + nx, id, top);
        if (idx >= nx) top = visit(idx - nx, id, top);
      }
      sizes.push(size);
    }
    const reach = new Uint8Array(nx * nz);
    if (sizes.length === 0) return { reach, standable, standCount };

    let startId = -1;
    const doorCounts = new Map();
    doorZones.forEach((zone) => {
      const { x0, z0, x1, z1 } = cellRange(grow(zone, DOOR_APPROACH));
      for (let zi = z0; zi < z1; zi += 1) {
        for (let xi = x0; xi < x1; xi += 1) {
          const id = labels[zi * nx + xi];
          if (id >= 0) doorCounts.set(id, (doorCounts.get(id) || 0) + 1);
        }
      }
    });
    doorCounts.forEach((count, id) => {
      if (startId < 0 || count > doorCounts.get(startId)) startId = id;
    });
    if (startId < 0) startId = sizes.indexOf(Math.max(...sizes));

    // Dilate the reachable walkway (square, two separable passes) so furniture edges next to it count
    for (let zi = 0; zi < nz; zi += 1) {
      let last = -Infinity;
      for (let xi = 0; xi < nx; xi += 1) {
        if (labels[zi * nx + xi] === startId) last = xi;
        rowPass[zi * nx + xi] = xi - last <= reachRadius ? 1 : 0;
      }
      let next = Infinity;
      for (let xi = nx - 1; xi >= 0; xi -= 1) {
        if (labels[zi * nx + xi] === startId) next = xi;
        if (next - xi <= reachRadius) rowPass[zi * nx + xi] = 1;
      }
    }
    for (let xi = 0; xi < nx; xi += 1) {
      let last = -Infinity;
      for (let zi = 0; zi < nz; zi += 1) {
        if (rowPass[zi * nx + xi]) last = zi;
        if (zi - last <= reachRadius) reach[zi * nx + xi] = 1;
      }
      let next = Infinity;
      for (let zi = nz - 1; zi >= 0; zi -= 1) {
        if (rowPass[zi * nx + xi]) next = zi;
        if (next - zi <= reachRadius) reach[zi * nx + xi] = 1;
      }
    }
    return { reach, standable, standCount };
  }

  function anyIn(mask, r) {
    const { x0, z0, x1, z1 } = cellRange(r);
    for (let zi = z0; zi < z1; zi += 1) for (let xi = x0; xi < x1; xi += 1) if (mask[zi * nx + xi]) return true;
    return false;
  }

  function evaluate(movingPoses, explain = false) {
    const poses = full(movingPoses);
    const rects = all.map((item, i) => rectOf(item, poses[i]));
    const terms = Object.fromEntries(Object.keys(WEIGHTS).map((key) => [key, 0]));
    const checks = [];

    // Overlaps (with clearance between unrelated pieces), existing furniture and the outline
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        // A fixed piece keeps a full gap (as an obstacle did), unless the new piece belongs with it.
        // Pieces that go together still keep a few centimetres: touching ones show as overlapping
        // in AR, where the boxes are the models' own (2026-11-12).
        const pad = partners[i].has(j) ? PARTNER_GAP / 2 : j < moving ? ITEM_GAP / 2 : ITEM_GAP;
        terms.overlap += j < moving
          ? intersection(grow(rects[i], pad), grow(rects[j], pad))
          : intersection(grow(rects[i], pad), rects[j]);
      }
      terms.overlap += obstacles.reduce((sum, o) => sum + intersection(grow(rects[i], ITEM_GAP), o), 0);
      terms.overlap += outsideArea(rects[i], room, polygon);
    }
    if (explain) checks.push({ rule: 'No furniture overlaps and everything fits the room', passed: terms.overlap < 1e-6 });

    // Wall placement
    items.forEach((item, i) => {
      if (!WALL_ROLES.has(item.role)) return;
      const distance = wallDistance(item, poses[i], room, polygon) - WALL_GAP;
      terms.wall += Math.max(0, distance);
      if (explain && item.role !== 'nightstand') checks.push({ rule: `${item.name} against a wall`, passed: distance <= NEAR_WALL });
    });

    // Functional pairs
    pairs.forEach(({ anchors, relation, offset }, i) => {
      let bestJ = anchors[0];
      let cost = Infinity;
      anchors.forEach((j) => {
        const c = relationCost(items[i], poses[i], all[j], poses[j], relation, offset);
        if (c < cost) {
          cost = c;
          bestJ = j;
        }
      });
      terms.pair += cost;
      if (['front', 'opposite', 'around'].includes(relation) && items[i].role !== 'coffee-table') {
        terms.facing += poses[i].rot === (poses[bestJ].rot + 180) % 360 ? 0 : 1;
      }
      // A coffee table runs along the sofa; turned across it, it read as a mistake.
      if (items[i].role === 'coffee-table') {
        const parallel = poses[i].rot % 180 === poses[bestJ].rot % 180;
        terms.facing += parallel ? 0 : 1;
        if (explain) checks.push({ rule: `${items[i].name} runs along ${all[bestJ].name}`, passed: parallel });
      }
      // An armchair turns towards the seating it is near: "near" alone let it face the wall.
      if (items[i].role === 'armchair') {
        const facing = facesTowards(rects[i], poses[i].rot, seatTarget(all[bestJ], poses[bestJ], center(rects[i])));
        terms.facing += facing ? 0 : 1;
        if (explain) checks.push({ rule: `${items[i].name} faces the seating`, passed: facing });
      }
      if (explain) {
        const phrase = { 'beside-head': 'beside', front: 'at', opposite: 'facing', beside: 'beside', around: 'at', near: 'near' }[relation];
        checks.push({ rule: `${items[i].name} ${phrase} ${all[bestJ].name}`, passed: cost <= 0.35 });
      }
    });

    // Clear floor in front of pieces (new ones, and the furniture already in the room)
    all.forEach((item, i) => {
      const depth = FRONT_CLEARANCE[item.role];
      if (!depth) return;
      const zone = frontZone(rects[i], poses[i].rot, depth);
      let blocked = 0;
      rects.forEach((r, j) => {
        // Two fixed pieces in each other's way is the room as it is, not the layout's doing.
        if (j === i || (i >= moving && j >= moving)) return;
        if (partners[i].has(j) && IN_FRONT_ROLES.has(all[j].role)) return;
        blocked += intersection(zone, r);
      });
      if (i < moving) blocked += obstacles.reduce((sum, o) => sum + intersection(zone, o), 0);
      blocked += outsideArea(zone, room, polygon);
      terms.front += blocked;
      if (explain && ['bed', 'wardrobe', 'dresser', 'desk', 'sofa'].includes(item.role)) {
        checks.push({ rule: `Clear space in front of ${item.name}`, passed: blocked <= 0.05 * area(zone) + 1e-6 });
      }
    });

    // Door swing and windows (only new pieces can be moved out of the way)
    const movingRects = rects.slice(0, moving);
    doorZones.forEach((zone) => {
      const blocked = movingRects.reduce((sum, r) => sum + intersection(zone, r), 0);
      terms.door += blocked;
      if (explain) checks.push({ rule: 'Door swing kept clear', passed: blocked < 1e-6 });
    });
    windowZones.forEach((zone) => {
      const blocked = movingRects.reduce((sum, r, i) => sum + (items[i].height > zone.maxHeight ? intersection(zone, r) : 0), 0);
      terms.window += blocked;
      if (explain) checks.push({ rule: 'Window not blocked by tall furniture', passed: blocked < 1e-6 });
    });
    if (windowZones.length > 0) {
      const diagonal = Math.hypot(room.width, room.length);
      items.forEach((item, i) => {
        if (item.role !== 'desk') return;
        const d = Math.min(...windowZones.map((zone) => dist(center(rects[i]), center(zone))));
        terms.light += d / diagonal;
        if (explain) checks.push({ rule: 'Desk near the window for daylight', passed: d <= 1.6 });
      });
    }

    // Circulation: every piece reachable from the door through a walkway
    const { reach, standable, standCount } = circulation(rects);
    let unreachable = 0;
    items.forEach((item, i) => {
      const zone = FRONT_CLEARANCE[item.role] || WALL_ROLES.has(item.role)
        ? frontZone(rects[i], poses[i].rot, 0.45)
        : grow(rects[i], 0.45);
      if (!anyIn(reach, zone)) unreachable += 1;
    });
    terms.access = unreachable;
    let reachable = 0;
    for (let idx = 0; idx < reach.length; idx += 1) if (reach[idx] && standable[idx]) reachable += 1;
    terms.reach = standCount > 0 ? 1 - reachable / standCount : 1;
    if (explain) checks.push({ rule: 'Walkable path to every piece', passed: unreachable === 0 });

    // Visual balance: area- and height-weighted centroid near the room centre
    let total = 0;
    let cx = 0;
    let cz = 0;
    rects.forEach((r, i) => {
      const weight = area(r) * Math.max(0.3, all[i].height);
      const c = center(r);
      total += weight;
      cx += weight * c.x;
      cz += weight * c.z;
    });
    if (total > 0) {
      terms.balance = Math.hypot((cx / total - room.width / 2) / room.width, (cz / total - room.length / 2) / room.length);
    }
    if (explain) checks.push({ rule: 'Balanced arrangement', passed: terms.balance <= 0.22 });

    const cost = Object.keys(WEIGHTS).reduce((sum, key) => sum + WEIGHTS[key] * terms[key], 0);
    if (!explain) return cost;
    return { cost, terms, checks, passed: checks.filter((c) => c.passed).length };
  }

  /** Hard constraints: no physical overlap, inside the room, doors and existing furniture clear. */
  function feasible(movingPoses) {
    const poses = full(movingPoses);
    const rects = all.map((item, i) => rectOf(item, poses[i]));
    for (let i = 0; i < moving; i += 1) {
      if (outsideArea(rects[i], room, polygon) > 1e-6) return false;
      if (obstacles.some((o) => intersection(rects[i], o) > 1e-6)) return false;
      if (doorZones.some((z) => intersection(rects[i], z) > 1e-6)) return false;
      for (let j = i + 1; j < rects.length; j += 1) if (intersection(rects[i], rects[j]) > 1e-6) return false;
    }
    return true;
  }

  return { room, items, pairs, anchor, evaluate, feasible };
}

// ---------------------------------------------------------------- search

function gauss(rng) {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const uniform = (min, max, rng) => min + (max - min) * rng();

function wallPose(item, room, rng) {
  const rot = pick(ROTATIONS, rng);
  const { w, d } = dims(item, rot);
  const alongX = uniform(WALL_GAP, Math.max(WALL_GAP, room.width - w - WALL_GAP), rng);
  const alongZ = uniform(WALL_GAP, Math.max(WALL_GAP, room.length - d - WALL_GAP), rng);
  if (rot === 0) return { x: alongX, z: WALL_GAP, rot };
  if (rot === 180) return { x: alongX, z: room.length - d - WALL_GAP, rot };
  if (rot === 90) return { x: WALL_GAP, z: alongZ, rot };
  return { x: room.width - w - WALL_GAP, z: alongZ, rot };
}

function randomPose(item, room, rng) {
  const rot = pick(ROTATIONS, rng);
  const { w, d } = dims(item, rot);
  return {
    x: uniform(WALL_GAP, Math.max(WALL_GAP, room.width - w - WALL_GAP), rng),
    z: uniform(WALL_GAP, Math.max(WALL_GAP, room.length - d - WALL_GAP), rng),
    rot,
  };
}

const freshPose = (item, room, rng) => (WALL_ROLES.has(item.role) ? wallPose : randomPose)(item, room, rng);

function initialPoses(scorer, rng) {
  const { items, room, pairs } = scorer;
  const poses = new Array(items.length).fill(null);
  const order = items.map((o, i) => i)
    .sort((a, b) => (pairs.has(a) - pairs.has(b)) || (items[b].width * items[b].length - items[a].width * items[a].length));
  order.forEach((i) => {
    const pair = pairs.get(i);
    if (pair) {
      const [anchorItem, anchorPose] = scorer.anchor(pick(pair.anchors, rng), poses);
      if (anchorPose) {
        poses[i] = clampPose(items[i], idealPose(items[i], anchorItem, anchorPose, pair.relation, pair.offset, rng), room);
        return;
      }
    }
    poses[i] = freshPose(items[i], room, rng);
  });
  return poses;
}

function propose(scorer, poses, rng, temperature) {
  const { items, room, pairs } = scorer;
  const next = [...poses];
  const i = Math.floor(rng() * items.length);
  const item = items[i];
  const move = rng();
  const pair = pairs.get(i);
  if (pair && move < 0.35) {
    const [anchorItem, anchorPose] = scorer.anchor(pick(pair.anchors, rng), poses);
    next[i] = idealPose(item, anchorItem, anchorPose, pair.relation, pair.offset, rng);
  } else if (move < 0.55) {
    const step = 0.05 + 0.6 * temperature;
    next[i] = { x: poses[i].x + gauss(rng) * step, z: poses[i].z + gauss(rng) * step, rot: poses[i].rot };
  } else if (move < 0.72) {
    next[i] = freshPose(item, room, rng);
  } else if (move < 0.85) {
    const c = center(rectOf(item, poses[i]));
    const rot = pick(ROTATIONS.filter((r) => r !== poses[i].rot), rng);
    const { w, d } = dims(item, rot);
    next[i] = { x: c.x - w / 2, z: c.z - d / 2, rot };
  } else {
    const j = Math.floor(rng() * items.length);
    if (j !== i) {
      const ci = center(rectOf(item, poses[i]));
      const cj = center(rectOf(items[j], poses[j]));
      const di = dims(item, poses[i].rot);
      const dj = dims(items[j], poses[j].rot);
      next[i] = { x: cj.x - di.w / 2, z: cj.z - di.d / 2, rot: poses[i].rot };
      next[j] = clampPose(items[j], { x: ci.x - dj.w / 2, z: ci.z - dj.d / 2, rot: poses[j].rot }, room);
    }
  }
  next[i] = clampPose(item, next[i], room);
  // Dependents follow their anchor when it moves
  pairs.forEach(({ anchors, relation, offset }, k) => {
    if (k !== i && anchors.includes(i) && rng() < 0.5) {
      next[k] = clampPose(items[k], idealPose(items[k], item, next[i], relation, offset, rng), room);
    }
  });
  return next;
}

function anneal(scorer, start, rng, { iterations, tStart, deadline }) {
  let poses = start;
  let cost = scorer.evaluate(poses);
  let best = { poses, cost, feasible: scorer.feasible(poses) };
  const tEnd = 0.01;
  let step = 0;
  for (; step < iterations; step += 1) {
    if (step % 100 === 0 && Date.now() > deadline) break;
    const temperature = tStart * (tEnd / tStart) ** (step / Math.max(1, iterations - 1));
    const candidate = propose(scorer, poses, rng, Math.min(1, temperature / 3));
    const candidateCost = scorer.evaluate(candidate);
    if (candidateCost <= cost || rng() < Math.exp((cost - candidateCost) / temperature)) {
      poses = candidate;
      cost = candidateCost;
      // Track the best layout that satisfies the hard constraints
      if (cost < best.cost || !best.feasible) {
        const ok = scorer.feasible(poses);
        if (ok && (!best.feasible || cost < best.cost)) best = { poses, cost, feasible: true };
      }
    }
  }
  return { ...best, steps: step };
}

/**
 * Refine `poses` for `items` with guideline-based simulated annealing.
 * @param {object} args
 * @param {{width:number,length:number,height:number}} args.room
 * @param {{polygon?:Array, doorZones?:Array, windowZones?:Array, obstacles?:Array, existing?:Array}} args.features
 *   room-local; `existing` is furniture already in the room ({id, role, name, width, length, height,
 *   groupKey, pose}): it never moves, and new pieces pair with it (a coffee table at your sofa).
 * @param {Array<{id:string,role:string,name:string,width:number,length:number,height:number,groupKey?:string}>} args.items
 * @param {Array<{x:number,z:number,rot:number}>} args.poses starting layout
 * @param {() => number} args.rng seeded random source in [0, 1)
 * @param {number} [args.iterations] annealing steps per run
 * @param {number} [args.timeBudgetMs] wall-clock cap across all runs
 * @returns {{poses:Array, improved:boolean, before:object, after:object, iterations:number}}
 */
export function optimizeLayout({ room, features = {}, items, poses, rng, iterations = 1200, timeBudgetMs = 400 }) {
  const scorer = createScorer(room, items, features);
  const before = scorer.evaluate(poses, true);
  const startFeasible = scorer.feasible(poses);
  const deadline = Date.now() + timeBudgetMs;

  let best = { poses, cost: before.cost, feasible: startFeasible };
  let steps = 0;
  // One run refines the planner's layout gently; the other searches from scratch.
  const runs = [
    { start: poses, tStart: 0.8 },
    { start: initialPoses(scorer, rng), tStart: 3 },
  ];
  for (const run of runs) {
    if (Date.now() > deadline) break;
    const result = anneal(scorer, run.start, rng, { iterations, tStart: run.tStart, deadline });
    steps += result.steps;
    if (result.feasible && (!best.feasible || result.cost < best.cost - 1e-9)) best = result;
  }

  const improved = best.poses !== poses;
  return {
    poses: best.poses,
    improved,
    before: { ...before, feasible: startFeasible },
    after: improved ? { ...scorer.evaluate(best.poses, true), feasible: true } : { ...before, feasible: startFeasible },
    iterations: steps,
  };
}

export default { optimizeLayout, WEIGHTS };
