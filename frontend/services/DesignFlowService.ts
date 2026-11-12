import { ApiError, callApi } from './apiClient';
import { designItemColor } from '@/utils/designItemColors';
import { mapFurnitureIdToUnity } from '@/config/unity-furniture-map';
import { footprintForRotation, roomLocalToUnity } from '@/utils/roomLocalToUnity';
import type { DesignProposal, FurnitureItem, GenerativeDesignOutput } from '@/types/ai-design';
import type {
  CustomizedDesignLayout,
  CustomizedLayoutItem,
  DesignFlowGenerationResult,
  DesignLayoutItem,
  DesignPreferencesInput,
  DesignProposalV2,
  SavedFinalDesignResponse,
  ScannedRoom,
} from '@/types/design-flow';
import type { FurnitureLibraryItem } from '@/types/ar-view';
import type { ApplyLayoutRequest, SpawnFurnitureRequest } from '@/types/unity-bridge';

interface GenerateDesignRequest {
  roomType: string;
  designStyle: string;
  dimensions: { width: number; length: number; height: number };
  budgetPhp: number;
  requiredItemIds: string[];
  requiredCategories: string[];
  measurementId?: string;
  projectId?: string;
  notes?: string;
  variationCount?: number;
}

interface GenerateDesignResponse extends GenerativeDesignOutput {
  sessionId?: string;
  measurementId?: string;
  projectId?: string;
  roomDimensions?: { width: number; height: number; depth: number };
  scannedRoom?: ScannedRoom | null;
  preferences?: DesignPreferencesInput;
  finalLayout?: CustomizedDesignLayout | null;
  finalizedAt?: number;
}

export type RoomFitReason = 'too-tall' | 'too-big' | 'no-space';

export interface RoomFitResult {
  /** The room the check used (the scanned outline's size), metres. */
  room: { width: number; length: number; height: number };
  /** Existing furniture the scan marked in the room. */
  existingCount: number;
  unfit: { id: string; reason: RoomFitReason }[];
}

function toLayoutItem(item: DesignLayoutItem | NonNullable<DesignProposal['layout']>['furniture'][number], index: number): DesignLayoutItem {
  if ('localPosition' in item && item.localPosition) {
    return item;
  }
  const furniture = item as DesignProposal['layout']['furniture'][number];
  return {
    instanceId: furniture.id || `item-${index}`,
    furnitureId: furniture.id || furniture.type || `item-${index}`,
    displayName: furniture.name,
    category: furniture.category,
    width: furniture.dimensions?.width ?? 1,
    height: furniture.dimensions?.height ?? 0.8,
    depth: furniture.dimensions?.length ?? 0.8,
    localPosition: {
      x: furniture.position?.x ?? 0,
      y: furniture.position?.y ?? 0,
      z: furniture.position?.z ?? 0,
    },
    rotationY: furniture.position?.rotation ?? 0,
    color: furniture.properties?.color,
    pricePhp: furniture.properties?.price ?? furniture.estimatedPrice?.low ?? 0,
    glbUrl: furniture.glbUrl || undefined,
  };
}

function toProposalV2(proposal: DesignProposal, budgetPhp: number): DesignProposalV2 {
  const items = Array.isArray((proposal as DesignProposal & { items?: DesignLayoutItem[] }).items)
    && (proposal as DesignProposal & { items?: DesignLayoutItem[] }).items!.length > 0
    ? (proposal as DesignProposal & { items?: DesignLayoutItem[] }).items!
    : (proposal.layout?.furniture || []).map(toLayoutItem);

  const totalPhp =
    (proposal as DesignProposal & { totalPhp?: number }).totalPhp
    ?? proposal.estimatedCost?.high
    ?? items.reduce((sum, item) => sum + (item.pricePhp || 0), 0);

  const remoteScore = (proposal as DesignProposal & { score?: Partial<DesignProposalV2['score']> }).score;

  return {
    id: proposal.id,
    title: proposal.title,
    description: proposal.description,
    items,
    score: {
      overall: proposal.performanceScore?.overall ?? 0,
      space: proposal.performanceScore?.spaceEfficiency ?? 0,
      flow: proposal.performanceScore?.functionalFlow ?? 0,
      budgetFit: budgetPhp > 0
        ? Math.max(0, Math.min(100, Math.round((1 - Math.max(0, totalPhp - budgetPhp) / budgetPhp) * 100)))
        : 100,
      clearance: remoteScore?.clearance,
      relations: remoteScore?.relations,
      wall: remoteScore?.wall,
      balance: remoteScore?.balance,
    },
    totalPhp,
    overBudget: Boolean((proposal as DesignProposal & { overBudget?: boolean }).overBudget)
      || (budgetPhp > 0 && totalPhp > budgetPhp),
    colorPalette: proposal.colorPalette || [],
    pros: Array.isArray(proposal.pros) ? proposal.pros : [],
    cons: Array.isArray(proposal.cons) ? proposal.cons : [],
  };
}

