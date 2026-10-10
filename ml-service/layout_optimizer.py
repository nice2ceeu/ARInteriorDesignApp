"""Interior-design-guideline layout optimizer.

Places catalog furniture in a rectangular room by simulated annealing over a cost
built from interior design guidelines, following the approach of Merrell et al.
(2011, "Interactive Furniture Layout Using Interior Design Guidelines") and
Yu et al. (2011, "Make It Home"): wall placement, functional pairs, clearance
zones, door swing, walkable circulation, window light and visual balance.

Coordinates are meters with a top-left origin: x across the room width and z along
its length. A pose (x, z, rotation) puts the top-left corner of the item's oriented
footprint at (x, z). Rotation 0 puts the item's back against the north wall (z = 0)
facing +z; 90 backs onto the east wall facing -x; 180 the south wall facing -z;
270 the west wall facing +x.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

import numpy as np
from scipy import ndimage

ROTATIONS = (0, 90, 180, 270)
GRID = 0.15          # meters per circulation cell
WALKWAY = 0.6        # minimum clear walkway width
NEAR_WALL = 0.12     # tolerance for "against the wall"

# Furniture whose back belongs against a wall
WALL_TYPES = {
    "bed", "wardrobe", "dresser", "desk", "sofa", "bookshelf", "tv-stand",
    "filing-cabinet", "buffet", "china-cabinet", "nightstand",
}

# dependent type -> (anchor types, relation, offset in meters)
PAIRS = {
    "nightstand": (("bed",), "beside-head", 0.03),
    "chair": (("desk",), "front", -0.05),
    "office-chair": (("desk",), "front", -0.05),
    "guest-chair": (("desk",), "front", 0.5),
    "coffee-table": (("sofa",), "front", 0.45),
    "armchair": (("coffee-table", "sofa"), "near", 1.3),
    "side-table": (("sofa", "armchair"), "beside", 0.05),
    "tv-stand": (("sofa",), "opposite", 2.6),
    "floor-lamp": (("sofa", "armchair", "desk"), "near", 0.9),
    "dining-chair": (("dining-table",), "around", 0.05),
    "bar-stool": (("kitchen-island",), "around", 0.05),
}

# Clear floor needed in front of an item (meters)
FRONT_CLEARANCE = {
    "bed": 0.6, "wardrobe": 0.9, "dresser": 0.8, "desk": 0.7, "sofa": 0.6,
    "bookshelf": 0.6, "tv-stand": 0.5, "filing-cabinet": 0.8, "buffet": 0.7, "china-cabinet": 0.7,
}

TALL = 1.2           # items taller than this should not cover windows
FLAT_TYPES = {"rug"}  # walkable; ignored for collisions and circulation

WEIGHTS = {
    "overlap": 60.0, "wall": 4.0, "pair": 3.0, "facing": 0.8, "front": 4.0,
    "door": 40.0, "window": 2.0, "light": 0.6, "access": 3.0, "reach": 2.0, "balance": 1.0,
}


@dataclass(frozen=True)
class Item:
    id: str
    type: str
    name: str
    width: float
    length: float
    height: float
    mandatory: bool = False


@dataclass(frozen=True)
class Opening:
    kind: str     # "door" | "window"
    wall: str     # "north" | "east" | "south" | "west"
    offset: float  # center along the wall, 0..1 (west->east or north->south)
    width: float


@dataclass(frozen=True)
class Room:
    width: float
    length: float
    height: float


# ---------------------------------------------------------------- geometry

def dims(item: Item, rotation: int) -> tuple[float, float]:
    return (item.length, item.width) if rotation in (90, 270) else (item.width, item.length)


def rect(item: Item, pose) -> tuple[float, float, float, float]:
    x, z, rotation = pose
    w, l = dims(item, rotation)
    return x, z, x + w, z + l


def area(r) -> float:
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def intersection(a, b) -> float:
    return area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


def gap_between(a, b) -> float:
    dx = max(b[0] - a[2], a[0] - b[2], 0.0)
    dz = max(b[1] - a[3], a[1] - b[3], 0.0)
    return math.hypot(dx, dz)


def front_vector(rotation: int) -> tuple[float, float]:
    return {0: (0.0, 1.0), 90: (-1.0, 0.0), 180: (0.0, -1.0), 270: (1.0, 0.0)}[rotation]


def back_center(item: Item, pose) -> tuple[float, float]:
    x0, z0, x1, z1 = rect(item, pose)
    return {0: ((x0 + x1) / 2, z0), 90: (x1, (z0 + z1) / 2),
            180: ((x0 + x1) / 2, z1), 270: (x0, (z0 + z1) / 2)}[pose[2]]


def front_zone(item: Item, pose, depth: float):
    x0, z0, x1, z1 = rect(item, pose)
    return {0: (x0, z1, x1, z1 + depth), 90: (x0 - depth, z0, x0, z1),
            180: (x0, z0 - depth, x1, z0), 270: (x1, z0, x1 + depth, z1)}[pose[2]]


def wall_distance(item: Item, pose, room: Room) -> float:
    """Distance from the item's back edge to the wall behind it."""
    x0, z0, x1, z1 = rect(item, pose)
    return {0: z0, 90: room.width - x1, 180: room.length - z1, 270: x0}[pose[2]]


