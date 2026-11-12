/**
 * Layout Planner
 * Rule-guided furniture arrangement for the design flow.
 *
 * Coordinates are room-local metres: x runs along the room width, z along its length.
 * A placed item's position is the min corner of its rotated footprint.
 * rotation (degrees): 0 faces +z, 90 faces +x, 180 faces -z, 270 faces -x.
 */

import { insidePolygon, pointInPolygon } from '../utils/roomGeometry.js';
import { optimizeLayout } from './layoutOptimizer.js';

const PAD = 0.05;
/** Least gap (m) between pieces of different groups: touching pieces show as overlapping in AR. */
const PIECE_GAP = 0.03;
const WALKWAY = 0.6;
const GRID_CELL = 0.2;
const ATTEMPTS_PER_LAYOUT = 30;
const WALL_ORDER = ['north', 'west', 'south', 'east'];
const WALL_ROTATION = { north: 0, west: 90, south: 180, east: 270 };
const OPPOSITE_WALL = { north: 'south', south: 'north', west: 'east', east: 'west' };

const WALL_HUG_ROLES = new Set(['bed', 'sofa', 'desk', 'wardrobe', 'dresser', 'storage']);
const NEEDS_FRONT_ROLES = new Set(['bed', 'sofa', 'tv-stand', 'desk', 'wardrobe', 'dresser', 'storage']);
const SEATING_ROLES = new Set(['sofa', 'armchair', 'bed', 'desk', 'chair']);
const PRIMARY_ROLES = ['bed', 'sofa', 'dining-table', 'island', 'desk'];
// Group members that belong in front of their anchor (a lamp or side table does not)
const IN_FRONT_ROLES = new Set(['coffee-table', 'desk-chair', 'chair', 'dining-chair', 'stool', 'armchair']);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function classifyFurniture(item) {
  const text = `${item.type || ''} ${item.name || ''} ${item.category || ''}`.toLowerCase();
  if (/\brug\b|carpet/.test(text)) return 'rug';
  if (/night ?stand|bedside/.test(text)) return 'nightstand';
  if (/coffee/.test(text)) return 'coffee-table';
  if (/side[- ]?table|end[- ]?table/.test(text)) return 'side-table';
  if (/\btv\b|\btv-|television|media console/.test(text)) return 'tv-stand';
  if (/dining( room)?[- ]?table/.test(text)) return 'dining-table';
  if (/dining[- ]?chair/.test(text)) return 'dining-chair';
  if (/island/.test(text)) return 'island';
  if (/stool/.test(text)) return 'stool';
  if (/sofa|couch|sectional|loveseat/.test(text)) return 'sofa';
  if (/\bbeds?\b|mattress/.test(text)) return 'bed';
  if (/armchair|accent chair|lounge chair/.test(text)) return 'armchair';
  if (/office[- ]?chair|desk[- ]?chair|ergonomic/.test(text)) return 'desk-chair';
  if (/desk|study[- ]?table|work[- ]?table/.test(text)) return 'desk';
  if (/guest/.test(text)) return 'chair';
  if (/lamp|lighting|\blight\b/.test(text)) return 'lamp';
  if (/wardrobe|armoire|closet/.test(text)) return 'wardrobe';
  if (/dresser|chest of drawers/.test(text)) return 'dresser';
  if (/shelf|bookcase|cabinet|buffet|storage|console|sideboard/.test(text)) return 'storage';
  if (/chair|seat/.test(text)) return 'chair';
  if (/table/.test(text)) return 'table';
  return 'other';
}

function footprint(item, rot) {
  return rot % 180 === 0
    ? { w: item.width, d: item.length }
    : { w: item.length, d: item.width };
}

function rectsOverlap(a, b, tolerance = 0.001) {
  return a.x < b.x + b.w - tolerance
    && b.x < a.x + a.w - tolerance
    && a.z < b.z + b.d - tolerance
    && b.z < a.z + a.d - tolerance;
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const d = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  return w > 0 && d > 0 ? w * d : 0;
}

function rectGap(a, b) {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dz = Math.max(0, b.z - (a.z + a.d), a.z - (b.z + b.d));
  return Math.sqrt(dx * dx + dz * dz);
}

function rectCenter(r) {
  return { x: r.x + r.w / 2, z: r.z + r.d / 2 };
}

function insideRoom(r, room) {
  return r.x >= -0.001 && r.z >= -0.001 && r.x + r.w <= room.width + 0.001 && r.z + r.d <= room.length + 0.001;
}

const NO_FEATURES = { polygon: null, doorZones: [], windowZones: [], obstacles: [], existing: [], existingZones: [] };

/** Existing pieces whose back goes along their long side (a sofa) or their short side (a bed's headboard). */
const BACK_ON_LONG_SIDE = new Set(['sofa', 'desk', 'tv-stand', 'wardrobe', 'dresser', 'storage']);
const BACK_ON_SHORT_SIDE = new Set(['bed']);
const EXISTING_NAMES = {
  sofa: 'sofa',
  bed: 'bed',
  desk: 'desk',
  'dining-table': 'dining table',
  table: 'table',
  'coffee-table': 'coffee table',
  'tv-stand': 'TV',
  armchair: 'armchair',
  island: 'island',
  wardrobe: 'wardrobe',
};

/**
 * Which way an existing piece faces. The scan only sees its footprint, so it is taken to stand
 * with its back to the nearest wall that suits its shape (a sofa's long side, a bed's head end).
 */
function existingRotation(rect, role, room) {
  const walls = [
    { rot: 0, gap: rect.z, along: rect.w },
    { rot: 180, gap: room.length - (rect.z + rect.d), along: rect.w },
    { rot: 90, gap: rect.x, along: rect.d },
    { rot: 270, gap: room.width - (rect.x + rect.w), along: rect.d },
  ];
  const long = Math.max(rect.w, rect.d);
  const short = Math.min(rect.w, rect.d);
  let suitable = walls;
  if (long > short * 1.2) {
    if (BACK_ON_LONG_SIDE.has(role)) suitable = walls.filter((wall) => wall.along === long);
    else if (BACK_ON_SHORT_SIDE.has(role)) suitable = walls.filter((wall) => wall.along === short);
  }
  return suitable.reduce((best, wall) => (wall.gap < best.gap ? wall : best)).rot;
}

function normalizeFeatures(features, room) {
  if (!features) return NO_FEATURES;
  const rects = (list) => (Array.isArray(list) ? list.filter((r) => r && r.w > 0 && r.d > 0) : []);
  const polygon = Array.isArray(features.polygon) && features.polygon.length >= 3 ? features.polygon : null;
  const obstacles = rects(features.obstacles);
  const existing = obstacles.map((o, index) => {
    const id = String(o.id || `existing-${index + 1}`);
    const role = o.role || classifyFurniture({ type: `${o.label || ''} ${o.type || ''}` });
    const rotation = existingRotation(o, role, room);
    const lw = rotation % 180 === 0 ? o.w : o.d;
    const ld = rotation % 180 === 0 ? o.d : o.w;
    return {
      id,
      role,
      type: o.type || 'other',
      label: o.label || '',
      name: `your ${EXISTING_NAMES[role] || String(o.label || o.type || 'furniture').toLowerCase()}`,
      rect: { x: o.x, z: o.z, w: o.w, d: o.d },
      rotation,
      lw,
      ld,
      height: Number(o.height) > 0 ? Number(o.height) : 0.8,
      groupKey: `existing-${id}`,
    };
  });
  return {
    polygon,
    doorZones: rects(features.doorZones),
    windowZones: rects(features.windowZones),
    obstacles,
    existing,
    // New pieces leave a walkway in front of existing ones (except pieces that belong with them).
    existingZones: existing
      .filter((e) => NEEDS_FRONT_ROLES.has(e.role))
      .map((e) => ({ ...frontZone(e.rect, e.rotation), anchorId: e.id })),
  };
}

function blocksWindow(item, zone) {
  return item.entry.item.height > zone.maxHeight && rectsOverlap(item.rect, zone);
}

function frontZone(rect, rot, depth = WALKWAY) {
  switch (((rot % 360) + 360) % 360) {
    case 0: return { x: rect.x, z: rect.z + rect.d, w: rect.w, d: depth };
    case 180: return { x: rect.x, z: rect.z - depth, w: rect.w, d: depth };
    case 90: return { x: rect.x + rect.w, z: rect.z, w: depth, d: rect.d };
    default: return { x: rect.x - depth, z: rect.z, w: depth, d: rect.d };
  }
}

// ----------------------------------------------------------------------------
// Groups: furniture that belongs together, built in a local frame where the
// group's back edge is v = 0 and its front faces +v.
// ----------------------------------------------------------------------------

function member(entry, u, v, rot) {
  const fp = footprint(entry.item, rot);
  return { entry, u, v, rot, lw: fp.w, ld: fp.d };
}