export class DesignFlowService {
  static async generateLayouts(
    preferences: DesignPreferencesInput,
    room: { width: number; length: number; height: number },
    extras?: { measurementId?: string; projectId?: string },
  ): Promise<DesignFlowGenerationResult> {
    const body: GenerateDesignRequest = {
      roomType: preferences.roomType,
      designStyle: preferences.style,
      dimensions: room,
      budgetPhp: preferences.budgetPhp,
      requiredItemIds: preferences.requiredItemIds,
      requiredCategories: preferences.requiredCategories,
      measurementId: extras?.measurementId,
      projectId: extras?.projectId,
      notes: preferences.notes,
      variationCount: 2,
    };

    const response = await callApi<GenerateDesignResponse>('/designs/generate', {
      method: 'POST',
      body,
      timeoutMs: 60000,
    });

    const proposals = (response.proposals || []).map((proposal) =>
      toProposalV2(proposal, preferences.budgetPhp),
    );

    return {
      sessionId: response.sessionId,
      measurementId: extras?.measurementId || response.measurementId,
      projectId: extras?.projectId || response.projectId,
      room: response.roomDimensions
        ? {
            width: response.roomDimensions.width || room.width,
            length: response.roomDimensions.depth || room.length,
            height: response.roomDimensions.height || room.height,
          }
        : room,
      scannedRoom: response.scannedRoom ?? null,
      preferences,
      proposals,
    };
  }

  /**
   * Catalog pieces that can't fit the scanned room (too big, too tall, or no free floor left by the
   * furniture already there), so the preferences screen leaves them out of the recommendations.
   */
  static async getRoomFit(
    room: { width: number; length: number; height: number },
    measurementId?: string,
  ): Promise<RoomFitResult> {
    const response = await callApi<RoomFitResult>('/designs/room-fit', {
      method: 'POST',
      body: { dimensions: room, measurementId },
      timeoutMs: 20000,
    });
    return {
      room: response.room,
      existingCount: response.existingCount ?? 0,
      unfit: Array.isArray(response.unfit) ? response.unfit : [],
    };
  }

  /** Persist the AR-customized layout (design flow step 7). */
  static async saveFinalDesign(
    layout: CustomizedDesignLayout,
    options?: { title?: string; preferences?: DesignPreferencesInput },
  ): Promise<SavedFinalDesignResponse> {
    return callApi<SavedFinalDesignResponse>('/designs/finalize', {
      method: 'POST',
      body: {
        sessionId: layout.sessionId,
        proposalId: layout.proposalId,
        projectId: layout.projectId,
        measurementId: layout.measurementId,
        room: layout.room,
        items: layout.items,
        totalPhp: layout.totalPhp,
        title: options?.title,
        preferences: options?.preferences,
      },
      timeoutMs: 30000,
    });
  }