def to_local(anchor: Item, anchor_pose, point) -> tuple[float, float]:
    """(u, v): sideways offset from the anchor's back center, and distance in front of its back."""
    bx, bz = back_center(anchor, anchor_pose)
    fx, fz = front_vector(anchor_pose[2])
    rx, rz = -fz, fx
    dx, dz = point[0] - bx, point[1] - bz
    return dx * rx + dz * rz, dx * fx + dz * fz


def to_world(anchor: Item, anchor_pose, u: float, v: float) -> tuple[float, float]:
    bx, bz = back_center(anchor, anchor_pose)
    fx, fz = front_vector(anchor_pose[2])
    rx, rz = -fz, fx
    return bx + u * rx + v * fx, bz + u * rz + v * fz


def center(r) -> tuple[float, float]:
    return (r[0] + r[2]) / 2, (r[1] + r[3]) / 2


def clamp_pose(item: Item, pose, room: Room, wall_gap: float):
    x, z, rotation = pose
    w, l = dims(item, rotation)
    x = min(max(x, wall_gap), max(wall_gap, room.width - w - wall_gap))
    z = min(max(z, wall_gap), max(wall_gap, room.length - l - wall_gap))
    return x, z, rotation


def fits(item: Item, room: Room, wall_gap: float) -> bool:
    return any(dims(item, r)[0] + 2 * wall_gap <= room.width and dims(item, r)[1] + 2 * wall_gap <= room.length
               for r in (0, 90)) and item.height <= room.height


def opening_segment(opening: Opening, room: Room):
    """Opening extent along its wall as a thin rectangle on the wall line."""
    if opening.wall in ("north", "south"):
        c = opening.offset * room.width
        z = 0.0 if opening.wall == "north" else room.length
        return c - opening.width / 2, z, c + opening.width / 2, z
    c = opening.offset * room.length
    x = 0.0 if opening.wall == "west" else room.width
    return x, c - opening.width / 2, x, c + opening.width / 2


def opening_zone(opening: Opening, room: Room, depth: float):
    x0, z0, x1, z1 = opening_segment(opening, room)
    return {"north": (x0, 0.0, x1, depth), "south": (x0, room.length - depth, x1, room.length),
            "west": (0.0, z0, depth, z1), "east": (room.width - depth, z0, room.width, z1)}[opening.wall]


# ---------------------------------------------------------------- relations