function finalizeGroup(group) {
  const minU = Math.min(...group.members.map((m) => m.u));
  const minV = Math.min(...group.members.map((m) => m.v));
  group.members.forEach((m) => {
    m.u -= minU;
    m.v -= minV;
  });
  group.gw = Math.max(...group.members.map((m) => m.u + m.lw));
  group.gd = Math.max(...group.members.map((m) => m.v + m.ld));
  group.needsFront = group.members.some((m) => NEEDS_FRONT_ROLES.has(m.entry.role));
  return group;
}

function buildGroups(entries) {
  const pool = [...entries];
  const take = (role) => {
    const idx = pool.findIndex((e) => e.role === role);
    return idx >= 0 ? pool.splice(idx, 1)[0] : null;
  };
  const takeAll = (role) => {
    const found = pool.filter((e) => e.role === role);
    found.forEach((e) => pool.splice(pool.indexOf(e), 1));
    return found;
  };

  const groups = [];

  let bed;
  while ((bed = take('bed'))) {
    const b = bed.item;
    const members = [member(bed, 0, 0, 0)];
    const stands = [take('nightstand'), take('nightstand')].filter(Boolean);
    if (stands[0]) members.push(member(stands[0], -stands[0].item.width - 0.05, 0, 0));
    if (stands[1]) members.push(member(stands[1], b.width + 0.05, 0, 0));
    groups.push(finalizeGroup({ key: `bed-${bed.id}`, kind: 'wall', primaryRole: 'bed', members }));
  }

  let sofa;
  while ((sofa = take('sofa'))) {
    const s = sofa.item;
    const members = [member(sofa, 0, 0, 0)];
    const coffee = take('coffee-table');
    let tableCenterV = s.length + 0.6;
    let tableRightU = s.width / 2;
    if (coffee) {
      const c = coffee.item;
      const v = s.length + 0.45;
      members.push(member(coffee, (s.width - c.width) / 2, v, 0));
      tableCenterV = v + c.length / 2;
      tableRightU = (s.width + c.width) / 2;
    }
    const side = take('side-table');
    if (side) members.push(member(side, s.width + 0.05, 0, 0));
    const lamp = take('lamp');
    if (lamp) members.push(member(lamp, -lamp.item.width - 0.1, 0, 0));
    const arm = take('armchair');
    if (arm) {
      const fp = footprint(arm.item, 270);
      members.push(member(arm, tableRightU + 0.45, Math.max(s.length + 0.3, tableCenterV - fp.d / 2), 270));
    }
    groups.push(finalizeGroup({ key: `sofa-${sofa.id}`, kind: 'wall', primaryRole: 'sofa', members }));
  }

  let desk;
  while ((desk = take('desk'))) {
    const d = desk.item;
    const members = [member(desk, 0, 0, 0)];
    const chair = take('desk-chair') || take('chair');
    if (chair) members.push(member(chair, (d.width - chair.item.width) / 2, d.length + 0.05, 180));
    groups.push(finalizeGroup({ key: `desk-${desk.id}`, kind: 'wall', primaryRole: 'desk', members }));
  }

  let table;
  while ((table = take('dining-table'))) {
    const t = table.item;
    const members = [member(table, 0, 0, 0)];
    const chairs = takeAll('dining-chair');
    const perSide = chairs.length >= 5 ? 2 : 1;
    const seats = [];
    for (let i = 0; i < perSide; i += 1) {
      const frac = perSide === 1 ? 0.5 : (i + 1) / (perSide + 1);
      seats.push({ side: 'front', frac }, { side: 'back', frac });
    }
    seats.push({ side: 'left' }, { side: 'right' });
    chairs.slice(0, seats.length).forEach((chair, i) => {
      const seat = seats[i];
      const c = chair.item;
      if (seat.side === 'front') members.push(member(chair, t.width * seat.frac - c.width / 2, -c.length - 0.05, 0));
      else if (seat.side === 'back') members.push(member(chair, t.width * seat.frac - c.width / 2, t.length + 0.05, 180));
      else {
        const rot = seat.side === 'left' ? 90 : 270;
        const fp = footprint(c, rot);
        const u = seat.side === 'left' ? -fp.w - 0.05 : t.width + 0.05;
        members.push(member(chair, u, t.length / 2 - fp.d / 2, rot));
      }
    });
    chairs.slice(seats.length).forEach((extra) => pool.push(extra));
    groups.push(finalizeGroup({ key: `dining-${table.id}`, kind: 'center', primaryRole: 'dining-table', members }));
  }

  let island;
  while ((island = take('island'))) {
    const isl = island.item;
    const members = [member(island, 0, 0, 0)];
    const stools = takeAll('stool');
    stools.forEach((stool, i) => {
      const u = ((i + 1) * isl.width) / (stools.length + 1) - stool.item.width / 2;
      members.push(member(stool, u, isl.length + 0.05, 180));
    });
    groups.push(finalizeGroup({ key: `island-${island.id}`, kind: 'center', primaryRole: 'island', members }));
  }

  pool
    .filter((e) => e.role !== 'rug')
    .forEach((entry) => {
      groups.push(finalizeGroup({ key: `single-${entry.id}`, kind: 'wall', primaryRole: entry.role, members: [member(entry, 0, 0, 0)] }));
    });

  const rugs = pool.filter((e) => e.role === 'rug');
  return { groups, rugs };
}

/**
 * After the main pieces, what the room is used for comes before what decorates it. By size alone,
 * a 3 × 3.5 m living room gave the TV's wall to the armchair and the TV was dropped while the
 * lamp and bookshelf stayed (adviser, 2026-10-28).
 */
const SECONDARY_PRIORITY = {
  // The coffee table is set in front of the sofa before the TV takes the wall across from it;
  // the other way round, the TV's walkway pushed the table against a side wall.
  'coffee-table': 450,
  'tv-stand': 400,
  nightstand: 350,
  'desk-chair': 300,
  chair: 300,
  'dining-chair': 300,
  stool: 300,
  wardrobe: 250,
  dresser: 200,
  armchair: 200,
  storage: 100,
  'side-table': 50,
  lamp: 20,
};

function groupPriority(group) {
  const primaryIndex = PRIMARY_ROLES.indexOf(group.primaryRole);
  const base = primaryIndex >= 0 ? 1000 - primaryIndex * 50 : SECONDARY_PRIORITY[group.primaryRole] || 0;
  return base + group.gw * group.gd * 10;
}

// ----------------------------------------------------------------------------
// Frame transforms: local (u, v) -> world rects
// ----------------------------------------------------------------------------

function transformRect(local, frame) {
  const { rot, ox, oz, gw, gd } = frame;
  switch (rot) {
    case 0: return { x: ox + local.u, z: oz + local.v, w: local.lw, d: local.ld };
    case 180: return { x: ox + gw - local.u - local.lw, z: oz + gd - local.v - local.ld, w: local.lw, d: local.ld };
    case 90: return { x: ox + local.v, z: oz + gw - local.u - local.lw, w: local.ld, d: local.lw };
    default: return { x: ox + gd - local.v - local.ld, z: oz + local.u, w: local.ld, d: local.lw };
  }
}

function placeGroup(group, frame) {
  const items = group.members.map((m) => ({
    entry: m.entry,
    groupKey: group.key,
    rect: transformRect(m, frame),
    rotation: (m.rot + frame.rot) % 360,
  }));
  const zones = [];
  if (group.kind === 'wall' && group.needsFront) {
    zones.push(transformRect({ u: 0, v: group.gd, lw: group.gw, ld: WALKWAY }, frame));
  } else if (group.kind === 'center') {
    const bounds = transformRect({ u: 0, v: 0, lw: group.gw, ld: group.gd }, frame);
    zones.push({ x: bounds.x - WALKWAY, z: bounds.z - WALKWAY, w: bounds.w + 2 * WALKWAY, d: bounds.d + 2 * WALKWAY });
  }
  return { group, frame, items, zones };
}

/** Gap left beside furniture when a piece is set next to it (the optimizer keeps the same). */
const BESIDE_GAP = 0.3;

/**
 * Spots along each wall for a group. Besides 25 cm steps, it tries next to each of `blockers`
 * (furniture, door zones), so a piece that fits a gap isn't missed between steps. A blocker with
 * `gap` keeps that much space (furniture); door zones already include theirs.
 */
function wallFrames(group, room, blockers = []) {
  const frames = [];
  WALL_ORDER.forEach((wall) => {
    const horizontal = wall === 'north' || wall === 'south';
    const along = horizontal ? room.width : room.length;
    const depthAvail = horizontal ? room.length : room.width;
    if (group.gw + 2 * PAD > along || group.gd + 2 * PAD > depthAvail) return;
    const maxOff = along - PAD - group.gw;
    const offsets = new Set([PAD, maxOff, (along - group.gw) / 2]);
    for (let off = PAD; off < maxOff; off += 0.25) offsets.add(off);
    blockers.forEach((b) => {
      const start = horizontal ? b.x : b.z;
      const size = horizontal ? b.w : b.d;
      const gap = b.gap ?? 0.02;
      [start + size + gap, start - group.gw - gap].forEach((off) => {
        if (off >= PAD - 1e-6 && off <= maxOff + 1e-6) offsets.add(clamp(off, PAD, maxOff));
      });
    });
    offsets.forEach((off) => {
      const base = { rot: WALL_ROTATION[wall], gw: group.gw, gd: group.gd, wall, offset: off, along };
      if (wall === 'north') frames.push({ ...base, ox: off, oz: PAD });
      else if (wall === 'south') frames.push({ ...base, ox: off, oz: room.length - PAD - group.gd });
      else if (wall === 'west') frames.push({ ...base, ox: PAD, oz: off });
      else frames.push({ ...base, ox: room.width - PAD - group.gd, oz: off });
    });
  });
  return frames;
}

