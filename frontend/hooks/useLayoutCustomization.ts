/**
 * useLayoutCustomization Hook
 * Design-flow step 6 (Customize): recolour, replace, lock and AI-regenerate the layout placed
 * in AR, warn about collisions, and keep the user's edited layout in the planner's room-local
 * frame for step 7.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import type { UnityARViewerHandle } from '@/components/UnityARViewer';
import { mapFurnitureIdToUnity } from '@/config/unity-furniture-map';
import {
  DesignFlowService,
  buildApplyLayoutRequest,
  resolveCatalogForLayoutItem,
} from '@/services/DesignFlowService';
import { saveCustomizedLayout, saveDesignGeneration } from '@/utils/designFlowStorage';
import { canPlaceMore, resolveAvailableColorHex } from '@/utils/furnitureCatalogHelpers';
import { describePlacementIssue } from '@/utils/placementWarning';
import { normalizeYaw, unityToRoomLocal } from '@/utils/roomLocalToUnity';
import type { FurnitureLibraryItem } from '@/types/ar-view';
import type {
  CustomizedDesignLayout,
  CustomizedLayoutItem,
  DesignFlowGenerationResult,
  DesignProposalV2,
} from '@/types/design-flow';
import type {
  LayoutPayload,
  PlacedFurniturePayload,
  PlacementSafetyPayload,
  SelectionPayload,
} from '@/types/unity-bridge';

const SAVE_DEBOUNCE_MS = 600;
const MAX_REPLACEMENTS = 12;

type PlanRoom = { width: number; length: number; height: number };

export interface FurnitureColorOption {
  label: string;
  hex: string;
}

interface UseLayoutCustomizationProps {
  /** Only the design-flow "View in AR" screen customizes a generated layout. */
  enabled: boolean;
  unityRef: React.RefObject<UnityARViewerHandle | null>;
  catalogItems: FurnitureLibraryItem[];
  generationRef: React.MutableRefObject<DesignFlowGenerationResult | null>;
  proposalRef: React.MutableRefObject<DesignProposalV2 | null>;
  roomRef: React.MutableRefObject<PlanRoom | null>;
  onStatus?: (message: string) => void;
  /** Called right after a fresh layout is sent to Unity (regenerate). */
  onLayoutSent?: () => void;
}

interface UseLayoutCustomizationReturn {
  selectedPiece: PlacedFurniturePayload | null;
  selectedCatalogItem: FurnitureLibraryItem | undefined;
  colorOptions: FurnitureColorOption[];
  replacementOptions: FurnitureLibraryItem[];
  /** Why the selected piece's placement is unsafe, e.g. "Abu Dhabi Sofa is in the way". */
  selectedWarning: string | null;
  regenerating: boolean;
  handleLayout: (payload: LayoutPayload) => void;
  handleSelection: (payload: SelectionPayload) => void;
  handlePlacementSafety: (payload: PlacementSafetyPayload) => void;
  setColor: (hex: string) => void;
  replaceWith: (item: FurnitureLibraryItem) => void;
  /** Locks the selected piece in place, or unlocks it. */
  toggleLock: () => void;
  regenerate: () => Promise<void>;
  /** Writes the latest layout to local storage immediately (before leaving AR). */
  flushCustomizedSave: () => Promise<void>;
}