def relation_cost(dep: Item, dep_pose, anchor: Item, anchor_pose, relation: str, offset: float) -> float:
    dep_rect, anchor_rect = rect(dep, dep_pose), rect(anchor, anchor_pose)
    u, v = to_local(anchor, anchor_pose, center(dep_rect))
    aw = anchor.width
    dw, dl = dep.width, dep.length
    if relation == "beside-head":
        return abs(abs(u) - (aw / 2 + dw / 2 + offset)) + abs(v - dl / 2)
    if relation == "front":
        return abs(u) + abs(v - (anchor.length + dl / 2 + offset))
    if relation == "opposite":
        target = anchor.length + offset
        return abs(u) * 0.5 + max(0.0, abs(v - target) - 0.6)
    if relation == "beside":
        return abs(abs(u) - (aw / 2 + dw / 2 + offset)) + max(0.0, abs(v - anchor.length / 2) - anchor.length / 2)
    if relation == "around":
        return max(0.0, gap_between(dep_rect, anchor_rect) - offset)
    if relation == "near":
        d = math.dist(center(dep_rect), center(anchor_rect))
        return max(0.0, d - offset)
    return 0.0


def ideal_pose(dep: Item, anchor: Item, anchor_pose, relation: str, offset: float, rng: random.Random):
    """A pose that satisfies the relation, used as a proposal move."""
    ar = anchor_pose[2]
    side = rng.choice((-1, 1))
    if relation == "beside-head":
        u, v, rotation = side * (anchor.width / 2 + dep.width / 2 + offset), dep.length / 2, ar
    elif relation == "front":
        u, v, rotation = 0.0, anchor.length + dep.length / 2 + offset, (ar + 180) % 360
        if dep.type == "coffee-table":
            rotation = ar
    elif relation == "opposite":
        u, v, rotation = 0.0, anchor.length + offset, (ar + 180) % 360
    elif relation == "beside":
        u, v, rotation = side * (anchor.width / 2 + dep.width / 2 + offset), anchor.length / 2, ar
    elif relation == "around":
        u, v, rotation = rng.uniform(-anchor.width / 2, anchor.width / 2), anchor.length + dep.length / 2 + offset, (ar + 180) % 360
    else:
        angle = rng.uniform(0, 2 * math.pi)
        cx, cz = center(rect(anchor, anchor_pose))
        w, l = dims(dep, ar)
        return cx + offset * math.cos(angle) - w / 2, cz + offset * math.sin(angle) - l / 2, ar
    cx, cz = to_world(anchor, anchor_pose, u, v)
    w, l = dims(dep, rotation)
    return cx - w / 2, cz - l / 2, rotation


# ---------------------------------------------------------------- scoring