function centerFrames(group, room) {
  const frames = [];
  [0, 90].forEach((rot) => {
    const bw = rot === 0 ? group.gw : group.gd;
    const bd = rot === 0 ? group.gd : group.gw;
    for (let ox = PAD; ox + bw <= room.width - PAD; ox += 0.25) {
      for (let oz = PAD; oz + bd <= room.length - PAD; oz += 0.25) {
        frames.push({ rot, ox, oz, gw: group.gw, gd: group.gd, wall: null });
      }
    }
  });
  return frames;
}

function isValidPlacement(candidate, placed, room, strict, features = NO_FEATURES) {
  for (const item of candidate.items) {
    if (!insideRoom(item.rect, room)) return false;
    if (!insidePolygon(item.rect, features.polygon)) return false;
    if (features.obstacles.some((o) => rectsOverlap(item.rect, o))) return false;
    if (features.doorZones.some((z) => rectsOverlap(item.rect, z))) return false;
    if (strict && features.windowZones.some((z) => blocksWindow(item, z))) return false;
    if (strict && features.existingZones.some((z) => z.anchorId !== candidate.anchorId && rectsOverlap(item.rect, z))) {
      return false;
    }
    for (const other of placed) {
      // A few centimetres between pieces of different groups: touching ones show as overlapping in AR.
      if (other.items.some((o) => rectsOverlap(item.rect, o.rect, -PIECE_GAP))) return false;
      // A coffee table set in front of its sofa belongs in the sofa's walkway.
      if (strict && other.group.key !== candidate.anchorGroupKey && other.zones.some((z) => rectsOverlap(item.rect, z))) {
        return false;
      }
    }
  }
  if (strict) {
    for (const zone of candidate.zones) {
      for (const other of placed) {
        if (other.items.some((o) => rectsOverlap(zone, o.rect))) return false;
      }
      if (features.obstacles.some((o) => rectsOverlap(zone, o))) return false;
    }
  }
  return true;
}

function groupBoundsCenter(candidate) {
  const xs = candidate.items.flatMap((i) => [i.rect.x, i.rect.x + i.rect.w]);
  const zs = candidate.items.flatMap((i) => [i.rect.z, i.rect.z + i.rect.d]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
}

function heuristicScore(candidate, placed, room, ctx, rng) {
  const { group, frame } = candidate;
  let score = rng() * 12;
  const center = groupBoundsCenter(candidate);

  if (group === ctx.primaryGroup) {
    if (frame.wall && frame.wall === ctx.preferredWall) score += 50;
    if (frame.wall) {
      const alongCenter = frame.offset + group.gw / 2;
      score += 15 * (1 - Math.abs(alongCenter - frame.along / 2) / (frame.along / 2));
    } else {
      // Shift centre pieces away from the preferred wall so each option leaves room on a different side.
      const shift = { north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0] }[ctx.preferredWall] || [0, 0];
      const targetX = room.width / 2 + shift[0] * room.width * 0.12 * Math.min(1, ctx.variant);
      const targetZ = room.length / 2 + shift[1] * room.length * 0.12 * Math.min(1, ctx.variant);
      const half = Math.hypot(room.width, room.length) / 2;
      score += 30 * (1 - Math.hypot(center.x - targetX, center.z - targetZ) / half);
      if (ctx.variant % 2 === 1) score += frame.rot === 0 ? 8 : 0;
      else score += frame.rot === 90 ? 8 : 0;
    }
  }

  if (ctx.primaryGroup?.kind === 'center' && group !== ctx.primaryGroup && frame.wall === ctx.preferredWall) {
    score += 25;
  }

  if (group.primaryRole === 'tv-stand' && frame.facingSofa) score += 45;
  // A piece set with furniture already in the room (coffee table at your sofa) beats a spot on its own.
  if (frame.anchorId) score += 60;
  if (group.primaryRole === 'tv-stand' && ctx.sofaPlacement?.frame.wall && frame.wall) {
    const sofaFrame = ctx.sofaPlacement.frame;
    if (frame.wall === OPPOSITE_WALL[sofaFrame.wall]) {
      const sofaRect = ctx.sofaPlacement.items[0].rect;
      const viewing = rectGap(candidate.items[0].rect, sofaRect);
      score += viewing <= 4.5 ? 40 : 5;
      const sofaCenter = groupBoundsCenter(ctx.sofaPlacement);
      const horizontal = frame.wall === 'north' || frame.wall === 'south';
      const offset = horizontal ? Math.abs(center.x - sofaCenter.x) : Math.abs(center.z - sofaCenter.z);
      score += 20 * (1 - Math.min(1, offset / frame.along));
    }
  }

  const tall = group.members.some((m) => m.entry.item.height > 1.5);
  if ((tall || group.primaryRole === 'lamp') && frame.wall) {
    const nearEnd = frame.offset <= PAD + 0.3 || frame.offset + group.gw >= frame.along - PAD - 0.3;
    if (nearEnd) score += 10;
  }

  if (group.primaryRole === 'desk' && frame.wall && frame.wall !== ctx.primaryPlacement?.frame.wall) score += 10;

  const windows = ctx.features.windowZones;
  if (windows.length > 0) {
    const windowGap = Math.min(...windows.map((z) => rectGap(candidate.items[0].rect, z)));
    if (group.primaryRole === 'desk') score += 25 * (1 - Math.min(1, windowGap / 1.5));
    if (group.primaryRole === 'tv-stand' && windowGap < 0.1) score -= 15;
    if (group.primaryRole === 'bed' && windowGap < 0.1) score -= 10;
  }

  if (group.primaryRole === 'nightstand' && ctx.bedPlacement) {
    const bedRect = ctx.bedPlacement.items[0].rect;
    score += 30 * (1 - Math.min(1, rectGap(candidate.items[0].rect, bedRect) / 2));
  }

  if (group.primaryRole === 'lamp' || group.primaryRole === 'side-table' || group.primaryRole === 'armchair') {
    const seating = [...placed, ...ctx.existingPlacements].flatMap((p) => p.items).filter((i) => SEATING_ROLES.has(i.entry.role));
    if (seating.length > 0) {
      const nearest = Math.min(...seating.map((s) => rectGap(candidate.items[0].rect, s.rect)));
      score += 20 * (1 - Math.min(1, nearest / 2));
    }
  }

  if (placed.length > 0) {
    const nearestGroup = Math.min(...placed.map((p) => {
      const c = groupBoundsCenter(p);
      return Math.hypot(c.x - center.x, c.z - center.z);
    }));
    score += 5 * Math.min(1, nearestGroup / 2);
  }

  return score;
}

function facingSofaCandidates(group, sofaPlacement) {
  const tvMember = group.members[0];
  const sofaMember = sofaPlacement.group.members.find((m) => m.entry.role === 'sofa');
  if (!sofaMember) return [];
  const sofaFrame = sofaPlacement.frame;
  return [2.4, 2.8, 3.2].map((viewing) => {
    const local = {
      u: sofaMember.u + (sofaMember.lw - tvMember.lw) / 2,
      v: sofaMember.v + sofaMember.ld + viewing,
      lw: tvMember.lw,
      ld: tvMember.ld,
    };
    const rect = transformRect(local, sofaFrame);
    const rotation = (sofaFrame.rot + 180) % 360;
    return {
      group,
      frame: { ...sofaFrame, wall: null, facingSofa: true },
      items: [{ entry: tvMember.entry, groupKey: group.key, rect, rotation }],
      zones: [frontZone(rect, rotation)],
    };
  });
}

/**
 * An existing piece as a fixed placement: same shape as a planned group, so dependents can be
 * laid out around it with the group offsets. It is never moved or returned as new furniture.
 */
function existingPlacement(e) {
  const entry = { id: e.id, role: e.role, existing: true, item: { name: e.name, width: e.lw, length: e.ld, height: e.height } };
  return {
    group: { key: e.groupKey, kind: 'wall', primaryRole: e.role, members: [{ entry, u: 0, v: 0, rot: 0, lw: e.lw, ld: e.ld }] },
    frame: { rot: e.rotation, ox: e.rect.x, oz: e.rect.z, gw: e.lw, gd: e.ld, wall: null },
    items: [{ entry, groupKey: e.groupKey, rect: e.rect, rotation: e.rotation }],
    zones: [],
    existing: e,
    anchor: { id: e.id, role: e.role, groupKey: e.groupKey, planned: false },
  };
}

