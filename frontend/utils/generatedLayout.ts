/**
 * Generated Layout Adapters
 * Converts layouts from POST /design/generate into the shapes used by
 * the 3D Layout screen, the AR overlay and saved projects.
 */

import type { DesignProposal, FurnitureItem as DesignFurnitureItem } from '@/types/ai-design';
import type { RoomDimensions } from '@/types/layout-3d';
import type { ARLayoutItem } from '@/components/ARFurniturePlacement';

// Floor-plan furniture: oriented footprint with a top-left room origin, in meters.
export interface GeneratedFurniture {
  id?: string;
  name: string;
  type?: string;
  category?: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height?: number;
  rotation: number;
  color: string;
  pricePHP?: number;
  modelUrl?: string;
}

export interface GeneratedLayoutResult {
  id: string;
  furniture: GeneratedFurniture[];
  safety_warnings: string[];
  score: number;
  estimatedCostPHP: number;
  rankingSource: 'geometric' | 'xgboost';
}

export interface LayoutContext {
  room: RoomDimensions;
  roomType: string;
  style: string;
}

// Used only when an older backend response omits item height.
const FALLBACK_HEIGHT = 0.75;
const CATEGORIES: DesignFurnitureItem['category'][] = ['seating', 'table', 'storage', 'decor', 'lighting', 'other'];

/** Center of a footprint, relative to the room center (3D scenes are centered on the room). */
export function toCenteredPosition(item: GeneratedFurniture, room: RoomDimensions): { x: number; z: number } {
  return {
    x: item.x + item.width / 2 - room.width / 2,
    z: item.y + item.depth / 2 - room.length / 2,
  };
}

export function toDesignProposal(layout: GeneratedLayoutResult, { room, roomType, style }: LayoutContext): DesignProposal {
  const furniture: DesignFurnitureItem[] = layout.furniture.map((item, index) => {
    const { x, z } = toCenteredPosition(item, room);
    const category = CATEGORIES.find(c => c === item.category) ?? 'other';
    return {
      id: item.id || `${item.type || 'item'}-${index}`,
      type: item.type || category,
      category,
      name: item.name,
      // Footprints are already oriented, so rotation stays 0.
      dimensions: { width: item.width, length: item.depth, height: item.height ?? FALLBACK_HEIGHT },
      position: { x, y: 0, z, rotation: 0 },
      properties: { color: item.color, style, price: item.pricePHP },
      zIndex: index,
      modelUrl: item.modelUrl,
    };
  });
  const cost = layout.estimatedCostPHP;
  return {
    id: layout.id,
    roomType,
    title: `${style} ${roomType}`,
    description: `${furniture.length} items · ${room.width}m × ${room.length}m`,
    layout: {
      id: layout.id,
      version: 1,
      furniture,
      metadata: { generatedAt: Date.now(), algorithm: 'rule-based', iterationsCount: 1 },
    },
    performanceScore: {
      spaceEfficiency: layout.score, comfort: layout.score, symmetry: layout.score,
      accessibility: layout.score, aesthetics: layout.score, functionalFlow: layout.score,
      lighting: layout.score, ergonomics: layout.score, overall: layout.score,
    },
    visualization: {},
    colorPalette: [...new Set(layout.furniture.map(item => item.color).filter(Boolean))],
    recommendedFurniture: furniture,
    estimatedCost: { low: cost, mid: cost, high: cost },
    pros: [],
    cons: layout.safety_warnings,
    rank: 1,
    currency: 'PHP',
  };
}

export function toARLayoutItems(layout: GeneratedLayoutResult, room: RoomDimensions): ARLayoutItem[] {
  return layout.furniture.map((item, index) => {
    const parsedColor = parseInt(item.color?.replace('#', '') ?? '', 16);
    return {
      id: `${item.type || item.category || 'item'}-${index}`,
      name: item.name,
      dimensions: { width: item.width, depth: item.depth, height: item.height ?? FALLBACK_HEIGHT },
      color: Number.isFinite(parsedColor) ? parsedColor : 0x808080,
      modelUrl: item.modelUrl,
      offset: toCenteredPosition(item, room),
    };
  });
}