class Scorer:
    def __init__(self, room: Room, items: list[Item], openings: list[Opening], gap: float, wall_gap: float,
                 fixed: tuple = ()):
        self.room, self.items, self.openings = room, items, openings
        self.fixed = list(fixed)  # measured immovable obstacles as (x0, z0, x1, z1)
        self.gap, self.wall_gap = gap, wall_gap
        self.nx = max(1, math.ceil(room.width / GRID))
        self.nz = max(1, math.ceil(room.length / GRID))
        radius = max(1, round(WALKWAY / 2 / GRID))
        yy, xx = np.ogrid[-radius:radius + 1, -radius:radius + 1]
        self.disk = (xx * xx + yy * yy) <= radius * radius
        self.reach = np.ones((2 * radius + 3, 2 * radius + 3), dtype=bool)
        self.pairs = {}
        for i, item in enumerate(items):
            if item.type in PAIRS:
                anchors, relation, offset = PAIRS[item.type]
                candidates = [j for j, other in enumerate(items) if other.type in anchors and j != i]
                if candidates:
                    self.pairs[i] = (candidates, relation, offset)
        # Items allowed to touch: dependents and their anchors
        self.partners = {i: set() for i in range(len(items))}
        for i, (anchors, _, _) in self.pairs.items():
            for j in anchors:
                self.partners[i].add(j)
                self.partners[j].add(i)

    def cells(self, r):
        x0 = max(0, int(math.floor(r[0] / GRID)))
        z0 = max(0, int(math.floor(r[1] / GRID)))
        x1 = min(self.nx, int(math.ceil(r[2] / GRID)))
        z1 = min(self.nz, int(math.ceil(r[3] / GRID)))
        return slice(z0, z1), slice(x0, x1)

    def circulation(self, poses):
        """Walkway reachability from the door (or the largest open area)."""
        occupied = np.zeros((self.nz, self.nx), dtype=bool)
        for item, pose in zip(self.items, poses):
            if item.type not in FLAT_TYPES:
                occupied[self.cells(rect(item, pose))] = True
        for obstacle in self.fixed:
            occupied[self.cells(obstacle)] = True
        standable = ndimage.binary_erosion(~occupied, structure=self.disk, border_value=0)
        labels, count = ndimage.label(standable)
        if count == 0:
            return np.zeros_like(standable), standable
        start = None
        door = next((o for o in self.openings if o.kind == "door"), None)
        if door is not None:
            zone_labels = labels[self.cells(opening_zone(door, self.room, WALKWAY + 0.4))]
            zone_labels = zone_labels[zone_labels > 0]
            if zone_labels.size:
                start = np.bincount(zone_labels).argmax()
        if start is None:
            start = np.bincount(labels[labels > 0]).argmax()
        reachable = labels == start
        return ndimage.binary_dilation(reachable, structure=self.reach), standable

    def evaluate(self, poses, explain: bool = False):
        room, items = self.room, self.items
        rects = [rect(item, pose) for item, pose in zip(items, poses)]
        terms = dict.fromkeys(WEIGHTS, 0.0)
        checks = []

        # Overlaps (with clearance between unrelated items) and room bounds
        for i in range(len(items)):
            if items[i].type in FLAT_TYPES:
                continue
            for j in range(i + 1, len(items)):
                if items[j].type in FLAT_TYPES:
                    continue
                pad = 0.0 if j in self.partners[i] else self.gap / 2
                a = (rects[i][0] - pad, rects[i][1] - pad, rects[i][2] + pad, rects[i][3] + pad)
                b = (rects[j][0] - pad, rects[j][1] - pad, rects[j][2] + pad, rects[j][3] + pad)
                terms["overlap"] += intersection(a, b)
        for i, r in enumerate(rects):
            if items[i].type not in FLAT_TYPES:
                padded = (r[0] - self.gap, r[1] - self.gap, r[2] + self.gap, r[3] + self.gap)
                terms["overlap"] += sum(intersection(padded, obstacle) for obstacle in self.fixed)
        if explain:
            checks.append(("No furniture overlaps", terms["overlap"] < 1e-6))

        # Wall placement
        for item, pose in zip(items, poses):
            if item.type in WALL_TYPES:
                distance = wall_distance(item, pose, room) - self.wall_gap
                terms["wall"] += max(0.0, distance)
                if explain and item.type != "nightstand":
                    checks.append((f"{item.name} against a wall", distance <= NEAR_WALL))

        # Functional pairs
        for i, (anchors, relation, offset) in self.pairs.items():
            best_j = min(anchors, key=lambda j: relation_cost(items[i], poses[i], items[j], poses[j], relation, offset))
            cost = relation_cost(items[i], poses[i], items[best_j], poses[best_j], relation, offset)
            terms["pair"] += cost
            if relation in ("front", "opposite", "around") and items[i].type != "coffee-table":
                wanted = (poses[best_j][2] + 180) % 360
                terms["facing"] += 0.0 if poses[i][2] == wanted else 1.0
            if explain:
                phrase = {"beside-head": "beside", "front": "at", "opposite": "facing", "beside": "beside",
                          "around": "at", "near": "near"}[relation]
                checks.append((f"{items[i].name} {phrase} {items[best_j].name}", cost <= 0.35))

        # Clear floor in front of items
        for i, (item, pose) in enumerate(zip(items, poses)):
            depth = FRONT_CLEARANCE.get(item.type)
            if not depth:
                continue
            zone = front_zone(item, pose, depth)
            blocked = sum(intersection(zone, rects[j]) for j in range(len(items))
                          if j != i and j not in self.partners[i] and items[j].type not in FLAT_TYPES)
            blocked += sum(intersection(zone, obstacle) for obstacle in self.fixed)
            inside = intersection(zone, (0, 0, room.width, room.length))
            blocked += area(zone) - inside
            terms["front"] += blocked
            if explain and item.type in ("bed", "wardrobe", "dresser", "desk", "sofa"):
                checks.append((f"Clear space in front of {item.name}", blocked <= 0.05 * area(zone) + 1e-6))

        # Door swing and windows
        for opening in self.openings:
            if opening.kind == "door":
                zone = opening_zone(opening, room, opening.width)
                blocked = sum(intersection(zone, r) for item, r in zip(items, rects) if item.type not in FLAT_TYPES)
                terms["door"] += blocked
                if explain:
                    checks.append(("Door swing kept clear", blocked < 1e-6))
            else:
                zone = opening_zone(opening, room, 0.6)
                blocked = sum(intersection(zone, r) for item, r in zip(items, rects) if item.height > TALL)
                terms["window"] += blocked
                if explain:
                    checks.append(("Window not blocked by tall furniture", blocked < 1e-6))
        window = next((o for o in self.openings if o.kind == "window"), None)
        if window is not None:
            wx0, wz0, wx1, wz1 = opening_segment(window, room)
            window_center = ((wx0 + wx1) / 2, (wz0 + wz1) / 2)
            for item, r in zip(items, rects):
                if item.type == "desk":
                    d = math.dist(center(r), window_center)
                    terms["light"] += d / math.hypot(room.width, room.length)
                    if explain:
                        checks.append(("Desk near the window for daylight", d <= 1.6))

        # Circulation: every item reachable from the door through a walkway
        reach, standable = self.circulation(poses)
        unreachable = 0
        for i, (item, pose) in enumerate(zip(items, poses)):
            if item.type in FLAT_TYPES:
                continue
            if item.type in FRONT_CLEARANCE or item.type in WALL_TYPES:
                zone = front_zone(item, pose, 0.45)
            else:
                r = rects[i]
                zone = (r[0] - 0.45, r[1] - 0.45, r[2] + 0.45, r[3] + 0.45)
            if not reach[self.cells(zone)].any():
                unreachable += 1
        terms["access"] = float(unreachable)
        total_standable = standable.sum()
        terms["reach"] = 1.0 - (float((reach & standable).sum()) / total_standable if total_standable else 0.0)
        if explain:
            checks.append(("Walkable path to every item", unreachable == 0))

        # Visual balance: area-weighted centroid near the room center
        weights = [area(r) * max(0.3, item.height) for item, r in zip(items, rects)]
        total = sum(weights) or 1.0
        cx = sum(w * center(r)[0] for w, r in zip(weights, rects)) / total
        cz = sum(w * center(r)[1] for w, r in zip(weights, rects)) / total
        offset = math.hypot((cx - room.width / 2) / room.width, (cz - room.length / 2) / room.length)
        terms["balance"] = offset
        if explain:
            checks.append(("Balanced arrangement", offset <= 0.22))

        cost = sum(WEIGHTS[key] * value for key, value in terms.items())
        if not explain:
            return cost
        passed = sum(1 for _, ok in checks if ok)
        return cost, terms, [{"rule": rule, "passed": ok} for rule, ok in checks], passed