/**
 * Each piece of a group this layout already placed, shaped like an existing piece, so the pieces
 * that go with it can be set around it. When a sofa's group didn't fit in one piece, its coffee
 * table used to land against any free wall, beside the sofa or across the room (adviser, 2026-10-28).
 */
function plannedAnchors(placement) {
  return placement.items.map((item) => {
    const { width, length } = item.entry.item;
    return {
      group: { key: placement.group.key, members: [{ entry: item.entry, u: 0, v: 0, rot: 0, lw: width, ld: length }] },
      frame: { rot: item.rotation, ox: item.rect.x, oz: item.rect.z, gw: width, gd: length, wall: null },
      items: [item],
      zones: [],
      anchor: { id: item.entry.id, role: item.entry.role, groupKey: placement.group.key, planned: true },
    };
  });
}

/** Where a piece goes next to the furniture it belongs with, in that furniture's frame (back edge v = 0). */
const ANCHORED_SPOTS = {
  'coffee-table': [['sofa'], (a, it) => [{ u: (a.lw - it.width) / 2, v: a.ld + 0.45, rot: 0 }]],
  'side-table': [['sofa', 'bed', 'armchair'], (a, it) => [{ u: a.lw + 0.05, v: 0, rot: 0 }, { u: -it.width - 0.05, v: 0, rot: 0 }]],
  nightstand: [['bed'], (a, it) => [{ u: -it.width - 0.05, v: 0, rot: 0 }, { u: a.lw + 0.05, v: 0, rot: 0 }]],
  lamp: [['sofa', 'armchair', 'bed', 'desk'], (a, it) => [{ u: -it.width - 0.1, v: 0, rot: 0 }, { u: a.lw + 0.1, v: 0, rot: 0 }]],
  armchair: [['sofa'], (a, it) => [
    { u: a.lw + 0.45, v: a.ld + 0.3, rot: 270 },
    { u: -it.length - 0.45, v: a.ld + 0.3, rot: 90 },
  ]],
  'desk-chair': [['desk'], (a, it) => [{ u: (a.lw - it.width) / 2, v: a.ld + 0.05, rot: 180 }]],
  chair: [['desk'], (a, it) => [{ u: (a.lw - it.width) / 2, v: a.ld + 0.05, rot: 180 }]],
  'dining-chair': [['dining-table', 'table'], (a, it) => [
    { u: (a.lw - it.width) / 2, v: -it.length - 0.05, rot: 0 },
    { u: (a.lw - it.width) / 2, v: a.ld + 0.05, rot: 180 },
    { u: -it.length - 0.05, v: (a.ld - it.width) / 2, rot: 90 },
    { u: a.lw + 0.05, v: (a.ld - it.width) / 2, rot: 270 },
  ]],
  stool: [['island'], (a, it) => [{ u: (a.lw - it.width) / 2, v: a.ld + 0.05, rot: 180 }]],
};

/**
 * Candidates that put a single piece with a piece it belongs with: a coffee table at your sofa, or
 * at the sofa this layout just placed. `anchors` are existing placements and plannedAnchors().
 */
function anchoredCandidates(group, anchors) {
  if (group.members.length !== 1) return [];
  const dep = group.members[0].entry;
  const rule = ANCHORED_SPOTS[dep.role];
  if (!rule) return [];
  const [anchorRoles, spots] = rule;
  const candidates = [];
  anchors
    .filter((p) => anchorRoles.includes(p.anchor.role))
    .forEach((anchor) => {
      const a = anchor.group.members[0];
      spots(a, dep.item).forEach((spot) => {
        const rect = transformRect(member(dep, spot.u, spot.v, spot.rot), anchor.frame);
        const rotation = (spot.rot + anchor.frame.rot) % 360;
        candidates.push({
          group,
          frame: { ...anchor.frame, anchorId: anchor.anchor.id },
          anchorId: anchor.anchor.id,
          anchorGroupKey: anchor.anchor.planned ? anchor.anchor.groupKey : null,
          items: [{ entry: dep, groupKey: anchor.anchor.groupKey, rect, rotation }],
          zones: NEEDS_FRONT_ROLES.has(dep.role) ? [frontZone(rect, rotation)] : [],
        });
      });
    });
  return candidates;
}

function placeRugs(rugs, placedItems, room, primaryPlacement) {
  return rugs.map((rug) => {
    const coffee = placedItems.find((i) => i.entry.role === 'coffee-table');
    const anchorRect = coffee?.rect || primaryPlacement?.items[0]?.rect;
    const target = anchorRect ? rectCenter(anchorRect) : { x: room.width / 2, z: room.length / 2 };
    const rot = primaryPlacement?.frame?.rot === 90 || primaryPlacement?.frame?.rot === 270 ? 0 : 90;
    const fp = footprint(rug.item, rot);
    const w = Math.min(fp.w, room.width - 2 * PAD);
    const d = Math.min(fp.d, room.length - 2 * PAD);
    const rect = {
      x: clamp(target.x - w / 2, PAD, room.width - PAD - w),
      z: clamp(target.z - d / 2, PAD, room.length - PAD - d),
      w,
      d,
    };
    return { entry: rug, groupKey: `rug-${rug.id}`, rect, rotation: rot };
  });
}

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

const FRONT_DIR = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };

/** Where `point` is from a placed piece's centre: `ahead` the way it faces, `side` across that. */
function relativeTo(item, point) {
  const c = rectCenter(item.rect);
  const [fx, fz] = FRONT_DIR[((item.rotation % 360) + 360) % 360] || FRONT_DIR[0];
  const dx = point.x - c.x;
  const dz = point.z - c.z;
  return { ahead: dx * fx + dz * fz, side: Math.abs(dx * fz - dz * fx) };
}

/** A placed piece's depth along the way it faces, and its width across that. */
function facingSize(item) {
  return item.rotation % 180 === 0 ? { depth: item.rect.d, width: item.rect.w } : { depth: item.rect.w, width: item.rect.d };
}