  /**
   * The project's newest design (a saved one first), so opening a saved project shows its design
   * instead of starting over at the preferences. Null when the project has no design yet.
   */
  static async getLatestProjectSession(
    projectId: string,
  ): Promise<{ sessionId: string; finalized: boolean } | null> {
    try {
      return await callApi<{ sessionId: string; finalized: boolean }>(
        `/designs/project/${encodeURIComponent(projectId)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  static async getSession(
    sessionId: string,
  ): Promise<
    DesignFlowGenerationResult & {
      finalLayout?: CustomizedDesignLayout | null;
      finalizedAt?: number;
    }
  > {
    const remote = await callApi<GenerateDesignResponse>(`/designs/${encodeURIComponent(sessionId)}`);
    const preferences: DesignPreferencesInput = remote.preferences || {
      roomType: 'Living Room',
      style: 'Modern',
      budgetPhp: 0,
      requiredItemIds: [],
      requiredCategories: [],
    };
    const room = {
      width: remote.roomDimensions?.width || 4,
      length: remote.roomDimensions?.depth || 5,
      height: remote.roomDimensions?.height || 2.7,
    };
    return {
      sessionId: remote.sessionId || sessionId,
      measurementId: remote.measurementId,
      projectId: remote.projectId,
      room,
      scannedRoom: remote.scannedRoom ?? null,
      preferences,
      proposals: (remote.proposals || []).map((proposal) =>
        toProposalV2(proposal, preferences.budgetPhp),
      ),
      finalLayout: remote.finalLayout ?? null,
      finalizedAt: remote.finalizedAt,
    };
  }
}

export function designProposalToLegacy(
  proposal: DesignProposalV2,
  room: { width: number; length: number; height: number },
  roomType: string,
): DesignProposal {
  return {
    id: proposal.id,
    roomType,
    title: proposal.title,
    description: proposal.description,
    layout: {
      id: `layout-${proposal.id}`,
      version: 1,
      furniture: proposal.items.map((item, index) => {
        // Quarter turns swap the footprint, rounded as AR does: angles back from AR are a hair off
        // (179.99°), and `% 180` swapped those and moved the piece (2026-11-12).
        const foot = footprintForRotation({ width: item.width, depth: item.depth }, item.rotationY);
        const footprintW = foot.width;
        const footprintD = foot.depth;
        return {
          id: item.instanceId || item.furnitureId || `item-${index}`,
          type: item.category,
          category: (['seating', 'table', 'storage', 'decor', 'lighting', 'other'].includes(item.category)
            ? item.category
            : 'other') as FurnitureItem['category'],
          name: item.displayName,
          dimensions: {
            width: item.width,
            length: item.depth,
            height: item.height,
          },
          // layout-3d centres the room on the origin; proposal positions are min-corner offsets.
          position: {
            x: item.localPosition.x + footprintW / 2 - room.width / 2,
            y: item.localPosition.y,
            z: item.localPosition.z + footprintD / 2 - room.length / 2,
            rotation: item.rotationY,
          },
          properties: {
            color: item.color,
            price: item.pricePhp,
          },
          zIndex: index + 1,
          color: designItemColor(index, item.category, item.role),
          glbUrl: item.glbUrl,
        };
      }),
      metadata: {
        generatedAt: Date.now(),
        algorithm: 'genetic',
        iterationsCount: 0,
      },
    },
    performanceScore: {
      spaceEfficiency: proposal.score.space,
      comfort: proposal.score.overall,
      symmetry: proposal.score.overall,
      accessibility: proposal.score.flow,
      aesthetics: proposal.score.overall,
      functionalFlow: proposal.score.flow,
      lighting: proposal.score.overall,
      ergonomics: proposal.score.overall,
      overall: proposal.score.overall,
    },
    visualization: {},
    colorPalette: proposal.colorPalette,
    recommendedFurniture: [],
    estimatedCost: {
      low: Math.round(proposal.totalPhp * 0.85),
      mid: proposal.totalPhp,
      high: Math.round(proposal.totalPhp * 1.15),
      totalPhp: proposal.totalPhp,
      currency: 'PHP',
    },
    pros: [],
    cons: proposal.overBudget ? ['Over the selected budget'] : [],
    rank: 1,
  };
}

function catalogMatchScore(item: DesignLayoutItem, catalogItem: FurnitureLibraryItem): number {
  const id = (item.furnitureId || '').toLowerCase();
  const name = (item.displayName || '').toLowerCase();
  const role = (item.role || item.category || '').toLowerCase();
  const catalogId = catalogItem.id.toLowerCase();
  const catalogName = catalogItem.name.toLowerCase();
  if (catalogId === id) return 100;
  if (id && catalogId.includes(id)) return 80;
  if (role && (catalogId.includes(role) || catalogName.includes(role))) return 60;
  if (name && catalogName.includes(name)) return 50;
  if (item.category && catalogItem.category === item.category) return 20;
  return 0;
}

export function resolveCatalogForLayoutItem(
  item: DesignLayoutItem,
  catalog: FurnitureLibraryItem[],
): FurnitureLibraryItem | undefined {
  if (!catalog.length) return undefined;
  const exact = catalog.find((entry) => entry.id === item.furnitureId);
  if (exact) return exact;
  const mapped = mapFurnitureIdToUnity(item.furnitureId);
  const byMapped = catalog.find((entry) => entry.id === mapped);
  if (byMapped) return byMapped;
  let best: FurnitureLibraryItem | undefined;
  let bestScore = 0;
  catalog.forEach((entry) => {
    const score = catalogMatchScore(item, entry);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  });
  return bestScore >= 50 ? best : undefined;
}

export function buildApplyLayoutRequest(
  proposal: DesignProposalV2,
  room: { width: number; length: number; height: number },
  catalog: FurnitureLibraryItem[] = [],
): ApplyLayoutRequest {
  const items: SpawnFurnitureRequest[] = (proposal.items as CustomizedLayoutItem[])
    .filter((item) => item.role !== 'rug')
    .map((item) => {
      const match = resolveCatalogForLayoutItem(item, catalog);
      const glbUrl = item.glbUrl
        || (typeof match?.model3D?.url === 'string' ? match.model3D.url : undefined);
      const pose = roomLocalToUnity(
        item.localPosition,
        item.rotationY,
        { width: item.width, depth: item.depth },
        room,
      );
      return {
        modelId: match?.id || item.furnitureId || item.instanceId,
        catalogId: mapFurnitureIdToUnity(match?.id || item.furnitureId || item.instanceId),
        glbUrl,
        width: item.width,
        height: item.height,
        depth: item.depth,
        hasPosition: true,
        position: { x: pose.x, y: pose.y, z: pose.z },
        rotationY: pose.rotationY,
        // A saved design keeps the colours chosen in AR.
        colorHex: item.tintHex,
      };
    });

  return { clearExisting: true, items };
}