# ---------------------------------------------------------------- search

def wall_pose(item: Item, room: Room, wall_gap: float, rng: random.Random):
    rotation = rng.choice(ROTATIONS)
    w, l = dims(item, rotation)
    if rotation == 0:
        x, z = rng.uniform(wall_gap, max(wall_gap, room.width - w - wall_gap)), wall_gap
    elif rotation == 180:
        x, z = rng.uniform(wall_gap, max(wall_gap, room.width - w - wall_gap)), room.length - l - wall_gap
    elif rotation == 90:
        x, z = room.width - w - wall_gap, rng.uniform(wall_gap, max(wall_gap, room.length - l - wall_gap))
    else:
        x, z = wall_gap, rng.uniform(wall_gap, max(wall_gap, room.length - l - wall_gap))
    return x, z, rotation


def random_pose(item: Item, room: Room, wall_gap: float, rng: random.Random):
    rotation = rng.choice(ROTATIONS)
    w, l = dims(item, rotation)
    return (rng.uniform(wall_gap, max(wall_gap, room.width - w - wall_gap)),
            rng.uniform(wall_gap, max(wall_gap, room.length - l - wall_gap)), rotation)


def initial_poses(scorer: Scorer, rng: random.Random):
    items, room, wall_gap = scorer.items, scorer.room, scorer.wall_gap
    poses = [None] * len(items)
    order = sorted(range(len(items)), key=lambda i: (i in scorer.pairs, -items[i].width * items[i].length))
    for i in order:
        item = items[i]
        if i in scorer.pairs:
            anchors, relation, offset = scorer.pairs[i]
            j = rng.choice(anchors)
            if poses[j] is not None:
                poses[i] = clamp_pose(item, ideal_pose(item, items[j], poses[j], relation, offset, rng), room, wall_gap)
                continue
        poses[i] = (wall_pose if item.type in WALL_TYPES else random_pose)(item, room, wall_gap, rng)
    return poses