function polygonArea(polygon) {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

function scoreLayout(items, room, features = NO_FEATURES) {
  const solid = items.filter((i) => i.entry.role !== 'rug');
  const floorArea = features.polygon ? Math.max(0.5, polygonArea(features.polygon)) : room.width * room.length;
  const fixedRects = features.obstacles;
  // Furniture already in the room, as placed items: new pieces are judged against it too.
  const existing = features.existing.map((e) => existingPlacement(e).items[0]);

  let overlaps = 0;
  let outside = 0;
  for (let i = 0; i < solid.length; i += 1) {
    if (!insideRoom(solid[i].rect, room) || !insidePolygon(solid[i].rect, features.polygon)) outside += 1;
    for (let j = i + 1; j < solid.length; j += 1) {
      if (overlapArea(solid[i].rect, solid[j].rect) > 0.005) overlaps += 1;
    }
  }
  const fit = Math.max(0, 100 - overlaps * 35 - outside * 25);

  // Walkable grid: a cell is walkable when a 60 cm wide person fits there.
  const half = WALKWAY / 2;
  const cols = Math.max(1, Math.floor(room.width / GRID_CELL));
  const rows = Math.max(1, Math.floor(room.length / GRID_CELL));
  const walkable = new Array(cols * rows).fill(false);
  let walkableCount = 0;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const cx = (c + 0.5) * GRID_CELL;
      const cz = (r + 0.5) * GRID_CELL;
      if (cx < half || cz < half || cx > room.width - half || cz > room.length - half) continue;
      if (features.polygon && !pointInPolygon({ x: cx, z: cz }, features.polygon)) continue;
      const near = (rect) => {
        const dx = Math.max(rect.x - cx, 0, cx - (rect.x + rect.w));
        const dz = Math.max(rect.z - cz, 0, cz - (rect.z + rect.d));
        return Math.hypot(dx, dz) < half;
      };
      const blocked = solid.some((item) => near(item.rect)) || fixedRects.some(near);
      if (!blocked) {
        walkable[c * rows + r] = true;
        walkableCount += 1;
      }
    }
  }

  const component = new Int32Array(cols * rows).fill(-1);
  let largestId = -1;
  let largestSize = 0;
  let nextId = 0;
  for (let start = 0; start < walkable.length; start += 1) {
    if (!walkable[start] || component[start] !== -1) continue;
    const stack = [start];
    component[start] = nextId;
    let size = 0;
    while (stack.length > 0) {
      const idx = stack.pop();
      size += 1;
      const c = Math.floor(idx / rows);
      const r = idx % rows;
      const neighbors = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of neighbors) {
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nIdx = nc * rows + nr;
        if (walkable[nIdx] && component[nIdx] === -1) {
          component[nIdx] = nextId;
          stack.push(nIdx);
        }
      }
    }
    if (size > largestSize) {
      largestSize = size;
      largestId = nextId;
    }
    nextId += 1;
  }

  const connectivity = walkableCount > 0 ? largestSize / walkableCount : 0;
  const coverage = Math.min(1, walkableCount / (cols * rows) / 0.35);
  const flow = Math.round(100 * (0.7 * connectivity + 0.3 * coverage));

  const reachable = (zone) => {
    const c0 = Math.max(0, Math.floor((zone.x - GRID_CELL) / GRID_CELL));
    const c1 = Math.min(cols - 1, Math.floor((zone.x + zone.w + GRID_CELL) / GRID_CELL));
    const r0 = Math.max(0, Math.floor((zone.z - GRID_CELL) / GRID_CELL));
    const r1 = Math.min(rows - 1, Math.floor((zone.z + zone.d + GRID_CELL) / GRID_CELL));
    for (let c = c0; c <= c1; c += 1) {
      for (let r = r0; r <= r1; r += 1) {
        if (component[c * rows + r] === largestId && largestId >= 0) return true;
      }
    }
    return false;
  };

  const frontItems = [...solid, ...existing].filter((i) => NEEDS_FRONT_ROLES.has(i.entry.role));
  let frontFree = 0;
  let frontReachable = 0;
  frontItems.forEach((item) => {
    const zone = frontZone(item.rect, item.rotation);
    const blocked = !insideRoom(zone, room)
      || solid.some((o) => o !== item && (o.groupKey !== item.groupKey || !IN_FRONT_ROLES.has(o.entry.role))
        && rectsOverlap(zone, o.rect))
      || (!item.entry.existing && fixedRects.some((o) => rectsOverlap(zone, o)));
    if (!blocked) frontFree += 1;
    if (reachable(zone)) frontReachable += 1;
  });
  const frontClearance = frontItems.length > 0
    ? Math.round(100 * (0.5 * (frontFree / frontItems.length) + 0.5 * (frontReachable / frontItems.length)))
    : 100;

  // A door counts as accessible when nothing sits in its swing zone and it joins the main walkway.
  const doors = features.doorZones;
  const doorsOk = doors.filter((zone) => !solid.some((o) => rectsOverlap(zone, o.rect)) && reachable(zone)).length;
  const doorAccess = doors.length > 0 ? Math.round((100 * doorsOk) / doors.length) : 100;
  const windowsBlocked = features.windowZones.filter((zone) => solid.some((item) => blocksWindow(item, zone))).length;
  // A tall piece in front of a window costs points: it used to show only in the cons, so the best
  // of the tries could be a layout with the wardrobe against the window.
  const clearance = Math.max(0, (doors.length > 0 ? Math.round(0.7 * frontClearance + 0.3 * doorAccess) : frontClearance)
    - 25 * windowsBlocked);
  const deskNearWindow = features.windowZones.length > 0 && solid
    .filter((i) => i.entry.role === 'desk')
    .some((desk) => features.windowZones.some((zone) => rectGap(desk.rect, zone) <= 0.6));

  const byRole = (role) => solid.filter((i) => i.entry.role === role);
  const relationResults = [];
  /** Where people sit together: the nearest coffee table, else the floor in front of the nearest sofa. */
  const seatingCentre = (piece) => {
    const all = [...solid, ...existing].filter((o) => o !== piece);
    const closest = (role) => all
      .filter((o) => o.entry.role === role)
      .reduce((best, o) => (!best || rectGap(piece.rect, o.rect) < rectGap(piece.rect, best.rect) ? o : best), null);
    const table = closest('coffee-table');
    if (table && rectGap(piece.rect, table.rect) <= 2.5) return rectCenter(table.rect);
    const sofa = closest('sofa');
    if (!sofa) return null;
    const c = rectCenter(sofa.rect);
    const [fx, fz] = FRONT_DIR[((sofa.rotation % 360) + 360) % 360] || FRONT_DIR[0];
    const reach = facingSize(sofa).depth / 2 + 0.8;
    return { x: c.x + fx * reach, z: c.z + fz * reach };
  };
  // Closest new or existing piece of one of `roles`; `lastAnchor` remembers which, for the pros.
  let lastAnchor = null;
  const nearest = (item, roles) => {
    lastAnchor = null;
    let best = null;
    [...solid, ...existing].forEach((o) => {
      if (o === item || !roles.includes(o.entry.role)) return;
      const gap = rectGap(item.rect, o.rect);
      if (best === null || gap < best) {
        best = gap;
        lastAnchor = o;
      }
    });
    return best;
  };
  const relate = (key, ok) => relationResults.push({
    key,
    ok,
    existingName: lastAnchor?.entry.existing ? lastAnchor.entry.item.name : null,
  });

  byRole('nightstand').forEach((n) => {
    const gap = nearest(n, ['bed']);
    if (gap != null) relate('nightstand', gap <= 0.15 ? 1 : gap <= 0.6 ? 0.5 : 0);
  });
  // In front of the sofa and centred on it, 30–70 cm off. Distance alone let a table beside the
  // sofa's arm score as well as one in front of it.
  byRole('coffee-table').forEach((t) => {
    if (nearest(t, ['sofa']) == null) return;
    const sofa = lastAnchor;
    const { ahead, side } = relativeTo(sofa, rectCenter(t.rect));
    const size = facingSize(sofa);
    const tableDepth = sofa.rotation % 180 === 0 ? t.rect.d : t.rect.w;
    const gap = ahead - size.depth / 2 - tableDepth / 2;
    const inFront = gap > -0.05 && side <= size.width / 2;
    const parallel = t.rotation % 180 === sofa.rotation % 180;
    let ok = 0;
    if (inFront && parallel && side <= size.width * 0.25 && gap >= 0.3 && gap <= 0.7) ok = 1;
    else if (inFront && gap <= 1.2) ok = 0.5;
    relate('coffee', ok);
  });
  const newSofas = byRole('sofa');
  const sofas = newSofas.length > 0 ? newSofas : existing.filter((i) => i.entry.role === 'sofa');
  // Pieces that may stand in front of a sofa: what you use from it.
  const inFrontOk = new Set(['coffee-table', 'rug', 'armchair', 'tv-stand', 'sofa']);
  const standsInFront = (sofa, depth) => {
    const zone = frontZone(sofa.rect, sofa.rotation, depth);
    return solid.some((o) => !inFrontOk.has(o.entry.role) && overlapArea(o.rect, zone) > 0.02);
  };
  byRole('tv-stand').forEach((tv) => {
    if (sofas.length === 0) return;
    const sofa = sofas[0];
    lastAnchor = sofa;
    const facing = Math.abs(((tv.rotation - sofa.rotation) % 360 + 360) % 360 - 180) < 1;
    const tc = rectCenter(tv.rect);
    const sc = rectCenter(sofa.rect);
    const axisOffset = sofa.rotation % 180 === 0 ? Math.abs(tc.x - sc.x) : Math.abs(tc.z - sc.z);
    const distance = Math.hypot(tc.x - sc.x, tc.z - sc.z);
    let ok = facing ? 0.6 + 0.4 * (1 - Math.min(1, axisOffset / 1.5)) : 0.2;
    if (distance < 1.8 || distance > 5.5) ok *= 0.6;
    // Nothing standing between the sofa and the TV (a floor lamp ended up in the view).
    const viewing = Math.max(0, relativeTo(sofa, tc).ahead - facingSize(sofa).depth / 2);
    if (facing && standsInFront(sofa, viewing)) ok *= 0.5;
    relate('tv', ok);
  });
  byRole('desk-chair').concat(byRole('chair')).forEach((ch) => {
    const gap = nearest(ch, ['desk']);
    if (gap != null) relate('desk-chair', gap <= 0.2 ? 1 : gap <= 1 ? 0.4 : 0);
  });
  byRole('dining-chair').forEach((ch) => {
    const gap = nearest(ch, ['dining-table', 'table']);
    if (gap != null) relate('dining', gap <= 0.2 ? 1 : 0);
  });
  byRole('stool').forEach((st) => {
    const gap = nearest(st, ['island', 'table']);
    if (gap != null) relate('stool', gap <= 0.2 ? 1 : 0);
  });
  // Close to the seating and turned towards it (the coffee table, else the floor in front of the
  // sofa). Distance alone let an armchair facing the wall score full marks.
  byRole('armchair').forEach((a) => {
    const gap = nearest(a, ['sofa', 'coffee-table']);
    if (gap == null) return;
    const anchor = lastAnchor;
    const close = gap <= 1.2 ? 1 : gap <= 2.5 ? 0.5 : 0;
    const target = seatingCentre(a);
    let facing = 1;
    if (target) {
      const { ahead, side } = relativeTo(a, target);
      const cos = ahead / Math.max(0.01, Math.hypot(ahead, side));
      facing = cos >= 0.3 ? 1 : cos >= -0.2 ? 0.4 : 0;
    }
    lastAnchor = anchor;
    relate('armchair', close * facing);
  });
  // Beside the seat, not out in front of it: a lamp in front of the sofa is in the way.
  const inFrontOfSeating = (piece) => sofas.some((sofa) => overlapArea(piece.rect, frontZone(sofa.rect, sofa.rotation, 1.2)) > 0.02);
  byRole('side-table').forEach((s) => {
    const gap = nearest(s, ['sofa', 'armchair', 'bed']);
    if (gap != null) relate('side-table', inFrontOfSeating(s) ? 0 : gap <= 0.2 ? 1 : gap <= 0.8 ? 0.5 : 0);
  });
  byRole('lamp').forEach((l) => {
    const gap = nearest(l, ['sofa', 'armchair', 'bed', 'desk']);
    if (gap != null) relate('lamp', inFrontOfSeating(l) ? 0 : gap <= 0.6 ? 1 : gap <= 1.5 ? 0.5 : 0);
  });
  // The main piece (sofa or bed) centred on the wall behind it. A sofa pushed into a corner, with
  // the rest of the wall free, used to score like a well-placed one (95 for a lone sofa).
  const main = ['bed', 'sofa'].map((role) => byRole(role)[0]).find(Boolean);
  if (main) {
    const along = main.rotation % 180 === 0 ? room.width : room.length;
    const centre = main.rotation % 180 === 0 ? main.rect.x + main.rect.w / 2 : main.rect.z + main.rect.d / 2;
    const offset = Math.abs(centre - along / 2) / (along / 2);
    lastAnchor = null;
    relate('centre', offset <= 0.15 ? 1 : Math.max(0.3, 1 - (offset - 0.15) * 1.2));
  }

  const relations = relationResults.length > 0
    ? Math.round((100 * relationResults.reduce((sum, r) => sum + r.ok, 0)) / relationResults.length)
    : 100;

  const wallItems = solid.filter((i) => WALL_HUG_ROLES.has(i.entry.role));
  const touchesWall = (r) => r.x <= PAD + 0.05 || r.z <= PAD + 0.05
    || r.x + r.w >= room.width - PAD - 0.05 || r.z + r.d >= room.length - PAD - 0.05;
  const wall = wallItems.length > 0
    ? Math.round((100 * wallItems.filter((i) => touchesWall(i.rect)).length) / wallItems.length)
    : 100;

  let weightSum = 0;
  let cx = 0;
  let cz = 0;
  [...solid, ...existing].forEach((item) => {
    const weight = item.rect.w * item.rect.d * Math.max(0.3, item.entry.item.height);
    const c = rectCenter(item.rect);
    weightSum += weight;
    cx += c.x * weight;
    cz += c.z * weight;
  });
  const halfDiag = Math.hypot(room.width, room.length) / 2;
  const balance = weightSum > 0
    ? Math.round(clamp(100 - (Math.hypot(cx / weightSum - room.width / 2, cz / weightSum - room.length / 2) / halfDiag) * 120, 0, 100))
    : 100;

  const occupied = (solid.reduce((sum, item) => sum + item.rect.w * item.rect.d, 0)
    + fixedRects.reduce((sum, rect) => sum + rect.w * rect.d, 0)) / floorArea;
  let space;
  if (occupied < 0.2) space = 40 + 60 * (occupied / 0.2);
  else if (occupied <= 0.45) space = 100;
  else space = 100 - (occupied - 0.45) * 200;
  space = Math.round(clamp(space, 0, 100));

  const weighted = 0.15 * fit + 0.2 * flow + 0.15 * clearance + 0.25 * relations + 0.1 * wall + 0.1 * balance + 0.05 * space;
  const overall = Math.round(fit < 100 ? Math.min(fit, weighted) : weighted);

  return {
    overall,
    fit,
    flow,
    clearance,
    relations,
    wall,
    balance,
    space,
    occupancy: occupied,
    relationResults,
    features: {
      doorCount: doors.length,
      doorAccess,
      windowCount: features.windowZones.length,
      windowsBlocked,
      deskNearWindow,
      obstacleCount: fixedRects.length,
    },
  };
}

