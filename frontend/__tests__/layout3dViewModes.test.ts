import { describe, it, expect } from '@jest/globals';
import { defaultControls, orthoHalfHeight, snapIsoHeading } from '../hooks/useLayout3DScene';

const room = { width: 5, length: 4, height: 2.7 };

describe('3D layout view modes', () => {
  it('starts each mode with its own framing', () => {
    const perspective = defaultControls('perspective', room);
    expect(perspective.zoom).toBeGreaterThan(Math.max(room.width, room.length));
    expect(perspective.rotationX).toBeGreaterThan(0);
    expect(defaultControls('top-down', room)).toEqual({ rotationX: 0, rotationY: 0, zoom: 1, panX: 0, panY: 0 });
    const iso = defaultControls('orthographic', room);
    expect(iso.rotationY).toBeCloseTo(Math.PI / 4);
    expect(iso.rotationX).toBeCloseTo(Math.atan(1 / Math.SQRT2));
  });

  it('frames the whole room in the top-down view for portrait and landscape screens', () => {
    const portrait = 0.5;
    const half = orthoHalfHeight('top-down', room, portrait);
    expect(half).toBeGreaterThanOrEqual(room.length / 2);
    expect(half * portrait).toBeGreaterThanOrEqual(room.width / 2);
    const landscape = 2;
    const wide = orthoHalfHeight('top-down', room, landscape);
    expect(wide).toBeGreaterThanOrEqual(room.length / 2);
    expect(wide * landscape).toBeGreaterThanOrEqual(room.width / 2);
  });

  it('frames taller rooms with more height in the isometric view', () => {
    expect(orthoHalfHeight('orthographic', { ...room, height: 4 }, 1)).toBeGreaterThan(orthoHalfHeight('orthographic', room, 1));
  });

  it('snaps isometric turns to 45° + 90° steps', () => {
    expect(snapIsoHeading(Math.PI / 4 + 0.3)).toBeCloseTo(Math.PI / 4);
    expect(snapIsoHeading(Math.PI / 4 + 1.0)).toBeCloseTo(Math.PI / 4 + Math.PI / 2);
    expect(snapIsoHeading(Math.PI / 4 - 1.0)).toBeCloseTo(Math.PI / 4 - Math.PI / 2);
  });
});