def propose(scorer: Scorer, poses, rng: random.Random, temperature: float):
    items, room, wall_gap = scorer.items, scorer.room, scorer.wall_gap
    new = list(poses)
    i = rng.randrange(len(items))
    item = items[i]
    move = rng.random()
    if i in scorer.pairs and move < 0.35:
        anchors, relation, offset = scorer.pairs[i]
        j = rng.choice(anchors)
        new[i] = ideal_pose(item, items[j], poses[j], relation, offset, rng)
    elif move < 0.55:
        step = 0.05 + 0.6 * temperature
        x, z, rotation = poses[i]
        new[i] = (x + rng.gauss(0, step), z + rng.gauss(0, step), rotation)
    elif move < 0.72:
        new[i] = wall_pose(item, room, wall_gap, rng) if item.type in WALL_TYPES else random_pose(item, room, wall_gap, rng)
    elif move < 0.85:
        x, z, rotation = poses[i]
        cx, cz = center(rect(item, poses[i]))
        rotation = rng.choice([r for r in ROTATIONS if r != rotation])
        w, l = dims(item, rotation)
        new[i] = (cx - w / 2, cz - l / 2, rotation)
    else:
        j = rng.randrange(len(items))
        if j != i:
            ci, cj = center(rect(item, poses[i])), center(rect(items[j], poses[j]))
            wi, li = dims(item, poses[i][2])
            wj, lj = dims(items[j], poses[j][2])
            new[i] = (cj[0] - wi / 2, cj[1] - li / 2, poses[i][2])
            new[j] = clamp_pose(items[j], (ci[0] - wj / 2, ci[1] - lj / 2, poses[j][2]), room, wall_gap)
    new[i] = clamp_pose(item, new[i], room, wall_gap)
    # Dependents follow their anchor when it moves
    for k, (anchors, relation, offset) in scorer.pairs.items():
        if i in anchors and k != i and rng.random() < 0.5:
            new[k] = clamp_pose(items[k], ideal_pose(items[k], item, new[i], relation, offset, rng), room, wall_gap)
    return new