/** Pro lines for new pieces set with furniture already in the room ("your sofa"). */
const EXISTING_PAIR_TEXT = {
  coffee: (name) => `Coffee table placed in front of ${name}`,
  tv: (name) => `TV faces ${name}`,
  nightstand: (name) => `Nightstand beside ${name}`,
  'desk-chair': (name) => `Chair pulled up to ${name}`,
  dining: (name) => `Chairs set around ${name}`,
  stool: (name) => `Stools set at ${name}`,
  armchair: (name) => `Armchair grouped with ${name}`,
  'side-table': (name) => `Side table next to ${name}`,
  lamp: (name) => `Lamp next to ${name}`,
};

function describeLayout(score, dropped) {
  const pros = [];
  const cons = [];
  // Pairs with furniture already in the room get their own lines below.
  const newRelations = score.relationResults.filter((r) => !r.existingName);
  const relationOk = (key) => newRelations.filter((r) => r.key === key).every((r) => r.ok >= 0.9)
    && newRelations.some((r) => r.key === key);

  if (relationOk('nightstand')) pros.push('Nightstand sits right beside the bed');
  if (relationOk('centre')) pros.push('Main piece is centred on its wall');
  if (relationOk('coffee')) pros.push('Coffee table sits in front of the sofa');
  if (relationOk('armchair')) pros.push('Armchair faces the seating area');
  if (relationOk('tv')) pros.push('TV faces the sofa at a comfortable distance');
  if (relationOk('desk-chair')) pros.push('Chair is pulled up to the desk');
  if (relationOk('dining')) pros.push('Chairs are arranged around the dining table');
  if (score.wall >= 90) pros.push('Large pieces sit against the walls');
  if (score.flow >= 80) pros.push('Clear 60 cm walkways connect the room');
  if (score.balance >= 70) pros.push('Furniture weight is spread evenly');
  const f = score.features;
  if (f.doorCount > 0 && f.doorAccess === 100) pros.push(f.doorCount > 1 ? 'Doorways are kept clear' : 'Doorway is kept clear');
  if (f.windowCount > 0 && f.windowsBlocked === 0) pros.push('Windows stay unblocked for daylight');
  if (f.deskNearWindow) pros.push('Desk gets natural light from the window');
  const withExisting = new Set();
  score.relationResults
    .filter((r) => r.existingName && r.ok >= 0.9 && EXISTING_PAIR_TEXT[r.key])
    .forEach((r) => withExisting.add(EXISTING_PAIR_TEXT[r.key](r.existingName)));
  // First, so the layout cards (which show the top few) say how your own furniture was used.
  pros.unshift(...withExisting);
  if (f.obstacleCount > 0 && withExisting.size === 0) pros.push('Works around your existing furniture');

  if (score.flow < 60) cons.push('Walkways are tight or broken up');
  if (score.clearance < 70) cons.push('Some pieces lack 60 cm of space in front');
  if (score.relationResults.some((r) => r.key === 'tv' && r.ok < 0.6)) cons.push('TV is not facing the sofa');
  if (score.relationResults.some((r) => r.key === 'coffee' && r.ok < 0.5)) cons.push('Coffee table is not in front of the sofa');
  if (score.relationResults.some((r) => (r.key === 'lamp' || r.key === 'side-table') && r.ok === 0)) {
    cons.push('A lamp or side table stands in front of the sofa');
  }
  if (score.relationResults.some((r) => r.key === 'armchair' && r.ok < 0.4)) cons.push('Armchair does not face the seating area');
  if (score.relationResults.some((r) => r.key === 'centre' && r.ok < 0.6)) cons.push('Main piece sits off to one side of its wall');
  if (score.occupancy < 0.1) cons.push('Room feels sparse for this much floor space');
  if (score.occupancy > 0.5) cons.push('Room feels crowded');
  if (f.doorCount > 0 && f.doorAccess < 100) cons.push('A doorway is hard to reach from the main walkway');
  if (f.windowsBlocked > 0) cons.push('Tall furniture partly blocks a window');
  if (dropped.length > 0) cons.push(`Could not fit: ${dropped.join(', ')}`);

  return { pros, cons };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

function expandQuantities(entries, existing = []) {
  const result = [...entries];
  // A dining table or island already in the room still gets a full set of chairs or stools.
  const hasRole = (role) => result.some((e) => e.role === role)
    || existing.some((e) => e.role === role || (role === 'dining-table' && e.role === 'table'));
  const cloneUntil = (role, count) => {
    const existing = result.filter((e) => e.role === role);
    if (existing.length === 0) return;
    for (let i = existing.length; i < count; i += 1) {
      const base = existing[0];
      result.push({ ...base, id: `${base.id}-${i + 1}`, item: { ...base.item } });
    }
  };
  if (hasRole('dining-table')) cloneUntil('dining-chair', 4);
  if (hasRole('island')) cloneUntil('stool', 2);
  return result;
}

function planSingle(groups, rugs, room, preferredWall, variant, seed, features) {
  const rng = mulberry32(seed);
  const ordered = [...groups].sort((a, b) => groupPriority(b) - groupPriority(a));
  const existingPlacements = features.existing.map(existingPlacement);
  const existingOf = (role) => existingPlacements.find((p) => p.existing.role === role) || null;
  const existingPrimary = PRIMARY_ROLES.map(existingOf).find(Boolean) || null;
  const newPrimary = ordered.find((g) => PRIMARY_ROLES.includes(g.primaryRole));
  const ctx = {
    preferredWall,
    variant,
    features,
    existingPlacements,
    // With no new main piece, the room's own sofa, bed or desk is what the layout centres on.
    primaryGroup: newPrimary || (existingPrimary ? null : ordered[0]),
    primaryPlacement: newPrimary ? null : existingPrimary,
    sofaPlacement: existingOf('sofa'),
    bedPlacement: existingOf('bed'),
  };
  const placed = [];
  const dropped = [];

  const queue = [...ordered];
  while (queue.length > 0) {
    const group = queue.shift();
    const blockers = [
      ...features.obstacles.map((o) => ({ ...o, gap: BESIDE_GAP })),
      ...features.doorZones,
      ...placed.flatMap((p) => p.items.map((i) => ({ ...i.rect, gap: BESIDE_GAP }))),
    ];
    const frames = group.kind === 'center' ? centerFrames(group, room) : wallFrames(group, room, blockers);
    const candidates = frames.map((frame) => placeGroup(group, frame));
    if (group.primaryRole === 'tv-stand' && ctx.sofaPlacement) {
      candidates.push(...facingSofaCandidates(group, ctx.sofaPlacement));
    }
    candidates.push(...anchoredCandidates(group, [...existingPlacements, ...placed.flatMap(plannedAnchors)]));
    let valid = candidates.filter((c) => isValidPlacement(c, placed, room, true, features));
    if (valid.length === 0) valid = candidates.filter((c) => isValidPlacement(c, placed, room, false, features));
    if (valid.length === 0 && group.members.length > 1) {
      // A sofa with its armchair (or a bed with nightstands) that doesn't fit together: each piece
      // gets its own try, the main one first. Dropping the whole group left a 7.4 m² room with
      // a love seat that fits on its own completely empty (phone test, 2026-10-24).
      const singles = group.members.map((m, i) => finalizeGroup({
        key: `single-${m.entry.id}`,
        kind: i === 0 ? group.kind : 'wall',
        primaryRole: m.entry.role,
        members: [member(m.entry, 0, 0, 0)],
      }));
      if (group === ctx.primaryGroup) ctx.primaryGroup = singles[0];
      // The main piece goes next; the rest wait their turn with everything else (the TV before
      // the lamp), and are then set around the main piece where they can be.
      queue.unshift(singles[0]);
      queue.push(...singles.slice(1));
      const [next, ...rest] = queue;
      rest.sort((a, b) => groupPriority(b) - groupPriority(a));
      queue.splice(0, queue.length, next, ...rest);
      continue;
    }
    if (valid.length === 0) {
      group.members.forEach((m) => dropped.push(m.entry.item.name));
      continue;
    }
    let best = valid[0];
    let bestScore = -Infinity;
    valid.forEach((candidate) => {
      const s = heuristicScore(candidate, placed, room, ctx, rng);
      if (s > bestScore) {
        bestScore = s;
        best = candidate;
      }
    });
    placed.push(best);
    if (group === ctx.primaryGroup) ctx.primaryPlacement = best;
    if (group.primaryRole === 'sofa' && !ctx.sofaPlacement) ctx.sofaPlacement = best;
    if (group.primaryRole === 'bed' && !ctx.bedPlacement) ctx.bedPlacement = best;
  }

  const placedItems = placed.flatMap((p) => p.items);
  const rugItems = placeRugs(rugs, placedItems, room, ctx.primaryPlacement);
  const items = [...rugItems, ...placedItems];
  return { items, dropped, score: scoreLayout(items, room, features), primaryWall: ctx.primaryPlacement?.frame.wall || null };
}

const ROTATION_WALL = { 0: 'north', 90: 'west', 180: 'south', 270: 'east' };

function optimizationSummary(result, applied) {
  const shown = applied ? result.after : result.before;
  return {
    algorithm: 'guideline-annealing',
    applied,
    iterations: result.iterations,
    costBefore: Math.round(result.before.cost * 1000) / 1000,
    costAfter: Math.round(shown.cost * 1000) / 1000,
    rulesPassed: shown.passed,
    rulesTotal: shown.checks.length,
    checks: shown.checks,
    terms: Object.fromEntries(Object.entries(shown.terms).map(([key, value]) => [key, Math.round(value * 1000) / 1000])),
  };
}

/**
 * Refine a planned layout with the guideline optimizer. The refined layout is kept only
 * when it satisfies the hard constraints and does not lower the planner's own score.
 */
function refinePlan(plan, room, features, seed, options) {
  const solid = plan.items.filter((i) => i.entry.role !== 'rug');
  if (solid.length === 0) return plan;
  const result = optimizeLayout({
    room,
    features: {
      ...features,
      // Existing pieces stay where they are; new ones can still pair with them.
      existing: features.existing.map((e) => ({
        id: e.id,
        role: e.role,
        name: e.name,
        width: e.lw,
        length: e.ld,
        height: e.height,
        groupKey: e.groupKey,
        pose: { x: e.rect.x, z: e.rect.z, rot: e.rotation },
      })),
    },
    items: solid.map((placed) => ({
      id: placed.entry.id,
      role: placed.entry.role,
      name: placed.entry.item.name || placed.entry.role,
      width: placed.entry.item.width,
      length: placed.entry.item.length,
      height: placed.entry.item.height,
      groupKey: placed.groupKey,
    })),
    poses: solid.map((placed) => ({ x: placed.rect.x, z: placed.rect.z, rot: placed.rotation })),
    rng: mulberry32(seed ^ 0x5bd1e995),
    iterations: options.iterations,
    timeBudgetMs: options.timeBudgetMs,
  });
  if (!result.improved) return { ...plan, optimization: optimizationSummary(result, false) };

  const items = solid.map((placed, k) => {
    const pose = result.poses[k];
    const fp = footprint(placed.entry.item, pose.rot);
    return { ...placed, rect: { x: pose.x, z: pose.z, w: fp.w, d: fp.d }, rotation: pose.rot };
  });
  const primary = items.find((i) => PRIMARY_ROLES.includes(i.entry.role)) || items[0];
  const rugs = placeRugs(
    plan.items.filter((i) => i.entry.role === 'rug').map((i) => i.entry),
    items,
    room,
    { items: [primary], frame: { rot: primary.rotation } },
  );
  const refinedItems = [...rugs, ...items];
  const score = scoreLayout(refinedItems, room, features);
  if (score.fit < plan.score.fit || score.overall < plan.score.overall) {
    return { ...plan, optimization: optimizationSummary(result, false) };
  }
  return {
    items: refinedItems,
    dropped: plan.dropped,
    score,
    primaryWall: ROTATION_WALL[primary.rotation] || null,
    optimization: optimizationSummary(result, true),
  };
}

/**
 * Plan `count` distinct layouts for a room.
 * @param {{width:number,length:number,height:number}} room
 * @param {Array<{id:string,name:string,type?:string,category?:string,width:number,length:number,height:number}>} furniture
 * @param {{count?:number, firstVariant?:number, seed?:number, optimize?:boolean, iterations?:number, timeBudgetMs?:number,
 *   features?:{polygon?:Array<{x:number,z:number}>, doorZones?:Array, windowZones?:Array, obstacles?:Array}}} [options]
 *   features are room-local: doorZones are kept fully clear, windowZones reject furniture taller
 *   than zone.maxHeight, obstacles are existing furniture footprints.
 *   firstVariant (default 0) picks the anchor wall of the first layout, so separate calls can
 *   produce layouts anchored on different walls.
 *   optimize (default true) refines each layout with guideline-based simulated annealing.
 */
export function planLayouts(room, furniture, options = {}) {
  const count = Math.max(1, options.count || 3);
  const firstVariant = Math.max(0, Math.floor(options.firstVariant || 0));
  const baseSeed = options.seed ?? Date.now();
  const features = normalizeFeatures(options.features, room);

  const entries = expandQuantities(
    furniture.map((item, index) => ({
      id: String(item.id || item.type || `item-${index}`),
      role: classifyFurniture(item),
      item,
    })),
    features.existing,
  );

  const results = [];
  for (let variant = firstVariant; variant < firstVariant + count; variant += 1) {
    const preferredWall = WALL_ORDER[variant % WALL_ORDER.length];
    let best = null;
    for (let attempt = 0; attempt < ATTEMPTS_PER_LAYOUT; attempt += 1) {
      const { groups, rugs } = buildGroups(entries);
      const plan = planSingle(groups, rugs, room, preferredWall, variant, baseSeed + variant * 1000 + attempt, features);
      if (!best || plan.score.overall > best.score.overall) best = plan;
    }
    results.push(options.optimize === false ? best : refinePlan(best, room, features, baseSeed + variant * 1000, options));
  }

  return results.map((plan, index) => {
    const variant = firstVariant + index;
    const counters = new Map();
    const placedFurniture = plan.items.map((placedItem) => {
      const { entry, rect, rotation } = placedItem;
      const n = (counters.get(entry.id) || 0) + 1;
      counters.set(entry.id, n);
      const isRug = entry.role === 'rug';
      const rotatedSwap = rotation % 180 !== 0;
      const width = isRug ? (rotatedSwap ? rect.d : rect.w) : entry.item.width;
      const length = isRug ? (rotatedSwap ? rect.w : rect.d) : entry.item.length;
      return {
        ...entry.item,
        id: `${entry.id}-v${variant + 1}-${n}`,
        role: entry.role,
        width,
        length,
        dimensions: { width, length, height: entry.item.height },
        position: { x: round2(rect.x), y: 0, z: round2(rect.z), rotation },
      };
    });
    const { pros, cons } = describeLayout(plan.score, plan.dropped);
    const { relationResults, occupancy, features: featureStats, ...score } = plan.score;
    return {
      furniture: placedFurniture,
      score,
      pros,
      cons,
      dropped: plan.dropped,
      primaryWall: plan.primaryWall,
      roomFeatures: featureStats,
      optimization: plan.optimization || null,
    };
  });
}

const FIT_STEP = 0.1;

/**
 * Whether a footprint can stand somewhere in the room, turned either way, given `features`.
 * Tries a 10 cm grid plus the spots right against each obstacle and door zone, so a snug gap
 * between two pieces isn't missed.
 */
function fitsSomewhere(item, room, features) {
  const blockers = [...features.obstacles, ...features.doorZones];
  return [0, 90].some((rot) => {
    const { w, d } = footprint(item, rot);
    const maxX = room.width - PAD - w;
    const maxZ = room.length - PAD - d;
    if (maxX < PAD - 0.001 || maxZ < PAD - 0.001) return false;
    const positions = (max, edges) => {
      const list = [];
      for (let v = PAD; v < max; v += FIT_STEP) list.push(v);
      list.push(Math.max(PAD, max));
      edges.forEach((v) => {
        if (v >= PAD - 0.001 && v <= max + 0.001) list.push(clamp(v, PAD, Math.max(PAD, max)));
      });
      return list;
    };
    const xs = positions(maxX, blockers.flatMap((b) => [b.x + b.w, b.x - w]));
    const zs = positions(maxZ, blockers.flatMap((b) => [b.z + b.d, b.z - d]));
    return xs.some((x) => zs.some((z) => isValidPlacement(
      { items: [{ rect: { x, z, w, d } }], zones: [] },
      [],
      room,
      false,
      features,
    )));
  });
}

/** Pieces the planner only ever stands against a wall (a sofa, a bed, a TV console). */
const WALL_FIT_ROLES = new Set([...WALL_HUG_ROLES, 'tv-stand']);

/** Whether a footprint fits against one of the walls, at the spots the planner tries. */
function fitsAgainstWall(item, room, features) {
  const blockers = [...features.obstacles.map((o) => ({ ...o, gap: BESIDE_GAP })), ...features.doorZones];
  return wallFrames({ gw: item.width, gd: item.length }, room, blockers).some((frame) => isValidPlacement(
    { items: [{ rect: transformRect({ u: 0, v: 0, lw: item.width, ld: item.length }, frame) }], zones: [] },
    [],
    room,
    false,
    features,
  ));
}

/**
 * Whether one piece fits the scanned room on its own: under the ceiling, inside the outline, and
 * clear of the furniture already there and of the doors. Used to leave pieces that can't fit out of
 * the recommendations (adviser, 2026-10-28: in a small room full of chairs and tables, pieces
 * that had no room were still offered and ended up drawn over the chairs).
 * @param {{width:number,length:number,height:number}} room
 * @param {{width:number,length:number,height:number,name?:string,type?:string,category?:string}} item
 * @param {object} [features] same as planLayouts options.features
 * @returns {{fits:boolean, reason:null|'too-tall'|'too-big'|'no-space'}}
 *   too-big: it doesn't fit even the empty room; no-space: only the existing furniture or a door
 *   is in the way.
 */
export function checkRoomFit(room, item, features) {
  const width = Number(item.width);
  const length = Number(item.length);
  if (!(width > 0 && length > 0)) return { fits: true, reason: null };
  if (Number(room.height) > 0 && Number(item.height) > room.height) return { fits: false, reason: 'too-tall' };
  // Rugs lie under the furniture and the planner trims them to the room.
  if (classifyFurniture(item) === 'rug') return { fits: true, reason: null };
  const f = normalizeFeatures(features, room);
  const sized = { width, length };
  // A sofa or bed must fit against a wall, as the planner places it: one that only fitted out in
  // the middle of the room was recommended and then dropped from the layout.
  const fits = WALL_FIT_ROLES.has(classifyFurniture(item)) ? fitsAgainstWall : fitsSomewhere;
  if (!fits(sized, room, { ...NO_FEATURES, polygon: f.polygon })) return { fits: false, reason: 'too-big' };
  if (!fits(sized, room, f)) return { fits: false, reason: 'no-space' };
  return { fits: true, reason: null };
}

/** The catalog product a placed piece is (its id without the "-v1-2" layout suffix). */
export function catalogIdOf(item) {
  return item.catalogId || String(item.id || '').replace(/-v\d+-\d+$/, '');
}

/**
 * Two layouts look the same to a user when the same pieces face the same ways (so stand at the
 * same walls); sliding a piece along its wall is not a different option.
 */
export function sameArrangement(a, b) {
  const signature = (items) => items
    .map((item) => `${catalogIdOf(item)}@${((Number(item.position?.rotation) || 0) % 360 + 360) % 360}`)
    .sort()
    .join('|');
  return signature(a) === signature(b);
}

/**
 * The layouts offered for a room: one per furniture set, each started on a different wall and moved
 * on to the next while it repeats an earlier option. The optimizer can pull every start back to the
 * same arrangement, so later tries keep the planner's own layout. An option that still repeats after
 * every try is left out: two copies of one layout read as "the same layout twice" (adviser, 2026-10-28).
 * @returns {Array<{variant:number, plan:object}>} variant = index into `sets`
 */
export function planOptions(room, sets, { features, seed = Date.now(), walls = WALL_ORDER.length } = {}) {
  const options = [];
  sets.forEach((set, variant) => {
    let first = null;
    for (let attempt = 0; attempt < walls * 3; attempt += 1) {
      const [plan] = planLayouts(room, set, {
        count: 1,
        firstVariant: (variant + (attempt % walls)) % walls,
        seed: seed + variant * 7919 + attempt * 104729,
        features,
        optimize: attempt < walls,
      });
      if (!plan) continue;
      first = first || plan;
      if (!options.some((o) => sameArrangement(o.plan.furniture, plan.furniture))) {
        options.push({ variant, plan });
        return;
      }
    }
    if (options.length === 0 && first) options.push({ variant, plan: first });
  });
  // A clearly worse second option (the TV not facing the sofa in a tight room) is left out: one
  // good layout reads better than a good one and a poor one.
  const best = Math.max(...options.map((o) => o.plan.score.overall));
  return options.filter((o) => o.plan.score.overall >= best - OPTION_SCORE_MARGIN);
}

/** How far below the best layout's score another option may be and still be offered. */
const OPTION_SCORE_MARGIN = 8;

/**
 * What the scan found, in the planner's room-local frame, for drawing next to a layout:
 * existing furniture (facing the way the planner takes it to face) and where doors and windows sit.
 * @param {{width:number,length:number}} room
 * @param {object} features same as planLayouts options.features
 */
export function describeRoomFeatures(room, features) {
  const f = normalizeFeatures(features, room);
  const opening = (zone) => (zone.span ? { id: zone.id, ...roundSpan(zone.span) } : null);
  return {
    existingFurniture: f.existing.map((e) => ({
      id: e.id,
      type: e.type,
      label: e.label,
      role: e.role,
      name: e.name,
      width: round2(e.lw),
      length: round2(e.ld),
      height: round2(e.height),
      position: { x: round2(e.rect.x), y: 0, z: round2(e.rect.z), rotation: e.rotation },
    })),
    doors: f.doorZones.map(opening).filter(Boolean),
    windows: f.windowZones.map(opening).filter(Boolean),
    // Room shape and scan frame for AR (see buildRoomFeatures); absent without a scanned outline.
    outline: Array.isArray(features?.outline) && features.outline.length >= 3
      ? features.outline.map((p) => ({ x: round3(p.x), z: round3(p.z) }))
      : null,
    frame: features?.frame && Number.isFinite(features.frame.angle)
      ? { angle: features.frame.angle, minX: round3(features.frame.minX), minZ: round3(features.frame.minZ) }
      : null,
  };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function roundSpan(span) {
  return { x1: round2(span.x1), z1: round2(span.z1), x2: round2(span.x2), z2: round2(span.z2) };
}

export default { planLayouts, planOptions, sameArrangement, classifyFurniture, describeRoomFeatures, checkRoomFit };
