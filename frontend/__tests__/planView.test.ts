import { describe, it, expect } from '@jest/globals';
import { planFootprint, planX, threePose } from '@/utils/planView';
import { roomLocalToUnity } from '@/utils/roomLocalToUnity';

const room = { width: 4, length: 3 };

const piece = (x: number, z: number, rotationY: number) => ({
  width: 1.8,
  depth: 0.6,
  rotationY,
  localPosition: { x, z },
});

describe('plan view', () => {
  it('runs x right to left, so the plan is the room seen from above, not its mirror image', () => {
    // A piece at the room frame's x = 0 wall is drawn against the right-hand wall.
    const foot = planFootprint(piece(0, 0.05, 0), room.width);
    expect(foot.left).toBeCloseTo(room.width - 1.8);
    expect(foot.left + foot.width).toBeCloseTo(room.width);
    expect(foot.top).toBeCloseTo(0.05);
    expect(planX(0, room.width)).toBe(room.width);
  });

  it('puts every piece where AR puts it, mirrored only in x', () => {
    for (const rotationY of [0, 90, 180, 270]) {
      const item = piece(1.2, 0.7, rotationY);
      const foot = planFootprint(item, room.width);
      const ar = roomLocalToUnity(item.localPosition, rotationY, item, room);
      expect(foot.centerX).toBeCloseTo(room.width / 2 - ar.x);
      expect(foot.centerZ).toBeCloseTo(room.length / 2 + ar.z);
    }
  });

  it('swaps the footprint by quarter turns, like AR, so angles back from AR stay put', () => {
    // 179.99° is a piece facing the other way, not a sideways one (AR's angles are a hair off).
    expect(planFootprint(piece(1, 1, 179.99), room.width).width).toBeCloseTo(1.8);
    expect(planFootprint(piece(1, 1, 359.6), room.width).width).toBeCloseTo(1.8);
    expect(planFootprint(piece(1, 1, 89.99), room.width).width).toBeCloseTo(0.6);
    expect(planFootprint(piece(1, 1, 270.2), room.width).depth).toBeCloseTo(1.8);
  });

  it('turns x and the angle round for the right-handed 3D view', () => {
    const pose = threePose({ x: 1, z: 2, rotation: 90 });
    expect(pose.x).toBe(-1);
    expect(pose.z).toBe(2);
    expect(pose.rotationY).toBeCloseTo(-Math.PI / 2);
    expect(threePose({ x: 0, z: 0 }).rotationY).toBeCloseTo(0);
  });
});