def anneal(scorer: Scorer, rng: random.Random, iterations: int):
    poses = initial_poses(scorer, rng)
    cost = scorer.evaluate(poses)
    best, best_cost = poses, cost
    t_start, t_end = 3.0, 0.01
    for step in range(iterations):
        temperature = t_start * (t_end / t_start) ** (step / max(1, iterations - 1))
        candidate = propose(scorer, poses, rng, min(1.0, temperature / t_start))
        candidate_cost = scorer.evaluate(candidate)
        if candidate_cost <= cost or rng.random() < math.exp((cost - candidate_cost) / temperature):
            poses, cost = candidate, candidate_cost
            if cost < best_cost:
                best, best_cost = poses, cost
    return best, best_cost


def layout_distance(items: list[Item], a, b) -> float:
    return sum(math.dist(center(rect(item, pa)), center(rect(item, pb))) for item, pa, pb in zip(items, a, b)) / len(items)


def generate(room: Room, items: list[Item], openings: list[Opening], gap: float = 0.3, wall_gap: float = 0.05,
             count: int = 3, seed: int | None = None, runs: int = 6, iterations: int = 1500, obstacles: tuple = ()):
    """Return up to `count` diverse, high-scoring layouts with per-rule explanations."""
    rng = random.Random(seed)
    omitted = [item.name for item in items if not fits(item, room, wall_gap)]
    active = [item for item in items if fits(item, room, wall_gap)]
    if any(item.mandatory and item.name in omitted for item in items):
        raise ValueError("A required item does not fit in this room")
    if not active:
        raise ValueError("No furniture fits in this room")

    results = []
    for run in range(runs):
        run_rng = random.Random(rng.random())
        run_items = list(active)
        run_omitted = list(omitted)
        attempts = 0
        while True:
            scorer = Scorer(room, run_items, openings, gap, wall_gap, obstacles)
            poses, _ = anneal(scorer, run_rng, iterations)
            cost, terms, checks, passed = scorer.evaluate(poses, explain=True)
            attempts += 1
            if terms["overlap"] < 1e-6:
                break
            # Retry before concluding the room is too crowded
            if attempts < 3:
                continue
            # Too crowded: drop the largest optional item and retry
            optional = [i for i, item in enumerate(run_items) if not item.mandatory]
            if not optional:
                break
            attempts = 0
            worst = max(optional, key=lambda i: run_items[i].width * run_items[i].length)
            run_omitted.append(run_items[worst].name)
            run_items = run_items[:worst] + run_items[worst + 1:]
        results.append({"items": run_items, "poses": poses, "cost": cost, "terms": terms,
                        "checks": checks, "passed": passed, "omitted": run_omitted,
                        "valid": terms["overlap"] < 1e-6})

    # Prefer valid layouts that keep all the requested furniture and a clear door, then the most rules met
    results.sort(key=lambda r: (not r["valid"], len(r["omitted"]), r["terms"]["door"] > 1e-6,
                                -r["passed"] / max(1, len(r["checks"])), r["cost"]))
    chosen = []
    for result in results:
        if len(chosen) >= count:
            break
        same_items = [c for c in chosen if [i.id for i in c["items"]] == [i.id for i in result["items"]]]
        if any(layout_distance(result["items"], c["poses"], result["poses"]) < 0.4 for c in same_items):
            continue
        chosen.append(result)
    for result in results:
        if len(chosen) >= count:
            break
        if result not in chosen:
            chosen.append(result)

    layouts = []
    for result in chosen:
        total = len(result["checks"])
        layouts.append({
            "furniture": [{
                "id": item.id, "x": round(pose[0], 3), "z": round(pose[1], 3), "rotation": pose[2],
                "width": round(dims(item, pose[2])[0], 3), "length": round(dims(item, pose[2])[1], 3),
            } for item, pose in zip(result["items"], result["poses"])],
            "score": round(100 * result["passed"] / total) if total else 0,
            "rulesPassed": result["passed"], "rulesTotal": total,
            "cost": round(result["cost"], 4),
            "terms": {key: round(value, 4) for key, value in result["terms"].items()},
            "checks": result["checks"],
            "omitted": result["omitted"],
        })
    return {"layouts": layouts, "algorithm": "guideline-annealing", "runs": runs, "iterations": iterations}
