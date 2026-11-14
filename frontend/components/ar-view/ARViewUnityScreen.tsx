/**
 * AR View — the "Design a room" AR steps on Unity's ARRoomMeasurement scene:
 * scan the room (then on to preferences), and later place the chosen AI layout
 * in the real room (align → place → customize → finish).
 * Native Android/iOS only. Uses @azesmway/react-native-unity.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  AppState,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { UnityARViewer, type UnityARViewerHandle } from '@/components/UnityARViewer';
import {
  ARPlannerOverlay,
  type PlannerTool,
} from '@/components/ar-view/ARPlannerOverlay';
import { RoomMeasurementSaveModal } from '@/components/ar-view/RoomMeasurementSaveModal';
import { ARToastNotice } from '@/components/ar-view/ARToastNotice';
import { LayoutAlignmentPanel } from '@/components/ar-view/LayoutAlignmentPanel';
import { LayoutViewControls } from '@/components/ar-view/LayoutViewControls';
import { VIEW_AR_GUIDE_SEEN_KEY, VIEW_ONLY_GUIDE_SEEN_KEY, ViewArGuide } from '@/components/ar-view/ViewArGuide';
import { ViewOnlyControls } from '@/components/ar-view/ViewOnlyControls';
import { FurnitureCustomizePanel } from '@/components/ar-view/FurnitureCustomizePanel';
import { useLayoutCustomization } from '@/hooks/useLayoutCustomization';
import { AppDialog } from '@/components/ui/AppDialog';
import { mapFurnitureIdToUnity } from '@/config/unity-furniture-map';
import { useFurnitureCatalog } from '@/hooks/useFurnitureCatalog';
import { useLayoutAlignment } from '@/hooks/useLayoutAlignment';
import type { FurnitureCategory, FurnitureLibraryItem } from '@/types/ar-view';
import type {
  HistoryStatePayload,
  LayoutPayload,
  RoomConfirmedPayload,
  ScanStatusPayload,
  ARPhotoCapturedPayload,
  SelectionPayload,
  PlacementSafetyPayload,
  PlacementCheckPayload,
  PlacementIssue,
  ExportResultPayload,
  LayoutAlignmentPayload,
  UnityOutboundMessage,
} from '@/types/unity-bridge';
import { RoomMeasurementService } from '@/services/RoomMeasurementService';
import { projectService } from '@/services/ProjectService';
import { buildApplyLayoutRequest } from '@/services/DesignFlowService';
import { loadDesignGeneration } from '@/utils/designFlowStorage';
import { getJson, setJson } from '@/utils/storage';
import type { DesignFlowGenerationResult, DesignProposalV2 } from '@/types/design-flow';
import { colors, spacing } from '@/components/ui/theme';
import { isUnityViewAvailable } from '@/utils/unityAvailability';
import { buildModelPreviewExportHref } from '@/utils/modelPreviewExport';
import { persistRoomExportGlb } from '@/utils/roomExportStorage';
import { canPlaceMore, getRemainingPlacements } from '@/utils/furnitureCatalogHelpers';
import { describePlacementIssue } from '@/utils/placementWarning';
import { isUnityPlayerWarm, markUnityPlayerWarm } from '@/utils/unitySession';

const UNITY_READY_TIMEOUT_MS = 15000;
/** First cold start waits for Unity/ARCore; warm remounts should be instant. */
const UNITY_MOUNT_DELAY_MS = 1200;
/** Unity's old AR Furniture scene — never opened now, but a warm player can still be on it. */
const FURNITURE_UNITY_SCENE = 'ARDesignScene';
const MEASUREMENT_UNITY_SCENE = 'ARRoomMeasurement';
/** Longest wait, when leaving, for Unity to report the measurement closed (see pauseUnityThen). */
const UNITY_CLOSE_WAIT_MS = 800;
/** After a message to Unity, time for it to run before Unity is paused. */
const UNITY_MESSAGE_GRACE_MS = 250;
/** After Unity's "closed" message, time to end that frame. */
const UNITY_FRAME_GRACE_MS = 100;
/** After pausing Unity, before the screen (and Unity's view) goes. */
const UNITY_PAUSE_SETTLE_MS = 150;

function normalizeUnitySceneName(sceneName?: string | null): string | null {
  if (sceneName === FURNITURE_UNITY_SCENE || sceneName === MEASUREMENT_UNITY_SCENE) {
    return sceneName;
  }
  return null;
}

function isSyntheticFurnitureOnlyRoom(payload: RoomConfirmedPayload): boolean {
  if (payload.furniturePlacementOnly) return true;
  // BeginFurniturePlacementOnly uses a 24×24 m floor at 2.5 m height (576 m²).
  return (
    Math.abs(payload.width - 24) < 0.05 &&
    Math.abs(payload.depth - 24) < 0.05 &&
    Math.abs(payload.height - 2.5) < 0.05
  );
}

function scanHintMessage(status: ScanStatusPayload | null): string {
  if (!status) return 'Walk around the room slowly — scanning runs in the background';
  switch (status.hint) {
    case 'tapFloorHeight':
      return 'Tap the floor to start measuring height';
    case 'extrudeHeight':
      return 'Move aim up to extrude height, then tap Finish';
    case 'tapFirstCorner':
      return 'Height locked — tap the first floor corner';
    case 'tapNextCorner':
      return 'Tap the next floor corner';
    case 'tapThirdCorner':
      return 'Tap a third corner to outline the room';
    case 'tapMoreCorners':
      return 'Keep tapping corners to outline the room';
    case 'closeOutline':
      return 'All corners marked? Tap Close room to finish the outline';
    case 'outlineCrosses':
      return 'Walls cross each other — undo the last corner';
    case 'findFloor':
      return 'Keep walking and looking around the room';
    case 'moveAround':
      return 'Turn slowly to cover more of the space';
    case 'scanWalls':
      return 'Look toward the walls to improve the room shell';
    case 'readyToConfirm':
      return 'Ready — tap Confirm room to lock the layout';
    case 'confirmed':
      return 'Select your desired furniture';
    case 'keepScanning':
      return 'Keep scanning, or confirm when you are ready';
    default:
      return `Scanning… ${Math.round((status.progress || 0) * 100)}%`;
  }
}

