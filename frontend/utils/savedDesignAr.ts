/**
 * Reopening a saved design in AR. AR places the proposal it finds in the stored generation, so the
 * saved arrangement (with any pieces moved, swapped or recoloured) goes in as that proposal.
 */

import type {
  CustomizedDesignLayout,
  DesignFlowGenerationResult,
  DesignProposalV2,
} from '@/types/design-flow';

/** Same place to within this (m) and angle (degrees): AR's round trip isn't exact to the millimetre. */
const SAME_POSITION_M = 0.02;
const SAME_ANGLE_DEG = 1;

/** The generation for AR, with `layout` as its proposal (added if the session has no such proposal). */
export function generationForSavedLayout(
  generation: DesignFlowGenerationResult,
  layout: CustomizedDesignLayout,
  title: string,
): DesignFlowGenerationResult {
  const original = generation.proposals.find((entry) => entry.id === layout.proposalId);
  const saved: DesignProposalV2 = {
    id: layout.proposalId,
    title: original?.title || title,
    description: original?.description || '',
    score: original?.score || { overall: 0, space: 0, flow: 0, budgetFit: 0 },
    overBudget: original?.overBudget || false,
    colorPalette: original?.colorPalette || [],
    pros: original?.pros,
    cons: original?.cons,
    items: layout.items,
    totalPhp: layout.totalPhp,
  };
  return {
    ...generation,
    room: layout.room,
    proposals: [saved, ...generation.proposals.filter((entry) => entry.id !== layout.proposalId)],
  };
}

function angleGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
}

/**
 * The AR draft changes the saved design: a piece added, removed, swapped, moved, turned or recoloured.
 * Pieces are compared by product and place, since AR gives them new instance ids.
 */
export function layoutEdited(saved: CustomizedDesignLayout, draft: CustomizedDesignLayout): boolean {
  if (saved.items.length !== draft.items.length) return true;
  const unmatched = [...saved.items];
  return draft.items.some((piece) => {
    const index = unmatched.findIndex((other) =>
      other.furnitureId === piece.furnitureId
      && (other.tintHex || '') === (piece.tintHex || '')
      && Math.abs(other.localPosition.x - piece.localPosition.x) <= SAME_POSITION_M
      && Math.abs(other.localPosition.z - piece.localPosition.z) <= SAME_POSITION_M
      && angleGap(other.rotationY, piece.rotationY) <= SAME_ANGLE_DEG);
    if (index < 0) return true;
    unmatched.splice(index, 1);
    return false;
  });
}
