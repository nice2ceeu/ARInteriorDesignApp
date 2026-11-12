/**
 * Drawing the planner's room on a page or screen without mirroring it.
 *
 * The planner's room frame is a turned copy of AR's world (backend `roomFeatures.toLocal`), and
 * AR's world seen from above has x to the right and z pointing up the page. Plans used to be
 * drawn with z running down the page and x to the right: that is the room's mirror image, so a
 * chair on your right in the room was on the left of the plan, and no turn could match the two
 * (client adviser, 2026-11-12). Drawn with z down the page, x has to run from right to left.
 *
 * Rotation 0 faces +z. With x flipped, a turn of θ in AR is a clockwise turn of θ on a y-down
 * page (SVG `rotate(θ)`).
 */

import { footprintForRotation } from '@/utils/roomLocalToUnity';

export interface PlanPiece {
  width: number;
  depth: number;
  rotationY: number;
  localPosition: { x: number; z: number };
}

/** A piece's footprint on the plan in metres, page orientation (left, top, width, depth, centre). */
export interface PlanFootprint {
  left: number;
  top: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
}

/**
 * Where a piece sits on a plan drawn with z down the page. `localPosition` is the min corner of
 * the footprint (quarter turns swap width and depth, as `roomLocalToUnity` does).
 */
export function planFootprint(piece: PlanPiece, roomWidth: number): PlanFootprint {
  const foot = footprintForRotation({ width: piece.width, depth: piece.depth }, piece.rotationY);
  const left = roomWidth - piece.localPosition.x - foot.width;
  const top = piece.localPosition.z;
  return {
    left,
    top,
    width: foot.width,
    depth: foot.depth,
    centerX: left + foot.width / 2,
    centerZ: top + foot.depth / 2,
  };
}

/** A room-frame x (metres) across a plan drawn with z down the page. */
export function planX(x: number, roomWidth: number): number {
  return roomWidth - x;
}

/**
 * The same pose in a right-handed 3D scene (three.js): AR (Unity) is left-handed, so the scene
 * is the room's mirror image unless one axis is turned round. With x negated, glTF models (which
 * Unity also loads with x negated) come out the way round they are in AR, and turns go the other
 * way.
 */
export function threePose(position: { x: number; z: number; rotation?: number }): { x: number; z: number; rotationY: number } {
  return {
    x: -(position.x || 0),
    z: position.z || 0,
    rotationY: -(((position.rotation || 0) * Math.PI) / 180),
  };
}