export function useLayoutCustomization({
  enabled,
  unityRef,
  catalogItems,
  generationRef,
  proposalRef,
  roomRef,
  onStatus,
  onLayoutSent,
}: UseLayoutCustomizationProps): UseLayoutCustomizationReturn {
  const [pieces, setPieces] = useState<PlacedFurniturePayload[]>([]);
  const piecesRef = useRef<PlacedFurniturePayload[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [safety, setSafety] = useState<PlacementSafetyPayload | null>(null);
  const safetyRef = useRef<PlacementSafetyPayload | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  /** Planner room the current Unity layout was mapped with (a regenerate may resize it). */
  const appliedRoomRef = useRef<PlanRoom | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const catalogById = useMemo(() => {
    const map = new Map<string, FurnitureLibraryItem>();
    catalogItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [catalogItems]);

  const buildCustomizedLayout = useCallback(
    (furniture: PlacedFurniturePayload[]): CustomizedDesignLayout | null => {
      const proposal = proposalRef.current;
      const room = appliedRoomRef.current ?? roomRef.current;
      if (!proposal || !room) return null;

      const items: CustomizedLayoutItem[] = furniture
        .filter((piece) => piece.hasSource && piece.sourcePosition)
        .map((piece) => {
          const catalog = catalogById.get(piece.modelId);
          const original = proposal.items.find(
            (item) =>
              item.furnitureId === piece.modelId
              || resolveCatalogForLayoutItem(item, catalogItems)?.id === piece.modelId,
          );
          const scale = piece.scale > 0 ? piece.scale : 1;
          // The size the layout was planned with (the 3D model's own size), not the store's listed
          // size: a set listed 1.07 × 0.66 m whose model is 2.41 × 1.64 m came back from AR small
          // and 0.7 m out of place (2026-11-12). A piece swapped in AR has no planned size, so it
          // takes the size AR measured. Unity's `dimensions` already include the scale.
          const planned = original && original.furnitureId === piece.modelId ? original : undefined;
          const measured = piece.dimensions && piece.dimensions.x > 0.01 && piece.dimensions.z > 0.01
            ? piece.dimensions
            : undefined;
          const width = planned ? planned.width * scale
            : measured ? measured.x : (catalog?.dimensions.width ?? 1) * scale;
          const height = planned ? planned.height * scale
            : measured ? measured.y : (catalog?.dimensions.height ?? 1) * scale;
          const depth = planned ? planned.depth * scale
            : measured ? measured.z : (catalog?.dimensions.length ?? 1) * scale;
          const rotationY = normalizeYaw(piece.sourceRotationY ?? piece.rotationY);
          const source = piece.sourcePosition!;
          const local = unityToRoomLocal(source, rotationY, { width, depth }, room);
          return {
            instanceId: piece.instanceId,
            furnitureId: piece.modelId,
            displayName: catalog?.name ?? original?.displayName ?? piece.modelId,
            glbUrl: typeof catalog?.model3D?.url === 'string' ? catalog.model3D.url : original?.glbUrl,
            category: catalog?.category ?? original?.category ?? 'other',
            width,
            height,
            depth,
            localPosition: { x: local.x, y: Math.max(0, source.y || 0), z: local.z },
            rotationY,
            color: original?.color,
            pricePhp: catalog?.pricePhp ?? original?.pricePhp ?? 0,
            role: original?.role,
            tintHex: piece.colorHex || undefined,
          };
        });

      // Rugs are never placed in AR, so carry them over from the proposal unchanged.
      proposal.items
        .filter((item) => item.role === 'rug')
        .forEach((item) => items.push({ ...item }));

      const generation = generationRef.current;
      return {
        proposalId: proposal.id,
        sessionId: generation?.sessionId,
        measurementId: generation?.measurementId,
        projectId: generation?.projectId,
        room,
        items,
        totalPhp: items.reduce((sum, item) => sum + (item.pricePhp || 0), 0),
        updatedAt: Date.now(),
      };
    },
    [catalogById, catalogItems, generationRef, proposalRef, roomRef]
  );

  const handleLayout = useCallback(
    (payload: LayoutPayload) => {
      if (!enabled) return;
      const furniture = payload.furniture ?? [];
      piecesRef.current = furniture;
      setPieces(furniture);
      const selected = furniture.find((piece) => piece.selected);
      setSelectedId(selected?.instanceId ?? null);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const layout = buildCustomizedLayout(furniture);
        if (!layout) return;
        saveCustomizedLayout(layout).catch((err) =>
          console.warn('[useLayoutCustomization] Failed to save customized layout:', err)
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [enabled, buildCustomizedLayout]
  );

  const handleSelection = useCallback(
    (payload: SelectionPayload) => {
      if (!enabled) return;
      if (!payload.selected || !payload.instanceId) {
        setSelectedId(null);
        return;
      }
      setSelectedId(payload.instanceId);
      if (!pieces.some((piece) => piece.instanceId === payload.instanceId)) {
        unityRef.current?.getCurrentLayout();
      }
    },
    [enabled, pieces, unityRef]
  );

  const handlePlacementSafety = useCallback(
    (payload: PlacementSafetyPayload) => {
      if (!enabled) return;
      const prev = safetyRef.current;
      const wasSafe = !prev || prev.isSafe || prev.instanceId !== payload.instanceId;
      // Buzz once when a piece first runs into trouble, not on every update.
      if (wasSafe && !payload.isSafe) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
      safetyRef.current = payload;
      setSafety(payload);
    },
    [enabled]
  );

  const selectedPiece = useMemo(
    () => pieces.find((piece) => piece.instanceId === selectedId) ?? null,
    [pieces, selectedId]
  );

  const selectedWarning = useMemo(() => {
    if (!selectedPiece || !safety || safety.instanceId !== selectedPiece.instanceId) return null;
    return describePlacementIssue(safety, (modelId) => catalogById.get(modelId)?.name);
  }, [catalogById, safety, selectedPiece]);

  const selectedCatalogItem = selectedPiece ? catalogById.get(selectedPiece.modelId) : undefined;

  const colorOptions = useMemo<FurnitureColorOption[]>(() => {
    const seen = new Set<string>();
    const options: FurnitureColorOption[] = [];
    (selectedCatalogItem?.availableColors ?? []).forEach((raw) => {
      const hex = resolveAvailableColorHex(raw, '').toUpperCase();
      if (!hex || seen.has(hex)) return;
      seen.add(hex);
      options.push({ label: raw, hex });
    });
    return options;
  }, [selectedCatalogItem]);

  const replacementOptions = useMemo(() => {
    if (!selectedPiece) return [];
    const category = selectedCatalogItem?.category;
    if (!category) return [];
    return catalogItems
      .filter((item) => item.category === category && item.id !== selectedPiece.modelId)
      .filter((item) =>
        canPlaceMore(item.quantity, pieces.filter((piece) => piece.modelId === item.id).length)
      )
      .slice(0, MAX_REPLACEMENTS);
  }, [catalogItems, pieces, selectedCatalogItem, selectedPiece]);

  const setColor = useCallback(
    (hex: string) => {
      if (!selectedPiece) return;
      unityRef.current?.setFurnitureColor({ instanceId: selectedPiece.instanceId, colorHex: hex });
      unityRef.current?.wakeUnityPlayer?.();
      Haptics.selectionAsync().catch(() => {});
    },
    [selectedPiece, unityRef]
  );

  const replaceWith = useCallback(
    (item: FurnitureLibraryItem) => {
      if (!selectedPiece) return;
      unityRef.current?.replaceSelectedFurniture({
        modelId: item.id,
        catalogId: mapFurnitureIdToUnity(item.id),
        glbUrl: typeof item.model3D?.url === 'string' ? item.model3D.url : undefined,
        width: item.dimensions.width,
        height: item.dimensions.height,
        depth: item.dimensions.length,
        colorHex: selectedPiece.colorHex || undefined,
      });
      unityRef.current?.wakeUnityPlayer?.();
      onStatus?.(`Swapping in ${item.name}…`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [selectedPiece, unityRef, onStatus]
  );

  const toggleLock = useCallback(() => {
    if (!selectedPiece) return;
    const locked = !selectedPiece.locked;
    const { instanceId } = selectedPiece;
    unityRef.current?.setFurnitureLocked({ instanceId, locked });
    unityRef.current?.wakeUnityPlayer?.();
    // Show the new state right away; Unity confirms with its next layoutChanged.
    const next = piecesRef.current.map((piece) =>
      piece.instanceId === instanceId ? { ...piece, locked } : piece
    );
    piecesRef.current = next;
    setPieces(next);
    onStatus?.(locked ? 'Locked in place. Unlock it to move it again.' : 'Unlocked. Drag or twist to adjust.');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [selectedPiece, unityRef, onStatus]);

  const regenerate = useCallback(async () => {
    const generation = generationRef.current;
    if (!generation || regenerating) return;

    setRegenerating(true);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    onStatus?.('Generating a new layout…');
    try {
      const result = await DesignFlowService.generateLayouts(generation.preferences, generation.room, {
        measurementId: generation.measurementId,
        projectId: generation.projectId,
      });
      const currentId = proposalRef.current?.id;
      const next =
        result.proposals.find((proposal) => proposal.items.length > 0 && proposal.id !== currentId)
        ?? result.proposals[0];
      if (!next) throw new Error('No layout returned');

      const merged: DesignFlowGenerationResult = {
        ...result,
        sessionId: result.sessionId ?? generation.sessionId,
      };
      generationRef.current = merged;
      proposalRef.current = next;
      appliedRoomRef.current = result.room;
      await saveDesignGeneration(merged);

      unityRef.current?.applyLayout(buildApplyLayoutRequest(next, result.room, catalogItems));
      unityRef.current?.wakeUnityPlayer?.();
      onLayoutSent?.();
      onStatus?.(`New layout: ${next.title}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      console.warn('[useLayoutCustomization] Regenerate failed:', err);
      onStatus?.('Could not generate a new layout. Check your connection and try again.');
    } finally {
      setRegenerating(false);
    }
  }, [catalogItems, generationRef, onLayoutSent, onStatus, proposalRef, regenerating, unityRef]);

  const flushCustomizedSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const layout = buildCustomizedLayout(piecesRef.current);
    if (layout) {
      await saveCustomizedLayout(layout);
    }
  }, [buildCustomizedLayout]);

  return {
    selectedPiece,
    selectedCatalogItem,
    colorOptions,
    replacementOptions,
    selectedWarning,
    regenerating,
    handleLayout,
    handleSelection,
    handlePlacementSafety,
    setColor,
    replaceWith,
    toggleLock,
    regenerate,
    flushCustomizedSave,
  };
}
