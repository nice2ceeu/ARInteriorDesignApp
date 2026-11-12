import { describe, it, expect, jest } from '@jest/globals';
import { generationForSavedLayout, layoutEdited } from '@/utils/savedDesignAr';
import { buildApplyLayoutRequest } from '@/services/DesignFlowService';
import { roomLocalToUnity, unityToRoomLocal } from '@/utils/roomLocalToUnity';
import type {
  CustomizedDesignLayout,
  CustomizedLayoutItem,
  DesignFlowGenerationResult,
  DesignProposalV2,
} from '@/types/design-flow';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), multiRemove: jest.fn() },
}));

const room = { width: 4, length: 5, height: 2.7 };

function piece(id: string, x: number, z: number, extra: Partial<CustomizedLayoutItem> = {}): CustomizedLayoutItem {
  return {
    instanceId: `${id}-1`,
    furnitureId: id,
    displayName: id,
    category: 'sofa',
    width: 2,
    height: 0.8,
    depth: 0.9,
    localPosition: { x, y: 0, z },
    rotationY: 90,
    pricePhp: 1000,
    ...extra,
  };
}

function layout(items: CustomizedLayoutItem[]): CustomizedDesignLayout {
  return { proposalId: 'option-a', sessionId: 's1', room, items, totalPhp: 2000, updatedAt: 1 };
}

const proposal: DesignProposalV2 = {
  id: 'option-a',
  title: 'Option A',
  description: 'As generated',
  items: [piece('sofa', 0, 0)],
  score: { overall: 90, space: 90, flow: 90, budgetFit: 100 },
  totalPhp: 1000,
  overBudget: false,
  colorPalette: ['#FFFFFF'],
};

function generation(proposals: DesignProposalV2[]): DesignFlowGenerationResult {
  return {
    sessionId: 's1',
    projectId: 'p1',
    measurementId: 'm1',
    room: { width: 3, length: 3, height: 2.5 },
    preferences: { roomType: 'Bedroom', style: 'Modern', budgetPhp: 20000, requiredItemIds: [], requiredCategories: [] },
    proposals,
  };
}

describe('generationForSavedLayout', () => {
  it('puts the saved arrangement in place of the generated proposal', () => {
    const saved = layout([piece('sofa', 1, 2), piece('chair', 3, 1)]);
    const other = { ...proposal, id: 'option-b' };
    const result = generationForSavedLayout(generation([proposal, other]), saved, 'My design');
    const placed = result.proposals.find((entry) => entry.id === 'option-a');
    expect(placed?.items).toEqual(saved.items);
    expect(placed?.title).toBe('Option A');
    expect(placed?.totalPhp).toBe(2000);
    expect(result.proposals).toHaveLength(2);
    expect(result.room).toEqual(room);
    expect(result.sessionId).toBe('s1');
  });

  it('adds the proposal when the session no longer lists it', () => {
    const result = generationForSavedLayout(generation([]), layout([piece('sofa', 1, 2)]), 'My design');
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].id).toBe('option-a');
    expect(result.proposals[0].title).toBe('My design');
  });

  it('sends saved colours to AR, and no rugs', () => {
    const saved = layout([piece('sofa', 1, 2, { tintHex: '#AA0000' }), piece('rug', 1, 1, { role: 'rug' })]);
    const result = generationForSavedLayout(generation([proposal]), saved, 'My design');
    const request = buildApplyLayoutRequest(result.proposals[0], room);
    expect(request.items).toHaveLength(1);
    expect(request.items[0].colorHex).toBe('#AA0000');
  });
});

describe('layoutEdited', () => {
  const saved = layout([piece('sofa', 1, 2), piece('chair', 3, 1)]);

  it('sees no change after AR round-trip noise, new instance ids or a different order', () => {
    const draft = layout([
      piece('chair', 3.01, 1, { instanceId: 'fur-2' }),
      piece('sofa', 1, 1.99, { instanceId: 'fur-1', rotationY: 90.4 }),
    ]);
    expect(layoutEdited(saved, draft)).toBe(false);
  });

  it('treats 0 and 360 degrees as the same turn', () => {
    const before = layout([piece('sofa', 1, 2, { rotationY: 0 })]);
    expect(layoutEdited(before, layout([piece('sofa', 1, 2, { rotationY: 359.6 })]))).toBe(false);
  });

  it.each([
    ['moved', [piece('sofa', 1.5, 2), piece('chair', 3, 1)]],
    ['turned', [piece('sofa', 1, 2, { rotationY: 180 }), piece('chair', 3, 1)]],
    ['recoloured', [piece('sofa', 1, 2, { tintHex: '#112233' }), piece('chair', 3, 1)]],
    ['swapped', [piece('loveseat', 1, 2), piece('chair', 3, 1)]],
    ['removed', [piece('sofa', 1, 2)]],
  ])('sees a piece %s', (_label, items) => {
    expect(layoutEdited(saved, layout(items))).toBe(true);
  });

  it.each([0, 90, 180, 270])('sees no change after the trip into AR and back at %i degrees', (rotationY) => {
    const original = piece('sofa', 1.27, 2.43, { rotationY });
    const size = { width: original.width, depth: original.depth };
    const pose = roomLocalToUnity(original.localPosition, rotationY, size, room);
    const local = unityToRoomLocal({ x: pose.x, z: pose.z }, pose.rotationY, size, room);
    const back = piece('sofa', local.x, local.z, { rotationY: pose.rotationY });
    expect(layoutEdited(layout([original]), layout([back]))).toBe(false);
  });
});