export function ARViewUnityScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    projectId?: string | string[];
    flow?: string | string[];
    applyLayout?: string | string[];
    viewOnly?: string | string[];
    proposalId?: string | string[];
    measurementId?: string | string[];
  }>();
  /** Named project from the Start new project tab — exports attach to it. */
  const activeProjectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const flowParam = Array.isArray(params.flow) ? params.flow[0] : params.flow;
  const applyLayoutParam = Array.isArray(params.applyLayout) ? params.applyLayout[0] : params.applyLayout;
  const proposalIdParam = Array.isArray(params.proposalId) ? params.proposalId[0] : params.proposalId;
  const measurementIdParam = Array.isArray(params.measurementId) ? params.measurementId[0] : params.measurementId;
  const isDesignFlow = flowParam === 'design';
  const isApplyLayoutFlow = isDesignFlow && applyLayoutParam === '1';
  const viewOnlyParam = Array.isArray(params.viewOnly) ? params.viewOnly[0] : params.viewOnly;
  /** Looking at a saved design: no editing controls, every piece locked, nothing saved. */
  const [viewOnly] = useState(isApplyLayoutFlow && viewOnlyParam === '1');
  const viewOnlyRef = useRef(viewOnly);
  viewOnlyRef.current = viewOnly;
  const placedFurnitureRef = useRef<NonNullable<LayoutPayload['furniture']>>([]);
  /** New project — force Unity scene sync (player stays warm across visits). */
  const arSessionKey = activeProjectId ?? '';
  const unityRef = useRef<UnityARViewerHandle>(null);
  const pendingSpawnRef = useRef<string | null>(null);
  const placementUnlockedRef = useRef(false);
  const measurementFlowCompleteRef = useRef(false);
  /** Layout step: Unity has the layout's room shell up and is placing furniture on it. */
  const measuredFurnitureActiveRef = useRef(false);
  /** Prevents requestClose ↔ handleBack feedback loops that crash UaaL on reopen. */
  const closingRef = useRef(false);
  /** Leaving is under way (Unity is being paused first): a second tap does nothing. */
  const exitingRef = useRef(false);
  /** Called when Unity reports the measurement closed, while leaving waits for it. */
  const planClosedWaiterRef = useRef<(() => void) | null>(null);

  /**
   * Pauses Unity, then runs `navigate` (which closes this screen). Closing the screen at once took
   * Unity's drawing surface mid-frame; the view library's pause then timed out after 2 s and the app
   * crashed with signal 11 a few seconds later, every time a scan was left (phone logs, 2026-10-30).
   * With `waitForPlanClosed`, it first waits for Unity to report the measurement closed (normally a
   * few ms; at most UNITY_CLOSE_WAIT_MS), so Unity has finished that frame before it is paused.
   */
  const pauseUnityThen = useCallback((navigate: () => void, waitForPlanClosed: boolean) => {
    const pauseAndGo = () => {
      planClosedWaiterRef.current = null;
      try {
        unityRef.current?.pauseUnityPlayer?.();
      } catch {
        /* the native view is already gone */
      }
      setTimeout(navigate, UNITY_PAUSE_SETTLE_MS);
    };
    if (!waitForPlanClosed) {
      setTimeout(pauseAndGo, UNITY_MESSAGE_GRACE_MS);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      // Let Unity end the frame that closed the measurement.
      setTimeout(pauseAndGo, UNITY_FRAME_GRACE_MS);
    };
    const fallback = setTimeout(finish, UNITY_CLOSE_WAIT_MS);
    planClosedWaiterRef.current = finish;
  }, []);
  /** One soft-reload per screen mount when already on ARRoomMeasurement. */
  const measureNeedsReloadRef = useRef(true);
  /** Ensures open/reload runs once per AR screen mount (ping must not re-boot). */
  const modeBootedRef = useRef(false);
  /** Unity answered this session's open (unityReady or reloadComplete): stop the boot retries. */
  const sessionBootAckRef = useRef(false);
  /** User closed the catalog sheet — ignore duplicate Unity unlock events that re-open it. */
  const libraryUserDismissedRef = useRef(false);
  const applyLayoutActiveRef = useRef(isApplyLayoutFlow);
  const applyLayoutSentRef = useRef(false);
  const applyHandoffOpenedRef = useRef(false);
  const applyTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const applyProposalRef = useRef<DesignProposalV2 | null>(null);
  const applyRoomRef = useRef<{ width: number; length: number; height: number } | null>(null);
  /** Pieces that overlap another piece or run through a wall (Unity's latest placementCheck). */
  const [placementIssues, setPlacementIssues] = useState<PlacementIssue[]>([]);
  /** Resolves the Finish tap's own check with the next placementCheck from Unity. */
  const placementCheckWaiterRef = useRef<((payload: PlacementCheckPayload | null) => void) | null>(null);
  const applyGenerationRef = useRef<DesignFlowGenerationResult | null>(null);
  /** Set when a layout is sent to Unity; the next non-empty layoutChanged reports it placed. */
  const applyAwaitingPlacementRef = useRef(false);
  const applyHandoffRef = useRef<Parameters<UnityARViewerHandle['openDesignLayoutInAr']>[0]>(undefined);

  const unityAvailable = isUnityViewAvailable();
  const { items: catalogItems, loading: catalogLoading, error: catalogError } = useFurnitureCatalog();
  const [applyPayloadReady, setApplyPayloadReady] = useState(!isApplyLayoutFlow);

  useEffect(() => {
    applyLayoutActiveRef.current = isApplyLayoutFlow;
    if (!isApplyLayoutFlow) {
      setApplyPayloadReady(true);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const stored = await loadDesignGeneration();
        const proposal = stored?.proposals.find((entry) => entry.id === proposalIdParam)
          || stored?.proposals[0]
          || null;
        if (cancelled) return;
        applyProposalRef.current = proposal;
        applyRoomRef.current = stored?.room || null;
        applyGenerationRef.current = stored;
        const room = stored?.room;
        const outline = stored?.scannedRoom?.outline;
        const frame = stored?.scannedRoom?.frame;
        applyHandoffRef.current = room
          ? {
              roomName: 'Design layout',
              width: room.width,
              depth: room.length,
              height: room.height,
              wallHeight: room.height,
              // The real room shape, centred the same way roomLocalToUnity centres the furniture,
              // so walls in AR are where the planner kept the furniture clear of them.
              ...(outline && outline.length >= 3
                ? {
                    floorPolygon: outline.map((p) => ({
                      x: p.x - room.width / 2,
                      y: 0,
                      z: p.z - room.length / 2,
                    })),
                  }
                : {}),
              ...(frame
                ? { hasScanFrame: true, frameAngle: frame.angle, frameMinX: frame.minX, frameMinZ: frame.minZ }
                : {}),
            }
          : undefined;
        setApplyPayloadReady(Boolean(proposal && room));
        if (!proposal || !room) {
          setStatusMessage('Could not load the layout to place. Go back and generate again.');
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[ARViewUnity] Failed to load design layout for AR:', err);
          setApplyPayloadReady(false);
          setStatusMessage('Could not load the layout to place.');
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isApplyLayoutFlow, proposalIdParam]);

  const [selectedCategory, setSelectedCategory] = useState<FurnitureCategory | 'all'>('all');
  const [selectedLibraryItem, setSelectedLibraryItem] = useState<string | null>(null);
  const [unityReady, setUnityReady] = useState(false);
  const [unityTimedOut, setUnityTimedOut] = useState(!unityAvailable);
  const [activeUnityScene, setActiveUnityScene] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    unityAvailable
      ? isApplyLayoutFlow
        ? 'Loading your layout in AR…'
        : 'Loading room scan…'
      : 'Unity AR is not available in this build'
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [furnitureLoading, setFurnitureLoading] = useState(false);
  const [mountUnity, setMountUnity] = useState(false);
  const [roomConfirmed, setRoomConfirmed] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanReady, setScanReady] = useState(false);
  const [placedModelIds, setPlacedModelIds] = useState<string[]>([]);
  const [selectedPlacedModelId, setSelectedPlacedModelId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [activeTool, setActiveTool] = useState<PlannerTool>('place');
  const [measurementModalVisible, setMeasurementModalVisible] = useState(false);
  const [confirmedPayload, setConfirmedPayload] = useState<RoomConfirmedPayload | null>(null);
  const [savingMeasurement, setSavingMeasurement] = useState(false);
  const [measurementSaved, setMeasurementSaved] = useState(false);
  const [measurementError, setMeasurementError] = useState<string | null>(null);
  const [measureRoomName, setMeasureRoomName] = useState('');
  const [measurePlanReady, setMeasurePlanReady] = useState(false);
  /** True after room name save — Unity measured-furniture handoff is in progress / active. */
  const [measuredFurnitureActive, setMeasuredFurnitureActive] = useState(false);
  const [exportingMeasure, setExportingMeasure] = useState(false);
  const measureExportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureExportKickoffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureExportStartedRef = useRef(false);
  const furnitureLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Mongo id of this design's room scan: saved here in the scan step, or passed in from the
   * layouts screen for the AR layout step. Export 3D links to it instead of saving a new scan.
   */
  const savedMeasurementIdRef = useRef<string | null>(measurementIdParam || null);
  const [placementUnlocked, setPlacementUnlocked] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const photoCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exportResultDialog, setExportResultDialog] = useState<
    | {
        kind: 'success';
        roomName: string;
        fileName: string;
        sizeKb: number;
        previewUri: string;
        projectId?: string;
        furnitureCount?: number;
        linkedToMeasurement: boolean;
        savedToProjects: boolean;
      }
    | { kind: 'error'; message: string }
    | null
  >(null);
  /** Short top notice (e.g. "Room measurement saved") — auto-hides. */
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Save the scanned room automatically under the project name (no name modal). */
  const autoSaveMeasurePendingRef = useRef(false);
  /** Name typed on the Start new project tab — used as the room measurement name. */
  const projectNameRef = useRef<string | null>(null);
  /** Project that AR photos are attached to (created on first capture if absent). */
  const photoProjectIdRef = useRef<string | undefined>(activeProjectId);
  /** Confirm before leaving AR so we can reset the scene. */
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  /** How View in AR works: by itself the first time, then from the help buttons. */
  const [guideVisible, setGuideVisible] = useState(false);

  useEffect(() => {
    if (!isApplyLayoutFlow) return undefined;
    let cancelled = false;
    getJson<boolean>(viewOnly ? VIEW_ONLY_GUIDE_SEEN_KEY : VIEW_AR_GUIDE_SEEN_KEY, false)
      .then((seen) => {
        if (!seen && !cancelled) setGuideVisible(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isApplyLayoutFlow, viewOnly]);

  const closeGuide = useCallback(() => {
    setGuideVisible(false);
    setJson(viewOnly ? VIEW_ONLY_GUIDE_SEEN_KEY : VIEW_AR_GUIDE_SEEN_KEY, true).catch(() => {});
  }, [viewOnly]);

  useEffect(() => {
    placementUnlockedRef.current = placementUnlocked;
  }, [placementUnlocked]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !mountUnity) return;
      unityRef.current?.resumeUnityPlayer?.();
      if (measuredFurnitureActiveRef.current && placementUnlockedRef.current) {
        unityRef.current?.wakeUnityPlayer?.();
      }
    });
    return () => sub.remove();
  }, [mountUnity]);

  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    projectService
      .getProjectById(activeProjectId)
      .then((project) => {
        if (!cancelled) projectNameRef.current = project?.name ?? null;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  const showToast = useCallback((message: string, durationMs = 2500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    if (!unityAvailable) return;
    if (isUnityPlayerWarm()) {
      setMountUnity(true);
      return;
    }
    const timer = setTimeout(() => setMountUnity(true), UNITY_MOUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unityAvailable]);

  useEffect(() => {
    if (!unityAvailable) return;

    const timer = setTimeout(() => {
      if (!unityReady) {
        // Stop the loading spinner only — do not block the Unity view.
        setUnityTimedOut(true);
      }
    }, UNITY_READY_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [unityAvailable, unityReady]);

  const countPlaced = useCallback(
    (itemId: string) => placedModelIds.filter((id) => id === itemId).length,
    [placedModelIds]
  );

  const spawnCatalogItem = useCallback(
    (itemId: string, items: FurnitureLibraryItem[]) => {
      const item = items.find((entry) => entry.id === itemId);
      if (!item) {
        pendingSpawnRef.current = itemId;
        setFurnitureLoading(false);
        setStatusMessage(`Furniture "${itemId}" is not in the catalog yet`);
        return;
      }

      // Wait until Unity armed placement on the room shell.
      if (!placementUnlockedRef.current) {
        pendingSpawnRef.current = itemId;
        setFurnitureLoading(false);
        setStatusMessage('Opening your room — try again in a moment');
        return;
      }

      const placedCount = placedModelIds.filter((id) => id === itemId).length;
      if (!canPlaceMore(item.quantity, placedCount)) {
        const remaining = getRemainingPlacements(item.quantity, placedCount);
        setFurnitureLoading(false);
        setStatusMessage(
          remaining === 0 && (item.quantity ?? 0) > 0
            ? `${item.name} — all ${item.quantity} available placed`
            : `${item.name} is out of stock`
        );
        return;
      }

      const glbUrl = typeof item.model3D?.url === 'string' ? item.model3D.url : undefined;
      setFurnitureLoading(true);
      setStatusMessage(`Loading ${item.name}…`);
      if (furnitureLoadTimeoutRef.current) clearTimeout(furnitureLoadTimeoutRef.current);
      furnitureLoadTimeoutRef.current = setTimeout(() => {
        setFurnitureLoading((prev) => {
          if (!prev) return prev;
          setStatusMessage(`Still loading ${item.name} — check Wi‑Fi, or try again`);
          return false;
        });
      }, 45000);

      unityRef.current?.spawnFurniture({
        modelId: itemId,
        catalogId: mapFurnitureIdToUnity(itemId),
        glbUrl,
        width: item.dimensions.width,
        height: item.dimensions.height,
        depth: item.dimensions.length,
      });
    },
    [placedModelIds]
  );

  useEffect(() => {
    if (!placementUnlocked || catalogLoading || catalogItems.length === 0) return;
    const pendingId = pendingSpawnRef.current;
    if (!pendingId) return;

    pendingSpawnRef.current = null;
    spawnCatalogItem(pendingId, catalogItems);
  }, [placementUnlocked, catalogLoading, catalogItems, spawnCatalogItem]);

  const handleSelectItem = useCallback(
    (itemId: string) => {
      if (furnitureLoading) return;

      const item = catalogItems.find((entry) => entry.id === itemId);
      const placedCount = countPlaced(itemId);
      if (item && !canPlaceMore(item.quantity, placedCount)) {
        const remaining = getRemainingPlacements(item.quantity, placedCount);
        setStatusMessage(
          remaining === 0 && (item.quantity ?? 0) > 0
            ? `${item.name} — all ${item.quantity} available placed`
            : `${item.name} is out of stock`
        );
        return;
      }
      setSelectedLibraryItem(itemId);
      setActiveTool('place');
      spawnCatalogItem(itemId, catalogItems);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [catalogItems, spawnCatalogItem, countPlaced, furnitureLoading]
  );

  useEffect(() => {
    if (!mountUnity || !unityAvailable) return;
    // Re-ping in case Unity stayed warm without re-firing Start/unityReady.
    const timer = setTimeout(() => {
      unityRef.current?.sendToUnity('ping', '');
    }, 600);
    return () => clearTimeout(timer);
  }, [mountUnity, unityAvailable]);

  const handleUnityReady = useCallback((sceneName?: string) => {
    if (closingRef.current) return;

    const scene = normalizeUnitySceneName(sceneName) ?? MEASUREMENT_UNITY_SCENE;
    setActiveUnityScene(scene);

    const synced = scene === MEASUREMENT_UNITY_SCENE;
    if (synced) {
      sessionBootAckRef.current = true;
      markUnityPlayerWarm();
      setUnityReady(true);
      setUnityTimedOut(false);
    } else {
      unityRef.current?.resumeUnityPlayer?.();
    }

    if (applyLayoutActiveRef.current) {
      setLibraryOpen(false);
      setMeasurementModalVisible(false);
      setStatusMessage('Opening your layout in AR…');
      modeBootedRef.current = true;
      measureNeedsReloadRef.current = false;
      // Unity is listening on either scene: openDesignLayoutInAr from ARDesignScene loads the
      // measurement scene itself. Waiting for ARRoomMeasurement here never ended, because nothing
      // else opens it in this flow, so the layout was never sent.
      sessionBootAckRef.current = true;
      markUnityPlayerWarm();
      setUnityReady(true);
      setUnityTimedOut(false);
      if (!synced) unityRef.current?.resumeUnityPlayer?.();
      return;
    }

    // Do not unlock furniture from unityReady/ping — wait for reloadComplete after
    // openMeasuredFurnitureDesign arms placement on this scene.
    if (!measuredFurnitureActiveRef.current || !placementUnlockedRef.current) {
      setLibraryOpen(false);
    }
    setMeasurementModalVisible(false);
    if (!measuredFurnitureActiveRef.current) {
      setMeasurePlanReady(false);
    }
    setExportResultDialog(null);
    setExportingMeasure(false);
    if (!measuredFurnitureActiveRef.current) {
      measurementFlowCompleteRef.current = false;
      setStatusMessage('Point the camera around the room to measure');
    }

    // Ping / late unityReady must not open/reload again after the first boot.
    if (
      modeBootedRef.current &&
      scene === MEASUREMENT_UNITY_SCENE &&
      !measureNeedsReloadRef.current
    ) {
      return;
    }

    if (scene !== MEASUREMENT_UNITY_SCENE) {
      modeBootedRef.current = true;
      measureNeedsReloadRef.current = false;
      unityRef.current?.resumeUnityPlayer?.();
      unityRef.current?.openRoomMeasurement();
    } else if (measureNeedsReloadRef.current) {
      modeBootedRef.current = true;
      measureNeedsReloadRef.current = false;
      unityRef.current?.reloadMeasurement();
    } else {
      // Fresh LoadScene already auto-starts the scan.
      modeBootedRef.current = true;
    }
  }, []);

  const openLibrarySheet = useCallback(() => {
    if (libraryUserDismissedRef.current) return;
    setLibraryOpen(true);
  }, []);

  const unlockMeasuredFurnitureUi = useCallback((options?: { openLibrary?: boolean }) => {
    if (placementUnlockedRef.current) return;

    placementUnlockedRef.current = true;
    if (options?.openLibrary !== false && !applyLayoutActiveRef.current) {
      openLibrarySheet();
    }
    setMeasurementModalVisible(false);
    setMeasurePlanReady(true);
    setMeasuredFurnitureActive(true);
    measuredFurnitureActiveRef.current = true;
    setPlacementUnlocked(true);
    setRoomConfirmed(true);
    setScanProgress(1);
    setScanReady(true);
    setStatusMessage('Tap to place · 1 finger move · 2 on piece rotate · 2 on room orbit');
  }, [openLibrarySheet]);

  const handleReloadComplete = useCallback(
    (sceneName?: string) => {
      if (closingRef.current) return;

      sessionBootAckRef.current = true;
      markUnityPlayerWarm();
      setUnityReady(true);
      setUnityTimedOut(false);
      modeBootedRef.current = true;
      measureNeedsReloadRef.current = false;

      setActiveUnityScene(normalizeUnitySceneName(sceneName) ?? MEASUREMENT_UNITY_SCENE);

      if (applyLayoutActiveRef.current) {
        setLibraryOpen(false);
        setStatusMessage('Opening the measured room…');
        return;
      }

      // Measured furniture unlocks on ARRoomMeasurement (no scene switch).
      if (measuredFurnitureActiveRef.current) {
        unlockMeasuredFurnitureUi();
        return;
      }

      setLibraryOpen(false);
      setMeasurementModalVisible(false);
      setMeasurePlanReady(false);
      setStatusMessage('Point the camera around the room to measure');
    },
    [unlockMeasuredFurnitureUi]
  );

  /** Dedicated unlock from Unity after openMeasuredFurnitureDesign (reloadComplete can drop on UaaL). */
  const handleMeasuredFurnitureReady = useCallback(
    (sceneName?: string) => {
      if (closingRef.current) return;

      markUnityPlayerWarm();
      setUnityReady(true);
      setUnityTimedOut(false);
      modeBootedRef.current = true;
      if (sceneName === 'ARRoomMeasurement' || sceneName === 'ARDesignScene') {
        setActiveUnityScene(sceneName);
      } else {
        setActiveUnityScene('ARRoomMeasurement');
      }
      measuredFurnitureActiveRef.current = true;
      setMeasuredFurnitureActive(true);
      const wasLocked = !placementUnlockedRef.current;
      unlockMeasuredFurnitureUi({ openLibrary: !applyLayoutActiveRef.current });
      if (wasLocked && __DEV__) {
        console.log('[ARViewUnity] measuredFurnitureReady from Unity');
      }
    },
    [unlockMeasuredFurnitureUi]
  );

  useEffect(() => {
    if (!isApplyLayoutFlow || !applyPayloadReady || !unityReady) return;
    if (applyHandoffOpenedRef.current) return;
    if (!applyHandoffRef.current) return;

    applyHandoffOpenedRef.current = true;
    measuredFurnitureActiveRef.current = true;
    setMeasuredFurnitureActive(true);
    setLibraryOpen(false);
    setStatusMessage('Opening your layout in AR…');
    unityRef.current?.resumeUnityPlayer?.();
    unityRef.current?.openDesignLayoutInAr(applyHandoffRef.current);

    // Unity answers from a coroutine; a paused UaaL player or a dropped event
    // would otherwise leave the handoff chip spinning forever.
    const wakeUnity = () => unityRef.current?.wakeUnityPlayer?.();
    applyTimersRef.current.push(
      setTimeout(wakeUnity, 50),
      setTimeout(wakeUnity, 400),
      setTimeout(() => {
        if (!placementUnlockedRef.current && measuredFurnitureActiveRef.current) {
          console.warn('[ARViewUnity] Unlocking AR layout placement (measuredFurnitureReady timeout)');
          unlockMeasuredFurnitureUi({ openLibrary: false });
        }
      }, 2500)
    );
  }, [isApplyLayoutFlow, applyPayloadReady, unityReady, unlockMeasuredFurnitureUi]);

  useEffect(() => {
    const timers = applyTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const handleLayoutAligned = useCallback(
    (payload: LayoutAlignmentPayload) => {
      if (payload.autoPlaced) {
        showToast('Placed where you scanned the room', 3000);
        return;
      }
      const gap = Math.abs(payload.measuredM - payload.planM);
      const lengths = `Wall ${payload.measuredM.toFixed(2)} m · plan ${payload.planM.toFixed(2)} m`;
      if (gap > 0.3) {
        showToast(`${lengths}. Lengths differ. If it looks off, go back and mark the corners again.`, 5000);
      } else {
        showToast(`Lined up with your room. ${lengths}`, 3000);
      }
    },
    [showToast]
  );

  const {
    alignment,
    isAligning: layoutAligning,
    hasAligned: layoutAligned,
    handleLayoutAlignment,
    markCorner: markAlignmentCorner,
    undoCorner: undoAlignmentCorner,
  } = useLayoutAlignment({
    enabled: isApplyLayoutFlow,
    ready: isApplyLayoutFlow && applyPayloadReady && placementUnlocked,
    unityRef,
    onAligned: handleLayoutAligned,
  });

  useEffect(() => {
    if (!isApplyLayoutFlow || !applyPayloadReady || !placementUnlocked) return;
    if (!layoutAligned) return;
    if (applyLayoutSentRef.current) return;
    if (catalogLoading) return;
    const proposal = applyProposalRef.current;
    const room = applyRoomRef.current;
    if (!proposal || !room) return;

    applyLayoutSentRef.current = true;
    applyAwaitingPlacementRef.current = true;
    setFurnitureLoading(true);
    setStatusMessage('Placing your layout…');
    unityRef.current?.applyLayout(buildApplyLayoutRequest(proposal, room, catalogItems));
    const wakeUnity = () => unityRef.current?.wakeUnityPlayer?.();
    applyTimersRef.current.push(setTimeout(wakeUnity, 50), setTimeout(wakeUnity, 400));
    if (furnitureLoadTimeoutRef.current) clearTimeout(furnitureLoadTimeoutRef.current);
    furnitureLoadTimeoutRef.current = setTimeout(() => {
      setFurnitureLoading(false);
      setStatusMessage('Layout placed — walk around to see it. Some models may still be loading.');
    }, 45000);
  }, [
    isApplyLayoutFlow,
    applyPayloadReady,
    placementUnlocked,
    layoutAligned,
    catalogLoading,
    catalogItems,
  ]);

  const handleCustomizeLayoutSent = useCallback(() => {
    applyAwaitingPlacementRef.current = true;
    setFurnitureLoading(true);
  }, []);

  const customization = useLayoutCustomization({
    enabled: isApplyLayoutFlow && !viewOnly,
    unityRef,
    catalogItems,
    generationRef: applyGenerationRef,
    proposalRef: applyProposalRef,
    roomRef: applyRoomRef,
    onStatus: setStatusMessage,
    onLayoutSent: handleCustomizeLayoutSent,
  });
  const {
    handleLayout: handleCustomizeLayout,
    handleSelection: handleCustomizeSelection,
    handlePlacementSafety: handleCustomizeSafety,
  } = customization;

  /** "Sofa overlaps Coffee table · Chair goes through a wall" — each pair once. */
  const describePlacementIssues = useCallback((issues: PlacementIssue[]) => {
    const nameOf = (modelId: string) => catalogItems.find((item) => item.id === modelId)?.name || 'A piece';
    const seen = new Set<string>();
    const lines: string[] = [];
    issues.forEach((issue) => {
      const key = issue.hitsWall
        ? `wall|${issue.instanceId}`
        : `pair|${[issue.modelId, issue.otherModelId].sort().join('|')}`;
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(issue.hitsWall
        ? `${nameOf(issue.modelId)} goes through a wall`
        : `${nameOf(issue.modelId)} overlaps ${issue.otherModelId ? nameOf(issue.otherModelId) : 'another piece'}`);
    });
    return lines.slice(0, 3).join(' · ') + (lines.length > 3 ? ` (+${lines.length - 3} more)` : '');
  }, [catalogItems]);

  const showPlacementIssues = useCallback((issues: PlacementIssue[]) => {
    showToast(`Fix first: ${describePlacementIssues(issues)}. Move or remove the piece, then tap Finish.`, 5000);
  }, [describePlacementIssues, showToast]);

  const handlePlacementCheck = useCallback((payload: PlacementCheckPayload) => {
    setPlacementIssues(payload.issues);
    const waiter = placementCheckWaiterRef.current;
    placementCheckWaiterRef.current = null;
    waiter?.(payload);
  }, []);

  /** Unity's check of every piece right now; null when it doesn't answer (older Unity build). */
  const requestPlacementCheck = useCallback(() => new Promise<PlacementCheckPayload | null>((resolve) => {
    const timer = setTimeout(() => {
      placementCheckWaiterRef.current = null;
      resolve(null);
    }, 1500);
    placementCheckWaiterRef.current = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    unityRef.current?.checkPlacement();
  }), []);

  const handleFinishDesign = useCallback(async () => {
    // Blocked while any piece overlaps another or runs through a wall (adviser, 2026-10-28).
    const check = await requestPlacementCheck();
    if (check?.hasErrors) {
      showPlacementIssues(check.issues);
      return;
    }
    try {
      unityRef.current?.getCurrentLayout();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await customization.flushCustomizedSave();
      const gen = applyGenerationRef.current;
      router.push({
        pathname: '/design-final',
        params: {
          sessionId: gen?.sessionId || '',
          projectId: gen?.projectId || activeProjectId || '',
          // This AR screen stays underneath: Final design goes back to it instead of opening another.
          fromAr: '1',
        },
      });
    } catch {
      showToast('Could not save your edits. Please try again.', 4000);
    }
  }, [activeProjectId, customization, requestPlacementCheck, router, showPlacementIssues, showToast]);

  const furnitureUiReady =
    unityReady && measuredFurnitureActive && measurePlanReady && placementUnlocked;

  const unitySceneSynced = activeUnityScene === MEASUREMENT_UNITY_SCENE;

  const measureHandoffPending = measuredFurnitureActive && !placementUnlocked;

  // Do NOT bulk-prefetch GLBs on open — sofa files are 70–250 MB and loading
  // many at once OOMs / freeze the device. Models load on place (with disk cache).

  /**
   * Unity loads and warms up its object detector once per session; that blocks Unity for several
   * seconds. A spinner here keeps moving (RN draws it, not Unity), so the frozen camera doesn't
   * look like a hang.
   */
  const [scannerPreparing, setScannerPreparing] = useState(false);
  const scannerPreparingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScannerPreparingMessage = useCallback((message: UnityOutboundMessage) => {
    if (message.event !== 'scannerPreparing' && message.event !== 'scannerReady') return;
    const preparing = message.event === 'scannerPreparing';
    setScannerPreparing(preparing);
    if (scannerPreparingTimeoutRef.current) clearTimeout(scannerPreparingTimeoutRef.current);
    scannerPreparingTimeoutRef.current = preparing
      ? setTimeout(() => setScannerPreparing(false), 30000)
      : null;
  }, []);
  useEffect(() => () => {
    if (scannerPreparingTimeoutRef.current) clearTimeout(scannerPreparingTimeoutRef.current);
  }, []);

  const handleUnityUnavailable = useCallback(() => {
    setUnityTimedOut(true);
    setStatusMessage('Unity AR is not available in this build');
  }, []);

  const handleScanStatus = useCallback(
    (payload: ScanStatusPayload) => {
      // The layout step owns its own status copy — ignore scan HUD updates.
      if (applyLayoutActiveRef.current) return;
      if (placementUnlockedRef.current) return;

      setScanProgress(payload.progress ?? 0);
      setScanReady(Boolean(payload.readyToConfirm));
      setRoomConfirmed(Boolean(payload.confirmed));
      setStatusMessage(scanHintMessage(payload));
    },
    []
  );

  const handleRoomConfirmed = useCallback(
    (payload: RoomConfirmedPayload) => {
      if (applyLayoutActiveRef.current) {
        if (isSyntheticFurnitureOnlyRoom(payload)) return;
        setConfirmedPayload(payload);
        setMeasurementModalVisible(false);
        unlockMeasuredFurnitureUi({ openLibrary: false });
        setStatusMessage('Placing your layout…');
        return;
      }

      // Unity's open-floor room (no scan) — keep the user scanning.
      if (isSyntheticFurnitureOnlyRoom(payload)) {
        setConfirmedPayload(null);
        setMeasurementModalVisible(false);
        setPlacementUnlocked(false);
        placementUnlockedRef.current = false;
        setRoomConfirmed(false);
        setScanProgress(0.15);
        setScanReady(false);
        setStatusMessage(
          'Point the camera around the room — tap floor height, then corners to measure'
        );
        return;
      }

      setRoomConfirmed(true);
      setScanProgress(1);
      setScanReady(true);
      setPlacementUnlocked(false);
      setMeasurementSaved(false);
      savedMeasurementIdRef.current = null;
      setMeasurementError(null);
      setMeasurePlanReady(false);
      measuredFurnitureActiveRef.current = false;
      setMeasuredFurnitureActive(false);
      setConfirmedPayload(payload);
      // Skip the name modal — save under the project name and go on to preferences.
      const stamp = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      setMeasureRoomName(projectNameRef.current?.trim() || `Room ${stamp}`);
      autoSaveMeasurePendingRef.current = true;
      setMeasurementModalVisible(false);
      setStatusMessage('Saving room measurement…');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
    [unlockMeasuredFurnitureUi]
  );

  const clearMeasureExportTimeout = useCallback(() => {
    if (measureExportTimeoutRef.current) {
      clearTimeout(measureExportTimeoutRef.current);
      measureExportTimeoutRef.current = null;
    }
  }, []);

  const clearMeasureExportKickoff = useCallback(() => {
    if (measureExportKickoffTimeoutRef.current) {
      clearTimeout(measureExportKickoffTimeoutRef.current);
      measureExportKickoffTimeoutRef.current = null;
    }
  }, []);

  const clearAllMeasureExportTimers = useCallback(() => {
    clearMeasureExportTimeout();
    clearMeasureExportKickoff();
    measureExportStartedRef.current = false;
  }, [clearMeasureExportKickoff, clearMeasureExportTimeout]);

  const armMeasureExportTimeout = useCallback(
    (ms: number) => {
      clearMeasureExportTimeout();
      measureExportTimeoutRef.current = setTimeout(() => {
        setExportingMeasure((prev) => {
          if (prev) {
            setExportResultDialog({
              kind: 'error',
              message: 'Export timed out. Try Export 3D again.',
            });
            setStatusMessage('Export timed out');
          }
          return false;
        });
      }, ms);
    },
    [clearMeasureExportTimeout]
  );

  const finalizeMeasureExport = useCallback(
    async (payload: ExportResultPayload) => {
      let previewUri = payload.path;
      let projectId: string | undefined;
      let savedToProjects = false;
      let linkedToMeasurement = false;
      const sizeKb = Math.round((payload.byteLength || 0) / 1024);

      try {
        const project = await projectService.saveUnityLayoutExport(payload, activeProjectId);
        projectId = project.id;
        savedToProjects = true;
        setStatusMessage(`Saved to Projects · ${payload.fileName} (${sizeKb} KB)`);
      } catch (err) {
        console.warn('[ARViewUnity] Failed to save export to Projects:', err);
      }

      // Link to the design's own scan. Never save a new scan here: it would show up as an
      // extra room choice in preferences for this project.
      const measurementId = savedMeasurementIdRef.current;
      if (measurementId) {
        try {
          previewUri = await persistRoomExportGlb(measurementId, payload.path);
        } catch (err) {
          console.warn('[ARViewUnity] Could not copy export into app storage:', err);
          previewUri = payload.path;
        }

        try {
          await RoomMeasurementService.linkExport(measurementId, {
            projectId,
            exportPath: previewUri,
            exportFileName: payload.fileName,
            exportByteLength: payload.byteLength,
            exportFurnitureCount: payload.furnitureCount,
          });
          linkedToMeasurement = true;
          setStatusMessage('Export linked to this room measurement');
        } catch (err) {
          console.warn('[ARViewUnity] Failed to link export to measurement:', err);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setExportResultDialog({
        kind: 'success',
        roomName: measureRoomName.trim() || 'Room scan',
        fileName: payload.fileName || 'room-layout.glb',
        sizeKb,
        previewUri,
        projectId,
        furnitureCount: payload.furnitureCount,
        linkedToMeasurement,
        savedToProjects,
      });
    },
    [activeProjectId, measureRoomName]
  );

  const handleExportMeasure = useCallback(async () => {
    if (exportingMeasure) return;

    if (!measuredFurnitureActiveRef.current || !placementUnlockedRef.current) {
      setExportResultDialog({
        kind: 'error',
        message: 'Save the room name first, then wait for the furniture workspace to open.',
      });
      return;
    }

    setExportingMeasure(true);
    setStatusMessage('Creating 3D layout…');
    measureExportStartedRef.current = false;
    armMeasureExportTimeout(180_000);

    measureExportKickoffTimeoutRef.current = setTimeout(() => {
      if (!measureExportStartedRef.current) {
        clearAllMeasureExportTimers();
        setExportingMeasure(false);
        setExportResultDialog({
          kind: 'error',
          message:
            'Unity did not start export. Switch back to the app and try Export again.',
        });
        setStatusMessage('Export did not start');
      }
    }, 12_000);

    try {
      unityRef.current?.wakeUnityPlayer?.();
      unityRef.current?.exportLayout();
    } catch (err) {
      clearAllMeasureExportTimers();
      console.warn('[ARViewUnity] Unity export failed to start:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setExportingMeasure(false);
      setExportResultDialog({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Could not create the 3D layout. Try Export 3D again.',
      });
    }
  }, [armMeasureExportTimeout, clearAllMeasureExportTimers, exportingMeasure]);

  const handleSaveMeasurement = useCallback(async () => {
    if (!confirmedPayload || savingMeasurement || measurementSaved) return;
    if (
      confirmedPayload.width <= 0 ||
      confirmedPayload.depth <= 0 ||
      confirmedPayload.height <= 0
    ) {
      setMeasurementError('Room dimensions are missing. Try scanning again.');
      return;
    }

    const trimmedName = measureRoomName.trim();
    if (!trimmedName) {
      setMeasurementError('Please enter a room name');
      return;
    }

    setSavingMeasurement(true);
    setMeasurementError(null);

    try {
      const saved = await RoomMeasurementService.save({
        width: confirmedPayload.width,
        depth: confirmedPayload.depth,
        height: confirmedPayload.height,
        floorAreaSqm: confirmedPayload.floorAreaSqm,
        wallHeight: confirmedPayload.wallHeight,
        dimensionLabel: confirmedPayload.dimensionLabel,
        boundsMin: confirmedPayload.boundsMin,
        boundsMax: confirmedPayload.boundsMax,
        floorPolygon: confirmedPayload.floorPolygon?.points,
        openings: confirmedPayload.openings,
        obstacles: confirmedPayload.obstacles,
        scanMetadata: {
          planeCount: confirmedPayload.planeCount,
          meshChunkCount: confirmedPayload.meshChunkCount,
          horizontalAreaSqm: confirmedPayload.horizontalAreaSqm,
          verticalAreaSqm: confirmedPayload.verticalAreaSqm,
          cornerCount: confirmedPayload.cornerCount,
          source: 'unity-ar',
        },
        name: trimmedName,
        projectId: activeProjectId,
      });
      savedMeasurementIdRef.current = saved.id;
      setMeasurementSaved(true);
      setStatusMessage(
        saved.dimensionLabel
          ? `Room saved — ${saved.name || saved.dimensionLabel}`
          : 'Room size saved to your account'
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      if (isDesignFlow) {
        showToast('Room measurement saved');
        measurementFlowCompleteRef.current = true;
        setMeasurementModalVisible(false);
        pauseUnityThen(() => router.replace({
          pathname: '/design-preferences',
          params: {
            projectId: activeProjectId || '',
            measurementId: saved.id,
            width: String(confirmedPayload.width),
            depth: String(confirmedPayload.depth),
            height: String(confirmedPayload.height),
            dimensionLabel: confirmedPayload.dimensionLabel || '',
            flow: 'design',
          },
        }), false);
        return;
      }
    } catch {
      setMeasurementError('Could not save. Check Wi‑Fi and that the backend is running.');
      // Auto-save failed — fall back to the modal so the user can retry or skip.
      setMeasurementModalVisible(true);
      setStatusMessage('Room measurement not saved');
    } finally {
      setSavingMeasurement(false);
    }
  }, [
    activeProjectId,
    confirmedPayload,
    isDesignFlow,
    measureRoomName,
    measurementSaved,
    pauseUnityThen,
    router,
    savingMeasurement,
    showToast,
  ]);

  // Runs after the room-confirmed handler has committed payload + name to state.
  useEffect(() => {
    if (!autoSaveMeasurePendingRef.current) return;
    if (!confirmedPayload || !measureRoomName.trim()) return;
    autoSaveMeasurePendingRef.current = false;
    void handleSaveMeasurement();
  }, [confirmedPayload, handleSaveMeasurement, measureRoomName]);

  /** Skip saving the scan (save failed) and go on to preferences with its size. */
  const handleContinueFromMeasurement = useCallback(() => {
    if (savingMeasurement) return;

    measurementFlowCompleteRef.current = true;
    setMeasurementModalVisible(false);
    if (confirmedPayload) {
      pauseUnityThen(() => router.replace({
        pathname: '/design-preferences',
        params: {
          projectId: activeProjectId || '',
          measurementId: savedMeasurementIdRef.current || '',
          width: String(confirmedPayload.width),
          depth: String(confirmedPayload.depth),
          height: String(confirmedPayload.height),
          dimensionLabel: confirmedPayload.dimensionLabel || '',
          flow: 'design',
        },
      }), false);
    }
  }, [activeProjectId, confirmedPayload, pauseUnityThen, router, savingMeasurement]);

  const lockPieces = useCallback((furniture: NonNullable<LayoutPayload['furniture']>) => {
    furniture
      .filter((piece) => !piece.locked)
      .forEach((piece) => unityRef.current?.setFurnitureLocked({ instanceId: piece.instanceId, locked: true }));
  }, []);

  useEffect(() => {
    if (viewOnly) lockPieces(placedFurnitureRef.current);
  }, [lockPieces, viewOnly]);

  const handleLayoutChanged = useCallback((payload: LayoutPayload) => {
    const furniture = payload.furniture ?? [];
    placedFurnitureRef.current = furniture;
    if (viewOnlyRef.current) lockPieces(furniture);
    setPlacedModelIds(furniture.map((item) => item.modelId));
    const selected = furniture.find((item) => item.selected);
    setSelectedPlacedModelId(selected?.modelId ?? null);
    if (!placementUnlockedRef.current) {
      setRoomConfirmed(Boolean(payload.roomConfirmed));
    }
    if (applyLayoutActiveRef.current && applyAwaitingPlacementRef.current && furniture.length > 0) {
      applyAwaitingPlacementRef.current = false;
      setFurnitureLoading(false);
      setStatusMessage(
        `Layout placed — ${furniture.length} pieces. Tap a piece to move, recolour, replace or lock it.`
      );
    }
    handleCustomizeLayout(payload);
  }, [handleCustomizeLayout, lockPieces]);

  const handleFurnitureSelected = useCallback((payload: SelectionPayload) => {
    if (viewOnlyRef.current) return;
    handleCustomizeSelection(payload);
    if (payload.selected && payload.modelId) {
      setSelectedPlacedModelId(payload.modelId);
      setStatusMessage('Selected — 1 finger drag · 2 fingers on piece to rotate');
    } else {
      setSelectedPlacedModelId(null);
    }
  }, [handleCustomizeSelection]);

  const handlePlacementSafety = useCallback((payload: PlacementSafetyPayload) => {
    handleCustomizeSafety(payload);
    const issue = describePlacementIssue(
      payload,
      (modelId) => catalogItems.find((item) => item.id === modelId)?.name,
    );
    if (!issue) {
      setStatusMessage('Placed — 1 finger move · 2 fingers on piece to twist-rotate');
      return;
    }
    setStatusMessage(`Unsafe — ${issue}`);
  }, [catalogItems, handleCustomizeSafety]);

  const handleFurnitureLockBlocked = useCallback(() => {
    if (viewOnlyRef.current) return;
    showToast('This piece is locked. Tap Locked to move it again.');
  }, [showToast]);

  const handleHistoryChanged = useCallback((payload: HistoryStatePayload) => {
    setCanUndo(Boolean(payload.canUndo));
    setCanRedo(Boolean(payload.canRedo));
  }, []);

  const handleConfirmScan = useCallback(() => {
    unityRef.current?.confirmRoomScan();
  }, []);

  const handleRescan = useCallback(() => {
    measurementFlowCompleteRef.current = false;
    setRoomConfirmed(false);
    setScanProgress(0);
    setScanReady(false);
    setPlacementUnlocked(false);
    placementUnlockedRef.current = false;
    setMeasurementModalVisible(false);
    setConfirmedPayload(null);
    setMeasurementSaved(false);
    savedMeasurementIdRef.current = null;
    setMeasurementError(null);
    setSavingMeasurement(false);
    setMeasurePlanReady(false);
    setPlacedModelIds([]);
    setSelectedPlacedModelId(null);
    setCanUndo(false);
    setCanRedo(false);
    unityRef.current?.startRoomScan();
    setStatusMessage('Rescanning room…');
  }, []);

  const handleClear = useCallback(() => {
    unityRef.current?.clearScene();
    setPlacedModelIds([]);
    setSelectedPlacedModelId(null);
    setStatusMessage('Select your desired furniture');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const handleSavePhoto = useCallback(() => {
    if (savingPhoto) return;
    setLibraryOpen(false);
    setSavingPhoto(true);
    setStatusMessage('Capturing photo…');
    // Hide RN chrome for a beat so ScreenCapture doesn't include the toolbar.
    setTimeout(() => {
      unityRef.current?.capturePhoto();
    }, 180);
    if (photoCaptureTimeoutRef.current) clearTimeout(photoCaptureTimeoutRef.current);
    photoCaptureTimeoutRef.current = setTimeout(() => {
      setSavingPhoto((prev) => {
        if (prev) setStatusMessage('Photo capture timed out — try again');
        return false;
      });
    }, 12000);
  }, [savingPhoto]);

  const leaveArScreen = useCallback(
    (destination?: '/projects') => {
      if (closingRef.current) return;
      closingRef.current = true;
      setExitConfirmVisible(false);
      if (destination) router.replace(destination);
      else if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    },
    [router]
  );

  const resetMeasureSessionLocally = useCallback(() => {
    measurementFlowCompleteRef.current = false;
    measuredFurnitureActiveRef.current = false;
    libraryUserDismissedRef.current = false;
    setMeasuredFurnitureActive(false);
    savedMeasurementIdRef.current = null;
    setMeasurementModalVisible(false);
    setConfirmedPayload(null);
    setMeasurementSaved(false);
    setMeasurementError(null);
    setMeasureRoomName('');
    setMeasurePlanReady(false);
    setExportingMeasure(false);
    setExportResultDialog(null);
    setRoomConfirmed(false);
    setScanProgress(0);
    setScanReady(false);
    setPlacementUnlocked(false);
    placementUnlockedRef.current = false;
    setPlacedModelIds([]);
    setSelectedPlacedModelId(null);
    setLibraryOpen(false);
    libraryUserDismissedRef.current = false;
  }, []);

  /** Full RN + boot-flag reset for each AR session (the Unity player stays alive between visits). */
  useEffect(() => {
    closingRef.current = false;
    modeBootedRef.current = false;
    measuredFurnitureActiveRef.current = false;
    libraryUserDismissedRef.current = false;
    measurementFlowCompleteRef.current = false;
    placementUnlockedRef.current = false;
    pendingSpawnRef.current = null;
    measureNeedsReloadRef.current = true;

    setUnityReady(false);
    setUnityTimedOut(false);
    setActiveUnityScene(null);
    setMeasuredFurnitureActive(false);
    setPlacementUnlocked(false);
    setRoomConfirmed(false);
    setScanProgress(0);
    setScanReady(false);
    setPlacedModelIds([]);
    setSelectedPlacedModelId(null);
    setCanUndo(false);
    setCanRedo(false);
    setLibraryOpen(false);
    setMeasurementModalVisible(false);
    setConfirmedPayload(null);
    setMeasurementSaved(false);
    setMeasurementError(null);
    setMeasureRoomName('');
    setMeasurePlanReady(false);
    setExportingMeasure(false);
    setExportResultDialog(null);
    setSelectedLibraryItem(null);
    setStatusMessage(isApplyLayoutFlow ? 'Loading your layout in AR…' : 'Loading room scan…');
  }, [arSessionKey, isApplyLayoutFlow]);

  const bootstrapUnitySceneForSession = useCallback(() => {
    if (closingRef.current || !unityAvailable) return;
    try {
      unityRef.current?.resumeUnityPlayer?.();
    } catch {
      /* native view may not be attached yet */
    }
    // "View in AR" boots through openDesignLayoutInAr. Opening the scanner here would start a new
    // scan, which resets AR tracking and loses where the room was scanned (the layout goes there).
    if (measuredFurnitureActiveRef.current || applyLayoutActiveRef.current) return;
    unityRef.current?.openRoomMeasurement();
    // Opening restarts the scan in Unity; a reload on top of it (from the ping's unityReady)
    // would restart it a second time.
    modeBootedRef.current = true;
    measureNeedsReloadRef.current = false;
  }, [unityAvailable]);

  useEffect(() => {
    if (!mountUnity || !unityAvailable) return;
    sessionBootAckRef.current = false;
    const runBootAttempt = () => {
      // The retries are for a cold start, when Unity may not be listening yet. Once it has
      // answered, each further "open" would restart the scan (and the camera) again — on a warm
      // reopen that was five restarts in two seconds, and the scan got slower every reopen.
      if (sessionBootAckRef.current) return;
      bootstrapUnitySceneForSession();
      unityRef.current?.sendToUnity('ping', '');
    };
    const delays = isUnityPlayerWarm() ? [0, 120, 400, 900, 1800] : [400, 900, 1800];
    const timers = delays.map((ms) => setTimeout(runBootAttempt, ms));
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [arSessionKey, mountUnity, unityAvailable, bootstrapUnitySceneForSession]);

  useFocusEffect(
    useCallback(() => {
      if (!unityAvailable || !mountUnity) return;
      try {
        unityRef.current?.resumeUnityPlayer?.();
      } catch {
        /* native view may not be attached yet */
      }
    }, [unityAvailable, mountUnity])
  );

  const exitAr = useCallback((destination?: '/projects') => {
    if (closingRef.current || exitingRef.current) return;
    exitingRef.current = true;
    setExitConfirmVisible(false);

    resetMeasureSessionLocally();
    const furniture = activeUnityScene === FURNITURE_UNITY_SCENE;
    try {
      if (furniture) {
        unityRef.current?.pauseFurniture();
      } else {
        unityRef.current?.pauseMeasurement();
      }
    } catch (err) {
      console.warn('[ARViewUnity] pause AR failed:', err);
    }
    measureNeedsReloadRef.current = true;

    // The furniture scene sends no "closed" message: give it a frame's grace instead.
    pauseUnityThen(() => leaveArScreen(destination), !furniture);
  }, [activeUnityScene, leaveArScreen, pauseUnityThen, resetMeasureSessionLocally]);

  const confirmExitAr = useCallback(() => exitAr(), [exitAr]);

  const handleBack = useCallback(() => {
    if (closingRef.current) return;
    // Nothing to lose when only looking: no "Exit?" question.
    if (viewOnlyRef.current) {
      exitAr();
      return;
    }
    setExitConfirmVisible(true);
  }, [exitAr]);

  if (Platform.OS === 'web') {
    return null;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {unityAvailable && mountUnity ? (
        <UnityARViewer
          ref={unityRef}
          style={styles.unityLayer}
          onUnityReady={handleUnityReady}
          onUnityMessage={handleScannerPreparingMessage}
          onReloadComplete={handleReloadComplete}
          onMeasuredFurnitureReady={handleMeasuredFurnitureReady}
          onLayoutAlignment={handleLayoutAlignment}
          onUnityUnavailable={handleUnityUnavailable}
          onRequestClose={() => {
            // Unity native back — same flow as the RN chevron.
            handleBack();
          }}
          onScanStatus={handleScanStatus}
          onRoomScanConfirmed={handleRoomConfirmed}
          onLayoutChanged={handleLayoutChanged}
          onFurnitureSelected={handleFurnitureSelected}
          onPlacementSafety={handlePlacementSafety}
          onPlacementCheck={handlePlacementCheck}
          onFurnitureLockBlocked={handleFurnitureLockBlocked}
          onHistoryChanged={handleHistoryChanged}
          onFurnitureInstancePlaced={(payload) => {
            if (furnitureLoadTimeoutRef.current) {
              clearTimeout(furnitureLoadTimeoutRef.current);
              furnitureLoadTimeoutRef.current = null;
            }
            if (payload?.modelId) setSelectedPlacedModelId(payload.modelId);
            setFurnitureLoading(false);
            if (applyLayoutActiveRef.current) {
              setStatusMessage('Placing your layout…');
              return;
            }
            setStatusMessage('Placed — 1 finger move · 2 on piece rotate');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }}
          onFurnitureReady={() => {
            if (furnitureLoadTimeoutRef.current) {
              clearTimeout(furnitureLoadTimeoutRef.current);
              furnitureLoadTimeoutRef.current = null;
            }
            setFurnitureLoading(false);
            setStatusMessage('Furniture ready — placed on your measured room');
          }}
          onExportStarted={() => {
            measureExportStartedRef.current = true;
            clearMeasureExportKickoff();
            armMeasureExportTimeout(180_000);
          }}
          onExportComplete={(payload) => {
            // Unity's own Export button lands here too — finalize so the GLB reaches Projects.
            clearAllMeasureExportTimers();
            setExportingMeasure(false);
            if (!payload.success || !payload.path) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
              setExportResultDialog({
                kind: 'error',
                message: payload.error || 'Export failed. Try Export 3D again.',
              });
              return;
            }
            void finalizeMeasureExport(payload);
          }}
          onMeasurementPlanReady={() => {
            setMeasurePlanReady(true);
            if (measuredFurnitureActiveRef.current) {
              const wasLocked = !placementUnlockedRef.current;
              unlockMeasuredFurnitureUi();
              if (wasLocked && __DEV__) {
                console.log('[ARViewUnity] Unlocked furniture via measurementPlanReady');
              }
            }
          }}
          onMeasurementPlanClosed={() => {
            planClosedWaiterRef.current?.();
            // SoftClose / scene handoff closes the measurement plan — keep UI unlocked
            // while measured furniture placement is starting on ARDesignScene.
            if (measuredFurnitureActiveRef.current) return;
            setMeasurePlanReady(false);
          }}
          onRequestRnExport3d={() => {
            void handleExportMeasure();
          }}
          onPhotoCaptured={(payload: ARPhotoCapturedPayload) => {
            if (photoCaptureTimeoutRef.current) {
              clearTimeout(photoCaptureTimeoutRef.current);
              photoCaptureTimeoutRef.current = null;
            }
            setSavingPhoto(false);

            if (!payload?.success || !payload.path) {
              setStatusMessage(payload?.error || 'Photo capture failed');
              return;
            }

            const uri = payload.path.startsWith('file://')
              ? payload.path
              : `file://${payload.path}`;
            const kb = Math.round((payload.byteLength || 0) / 1024);
            setStatusMessage(
              payload.gallerySaved
                ? `Photo saved to Gallery + app (${kb} KB)`
                : `Photo saved to app (${kb} KB)`
            );

            void projectService
              .addProjectPhoto(photoProjectIdRef.current, {
                uri,
                fileName: payload.fileName || `ar-photo-${Date.now()}.png`,
                byteLength: payload.byteLength || 0,
                capturedAt: Date.now(),
                gallerySaved: Boolean(payload.gallerySaved),
              })
              .then((project) => {
                photoProjectIdRef.current = project.id;
                setStatusMessage(
                  payload.gallerySaved
                    ? `Saved to Gallery + Projects · ${project.name}`
                    : `Saved to Projects · ${project.name}`
                );
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                  () => {}
                );
              })
              .catch((err) => {
                console.warn('[ARViewUnity] Failed to save AR photo to Projects:', err);
              });
          }}
          onUnityError={(payload) => {
            if (furnitureLoadTimeoutRef.current) {
              clearTimeout(furnitureLoadTimeoutRef.current);
              furnitureLoadTimeoutRef.current = null;
            }
            setFurnitureLoading(false);
            setStatusMessage(payload.message || payload.code);
            if (
              payload.code === 'noMeasuredRoom' ||
              payload.code === 'applyMeasuredRoomFailed'
            ) {
              measuredFurnitureActiveRef.current = false;
              setMeasuredFurnitureActive(false);
              setPlacementUnlocked(false);
              placementUnlockedRef.current = false;
            }
          }}
        />
      ) : unityAvailable ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Preparing Unity AR…</Text>
        </View>
      ) : (
        <View style={styles.unavailableLayer}>
          <Ionicons name="cube-outline" size={48} color={colors.accent} />
          <Text style={styles.unavailableTitle}>True Floor AR unavailable</Text>
          <Text style={styles.unavailableText}>
            This development build does not include the Unity native view. Rebuild with an
            ARDesignScene export to use the planner.
          </Text>
        </View>
      )}

      {unityAvailable && mountUnity && (!unityReady || !unitySceneSynced) && !unityTimedOut && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>
            {isApplyLayoutFlow ? 'Opening your layout in AR…' : 'Starting the room scan…'}
          </Text>
        </View>
      )}

      {furnitureUiReady && layoutAligning && alignment && (
        <LayoutAlignmentPanel
          alignment={alignment}
          planWidth={applyRoomRef.current?.width}
          planLength={applyRoomRef.current?.length}
          onMarkCorner={markAlignmentCorner}
          onUndo={undoAlignmentCorner}
          onBack={handleBack}
          onHelp={() => setGuideVisible(true)}
        />
      )}

      {furnitureUiReady && !layoutAligning && viewOnly && (
        <ViewOnlyControls
          loading={furnitureLoading}
          onBack={handleBack}
          onHelp={() => setGuideVisible(true)}
          onTurnAround={!alignment?.canTurn
            ? undefined
            : () => {
                unityRef.current?.flipLayoutAlignment();
                showToast('Turned to the next wall', 2000);
              }}
        />
      )}

      {furnitureUiReady && !layoutAligning && !viewOnly && (
        <ARPlannerOverlay
          catalogItems={catalogItems}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          roomConfirmed={placementUnlocked}
          scanModalOpen={measurementModalVisible}
          scanProgress={scanProgress}
          scanReady={scanReady}
          statusMessage={statusMessage}
          furnitureLoading={furnitureLoading}
          selectedCategory={selectedCategory}
          selectedLibraryItem={selectedLibraryItem}
          selectedPlacedModelId={selectedPlacedModelId}
          selectedLocked={Boolean(customization.selectedPiece?.locked)}
          placedModelIds={placedModelIds}
          canUndo={canUndo}
          canRedo={canRedo}
          activeTool={activeTool}
          libraryOpen={libraryOpen}
          onSelectCategory={setSelectedCategory}
          onSelectItem={handleSelectItem}
          onConfirmScan={handleConfirmScan}
          onRescan={handleRescan}
          onUndo={() => unityRef.current?.undo()}
          onRedo={() => unityRef.current?.redo()}
          onClear={handleClear}
          // No Export button at the top right (client, 2026-11-12): it was tapped by accident, and
          // saving goes through Finish.
          onSavePhoto={handleSavePhoto}
          savingPhoto={savingPhoto}
          onRemoveSelected={() => unityRef.current?.removeSelectedFurniture()}
          onSetTool={setActiveTool}
          onToggleLibrary={() => {
            setLibraryOpen((open) => {
              const next = !open;
              libraryUserDismissedRef.current = !next;
              return next;
            });
          }}
          onBack={handleBack}
          enablePlannerOrbit={measuredFurnitureActive}
          onPlannerPointer={(payload) => unityRef.current?.plannerPointer(payload)}
          style={savingPhoto ? { opacity: 0, pointerEvents: 'none' } : undefined}
        />
      )}

      {furnitureUiReady && isApplyLayoutFlow && !viewOnly && layoutAligned && !layoutAligning && !savingPhoto && (
        <LayoutViewControls
          onRegenerate={() => {
            void customization.regenerate();
          }}
          regenerating={customization.regenerating}
          onFinish={() => {
            void handleFinishDesign();
          }}
          finishBlocked={placementIssues.length > 0}
          onFinishBlocked={() => showPlacementIssues(placementIssues)}
          onHelp={() => setGuideVisible(true)}
          onTurnAround={!alignment?.canTurn
            ? undefined
            : () => {
                unityRef.current?.flipLayoutAlignment();
                showToast('Turned to the next wall', 2000);
              }}
        />
      )}

      {furnitureUiReady
        && isApplyLayoutFlow
        && !viewOnly
        && layoutAligned
        && !layoutAligning
        && !savingPhoto
        && !libraryOpen
        && customization.selectedPiece && (
          <FurnitureCustomizePanel
            itemName={customization.selectedCatalogItem?.name ?? customization.selectedPiece.modelId}
            activeColorHex={customization.selectedPiece.colorHex ?? ''}
            colorOptions={customization.colorOptions}
            replacementOptions={customization.replacementOptions}
            locked={Boolean(customization.selectedPiece.locked)}
            warning={customization.selectedWarning}
            onSelectColor={customization.setColor}
            onReplace={customization.replaceWith}
            onToggleLock={customization.toggleLock}
            bottomOffset={140}
          />
        )}

      {scannerPreparing && (
        <View style={styles.scannerPreparing} pointerEvents="none">
          <View style={styles.scannerPreparingCard}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.scannerPreparingTitle}>Getting the scanner ready…</Text>
            <Text style={styles.scannerPreparingBody}>A few seconds · longer the first time after an install</Text>
          </View>
        </View>
      )}

      {measureHandoffPending && !furnitureUiReady && (
        <View style={styles.measureChrome} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.measureBackButton}
            onPress={handleBack}
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color="#1C1B19" />
          </TouchableOpacity>
          <View style={styles.handoffChip} pointerEvents="none">
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.handoffChipText}>
              {isApplyLayoutFlow ? 'Placing your layout in AR…' : 'Opening measured room for furniture…'}
            </Text>
          </View>
        </View>
      )}

      {unityAvailable &&
        (unityReady || unityTimedOut) &&
        !furnitureUiReady &&
        !measureHandoffPending && (
        <View style={styles.measureChrome} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.measureBackButton}
            onPress={handleBack}
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color="#1C1B19" />
          </TouchableOpacity>
        </View>
      )}

      <RoomMeasurementSaveModal
        visible={measurementModalVisible}
        payload={confirmedPayload}
        saving={savingMeasurement}
        error={measurementError}
        roomName={measureRoomName}
        onChangeRoomName={(text) => {
          setMeasureRoomName(text);
          if (measurementError) setMeasurementError(null);
        }}
        onSave={handleSaveMeasurement}
        onSkip={handleContinueFromMeasurement}
      />

      <ARToastNotice message={toastMessage} />

      {/* Inline overlay, not <Modal>: an Android dialog window steals focus and pauses Unity mid-export. */}
      {exportingMeasure ? (
        <View style={styles.exportBusyBackdrop} pointerEvents="auto">
          <View style={styles.exportBusyCard}>
            <ActivityIndicator size="large" color="#0C295F" />
            <Text style={styles.exportBusyTitle}>Creating 3D layout…</Text>
            <Text style={styles.exportBusyBody}>
              Building a 3D model of your room and layout, then saving it to Projects.
            </Text>
          </View>
        </View>
      ) : null}

      {guideVisible ? <ViewArGuide viewOnly={viewOnly} onClose={closeGuide} /> : null}

      <AppDialog
        inline
        visible={exitConfirmVisible}
        title={isApplyLayoutFlow ? 'Exit AR view?' : 'Exit room scan?'}
        message={
          isApplyLayoutFlow
            ? 'Are you sure you want to exit? Placed furniture on screen will be cleared so the next open starts fresh.'
            : 'Are you sure you want to exit? Your current scan on screen will be cleared so the next open starts fresh.'
        }
        icon="exit-outline"
        dismissOnBackdrop={!exportingMeasure && !savingMeasurement && !savingPhoto}
        onRequestClose={() => {
          if (exportingMeasure || savingMeasurement || savingPhoto) return;
          setExitConfirmVisible(false);
        }}
        actions={[
          {
            label: 'Stay',
            tone: 'ghost',
            onPress: () => setExitConfirmVisible(false),
          },
          {
            label: 'Yes, exit',
            tone: 'primary',
            onPress: confirmExitAr,
          },
        ]}
      />

      <AppDialog
        inline
        visible={exportResultDialog?.kind === 'success'}
        title="3D layout exported"
        message={
          exportResultDialog?.kind === 'success'
            ? [
                `“${exportResultDialog.roomName}” is ready (${exportResultDialog.sizeKb} KB).`,
                exportResultDialog.savedToProjects
                  ? 'Saved to Projects.'
                  : 'Could not add to Projects.',
              ].join(' ')
            : undefined
        }
        icon="checkmark-circle-outline"
        dismissOnBackdrop={false}
        onRequestClose={() => setExportResultDialog(null)}
        actions={
          exportResultDialog?.kind === 'success'
            ? [
                {
                  label: 'Done',
                  tone: 'ghost',
                  onPress: () => {
                    // Export is saved to the project — finish the AR session and show it in Projects.
                    setExportResultDialog(null);
                    exitAr('/projects');
                  },
                },
                {
                  label: 'View layout',
                  tone: 'primary',
                  onPress: () => {
                    const result = exportResultDialog;
                    setExportResultDialog(null);
                    if (!result || result.kind !== 'success') return;
                    router.push(
                      buildModelPreviewExportHref({
                        uri: result.previewUri,
                        title: result.fileName,
                        furnitureCount: result.furnitureCount,
                        projectId: result.projectId,
                      })
                    );
                  },
                },
              ]
            : undefined
        }
      />

      <AppDialog
        inline
        visible={exportResultDialog?.kind === 'error'}
        title="Export failed"
        message={exportResultDialog?.kind === 'error' ? exportResultDialog.message : undefined}
        icon="alert-circle-outline"
        variant="danger"
        onRequestClose={() => setExportResultDialog(null)}
        actions={[
          {
            label: 'Close',
            tone: 'ghost',
            onPress: () => setExportResultDialog(null),
          },
          {
            label: 'Try again',
            tone: 'primary',
            onPress: () => {
              setExportResultDialog(null);
              handleExportMeasure();
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scannerPreparing: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  scannerPreparingCard: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 22,
    borderRadius: 18,
    backgroundColor: 'rgba(20,22,28,0.88)',
    maxWidth: 300,
  },
  scannerPreparingTitle: {
    marginTop: 14,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  scannerPreparingBody: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    textAlign: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  unityLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  measureChrome: {
    ...StyleSheet.absoluteFillObject,
  },
  measureBackButton: {
    position: 'absolute',
    top: 48,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  handoffChip: {
    position: 'absolute',
    top: 54,
    left: 72,
    right: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(12, 41, 95, 0.92)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 2,
  },
  handoffChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  measureTopActions: {
    position: 'absolute',
    top: 48,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 2,
  },
  measureToolButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  measureToolButtonActive: {
    backgroundColor: '#DBEAFE',
  },
  measureExportButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: '#0C295F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  measureExportDisabled: {
    opacity: 0.7,
  },
  measureExportText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  measureLibrarySheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 12,
    zIndex: 2,
  },
  measureLibraryTitle: {
    color: '#1C1B19',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
    marginLeft: 4,
  },
  measureLibraryState: {
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  measureLibraryStateText: {
    color: '#64748B',
    fontSize: 13,
  },
  measureLibraryRow: {
    paddingBottom: 4,
    paddingRight: 8,
  },
  measureItemCard: {
    width: 104,
    marginRight: 10,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
    padding: 8,
  },
  measureItemCardSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  measureItemCardLocked: {
    opacity: 0.45,
  },
  measureItemCardLast: {
    marginRight: 4,
  },
  measureItemMedia: {
    height: 64,
    borderRadius: 10,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  measureItemThumb: {
    width: '100%',
    height: '100%',
  },
  measureItemSwatch: {
    width: '70%',
    height: '70%',
    borderRadius: 8,
  },
  measureItemName: {
    marginTop: 6,
    color: '#1C1B19',
    fontSize: 12,
    fontWeight: '600',
  },
  measureItemMeta: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 10,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  loadingText: {
    marginTop: spacing.md,
    color: '#FFFFFF',
    fontSize: 16,
  },
  unavailableLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: '#0F172A',
    gap: spacing.md,
  },
  unavailableTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  unavailableText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  exportBusyBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  exportBusyCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  exportBusyTitle: {
    marginTop: spacing.sm,
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  exportBusyBody: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
