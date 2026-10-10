import { describe, it, expect } from '@jest/globals';
import { toCenteredPosition, toDesignProposal, toARLayoutItems, type GeneratedLayoutResult } from '../utils/generatedLayout';

const room = { width: 5, length: 4, height: 2.7 };

const layout: GeneratedLayoutResult = {
  id: 'layout-1',
  furniture: [
    { id: 'bed-1', name: 'Queen Bed', type: 'bed', category: 'other', x: 0, y: 0, width: 1.6, depth: 2.1, height: 0.5, rotation: 0, color: '#8b4513', pricePHP: 10000 },
    { name: 'Writing Desk', type: 'desk', category: 'table', x: 3.8, y: 3.4, width: 1.2, depth: 0.6, rotation: 0, color: 'not-a-color' },
  ],
  safety_warnings: ['Narrow walkway near desk'],
  score: 82,
  estimatedCostPHP: 14500,
  rankingSource: 'geometric',
};

describe('generated layout adapters', () => {
  it('converts top-left floor-plan footprints to room-centered positions', () => {
    expect(toCenteredPosition(layout.furniture[0], room)).toEqual({ x: -1.7, z: -0.95 });
    const desk = toCenteredPosition(layout.furniture[1], room);
    expect(desk.x).toBeCloseTo(1.9);
    expect(desk.z).toBeCloseTo(1.7);
  });

  it('builds a design proposal for 3D Layout and saving', () => {
    const design = toDesignProposal(layout, { room, roomType: 'Bedroom', style: 'Minimalist' });
    expect(design.id).toBe('layout-1');
    expect(design.title).toBe('Minimalist Bedroom');
    expect(design.estimatedCost).toEqual({ low: 14500, mid: 14500, high: 14500 });
    expect(design.cons).toEqual(['Narrow walkway near desk']);
    const [bed, desk] = design.layout.furniture;
    expect(bed.dimensions).toEqual({ width: 1.6, length: 2.1, height: 0.5 });
    expect(bed.position).toEqual({ x: -1.7, y: 0, z: -0.95, rotation: 0 });
    expect(bed.properties.price).toBe(10000);
    expect(desk.id).toBe('desk-1');
    expect(desk.category).toBe('table');
    expect(desk.dimensions.height).toBe(0.75);
  });

  it('builds AR items with numeric colors and centered offsets', () => {
    const [bed, desk] = toARLayoutItems(layout, room);
    expect(bed.color).toBe(0x8b4513);
    expect(bed.dimensions).toEqual({ width: 1.6, depth: 2.1, height: 0.5 });
    expect(bed.offset).toEqual({ x: -1.7, z: -0.95 });
    expect(desk.color).toBe(0x808080);
  });
});
