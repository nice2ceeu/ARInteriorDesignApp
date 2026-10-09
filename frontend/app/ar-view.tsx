import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  GestureResponderEvent,
  ScrollView,
  Alert,
  ActivityIndicator,
  Share,
  Platform,
  PanResponder,
  AccessibilityInfo,
  Dimensions,
  Modal,
  Animated,
} from 'react-native';
import { AnimatedButton, AnimatedCard, FadeInView, SlideInView, ScaleInView } from '@/components/interactive';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { GLView } from 'expo-gl';
import * as THREE from 'three';
import * as FileSystem from 'expo-file-system/legacy';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomData, SpatialPoint } from '@/types/spatial-mapping';
// Redundant imports removed
import { arAnchorManager } from '@/services/ARAnchorManager';
import { enhancedSpatialMappingService } from '@/services/EnhancedSpatialMappingService';
import { furnitureModelLoader } from '@/services/FurnitureModelLoader';
import { roomLayoutService } from '@/services/RoomLayoutService';
import type { AnchorStatus } from '@/types/anchor';
import type {
  ARInitError,
  FurnitureMapEntry,
  FurnitureLibraryItem,
  PlacedFurnitureMeta,
  SavedLayout
} from '@/types/ar-view';
import type { DetectedPlane } from '@/types/spatial-mapping';
import { getJson, setJson } from '@/utils/storage';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import { ARViewSkeleton } from '@/components/ui/SkeletonLoader';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii } from '@/components/ui/theme';

// Refactored logic imports
import { CONFIG, MAX_CACHE_SIZE, MAX_POOL_SIZE } from '../constants/ar-config';
import { FURNITURE_LIBRARY } from '../constants/furniture-library';
import {
  disposeMesh,
  disposeObjectRecursive,
  unitToMeters,
  spatialToVector3,
  vector3ToSpatial
} from '../utils/three-utils';
import {
  parseSizeLabel,
  checkObstacleCollisions,
  checkFurnitureCollisions,
  getPlacementSafety,
  checkRoomBounds,
  distanceToLineSegment,
  createFurnitureBoundingBox,
} from '../utils/arCollisionDetection';
import {
  suggestAlternativePositions,
  autoCorrectPosition,
} from '../utils/arPlacementHelpers';
import {
  alignToFloor,
  snapToGridPosition,
  snapRotation,
  findAlignmentTargets,
  findWallSnapTargets,
} from '../utils/arPositioningHelpers';
import { useARRenderer } from '../hooks/useARRenderer';
import { useARFurnitureState } from '../hooks/useARFurnitureState';
import { useARInteractionState } from '../hooks/useARInteractionState';
import { useARUIState } from '../hooks/useARUIState';
import { useARMeasurementState } from '../hooks/useARMeasurementState';
import { useARMarkerTracking } from '../hooks/useARMarkerTracking';
import { useARRefs } from '../hooks/useARRefs';
import { useARCoreState } from '../hooks/useARCoreState';
import { useARHistory } from '../hooks/useARHistory';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

// CONFIG and MAX limits moved to ../constants/ar-config

/**
 * Error classification for AR initialization errors
 * Types are imported from '@/types/ar-view' - removed duplicate local definitions
 */

/**
 * Error messages and recovery strategies for AR initialization
 */
const ERROR_MESSAGES = {
  CAMERA_PERMISSION_DENIED: 'Camera permission is required for AR features.',
  ROOM_DATA_PARSE_ERROR: 'Failed to load room data. Please try scanning again.',
  FURNITURE_PLACEMENT_ERROR: 'Unable to place furniture. Please try again.',
  ANCHOR_ERROR: 'Unable to establish anchor. Move device slowly and try again.',
} as const;

// Error classification moved to @/utils/arErrorHandling.ts
import { AR_ERROR_CLASSIFICATION } from '@/utils/arErrorHandling';
// Styles moved to @/styles/arView.styles.ts
import { styles, errorBoundaryStyles } from '@/styles/arView.styles';

/**
 * Classify an error and return appropriate error details
 * @internal - Reserved for future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _classifyARError = (error: Error | unknown): ARInitError => {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Try to match specific error patterns
  if (errorMessage.includes('permission') || errorMessage.includes('camera')) {
    return AR_ERROR_CLASSIFICATION['camera-permission-denied'];
  }
  if (errorMessage.includes('webgl') && errorMessage.includes('lost')) {
    return AR_ERROR_CLASSIFICATION['webgl-context-lost'];
  }
  if (errorMessage.includes('webgl') && (errorMessage.includes('not supported') || errorMessage.includes('unsupported'))) {
    return AR_ERROR_CLASSIFICATION['webgl-unsupported'];
  }
  if (errorMessage.includes('webgl') || errorMessage.includes('context')) {
    return AR_ERROR_CLASSIFICATION['webgl-context-failed'];
  }
  if (errorMessage.includes('renderer') || errorMessage.includes('render')) {
    return AR_ERROR_CLASSIFICATION['renderer-create-failed'];
  }
  if (errorMessage.includes('dimension') || errorMessage.includes('invalid') && errorMessage.includes('context')) {
    return AR_ERROR_CLASSIFICATION['invalid_context_dimensions'];
  }
  if (errorMessage.includes('scene') || errorMessage.includes('3d scene')) {
    return AR_ERROR_CLASSIFICATION['scene-create-failed'];
  }
  if (errorMessage.includes('light') || errorMessage.includes('lighting')) {
    return AR_ERROR_CLASSIFICATION['lighting-init-failed'];
  }
  if (errorMessage.includes('anchor') && (errorMessage.includes('lost') || errorMessage.includes('tracking'))) {
    return AR_ERROR_CLASSIFICATION['anchor-tracking-lost'];
  }
  if (errorMessage.includes('anchor') && errorMessage.includes('quality')) {
    return AR_ERROR_CLASSIFICATION['anchor-poor-quality'];
  }
  if (errorMessage.includes('anchor')) {
    return AR_ERROR_CLASSIFICATION['anchor-init-failed'];
  }
  if (errorMessage.includes('memory') || errorMessage.includes('out of memory')) {
    return AR_ERROR_CLASSIFICATION['memory-limit-exceeded'];
  }
  if (errorMessage.includes('texture')) {
    return AR_ERROR_CLASSIFICATION['texture-load-failed'];
  }
  if (errorMessage.includes('incompatible') || errorMessage.includes('not supported')) {
    return AR_ERROR_CLASSIFICATION['device-incompatible'];
  }

  // Default to unknown error
  return AR_ERROR_CLASSIFICATION['unknown-error'];
};

/**
 * Physics properties for furniture simulation
 * Enables realistic gravity, friction, and weight distribution
 */
interface FurniturePhysics {
  mass: number;
  friction: number;
  enableGravity: boolean;
}

// Types are now imported from '@/types/ar-view' - removed duplicate local definitions

// Redundant FURNITURE_LIBRARY removed, now imported from @/constants/furniture-library
// OBSTACLE_COLORS moved to @/config/arView.config.ts and used in RoomLayoutService

/**
 * Convert units to meters with high precision
 * Uses exact conversion factor for feet to meters
 */
// Redundant utility functions removed, now imported from ../utils/three-utils
// unitToMeters, metersToUnit, parseSizeLabel, spatialToVector3, vector3ToSpatial, disposeMesh, alignToFloor, snapToGridPosition

// ============================================================================
// COMPONENT: ARViewScreen
// ============================================================================

/**
 * Safely executes an async operation with error handling
 * Returns a default value if the operation fails
 * @param operation - Async function to execute
 * @param defaultValue - Value to return if operation fails
 * @param errorContext - Context string for error logging
 * @returns Result of operation or default value
 * @internal - Reserved for future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _safeAsync = async <T extends unknown>(
  operation: () => Promise<T>,
  defaultValue: T,
  errorContext: string
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    console.error(`[ARView] ${errorContext}:`, error);
    return defaultValue;
  }
};

/**
 * Debounce function to limit function calls
 * Useful for expensive operations like rendering updates
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @returns Debounced function
 * @internal - Reserved for future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _debounce = <T extends (...args: any[]) => any,>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, wait);
  };
};

// ============================================================================
// COLLISION DETECTION UTILITIES
// ============================================================================

// Collision detection functions moved to @/utils/arCollisionDetection.ts
// Placement helpers moved to @/utils/arPlacementHelpers.ts

/**
 * Create detailed 3D furniture model based on category
 * Supports both GLB/GLTF files and procedural generation
 * Returns a Promise that resolves to a THREE.Group
 * 
 * @deprecated Use furnitureModelLoader.createDetailedFurnitureModel instead
 */
const createDetailedFurnitureModel = async (
  item: FurnitureLibraryItem
): Promise<THREE.Group> => {
  // Use the service instead
  return furnitureModelLoader.createDetailedFurnitureModel(item);
};

// Positioning functions moved to @/utils/arPositioningHelpers.ts
// createFurnitureBoundingBox moved to @/utils/arCollisionDetection.ts

/**
 * Find corner snapping targets
 */
const findCornerSnapTargets = (
  position: THREE.Vector3,
  roomData: RoomData | null,
  threshold: number = CONFIG.CORNER_SNAP_THRESHOLD
): { x?: number; z?: number } | null => {
  if (!roomData) return null;

  const widthMeters = unitToMeters(roomData.dimensions.width, roomData.dimensions.unit);
  const lengthMeters = unitToMeters(roomData.dimensions.length, roomData.dimensions.unit);

  const halfWidth = widthMeters / 2;
  const halfLength = lengthMeters / 2;

  const corners = [
    { x: -halfWidth, z: -halfLength }, // Front-left
    { x: halfWidth, z: -halfLength },  // Front-right
    { x: -halfWidth, z: halfLength },   // Back-left
    { x: halfWidth, z: halfLength },   // Back-right
  ];

  for (const corner of corners) {
    const distance = Math.sqrt(
      Math.pow(position.x - corner.x, 2) + Math.pow(position.z - corner.z, 2)
    );
    if (distance < threshold) {
      return { x: corner.x, z: corner.z };
    }
  }

  return null;
};

/**
 * Find edge alignment with room boundaries
 */
const findEdgeAlignmentTargets = (
  position: THREE.Vector3,
  furnitureDimensions: { width: number; length: number },
  roomData: RoomData | null,
  threshold: number = CONFIG.EDGE_SNAP_THRESHOLD
): { x?: number; z?: number } => {
  if (!roomData) return {};

  const alignments: { x?: number; z?: number } = {};
  const widthMeters = unitToMeters(roomData.dimensions.width, roomData.dimensions.unit);
  const lengthMeters = unitToMeters(roomData.dimensions.length, roomData.dimensions.unit);

  const halfWidth = widthMeters / 2;
  const halfLength = lengthMeters / 2;
  const halfFurnitureWidth = furnitureDimensions.width / 2;
  const halfFurnitureLength = furnitureDimensions.length / 2;

  // Check left edge alignment
  const leftEdge = -halfWidth + halfFurnitureWidth;
  if (Math.abs(position.x - leftEdge) < threshold) {
    alignments.x = leftEdge;
  }

  // Check right edge alignment
  const rightEdge = halfWidth - halfFurnitureWidth;
  if (Math.abs(position.x - rightEdge) < threshold) {
    alignments.x = rightEdge;
  }

  // Check front edge alignment
  const frontEdge = -halfLength + halfFurnitureLength;
  if (Math.abs(position.z - frontEdge) < threshold) {
    alignments.z = frontEdge;
  }

  // Check back edge alignment
  const backEdge = halfLength - halfFurnitureLength;
  if (Math.abs(position.z - backEdge) < threshold) {
    alignments.z = backEdge;
  }

  return alignments;
};

/**
 * Throttle function for performance optimization
 * @internal - Reserved for future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _throttle = <T extends (...args: any[]) => any,>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _timeoutId: ReturnType<typeof setTimeout> | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      _timeoutId = setTimeout(() => {
        inThrottle = false;
        _timeoutId = null;
      }, limit);
    }
  };
};

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

class ARViewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state: { hasError: boolean; error: Error | null } = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ARView] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // When hasError is true, error should be an Error instance (from getDerivedStateFromError)
      // Use direct type assertion since getDerivedStateFromError always sets error to Error
      const errorMessage = (this.state.error as Error)?.message || 'Unknown error occurred';
      return (
        <View style={errorBoundaryStyles.errorContainer}>
          <Text style={errorBoundaryStyles.errorText}>
            AR View Error: {errorMessage}
          </Text>
          <TouchableOpacity
            style={errorBoundaryStyles.retryButton}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={errorBoundaryStyles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

function ARViewScreen() {
  // Safety check must live in a wrapper component without hooks
  if (typeof THREE === 'undefined' || !THREE.WebGLRenderer) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Three.js failed to load. Please refresh.</Text>
      </View>
    );
  }

  return <ARViewScreenInner />;
}

function ARViewScreenInner() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roomDataJson?: string }>();
  const [permission, requestPermission] = useCameraPermissions();

  // Use custom hooks for state management
  const furnitureState = useARFurnitureState();
  const interactionState = useARInteractionState();
  const uiState = useARUIState();
  const measurementState = useARMeasurementState();
  const markerTracking = useARMarkerTracking();
  const arRefs = useARRefs();
  const coreState = useARCoreState();

  // Destructure for easier access
  const {
    selectedLibraryItem,
    setSelectedLibraryItem,
    selectedPlacedId,
    setSelectedPlacedId,
    selectedFurnitureIds,
    setSelectedFurnitureIds,
    multiSelectMode,
    setMultiSelectMode,
    placedFurniture,
    setPlacedFurniture,
    isPlacingFurniture,
    setIsPlacingFurniture,
    showPlacementHint,
    setShowPlacementHint,
    furnitureScale,
    setFurnitureScale,
    highlightedFurniture,
    setHighlightedFurniture,
  } = furnitureState;

  const {
    gestureState,
    setGestureState,
    isDraggingFurniture,
    setIsDraggingFurniture,
    draggedFurnitureId,
    setDraggedFurnitureId,
    dragStartPosition,
    setDragStartPosition,
    dragStartRotation,
    setDragStartRotation,
    dragRotation,
    setDragRotation,
    isRotatingFurniture,
    setIsRotatingFurniture,
    rotationStartAngle,
    setRotationStartAngle,
    rotationStartTouchAngle,
    setRotationStartTouchAngle,
    magneticSnapActive,
    setMagneticSnapActive,
    snapType,
    setSnapType,
    suggestedPositions,
    setSuggestedPositions,
    twoFingerStartRef,
    lockedScaleRef,
    lastDragUpdateRef,
    pendingDragPositionRef,
    latestDragPositionRef,
    dragGhostRef,
    alignmentLinesRef,
    constraintLinesRef,
    dimensionLabelRef,
    suggestedPositionsRef,
    suggestedPositionLabelsRef,
    dragStateUpdateTimeoutRef,
    dragStateUpdateQueue,
  } = interactionState;

  const {
    libraryPanelVisible,
    setLibraryPanelVisible,
    libraryPanelDragY,
    setLibraryPanelDragY,
    selectedCategory,
    setSelectedCategory,
    showFloor,
    setShowFloor,
    cameraMode,
    setCameraMode,
    cameraZoom,
    setCameraZoom,
    cameraRotation,
    setCameraRotation,
    statusMessageDismissed,
    setStatusMessageDismissed,
    surfaceDetectedTime,
    setSurfaceDetectedTime,
  } = uiState;

  const {
    measurementMode,
    setMeasurementMode,
    measurementPoints,
    setMeasurementPoints,
    measurementResults,
    setMeasurementResults,
    measurementLinesRef,
    measurementLabelsRef,
    measurementPointsRef,
    measurementMarkerAnimationsRef,
  } = measurementState;

  const {
    markerTrackingEnabled,
    setMarkerTrackingEnabled,
    lastMarkerPayload,
    setLastMarkerPayload,
    markerLastSeenAt,
    setMarkerLastSeenAt,
    lastMarkerUpdateRef,
    markerAnchorOffsetRef,
    markerYawRef,
    markerScaleRef,
  } = markerTracking;

  const {
    furnitureMapRef,
    obstacleMapRef,
    roomGroupRef,
    raycasterRef,
    floorPlaneRef,
    geometryPoolRef,
    materialPoolRef,
    geometryCacheRef,
    materialCacheRef,
    lastPanRef,
    touchStartRef,
    isPanningRef,
    isZoomingRef,
    isRotatingRef,
    longPressTimerRef,
    tooltipRef,
    lastHistorySaveRef,
    lastCollisionCheckRef,
    demoIntervalRef,
    demoTimeoutRef,
  } = arRefs;

  const {
    isARActive,
    setIsARActive,
    roomData,
    setRoomData,
    anchorStatus,
    setAnchorStatus,
    isInitializing,
    setIsInitializing,
    componentError,
    setComponentError,
    retryAttempts,
    setRetryAttempts,
    retryCount,
    setRetryCount,
    arUnavailable,
    setArUnavailable,
    arLimitedDismissed,
    setArLimitedDismissed,
    detectedPlanes,
    setDetectedPlanes,
    collisionWarnings,
    setCollisionWarnings,
    demoMode,
    setDemoMode,
    interactiveStats,
    setInteractiveStats,
    placementSafety,
    setPlacementSafety,
  } = coreState;

  // Plane detection state (unused but kept for compatibility)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showPlaneVisualization, _setShowPlaneVisualization] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_planeVisualizationMeshes, _setPlaneVisualizationMeshes] = useState<Map<string, THREE.Mesh>>(new Map());

  // Unused state (kept for compatibility)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showWalkingSpace, _setShowWalkingSpace] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_firstTimeUser, _setFirstTimeUser] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_tutorialCompleted, _setTutorialCompleted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [snapToGrid, _setSnapToGrid] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showDragGuides, _setShowDragGuides] = useState(true);

  const STATUS_AUTO_HIDE_DELAY = 3000; // Auto-hide after 3 seconds of surface detection

  // Use the refactored renderer hook
  const {
    onContextCreate,
    handleCanvasLayout,
    rendererReady,
    error: rendererError,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    initError: _initError,
    sceneRef,
    cameraRef,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rendererRef: _rendererRef,
    rootGroupRef,
    reticleRef,
    glLayoutRef,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    recoveryInProgress: _recoveryInProgress,
    previewGhostRef,
    reticleWorldPositionRef,
    reticleSmoothedPositionRef,
    updateReticleFromScreen,
  } = useARRenderer({
    isARActive,
    furnitureMapRef,
    roomData,
    isDraggingFurniture,
    draggedFurnitureId,
    demoMode,
    onSceneReady: () => {
      // Re-enable placement hint if an item was selected
      if (selectedLibraryItem) setShowPlacementHint(true);
    },
    setCameraMode,
    setIsARActive,
    detectedPlanes,
    isPlacingFurniture,
    selectedLibraryItemId: selectedLibraryItem,
  });

  // Unused state (kept for compatibility)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showSaveLayoutModal, _setShowSaveLayoutModal] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_layoutName, _setLayoutName] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [voiceGuidanceEnabled, _setVoiceGuidanceEnabled] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_furnitureCustomizations, _setFurnitureCustomizations] = useState<Map<string, {
    color?: string;
    material?: 'leather' | 'fabric' | 'wood' | 'metal';
    scale?: { width: number; height: number; length: number };
  }>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_roomTemplates, _setRoomTemplates] = useState<{
    id: string;
    name: string;
    type: 'living-room' | 'bedroom' | 'office' | 'kitchen' | 'dining';
    squareFootage: number;
    budgetRange: { min: number; max: number };
    furniture: { libraryId: string; position: { x: number; y: number; z: number } }[];
  }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_multiPointAnchors, _setMultiPointAnchors] = useState<{ id: string; position: THREE.Vector3; type: 'visual' | 'spatial' }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_persistentAnchors, _setPersistentAnchors] = useState<Map<string, { position: THREE.Vector3; rotation: THREE.Euler; savedAt: number }>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showTutorial, _setShowTutorial] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_tutorialStep, _setTutorialStep] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showMeasurements, _setShowMeasurements] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_selectedMeasurement, _setSelectedMeasurement] = useState<{ from: THREE.Vector3; to: THREE.Vector3 } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_showInteractiveHelp, _setShowInteractiveHelp] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_demoStep, _setDemoStep] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_demoTourActive, _setDemoTourActive] = useState(false);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Interactive tutorial steps
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _TUTORIAL_STEPS: { title: string; description: string; icon: string }[] = [
    { title: 'Welcome! 👋', description: 'Tap and drag furniture to move it around in AR space', icon: '👆' },
    { title: 'Place Furniture', description: 'Select furniture from library, then tap to place', icon: '🪑' },
    { title: 'Safety System', description: 'Watch the safety indicator - green is safe, red means collision', icon: '✅' },
    { title: 'Drag & Rotate', description: 'Tap furniture to drag, use rotate button for orientation', icon: '🔄' },
    { title: 'Measurements', description: 'Use measurement tools to check distances and areas', icon: '📏' },
  ];

  // History management
  const furnitureLibraryById = useMemo(() => {
    return FURNITURE_LIBRARY.reduce<Record<string, FurnitureLibraryItem>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, []);

  const {
    canUndo,
    canRedo,
    historyIndex,
    saveToHistory,
    undo,
    redo,
    clearHistory,
    validateHistoryState: validateHistoryStateFromHook,
  } = useARHistory(furnitureLibraryById);

  // Enhanced validateHistoryState that includes scene presence check
  const validateHistoryState = useCallback((
    state: PlacedFurnitureMeta[],
    checkScenePresence: boolean = false
  ): PlacedFurnitureMeta[] => {
    const validated = validateHistoryStateFromHook(state);

    // Additional scene presence check if requested
    if (checkScenePresence && furnitureMapRef.current) {
      return validated.filter(item => {
        const entry = furnitureMapRef.current.get(item.id);
        if (!entry) {
          console.warn(`[ARView] Furniture ${item.id} missing from scene`);
          return false;
        }
        return true;
      });
    }

    return validated;
  }, [validateHistoryStateFromHook]);

  // Performance monitoring (development only)
  usePerformanceMonitor(30);

  // Enhanced saveToHistory that includes scene presence check
  const saveToHistoryWithSceneCheck = useCallback((newState: PlacedFurnitureMeta[]) => {
    // Validate with scene presence check since we're saving current state
    const validatedState = validateHistoryState(newState, true);
    saveToHistory(validatedState);

    // Warn if validation removed items
    if (validatedState.length !== newState.length) {
      console.warn(`[ARView] History validation removed ${newState.length - validatedState.length} invalid items from history state.`);
    }
  }, [validateHistoryState, saveToHistory]);

  // Alias for convenience - use saveToHistoryWithSceneCheck for most cases
  const saveToHistoryValidated = saveToHistoryWithSceneCheck;

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    setIsInitializing(true);
    setComponentError(null);

    try {
      if (params.roomDataJson && typeof params.roomDataJson === 'string') {
        try {
          const parsed = JSON.parse(params.roomDataJson) as RoomData;
          if (parsed && parsed.dimensions) {
            setRoomData(parsed);
            enhancedSpatialMappingService.setLatestRoomData(parsed);
          } else {
            throw new Error('Invalid room data structure');
          }
        } catch (parseError) {
          console.error('Failed to parse room data from params', parseError);
          setComponentError(ERROR_MESSAGES.ROOM_DATA_PARSE_ERROR);
          Alert.alert('Error', ERROR_MESSAGES.ROOM_DATA_PARSE_ERROR, [
            {
              text: 'OK',
              onPress: () => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(tabs)');
                }
              }
            }
          ]);
        }
      } else {
        const latest = enhancedSpatialMappingService.getLatestRoomData();
        if (latest) {
          setRoomData(latest);
        }
      }
    } finally {
      setIsInitializing(false);
    }
  }, [params.roomDataJson, router]);

  useEffect(() => {
    setShowPlacementHint(Boolean(selectedLibraryItem));
    // Hide preview ghost when deselecting
    if (!selectedLibraryItem && previewGhostRef.current) {
      previewGhostRef.current.visible = false;
    }
    // Reset safety indicator when deselecting
    if (!selectedLibraryItem) {
      setPlacementSafety({
        isSafe: true,
        safetyLevel: 'safe',
        safetyScore: 100,
        reason: null,
        hasObstacleCollision: false,
        hasFurnitureCollision: false,
        hasWallCollision: false,
        isOutOfBounds: false,
        nearestObstacleDistance: null,
        nearestWallDistance: null,
        nearestFurnitureDistance: null,
        recommendations: [],
      });
    }

  }, [selectedLibraryItem, previewGhostRef]);

  // Initialize history on mount
  useEffect(() => {
    if (placedFurniture.length === 0) {
      // History is initialized by useARHistory hook
      // Just ensure we save initial empty state
      saveToHistoryWithSceneCheck([]);
    }
  }, []); // Only run once on mount

  useEffect(() => {
    if (roomData) {
      arAnchorManager.hydrateFromSpatialMapping(roomData);
      setAnchorStatus(arAnchorManager.getStatus());
    }
  }, [roomData]);

  // Initialize plane detection for furniture rendering
  useEffect(() => {
    if (!rendererReady || !isARActive) return;

    const derivePlanesFromRoomData = (data: RoomData): DetectedPlane[] => {
      const { width, length, height } = data.dimensions;
      const halfW = width / 2;
      const halfL = length / 2;
      const timestamp = data.timestamp ?? Date.now();
      const confidence = data.confidence ?? 0.6;

      const floorPoints: SpatialPoint[] =
        data.floorBoundary && data.floorBoundary.length >= 3
          ? data.floorBoundary
          : [
            { x: -halfW, y: 0, z: -halfL },
            { x: halfW, y: 0, z: -halfL },
            { x: halfW, y: 0, z: halfL },
            { x: -halfW, y: 0, z: halfL },
          ];

      const ceilingPoints: SpatialPoint[] =
        data.ceilingBoundary && data.ceilingBoundary.length >= 3
          ? data.ceilingBoundary
          : floorPoints.map((p) => ({ x: p.x, y: height, z: p.z }));

      const derived: DetectedPlane[] = [
        {
          id: 'derived-floor',
          type: 'horizontal',
          points: floorPoints,
          center: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
          area: Math.max(0.01, data.area || width * length),
          confidence,
          timestamp,
        },
        {
          id: 'derived-ceiling',
          type: 'horizontal',
          points: ceilingPoints,
          center: { x: 0, y: height, z: 0 },
          normal: { x: 0, y: -1, z: 0 },
          area: Math.max(0.01, width * length),
          confidence: Math.max(0.3, confidence - 0.1),
          timestamp,
        },
      ];

      // Walls (rectangles)
      if (data.walls && data.walls.length > 0) {
        for (const wall of data.walls) {
          const bottomA = wall.startPoint;
          const bottomB = wall.endPoint;
          const topA = { x: bottomA.x, y: height, z: bottomA.z };
          const topB = { x: bottomB.x, y: height, z: bottomB.z };

          const center: SpatialPoint = {
            x: (bottomA.x + bottomB.x) / 2,
            y: height / 2,
            z: (bottomA.z + bottomB.z) / 2,
          };

          // Approximate normals from orientation
          const normal: SpatialPoint =
            wall.orientation === 'north'
              ? { x: 0, y: 0, z: 1 }
              : wall.orientation === 'south'
                ? { x: 0, y: 0, z: -1 }
                : wall.orientation === 'east'
                  ? { x: -1, y: 0, z: 0 }
                  : { x: 1, y: 0, z: 0 };

          derived.push({
            id: `derived-wall-${wall.id}`,
            type: 'vertical',
            points: [bottomA, bottomB, topB, topA],
            center,
            normal,
            area: Math.max(0.01, wall.length * height),
            confidence: Math.max(0.3, confidence - 0.05),
            timestamp,
          });
        }
      }

      return derived;
    };

    const getExtentFromPlane = (plane: DetectedPlane): { width: number; length: number } => {
      const fallback = Math.sqrt(Math.max(plane.area || 1, 1));
      const pts = plane.points ?? [];
      if (pts.length < 2) {
        return { width: fallback, length: fallback };
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;

      for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }

      const spanX = Math.max(0.01, maxX - minX);
      const spanY = Math.max(0.01, maxY - minY);
      const spanZ = Math.max(0.01, maxZ - minZ);

      if (plane.type === 'horizontal') {
        return { width: spanX || fallback, length: spanZ || fallback };
      }

      // Vertical: width on horizontal axis, "length" treated as height for visualization/layout
      const horizontalSpan = Math.max(spanX, spanZ);
      return { width: horizontalSpan || fallback, length: spanY || fallback };
    };

    // Plane detection initialization disabled - planes work internally but are not visualized
    // This preserves the clean scanning experience without visual plane projections
    // Note: Plane detection still works for collision detection, just not visually displayed

    // Plane detection disabled - no visual plane projection to preserve clean scanning experience
    // Planes are still detected internally for collision detection but not visualized
    // This prevents plane projections from ruining the AR scanning experience

    // Keep planes empty to prevent any visualization
    setDetectedPlanes([]);

    return () => {
      // No interval to clear
    };
  }, [rendererReady, isARActive, roomData]);

  useEffect(() => {
    if (!isARActive) {
      if (reticleRef.current) {
        reticleRef.current.visible = false;
      }
      // Reset status message visibility when AR is deactivated
      setStatusMessageDismissed(false);
      setSurfaceDetectedTime(null);
      return;
    }

    const interval = setInterval(() => {
      try {
        const newStatus = arAnchorManager.getStatus();
        setAnchorStatus(newStatus);

        // Track when surface is first detected
        if (newStatus.hasLock && surfaceDetectedTime === null) {
          setSurfaceDetectedTime(Date.now());
        } else if (!newStatus.hasLock) {
          // Reset if surface is lost
          setSurfaceDetectedTime(null);
          setStatusMessageDismissed(false);
        }
      } catch (error) {
        console.error('[ARView] Error updating anchor status:', error);
        setComponentError(ERROR_MESSAGES.ANCHOR_ERROR);
      }
    }, CONFIG.ANCHOR_UPDATE_INTERVAL);

    return () => clearInterval(interval);

  }, [isARActive, surfaceDetectedTime, reticleRef]);

  // Auto-hide status message after surface is detected
  useEffect(() => {
    if (surfaceDetectedTime !== null && !statusMessageDismissed) {
      const timer = setTimeout(() => {
        setStatusMessageDismissed(true);
      }, STATUS_AUTO_HIDE_DELAY);

      return () => clearTimeout(timer);
    }
  }, [surfaceDetectedTime, statusMessageDismissed]);


  /**
   * Web Workers: Offload collision detection to worker thread
   * Structure for future implementation (React Native doesn't support Web Workers directly)
   * This would be implemented using a native module or background task
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _performCollisionDetectionInWorker = useCallback(async (
    furniturePositions: { id: string; position: THREE.Vector3; dimensions: { width: number; height: number; length: number } }[],
    obstacles: { position: THREE.Vector3; dimensions: { width: number; height: number; length: number } }[]
  ): Promise<Set<string>> => {
    // In a full implementation, this would offload to a Web Worker
    // For now, we perform collision detection on main thread but structure is ready
    const collisions = new Set<string>();

    // Perform collision detection (simplified - full implementation would use spatial partitioning)
    for (let i = 0; i < furniturePositions.length; i++) {
      const furniture1 = furniturePositions[i];
      const box1 = new THREE.Box3().setFromCenterAndSize(
        furniture1.position,
        new THREE.Vector3(furniture1.dimensions.width, furniture1.dimensions.height, furniture1.dimensions.length)
      );

      // Check against other furniture
      for (let j = i + 1; j < furniturePositions.length; j++) {
        const furniture2 = furniturePositions[j];
        const box2 = new THREE.Box3().setFromCenterAndSize(
          furniture2.position,
          new THREE.Vector3(furniture2.dimensions.width, furniture2.dimensions.height, furniture2.dimensions.length)
        );

        if (box1.intersectsBox(box2)) {
          collisions.add(furniture1.id);
          collisions.add(furniture2.id);
        }
      }

      // Check against obstacles
      for (const obstacle of obstacles) {
        const obstacleBox = new THREE.Box3().setFromCenterAndSize(
          obstacle.position,
          new THREE.Vector3(obstacle.dimensions.width, obstacle.dimensions.height, obstacle.dimensions.length)
        );

        if (box1.intersectsBox(obstacleBox)) {
          collisions.add(furniture1.id);
        }
      }
    }

    return collisions;
  }, []);


  /**
   * Batch state updates for drag operations using a queue to prevent race conditions
   * Uses requestAnimationFrame to process all pending updates atomically
   * This prevents lost updates when multiple state changes happen rapidly
   */
  const updateDragState = useCallback((updates: {
    safety?: typeof placementSafety;
    magneticSnap?: boolean;
    snapType?: typeof snapType;
  }) => {
    // Use a queue to prevent lost updates
    const pendingUpdates = dragStateUpdateQueue.current;
    pendingUpdates.push(updates);

    if (dragStateUpdateTimeoutRef.current !== null) {
      return; // Already scheduled
    }

    dragStateUpdateTimeoutRef.current = requestAnimationFrame(() => {
      try {
        // Process all pending updates atomically
        const allUpdates = pendingUpdates.reduce((acc, update) => ({
          ...acc,
          ...update
        }), {});

        // Use startTransition to mark these as non-urgent updates, reducing re-renders
        startTransition(() => {
          if (allUpdates.safety) setPlacementSafety(allUpdates.safety);
          if (allUpdates.magneticSnap !== undefined) setMagneticSnapActive(allUpdates.magneticSnap);
          if (allUpdates.snapType !== undefined) setSnapType(allUpdates.snapType);
        });
      } catch (error) {
        console.error('[ARView] Error processing drag state updates:', error);
      } finally {
        // Always clear the queue, even if there was an error
        pendingUpdates.length = 0;
        dragStateUpdateTimeoutRef.current = null;
      }
    });
  }, []);

  // updatePreviewGhost and updateReticleFromScreen migrated to useARRenderer hook


  const cleanupCaches = useCallback(() => {

    // Clean up geometry cache if it exceeds limit
    if (geometryCacheRef.current.size > MAX_CACHE_SIZE) {
      const entries = Array.from(geometryCacheRef.current.entries());
      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      toRemove.forEach(([key, geometry]) => {
        geometry.dispose();
        geometryCacheRef.current.delete(key);
      });
    }

    // Clean up material cache if it exceeds limit
    if (materialCacheRef.current.size > MAX_CACHE_SIZE) {
      const entries = Array.from(materialCacheRef.current.entries());
      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      toRemove.forEach(([key, material]) => {
        material.dispose();
        materialCacheRef.current.delete(key);
      });
    }

    // Geometry pools
    geometryPoolRef.current.forEach((pool, key) => {
      if (pool.length > MAX_POOL_SIZE) {
        const excess = pool.splice(MAX_POOL_SIZE);
        excess.forEach(geom => geom.dispose());
      }
    });

    // Material pools
    materialPoolRef.current.forEach((pool, key) => {
      if (pool.length > MAX_POOL_SIZE) {
        const excess = pool.splice(MAX_POOL_SIZE);
        excess.forEach(material => material.dispose());
      }
    });

    // Remove empty pools
    Array.from(geometryPoolRef.current.entries()).forEach(([key, pool]) => {
      if (pool.length === 0) {
        geometryPoolRef.current.delete(key);
      }
    });

    Array.from(materialPoolRef.current.entries()).forEach(([key, pool]) => {
      if (pool.length === 0) {
        materialPoolRef.current.delete(key);
      }
    });
  }, []);

  const resetFurnitureMeshes = useCallback(() => {
    furnitureMapRef.current.forEach(({ mesh }) => {
      rootGroupRef.current?.remove(mesh);

      // Dispose of all geometries and materials in the group
      // Groups contain children (meshes) that have geometry and material
      if (mesh instanceof THREE.Mesh) {
        // Handle Mesh objects directly
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat: THREE.Material) => mat.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      } else if (mesh instanceof THREE.Group) {
        // Handle Group objects by traversing children
        mesh.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            if (child.geometry) {
              child.geometry.dispose();
            }
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((mat: THREE.Material) => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
      } else {
        // Handle other Object3D types using disposeMesh helper
        // This ensures all types are properly disposed
        disposeMesh(mesh);
      }
    });
    furnitureMapRef.current.clear();

    // Clear preview ghost
    if (previewGhostRef.current) {
      rootGroupRef.current?.remove(previewGhostRef.current);
      disposeObjectRecursive(previewGhostRef.current);
      previewGhostRef.current = null;
    }

    // Clean up caches after clearing furniture
    cleanupCaches();

    setPlacedFurniture([]);
    setSelectedPlacedId(null);
    clearHistory();
    setCollisionWarnings(new Set());
  }, [cleanupCaches]);

  // Note: Obstacles are managed separately and persist across furniture resets

  const updateRoomLayout = useCallback((data: RoomData) => {
    if (!sceneRef.current || !rootGroupRef.current) {
      return;
    }

    // Dispose of existing room layout
    if (roomGroupRef.current) {
      rootGroupRef.current.remove(roomGroupRef.current);
      roomLayoutService.disposeRoomLayout(roomGroupRef.current);
      roomGroupRef.current = null;
    }

    // Clear existing obstacles
    obstacleMapRef.current.forEach((mesh) => {
      disposeMesh(mesh);
    });
    obstacleMapRef.current.clear();

    // Build room layout using service
    const result = roomLayoutService.buildRoomLayout(
      data,
      rootGroupRef.current,
      cameraRef,
      showFloor
    );

    roomGroupRef.current = result.roomGroup;

    // Update obstacle map
    result.obstacleMap.forEach((mesh, id) => {
      obstacleMapRef.current.set(id, mesh);
    });

    // Update camera position if provided
    if (result.cameraPosition && result.cameraLookAt && cameraRef.current) {
      cameraRef.current.position.copy(result.cameraPosition);
      cameraRef.current.lookAt(result.cameraLookAt);
    }
  }, [showFloor]);

  useEffect(() => {
    if (rendererReady && roomData) {
      updateRoomLayout(roomData);
    }
  }, [rendererReady, roomData, updateRoomLayout]);

  // Control floor visibility based on showFloor state
  useEffect(() => {
    if (!roomGroupRef.current) return;
    roomLayoutService.updateFloorVisibility(roomGroupRef.current, showFloor);
  }, [showFloor]);

  // Ensure floor stays hidden when furniture is placed
  useEffect(() => {
    if (placedFurniture.length > 0 && showFloor) {
      setShowFloor(false);
    }
  }, [placedFurniture.length, showFloor]);

  // Camera controls for preview mode (pan, zoom, orbit)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _cameraPanResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => !isDraggingFurniture && cameraMode === 'preview',
      onMoveShouldSetPanResponder: () => !isDraggingFurniture && cameraMode === 'preview',
      onPanResponderGrant: (evt) => {
        if (cameraMode !== 'preview') return;
        const touches = evt.nativeEvent.touches;
        if (touches.length === 1) {
          isPanningRef.current = true;
          lastPanRef.current = { x: touches[0].pageX, y: touches[0].pageY };
        } else if (touches.length === 2) {
          isZoomingRef.current = true;
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);
          touchStartRef.current = {
            distance,
            angle,
            touches: [{ x: touches[0].pageX, y: touches[0].pageY }, { x: touches[1].pageX, y: touches[1].pageY }]
          };
        }
      },
      onPanResponderMove: (evt) => {
        if (cameraMode !== 'preview' || !cameraRef.current) return;
        const touches = evt.nativeEvent.touches;

        if (touches.length === 1 && isPanningRef.current && lastPanRef.current) {
          // Single finger - orbit camera
          const deltaX = (touches[0].pageX - lastPanRef.current.x) * 0.01;
          const deltaY = (touches[0].pageY - lastPanRef.current.y) * 0.01;

          setCameraRotation(prev => ({
            x: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, prev.x - deltaY)),
            y: prev.y + deltaX,
          }));

          lastPanRef.current = { x: touches[0].pageX, y: touches[0].pageY };
        } else if (touches.length === 2 && touchStartRef.current) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);
          const angleDelta = angle - touchStartRef.current.angle;

          // Pinch to scale furniture (if furniture is selected) - ONLY in PINCH_OR_ROTATE_TWO_FINGERS state
          // NEVER scale during single-finger drag
          if (selectedPlacedId && isARActive && gestureState === 'PINCH_OR_ROTATE_TWO_FINGERS' && !isDraggingFurniture) {
            const scaleDelta = (distance - touchStartRef.current.distance) * 0.01;
            const currentScale = furnitureScale[selectedPlacedId] || 1.0;
            const newScale = Math.max(0.5, Math.min(2.0, currentScale + scaleDelta));
            setFurnitureScale(prev => ({ ...prev, [selectedPlacedId]: newScale }));
            const furnitureEntry = furnitureMapRef.current.get(selectedPlacedId);
            if (furnitureEntry?.mesh) {
              furnitureEntry.mesh.scale.setScalar(newScale);
              // Update locked scale ref when explicitly scaling
              lockedScaleRef.current.set(selectedPlacedId, newScale);
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
          } else if (cameraMode === 'preview' && isZoomingRef.current) {
            // Two fingers - pinch to zoom camera
            const zoomDelta = (touchStartRef.current.distance - distance) * 0.01;
            setCameraZoom(prev => Math.max(0.5, Math.min(3.0, prev + zoomDelta)));
          }

          // Two-finger rotate furniture
          if (selectedPlacedId && isARActive && Math.abs(angleDelta) > 0.1) {
            isRotatingRef.current = true;
            const furnitureEntry = furnitureMapRef.current.get(selectedPlacedId);
            if (furnitureEntry?.mesh) {
              furnitureEntry.mesh.rotation.y += angleDelta;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
            }
          }

          touchStartRef.current = {
            distance,
            angle,
            touches: [{ x: touches[0].pageX, y: touches[0].pageY }, { x: touches[1].pageX, y: touches[1].pageY }]
          };
        }
      },
      onPanResponderRelease: (evt) => {
        // Swipe to delete: detect left swipe gesture
        if (selectedPlacedId && isARActive && !isDraggingFurniture) {
          const touches = evt.nativeEvent.changedTouches;
          if (touches.length === 1) {
            const touch = touches[0];
            const startTouch = touchStartRef.current?.touches?.[0];
            if (startTouch) {
              const swipeDistance = touch.pageX - startTouch.x;
              const swipeSpeed = Math.abs(swipeDistance) / (evt.nativeEvent.timestamp - (evt.nativeEvent.timestamp || Date.now()));

              // Detect left swipe (swipe to delete)
              if (swipeDistance < -100 && swipeSpeed > 0.5) {
                Alert.alert(
                  'Delete Furniture',
                  'Are you sure you want to delete this furniture?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        const entry = furnitureMapRef.current.get(selectedPlacedId);
                        if (entry && rootGroupRef.current) {
                          rootGroupRef.current.remove(entry.mesh);
                          if (entry.mesh instanceof THREE.Group) {
                            disposeObjectRecursive(entry.mesh);
                          } else {
                            disposeMesh(entry.mesh);
                          }
                          furnitureMapRef.current.delete(selectedPlacedId);
                          setPlacedFurniture(prev => prev.filter(f => f.id !== selectedPlacedId));
                          setSelectedPlacedId(null);
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
                        }
                      }
                    }
                  ]
                );
              }
            }
          }
        }

        isPanningRef.current = false;
        isZoomingRef.current = false;
        isRotatingRef.current = false;
        lastPanRef.current = null;
        touchStartRef.current = null;
      },
    }),
    [isDraggingFurniture, cameraMode, selectedPlacedId, furnitureScale, isARActive, gestureState]
  );

  // Update camera position/rotation in preview mode
  useEffect(() => {
    if (!cameraRef.current || cameraMode !== 'preview') return;

    const camera = cameraRef.current;
    const radius = 5 * cameraZoom;
    const x = Math.sin(cameraRotation.y) * Math.cos(cameraRotation.x) * radius;
    const y = Math.sin(cameraRotation.x) * radius + 1.6;
    const z = Math.cos(cameraRotation.y) * Math.cos(cameraRotation.x) * radius;

    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);

  }, [cameraMode, cameraZoom, cameraRotation, cameraRef]);

  // Visual highlight for selected furniture (multi-select)
  useEffect(() => {
    if (!rootGroupRef.current) return;

    furnitureMapRef.current.forEach((entry, id) => {
      const isSelected = selectedFurnitureIds.has(id);
      const updateMeshEmissive = (mesh: THREE.Mesh | THREE.Group, hex: number, intensity: number) => {
        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.emissive.setHex(hex);
          mesh.material.emissiveIntensity = intensity;
        } else if (mesh instanceof THREE.Group) {
          mesh.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
              child.material.emissive.setHex(hex);
              child.material.emissiveIntensity = intensity;
            }
          });
        }
      };

      if (entry.mesh instanceof THREE.Mesh && entry.mesh.material instanceof THREE.MeshStandardMaterial) {
        if (isSelected) {
          // Highlight selected furniture with blue glow
          entry.mesh.material.emissive.setHex(0x3b82f6);
          entry.mesh.material.emissiveIntensity = 0.4;
        } else if (id === highlightedFurniture) {
          // Keep highlight animation for newly placed furniture
          entry.mesh.material.emissive.setHex(0xffffff);
          entry.mesh.material.emissiveIntensity = 0.5;
        } else if (id === selectedPlacedId) {
          // CRITICAL: Individual object selection highlight
          // Only THIS specific furniture item is highlighted, not groups
          entry.mesh.material.emissive.setHex(0x5ac8fa);
          entry.mesh.material.emissiveIntensity = 0.3;
          // Update individual object's selection state
          if (entry.mesh.userData) {
            entry.mesh.userData.isSelected = true;
          }
        } else {
          // Reset to normal
          const colorValue = entry.item.color || '#808080';
          const baseColor = new THREE.Color(colorValue);
          entry.mesh.material.emissive.copy(baseColor.clone().multiplyScalar(0.05));
          entry.mesh.material.emissiveIntensity = 0.05;
        }
      } else if (entry.mesh instanceof THREE.Group) {
        // Handle Group meshes
        if (isSelected) {
          updateMeshEmissive(entry.mesh, 0x3b82f6, 0.4);
        } else if (id === highlightedFurniture) {
          updateMeshEmissive(entry.mesh, 0xffffff, 0.5);
        } else if (id === selectedPlacedId) {
          updateMeshEmissive(entry.mesh, 0x5ac8fa, 0.3);
          if (entry.mesh.userData) {
            entry.mesh.userData.isSelected = true;
          }
        } else {
          const colorValue = entry.item.color || '#808080';
          const baseColor = new THREE.Color(colorValue);
          updateMeshEmissive(entry.mesh, baseColor.getHex(), 0.05);
        }
      }
    });
  }, [selectedFurnitureIds, selectedPlacedId, highlightedFurniture]);


  // Error recovery helper functions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleErrorRecovery = useCallback((
    errorInfo: ARInitError,
    onRetry: () => void
  ): void => {
    switch (errorInfo.type) {
      case 'webgl_context':
        // WebGL context recovery - attempt to recreate context
        console.log('[ARView] Attempting WebGL context recovery...');
        // If fallback mode is available, use it after max retries
        if (errorInfo.fallbackMode === 'preview') {
          const errorKey = errorInfo.type;
          const currentRetries = retryAttempts.get(errorKey) || 0;
          if (currentRetries >= errorInfo.maxRetries) {
            // Fallback to preview mode
            setIsARActive(false);
            setCameraMode('preview');
            setComponentError('AR mode unavailable. Using 2D preview mode instead.');
            Alert.alert(
              'Switched to Preview Mode',
              'AR features are currently unavailable. You can still view and arrange furniture in 2D preview mode.',
              [{ text: 'OK', style: 'default' }]
            );
            return;
          }
        }
        onRetry();
        break;

      case 'renderer_init':
        // Renderer initialization recovery
        console.log('[ARView] Attempting renderer recovery...');
        if (errorInfo.fallbackMode === 'preview') {
          const errorKey = errorInfo.type;
          const currentRetries = retryAttempts.get(errorKey) || 0;
          if (currentRetries >= errorInfo.maxRetries) {
            // Fallback to preview mode
            setIsARActive(false);
            setCameraMode('preview');
            setComponentError('AR mode unavailable. Using 2D preview mode instead.');
            Alert.alert(
              'Switched to Preview Mode',
              'AR features are currently unavailable. You can still view and arrange furniture in 2D preview mode.',
              [{ text: 'OK', style: 'default' }]
            );
            return;
          }
        }
        onRetry();
        break;

      case 'invalid_context_dimensions':
        // Context dimension recovery - wait for valid dimensions
        console.log('[ARView] Waiting for valid context dimensions...');
        // Retry after a short delay
        setTimeout(() => onRetry(), 500);
        break;

      case 'lighting_init':
        // Lighting can fail gracefully - continue without full lighting
        console.log('[ARView] Using fallback lighting configuration...');
        onRetry();
        break;

      case 'memory_limit':
        // Memory recovery - reduce quality settings
        console.log('[ARView] Reducing quality settings due to memory constraints...');
        onRetry();
        break;

      default:
        // Generic retry
        onRetry();
    }
  }, [retryAttempts]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _showErrorRecoveryOptions = useCallback((
    errorInfo: ARInitError,
    maxRetriesReached: boolean = false
  ): void => {
    const buttons: { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }[] = [];

    // Add retry button if error is retryable and max retries not reached
    if (errorInfo.retryable && !maxRetriesReached) {
      buttons.push({
        text: 'Retry',
        onPress: () => {
          // Reset retry attempts for this error type
          setRetryAttempts(prev => {
            const newMap = new Map(prev);
            newMap.delete(errorInfo.type);
            return newMap;
          });
          // Note: rendererReady and recoveryInProgress are managed internally by useARRenderer
        },
      });
    }

    // Add fallback mode button if available
    if (errorInfo.fallbackMode) {
      const fallbackText = errorInfo.fallbackMode === 'preview' ? 'Use Preview Mode' : 'Use Minimal Mode';
      buttons.push({
        text: fallbackText,
        onPress: () => {
          if (errorInfo.fallbackMode === 'preview') {
            setCameraMode('preview');
            setIsARActive(false);
            AccessibilityInfo.announceForAccessibility('Switched to preview mode');
          }
          // Note: initError and recoveryInProgress are managed internally by useARRenderer
          setComponentError(null);
        },
      });
    }

    // Add cancel button
    buttons.push({
      text: 'OK',
      style: 'cancel',
    });

    Alert.alert(
      maxRetriesReached ? 'Initialization Failed' : 'Initialization Error',
      maxRetriesReached
        ? `${errorInfo.userMessage}\n\nMax retry attempts reached. ${errorInfo.recoveryHint}`
        : `${errorInfo.userMessage}\n\n${errorInfo.recoveryHint}`,
      buttons
    );
  }, []);


  // COLLISION_CHECK_THROTTLE constant (lastCollisionCheckRef is declared earlier)
  const COLLISION_CHECK_THROTTLE = 100; // Only check collisions every 100ms

  const checkCollisions = useCallback((newMesh: THREE.Mesh | THREE.Group, newId: string) => {
    // Throttle collision checks for performance
    const now = Date.now();
    if (now - lastCollisionCheckRef.current < COLLISION_CHECK_THROTTLE) {
      return; // Skip this check, too soon since last one
    }
    lastCollisionCheckRef.current = now;

    const warnings = new Set<string>();
    const newBox = new THREE.Box3().setFromObject(newMesh);

    // Check collisions with other furniture (optimized, using margin)
    const hasFurnitureCollision = checkFurnitureCollisions(
      newBox,
      furnitureMapRef.current,
      newId,
      CONFIG.COLLISION_MARGIN
    );
    if (hasFurnitureCollision) {
      warnings.add(newId);

      // Visual feedback: make colliding mesh pulse red
      if (newMesh instanceof THREE.Mesh) {
        const newMaterial = newMesh.material instanceof THREE.MeshStandardMaterial
          ? newMesh.material
          : Array.isArray(newMesh.material) && newMesh.material[0] instanceof THREE.MeshStandardMaterial
            ? newMesh.material[0]
            : null;
        if (newMaterial && newMaterial.color) {
          const originalColor = newMaterial.color.clone();
          newMaterial.color.setHex(0xff0000);
          setTimeout(() => {
            if (newMaterial && newMaterial.color) {
              newMaterial.color.copy(originalColor);
            }
          }, 1000);
        }
      } else if (newMesh instanceof THREE.Group) {
        // Handle Group meshes
        newMesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            const originalColor = child.material.color.clone();
            child.material.color.setHex(0xff0000);
            setTimeout(() => {
              if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
                child.material.color.copy(originalColor);
              }
            }, 1000);
          }
        });
      }
    }

    // Check collisions with obstacles - CRITICAL for accurate detection (optimized, using margin)
    const hasObstacleCollision = checkObstacleCollisions(
      newBox,
      obstacleMapRef.current,
      CONFIG.COLLISION_MARGIN
    );
    if (hasObstacleCollision) {
      warnings.add(newId);

      // Visual feedback: make colliding furniture pulse red
      // Visual feedback: make colliding furniture pulse red
      if (newMesh instanceof THREE.Mesh) {
        const newMaterial = newMesh.material as THREE.MeshStandardMaterial;
        if (newMaterial && !Array.isArray(newMaterial) && newMaterial.color) {
          const originalColor = newMaterial.color.clone();
          newMaterial.color.setHex(0xff0000);
          setTimeout(() => {
            if (newMaterial) {
              newMaterial.color.copy(originalColor);
            }
          }, 1000);
        }
      }

      // Highlight obstacles that are being collided with
      obstacleMapRef.current.forEach((obstacleMesh) => {
        const obstacleBox = new THREE.Box3().setFromObject(obstacleMesh);
        if (newBox.intersectsBox(obstacleBox)) {
          const obstacleMaterial = obstacleMesh.material as THREE.MeshStandardMaterial;
          if (obstacleMaterial) {
            const obstacleOriginalColor = obstacleMaterial.color.clone();
            obstacleMaterial.color.setHex(0xff6600); // Orange warning color
            obstacleMaterial.opacity = 1.0;
            setTimeout(() => {
              if (obstacleMaterial) {
                obstacleMaterial.color.copy(obstacleOriginalColor);
                obstacleMaterial.opacity = 0.85;
              }
            }, 1500);
          }
        }
      });
    }

    if (warnings.size > 0) {
      setCollisionWarnings(warnings);
      setTimeout(() => setCollisionWarnings(new Set()), CONFIG.COLLISION_WARNING_TIMEOUT);
      // Haptic feedback for collision
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {
        // Haptics not available, ignore
      });
    }
  }, []);

  /**
   * Adds furniture to the AR scene at the specified world position
   * Handles collision detection, safety checks, and visual feedback
   * @param worldPosition - 3D position where furniture should be placed
   */
  const addFurnitureToScene = useCallback(
    async (worldPosition: THREE.Vector3) => {
      if (!selectedLibraryItem || !rootGroupRef.current) {
        return;
      }

      setIsPlacingFurniture(true);
      setComponentError(null);

      try {
        const libraryItem = furnitureLibraryById[selectedLibraryItem];
        if (!libraryItem) {
          console.error('[ARView] Library item not found:', selectedLibraryItem);
          console.log('[ARView] Available items:', Object.keys(furnitureLibraryById));
          return;
        }

        // Verify library item has required properties
        if (!libraryItem.dimensions || !libraryItem.category) {
          console.error('[ARView] Library item missing required properties:', libraryItem);
          return;
        }

        console.log('[ARView] Creating furniture model for:', libraryItem.name, 'Category:', libraryItem.category);

        // Align position to floor for accurate placement
        let alignedPosition = alignToFloor(worldPosition);

        // Pre-check for collisions before placing (optimized)
        let tempBox = createFurnitureBoundingBox(alignedPosition, libraryItem.dimensions);

        // Check obstacles first (optimized with early exit, using margin)
        const hasObstacleCollision = checkObstacleCollisions(
          tempBox,
          obstacleMapRef.current,
          CONFIG.COLLISION_MARGIN
        );

        // Check existing furniture (optimized with early exit, using margin)
        const hasFurnitureCollision = checkFurnitureCollisions(
          tempBox,
          furnitureMapRef.current,
          undefined,
          CONFIG.COLLISION_MARGIN
        );

        // Get enhanced detailed safety information before placement
        let safetyInfo = getPlacementSafety(
          tempBox,
          obstacleMapRef.current,
          furnitureMapRef.current,
          roomData,
          undefined,
          CONFIG.COLLISION_MARGIN
        );

        // Enhanced collision response: suggest alternatives or auto-correct
        if (safetyInfo.safetyLevel === 'danger') {
          // Try automatic position correction
          const correctedPosition = autoCorrectPosition(
            alignedPosition,
            libraryItem.dimensions,
            roomData,
            obstacleMapRef.current,
            furnitureMapRef.current
          );

          if (correctedPosition) {
            // Auto-correct to safe position
            alignedPosition = correctedPosition;
            tempBox = createFurnitureBoundingBox(correctedPosition, libraryItem.dimensions);
            safetyInfo = getPlacementSafety(
              tempBox,
              obstacleMapRef.current,
              furnitureMapRef.current,
              roomData,
              undefined,
              CONFIG.COLLISION_MARGIN
            );

            if (safetyInfo.safetyLevel === 'safe') {
              // Show notification that position was auto-corrected
              Alert.alert(
                'Position Adjusted',
                'Furniture position was automatically adjusted to avoid collision.',
                [{ text: 'OK' }]
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
            }
          } else {
            // Generate suggested positions
            const suggestions = suggestAlternativePositions(
              alignedPosition,
              libraryItem.dimensions,
              roomData,
              obstacleMapRef.current,
              furnitureMapRef.current,
              undefined,
              3
            );

            if (suggestions.length > 0) {
              setSuggestedPositions(suggestions);
              Alert.alert(
                'Collision Detected',
                `Cannot place here. ${suggestions.length} alternative position(s) suggested. Tap on a suggestion to place there.`,
                [
                  {
                    text: 'Cancel', style: 'cancel', onPress: () => {
                      setSuggestedPositions([]);
                      // State will be reset in finally block
                    }
                  },
                  ...suggestions.map((pos: THREE.Vector3, idx: number) => ({
                    text: `Use Position ${idx + 1}`,
                    onPress: () => {
                      // Recursively call with suggested position
                      addFurnitureToScene(pos);
                      setSuggestedPositions([]);
                    },
                  })),
                ]
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => { });
              return;
            } else {
              // No suggestions available, show error
              const errorMessage = safetyInfo.reason || 'Cannot place furniture here - collision detected!';
              setComponentError(errorMessage);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => { });
              return;
            }
          }
        }

        // Haptic feedback for successful placement
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
          // Haptics not available, ignore
        });

        // Screen reader announcement for successful placement with detailed information
        const placementAnnouncement = `Furniture ${libraryItem.name} placed successfully. Safety score: ${safetyInfo.safetyScore} percent. Position: ${alignedPosition.x.toFixed(1)} meters by ${alignedPosition.z.toFixed(1)} meters.`;
        AccessibilityInfo.announceForAccessibility(placementAnnouncement);

        // Voice guidance for placement
        if (voiceGuidanceEnabled) {
          const guidanceMessage = `Placed ${libraryItem.name}. Dimensions: ${libraryItem.dimensions.width.toFixed(1)} by ${libraryItem.dimensions.length.toFixed(1)} meters. Safety score: ${safetyInfo.safetyScore} percent.`;
          AccessibilityInfo.announceForAccessibility(guidanceMessage);
        }

        const meshId = `${libraryItem.id}-${Date.now()}`;

        // Create detailed 3D furniture model (falls back to placeholder if model unavailable)
        console.log('[ARView] Calling createDetailedFurnitureModel for:', libraryItem.name, 'Category:', libraryItem.category);
        const furnitureGroup = await createDetailedFurnitureModel(libraryItem);
        console.log('[ARView] Furniture group created. Children count:', furnitureGroup.children.length);

        // Enable shadows on all meshes in the group and ensure visibility
        furnitureGroup.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.visible = true; // Ensure all meshes are visible
            // Ensure materials are properly configured
            if (child.material instanceof THREE.MeshStandardMaterial) {
              child.material.needsUpdate = true;
            }
          }
        });

        // Ensure the group itself is visible and properly configured
        furnitureGroup.visible = true;
        furnitureGroup.matrixAutoUpdate = true; // Ensure matrix updates automatically

        // Force update matrix to ensure proper rendering
        furnitureGroup.updateMatrix();
        furnitureGroup.updateMatrixWorld(true);

        // Position the furniture group - ensure it's on the floor
        const finalY = alignedPosition.y + libraryItem.dimensions.height / 2;
        furnitureGroup.position.set(
          alignedPosition.x,
          finalY,
          alignedPosition.z
        );

        // Force matrix update to ensure proper rendering
        furnitureGroup.updateMatrix();
        furnitureGroup.updateMatrixWorld(true);

        // Debug: Log position and visibility
        console.log(`[ARView] Furniture positioned at:`, {
          x: alignedPosition.x.toFixed(2),
          y: finalY.toFixed(2),
          z: alignedPosition.z.toFixed(2),
          visible: furnitureGroup.visible,
          children: furnitureGroup.children.length,
          name: libraryItem.name
        });

        // Use the group directly (not wrapped in an empty mesh)
        // The group itself can be used for collision detection and rendering

        // Add ground shadow under furniture for better depth perception
        // Use a more subtle shadow that blends with the floor
        const shadowSize = Math.max(libraryItem.dimensions.width, libraryItem.dimensions.length) * 0.7;
        const shadowGeometry = new THREE.CircleGeometry(shadowSize, 16);
        const shadowMaterial = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.2, // Reduced opacity for more subtle shadow
          side: THREE.DoubleSide,
          depthWrite: false, // Prevent z-fighting with floor
        });
        const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -libraryItem.dimensions.height / 2 + 0.005; // Slightly lower to avoid z-fighting
        shadow.renderOrder = -1; // Render before furniture to avoid issues
        shadow.visible = true; // Ensure shadow is visible
        furnitureGroup.add(shadow);

        // Color-code furniture based on safety level (update materials in group)
        if (safetyInfo.safetyLevel === 'danger') {
          furnitureGroup.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
              child.material.color.setHex(0xff0000); // Red for danger
            }
          });
        } else if (safetyInfo.safetyLevel === 'warning') {
          furnitureGroup.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
              child.material.color.setHex(0xffaa00); // Yellow for warning
            }
          });
        }

        // Calculate physics properties based on furniture dimensions
        const volume = libraryItem.dimensions.width * libraryItem.dimensions.height * libraryItem.dimensions.length;
        const physics: FurniturePhysics = {
          mass: volume * 50, // Mass proportional to volume (kg per cubic meter)
          friction: 0.6, // Standard friction coefficient
          enableGravity: true,
        };

        // Position is already set above (line 4947-4951), no need to set again
        // Furniture is already positioned correctly on the floor at finalY

        // Store metadata in userData
        furnitureGroup.userData = {
          type: 'furniture',
          id: meshId,
          libraryId: libraryItem.id,
          physics: physics, // Store physics properties
        };

        // Frustum culling optimization
        furnitureGroup.frustumCulled = true;

        // Store LOD level in userData for dynamic updates (but don't replace geometry)
        const initialDistance = cameraRef.current
          ? alignedPosition.distanceTo(cameraRef.current.position)
          : 5;
        const initialLod = initialDistance > 10 ? 'low' : initialDistance > 5 ? 'medium' : 'high';
        furnitureGroup.userData.lodLevel = initialLod;

        // Ensure furniture group is properly configured before adding to scene
        furnitureGroup.updateMatrixWorld(true); // Update matrix to ensure proper rendering

        // Add the furniture group directly to the scene
        if (rootGroupRef.current && sceneRef.current) {
          rootGroupRef.current.add(furnitureGroup);

          // Force scene update to ensure furniture is rendered
          sceneRef.current.updateMatrixWorld(true);

          // Verify furniture is properly added and visible
          console.log(`[ARView] ✓ Placed ${libraryItem.name} at (${alignedPosition.x.toFixed(2)}, ${finalY.toFixed(2)}, ${alignedPosition.z.toFixed(2)})`);
          console.log(`[ARView] ✓ Group has ${furnitureGroup.children.length} children, visible: ${furnitureGroup.visible}`);
          console.log(`[ARView] ✓ Root group children: ${rootGroupRef.current.children.length}, Scene children: ${sceneRef.current.children.length}`);

          // Ensure camera can see the furniture (adjust if needed)
          if (cameraRef.current) {
            const distance = furnitureGroup.position.distanceTo(cameraRef.current.position);
            console.log(`[ARView] ✓ Camera distance to furniture: ${distance.toFixed(2)}m`);

            // If furniture is too far or camera is not looking at it, log a warning
            if (distance > 20) {
              console.warn(`[ARView] ⚠ Furniture is far from camera (${distance.toFixed(2)}m). May not be visible.`);
            }
          }
        } else {
          console.error('[ARView] ERROR: rootGroupRef.current or sceneRef.current is null!');
          console.error(`[ARView] rootGroupRef: ${!!rootGroupRef.current}, sceneRef: ${!!sceneRef.current}`);
          setIsPlacingFurniture(false);
          setComponentError('Failed to add furniture to scene. Scene not initialized.');
          return;
        }

        // ============================================================================
        // CRITICAL: INDIVIDUAL OBJECT STORAGE & SELECTION
        // ============================================================================
        // Each furniture item is stored as an independent, individually selectable entity
        // This ensures:
        // 1. Each object has its own unique ID (meshId)
        // 2. Each object can be individually selected via raycast hit testing
        // 3. Each object maintains its own selection state (userData.isSelected)
        // 4. Each object can be individually manipulated (move, rotate, scale)
        // 5. Each object is rendered independently in the AR scene
        // 6. No group-level selection - only the tapped object is selected
        // 7. Selection does not propagate to parent nodes or other objects
        // ============================================================================
        furnitureMapRef.current.set(meshId, {
          mesh: furnitureGroup, // The furniture group (individual object)
          item: libraryItem,
          libraryId: libraryItem.id,
          // Each furniture item maintains its own independent state
          // No shared parent state, no group-level selection
        });

        const newFurniture = {
          id: meshId,
          libraryId: libraryItem.id,
          name: libraryItem.name,
          emoji: libraryItem.emoji || '',
          price: libraryItem.price,
        };

        const updatedFurniture = [...placedFurniture, newFurniture];

        // Save to history for undo/redo with validation
        saveToHistoryWithSceneCheck(updatedFurniture);

        setPlacedFurniture(updatedFurniture);
        setSelectedPlacedId(meshId);
        setSelectedLibraryItem(null);
        setShowPlacementHint(false);

        // Update interactive stats with safety score
        const currentSafety = placementSafety.safetyScore;
        setInteractiveStats(prev => {
          const newCount = prev.totalFurniture + 1;
          const newAverageSafety = prev.totalFurniture > 0
            ? ((prev.averageSafety * prev.totalFurniture) + currentSafety) / newCount
            : currentSafety;
          return {
            totalFurniture: newCount,
            totalArea: prev.totalArea + (libraryItem.dimensions.width * libraryItem.dimensions.length),
            averageSafety: newAverageSafety,
            placementCount: prev.placementCount + 1,
          };
        });

        // Highlight newly placed furniture with animation
        setHighlightedFurniture(meshId);
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }
        highlightTimeoutRef.current = setTimeout(() => {
          setHighlightedFurniture(null);
        }, CONFIG.INTERACTIVE_HIGHLIGHT_DURATION);

        // Furniture is already positioned correctly on the floor
        // Add a subtle scale animation for visual feedback (like in the reference image)
        const placedMesh = furnitureMapRef.current.get(meshId)?.mesh;
        if (placedMesh) {
          // Subtle pop-in animation for better UX (like in the reference image)
          placedMesh.scale.set(0.9, 0.9, 0.9);

          let scale = 0.9;
          const scaleInterval = setInterval(() => {
            scale += 0.02; // Smooth scale up
            if (scale >= 1.0) {
              scale = 1.0;
              clearInterval(scaleInterval);
            }
            placedMesh.scale.set(scale, scale, scale);
          }, 16); // ~60fps

          // Cleanup after animation completes (safety timeout)
          setTimeout(() => {
            clearInterval(scaleInterval);
            placedMesh.scale.set(1.0, 1.0, 1.0); // Ensure final scale is correct
          }, 1000);
        }

        // Remove and dispose preview ghost completely after placing furniture
        if (previewGhostRef.current && rootGroupRef.current) {
          rootGroupRef.current.remove(previewGhostRef.current);
          disposeObjectRecursive(previewGhostRef.current);
          previewGhostRef.current = null;
        }

        // Hide reticle after placing furniture
        if (reticleRef.current) {
          reticleRef.current.visible = false;
        }
        reticleWorldPositionRef.current = null;
        if (reticleSmoothedPositionRef.current) {
          reticleSmoothedPositionRef.current = null;
        }

        // Final verification that furniture is in the scene (after a short delay to ensure it's added)
        setTimeout(() => {
          const entry = furnitureMapRef.current.get(meshId);
          if (entry && entry.mesh) {
            const isInScene = rootGroupRef.current?.children.includes(entry.mesh) || false;
            console.log(`[ARView] ✓ Verification: Furniture "${libraryItem.name}" ${isInScene ? 'IS' : 'IS NOT'} in scene`);
            if (!isInScene) {
              console.error(`[ARView] ERROR: Furniture ${meshId} was not properly added to scene!`);
              // Try to re-add it
              if (rootGroupRef.current && entry.mesh) {
                rootGroupRef.current.add(entry.mesh);
                entry.mesh.updateMatrixWorld(true);
                console.log(`[ARView] ✓ Re-added furniture to scene`);
              }
            } else {
              // Verify visibility
              entry.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  console.log(`[ARView] ✓ Child mesh visible: ${child.visible}, material: ${child.material ? 'present' : 'missing'}`);
                }
              });
            }
          }

          // Check for collisions after verification
          if (entry && entry.mesh) {
            checkCollisions(entry.mesh, meshId);
          }
        }, 100);
      } catch (error) {
        console.error('[ARView] Error placing furniture:', error);
        setComponentError(ERROR_MESSAGES.FURNITURE_PLACEMENT_ERROR);
        Alert.alert('Placement Error', ERROR_MESSAGES.FURNITURE_PLACEMENT_ERROR, [
          { text: 'OK', style: 'default' }
        ]);
      } finally {
        setIsPlacingFurniture(false);
      }
    },
    [selectedLibraryItem, furnitureLibraryById, placedFurniture, saveToHistoryWithSceneCheck, checkCollisions],
  );

  // Measurement calculation functions
  const calculateDistance = useCallback((point1: THREE.Vector3, point2: THREE.Vector3): number => {
    return point1.distanceTo(point2);
  }, []);

  const calculateArea = useCallback((points: THREE.Vector3[]): number => {
    if (points.length < 3) return 0;
    // Calculate area using shoelace formula for polygon
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].z;
      area -= points[j].x * points[i].z;
    }
    return Math.abs(area) / 2;
  }, []);

  const calculateVolume = useCallback((points: THREE.Vector3[], height: number): number => {
    const area = calculateArea(points);
    return area * height;
  }, [calculateArea]);

  // Create text label sprite for measurements
  const createTextLabel = useCallback((text: string, position: THREE.Vector3): THREE.Sprite | null => {
    if (typeof document === 'undefined' || !document.createElement) {
      return null;
    }

    try {
      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return null;

      canvas.width = 256;
      canvas.height = 64;

      // Draw text with background
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = 'white';
      context.font = 'Bold 24px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, canvas.width / 2, canvas.height / 2);

      // Create texture with Expo GL compatible settings
      const texture = new THREE.CanvasTexture(canvas);
      texture.flipY = false; // Prevent pixelStorei warning in Expo GL
      texture.needsUpdate = true;

      // Create sprite material
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
      });

      // Create sprite
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.scale.set(0.5, 0.125, 1);

      return sprite;
    } catch (error) {
      console.warn('[ARView] Error creating text label:', error);
      return null;
    }
  }, []);

  // Render measurement lines and points
  const updateMeasurementVisualization = useCallback(() => {
    if (!rootGroupRef.current || !sceneRef.current) return;

    // Clear existing measurements
    measurementLinesRef.current.forEach(line => {
      rootGroupRef.current?.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    measurementLinesRef.current = [];

    measurementPointsRef.current.forEach(point => {
      rootGroupRef.current?.remove(point);
      point.geometry.dispose();
      (point.material as THREE.Material).dispose();
    });
    measurementPointsRef.current = [];

    if (measurementLabelsRef.current) {
      rootGroupRef.current.remove(measurementLabelsRef.current);
      measurementLabelsRef.current.clear();
    } else {
      measurementLabelsRef.current = new THREE.Group();
      rootGroupRef.current.add(measurementLabelsRef.current);
    }

    if (measurementPoints.length === 0) return;

    // Create point markers with animation
    const pointGeometry = new THREE.SphereGeometry(0.05, 16, 16);
    const pointMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 1.0,
    });

    measurementPoints.forEach((point, index) => {
      // Check if marker already exists for this point
      const existingMarker = measurementPointsRef.current[index];
      if (existingMarker) {
        // Marker already exists, skip creation
        return;
      }

      // Create new marker
      const pointMesh = new THREE.Mesh(pointGeometry.clone(), pointMaterial.clone());
      pointMesh.position.copy(point);

      // Initialize scale to 0 for pop-in animation
      pointMesh.scale.set(0, 0, 0);

      // Store animation data
      const now = Date.now();
      measurementMarkerAnimationsRef.current.set(pointMesh, {
        startTime: now,
        initialScale: 0,
      });

      rootGroupRef.current?.add(pointMesh);
      measurementPointsRef.current.push(pointMesh);
    });

    // Create lines based on measurement mode
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 3,
    });

    if (measurementMode === 'distance' && measurementPoints.length >= 2) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        measurementPoints[0],
        measurementPoints[1],
      ]);
      const line = new THREE.Line(lineGeometry, lineMaterial);
      rootGroupRef.current.add(line);
      measurementLinesRef.current.push(line);

      // Add distance label at midpoint
      const midpoint = new THREE.Vector3()
        .addVectors(measurementPoints[0], measurementPoints[1])
        .multiplyScalar(0.5);
      midpoint.y += 0.2; // Offset above line

      const distance = calculateDistance(measurementPoints[0], measurementPoints[1]);
      const distanceText = `${distance.toFixed(2)}m`;
      const label = createTextLabel(distanceText, midpoint);
      if (label && measurementLabelsRef.current) {
        measurementLabelsRef.current.add(label);
      }
    } else if (measurementMode === 'area' && measurementPoints.length >= 3) {
      // Draw polygon lines
      for (let i = 0; i < measurementPoints.length; i++) {
        const next = (i + 1) % measurementPoints.length;
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
          measurementPoints[i],
          measurementPoints[next],
        ]);
        const line = new THREE.Line(lineGeometry, lineMaterial);
        rootGroupRef.current.add(line);
        measurementLinesRef.current.push(line);
      }

      // Add area label at center of polygon
      const center = new THREE.Vector3();
      measurementPoints.forEach(point => center.add(point));
      center.divideScalar(measurementPoints.length);
      center.y += 0.2; // Offset above polygon

      const area = calculateArea(measurementPoints);
      const areaText = `${area.toFixed(2)}m²`;
      const label = createTextLabel(areaText, center);
      if (label && measurementLabelsRef.current) {
        measurementLabelsRef.current.add(label);
      }
    } else if (measurementMode === 'volume' && measurementPoints.length >= 3) {
      // Draw base polygon
      for (let i = 0; i < measurementPoints.length; i++) {
        const next = (i + 1) % measurementPoints.length;
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
          measurementPoints[i],
          measurementPoints[next],
        ]);
        const line = new THREE.Line(lineGeometry, lineMaterial);
        rootGroupRef.current.add(line);
        measurementLinesRef.current.push(line);
      }

      // Add volume label at center of polygon
      const center = new THREE.Vector3();
      measurementPoints.forEach(point => center.add(point));
      center.divideScalar(measurementPoints.length);
      center.y += 0.2; // Offset above polygon

      const height = roomData?.dimensions.height || 2.7;
      const volume = calculateVolume(measurementPoints, height);
      const volumeText = `${volume.toFixed(2)}m³`;
      const label = createTextLabel(volumeText, center);
      if (label && measurementLabelsRef.current) {
        measurementLabelsRef.current.add(label);
      }
    }
  }, [measurementPoints, measurementMode, calculateDistance, calculateArea, calculateVolume, createTextLabel, roomData]);

  // Visualize suggested alternative positions
  const visualizeSuggestedPositions = useCallback(() => {
    if (!rootGroupRef.current) return;

    // Clean up old suggestions
    suggestedPositionsRef.current.forEach(indicator => {
      rootGroupRef.current?.remove(indicator);
      indicator.geometry.dispose();
      (indicator.material as THREE.Material).dispose();
    });
    suggestedPositionsRef.current = [];

    // Clean up old labels
    if (suggestedPositionLabelsRef.current) {
      rootGroupRef.current.remove(suggestedPositionLabelsRef.current);
      suggestedPositionLabelsRef.current.clear();
      suggestedPositionLabelsRef.current = null;
    }

    if (suggestedPositions.length === 0) return;

    // Create label group
    suggestedPositionLabelsRef.current = new THREE.Group();
    rootGroupRef.current.add(suggestedPositionLabelsRef.current);

    // Create visual indicators for each suggested position
    suggestedPositions.forEach((pos, index) => {
      // Create ring geometry indicator
      const indicatorGeometry = new THREE.RingGeometry(0.2, 0.25, 32);
      const indicatorMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
      indicator.rotation.x = -Math.PI / 2; // Rotate to lie flat on floor
      indicator.position.copy(pos);
      indicator.position.y = 0.01; // Slightly above floor

      rootGroupRef.current?.add(indicator);
      suggestedPositionsRef.current.push(indicator);

      // Add number label (using canvas texture if available)
      if (typeof document !== 'undefined' && document.createElement) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const context = canvas.getContext('2d');
          if (context && suggestedPositionLabelsRef.current) {
            context.fillStyle = '#00ff00';
            context.font = 'bold 64px Arial';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(`${index + 1}`, 64, 64);

            const texture = new THREE.CanvasTexture(canvas);
            texture.flipY = false; // Prevent pixelStorei warning in Expo GL
            const labelMaterial = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              opacity: 0.9,
            });
            const labelGeometry = new THREE.PlaneGeometry(0.3, 0.3);
            const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);
            labelMesh.position.copy(pos);
            labelMesh.position.y = 0.5; // Above the ring
            if (cameraRef.current) {
              labelMesh.lookAt(cameraRef.current.position);
            }

            suggestedPositionLabelsRef.current.add(labelMesh);
          }
        } catch (error) {
          // Canvas not available, skip label
          console.warn('[ARView] Canvas not available for label rendering:', error);
        }
      }
    });
  }, [suggestedPositions]);

  // Update suggested positions visualization when positions change
  useEffect(() => {
    if (rendererReady) {
      visualizeSuggestedPositions();
    }
  }, [suggestedPositions, rendererReady, visualizeSuggestedPositions]);

  // Update measurement visualization when points change
  useEffect(() => {
    if (rendererReady) {
      updateMeasurementVisualization();
    }
  }, [measurementPoints, measurementMode, rendererReady, updateMeasurementVisualization]);

  // Clear measurements when mode changes
  useEffect(() => {
    if (!measurementMode) {
      setMeasurementPoints([]);
      setMeasurementResults(null);
    }
  }, [measurementMode]);

  // Detect furniture selection via raycasting - INDIVIDUAL OBJECT SELECTION
  // Each furniture item is treated as an independent, selectable entity
  const detectFurnitureAtScreenPoint = useCallback(
    (locationX: number, locationY: number): string | null => {
      if (!rendererReady || !cameraRef.current) return null;

      const { width, height } = glLayoutRef.current;
      if (width === 0 || height === 0) return null;

      const ndc = new THREE.Vector2(
        (locationX / width) * 2 - 1,
        -(locationY / height) * 2 + 1,
      );

      if (!raycasterRef.current) return null;

      raycasterRef.current.setFromCamera(ndc, cameraRef.current);

      // CRITICAL: Each furniture item is stored as an individual group in furnitureMapRef
      // We perform hit testing against each furniture group individually
      // This ensures only the tapped object is selected, not parent groups or other objects

      const furnitureObjects = Array.from(furnitureMapRef.current.values()).map(entry => entry.mesh);

      // Use recursive hit testing to detect hits on any mesh within a furniture group
      // But return only the specific furniture item ID, not the group
      const intersects = raycasterRef.current.intersectObjects(furnitureObjects, true);

      if (intersects.length > 0) {
        const hitObject = intersects[0].object;

        // Find which individual furniture item this hit belongs to
        // Each furniture item has a unique ID stored in furnitureMapRef
        for (const [furnitureId, entry] of furnitureMapRef.current.entries()) {
          const furnitureGroup = entry.mesh;

          // Check if hit object is part of this furniture item's group
          let belongsToThisFurniture = false;

          if (hitObject === furnitureGroup) {
            // Direct hit on the group itself
            belongsToThisFurniture = true;
          } else {
            // Check if hit object is a child of this furniture group
            furnitureGroup.traverse((child) => {
              if (child === hitObject) {
                belongsToThisFurniture = true;
              }
            });
          }

          if (belongsToThisFurniture) {
            // Return the unique furniture ID - this ensures only THIS object is selected
            if (__DEV__) {
              console.log(`[ARView] Hit detected on furniture: ${entry.item.name} (ID: ${furnitureId})`);
            }
            return furnitureId; // Return the unique ID for this individual furniture item
          }
        }
      }

      return null; // No furniture hit
    },
    [rendererReady],
  );

  /**
   * Cleans up all alignment lines from the scene
   * Safely handles race conditions by cloning the array before iteration
   * Removes lines from scene and disposes of their resources
   */
  const cleanupAlignmentLines = useCallback(() => {
    if (!rootGroupRef.current) return;

    // Clone array to avoid modification during iteration (race condition fix)
    const linesToClean = [...alignmentLinesRef.current];
    // Clear ref immediately to prevent new lines from being added during cleanup
    alignmentLinesRef.current = [];

    // Clean up each line with error handling
    linesToClean.forEach(line => {
      try {
        rootGroupRef.current?.remove(line);
        if (line.geometry) {
          line.geometry.dispose();
        }
        if (line.material) {
          (line.material as THREE.Material).dispose();
        }
      } catch (error) {
        console.warn('[ARView] Error cleaning up alignment line:', error);
      }
    });
  }, []);

  // Clean up dimension labels
  const cleanupDimensionLabels = useCallback(() => {
    if (!rootGroupRef.current || !dimensionLabelRef.current) return;

    try {
      rootGroupRef.current.remove(dimensionLabelRef.current);
      // Dispose all children (sprites, planes, etc.)
      dimensionLabelRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      dimensionLabelRef.current = null;
    } catch (error) {
      console.warn('[ARView] Error cleaning up dimension labels:', error);
    }
  }, []);

  /**
   * Cleans up all constraint lines showing room boundaries
   * Safely handles race conditions and disposes of line resources
   * Used when drag ends or guides are disabled
   */
  const cleanupConstraintLines = useCallback(() => {
    if (!rootGroupRef.current) return;

    // Clone array to avoid modification during iteration (race condition fix)
    const linesToClean = [...constraintLinesRef.current];
    // Clear ref immediately to prevent new lines from being added during cleanup
    constraintLinesRef.current = [];

    // Clean up each line with error handling
    linesToClean.forEach(line => {
      try {
        rootGroupRef.current?.remove(line);
        if (line.geometry) {
          line.geometry.dispose();
        }
        if (line.material) {
          (line.material as THREE.Material).dispose();
        }
      } catch (error) {
        console.warn('[ARView] Error cleaning up constraint line:', error);
      }
    });
  }, []);

  /**
   * Show augmented tooltip with furniture information
   */
  const showTooltip = useCallback((furnitureId: string, position: THREE.Vector3) => {
    const entry = furnitureMapRef.current.get(furnitureId);
    if (!entry) return;

    tooltipRef.current = { furnitureId, position };

    // Auto-hide tooltip after 3 seconds (reduced from 5)
    setTimeout(() => {
      if (tooltipRef.current?.furnitureId === furnitureId) {
        tooltipRef.current = null;
      }
    }, 3000);
  }, []);


  const handleSceneTap = useCallback(
    (event: GestureResponderEvent) => {
      if (!rendererReady || !cameraRef.current) {
        return;
      }

      const { locationX, locationY } = event.nativeEvent;

      // Handle measurement mode
      if (measurementMode) {
        const { width, height } = glLayoutRef.current;
        if (width === 0 || height === 0) return;

        const ndc = new THREE.Vector2(
          (locationX / width) * 2 - 1,
          -(locationY / height) * 2 + 1,
        );

        if (!raycasterRef.current) return;

        raycasterRef.current.setFromCamera(ndc, cameraRef.current);

        // Raycast to floor plane (y = 0)
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        raycasterRef.current.ray.intersectPlane(plane, intersectPoint);

        if (measurementMode === 'distance') {
          if (measurementPoints.length === 0) {
            setMeasurementPoints([intersectPoint]);
            setMeasurementResults(null);
          } else if (measurementPoints.length === 1) {
            const newPoints = [...measurementPoints, intersectPoint];
            setMeasurementPoints(newPoints);
            const distance = calculateDistance(measurementPoints[0], intersectPoint);
            setMeasurementResults({ distance });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => { });
          } else {
            // Reset for new measurement
            setMeasurementPoints([intersectPoint]);
            setMeasurementResults(null);
          }
        } else if (measurementMode === 'area') {
          const newPoints = [...measurementPoints, intersectPoint];
          setMeasurementPoints(newPoints);
          if (newPoints.length >= 3) {
            const area = calculateArea(newPoints);
            setMeasurementResults({ area });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
          }
        } else if (measurementMode === 'volume') {
          const newPoints = [...measurementPoints, intersectPoint];
          setMeasurementPoints(newPoints);
          if (newPoints.length >= 3) {
            // For volume, we need height - use average height of room or default
            const height = roomData?.dimensions.height || 2.7;
            const area = calculateArea(newPoints);
            const volume = calculateVolume(newPoints, height);
            setMeasurementResults({ area, volume });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
          }
        }
        return;
      }

      // Check if user tapped on existing furniture
      const tappedFurnitureId = detectFurnitureAtScreenPoint(locationX, locationY);

      if (tappedFurnitureId) {
        const entry = furnitureMapRef.current.get(tappedFurnitureId);

        // Show tooltip on long press
        longPressTimerRef.current = setTimeout(() => {
          if (entry) {
            showTooltip(tappedFurnitureId, entry.mesh.position);
          }
        }, 500); // 500ms long press
        if (multiSelectMode) {
          // Multi-select mode: toggle selection
          toggleFurnitureSelection(tappedFurnitureId);
        } else {
          // CRITICAL: Individual furniture selection only - NO GROUP SELECTION
          // Every furniture item is treated as an independent, individually selectable object
          setDraggedFurnitureId(tappedFurnitureId);
          setIsDraggingFurniture(true);
          // Clear previous drag position refs when starting new drag
          latestDragPositionRef.current = null;
          pendingDragPositionRef.current = null;
          setSelectedPlacedId(tappedFurnitureId); // Select ONLY this individual object
          setSelectedLibraryItem(null); // Deselect library item

          // Store initial position and rotation for THIS individual object
          const entry = furnitureMapRef.current.get(tappedFurnitureId);
          if (entry && rootGroupRef.current && entry.mesh && entry.mesh.position) {
            setDragStartPosition(entry.mesh.position.clone());
            setDragStartRotation(entry.mesh.rotation.y);
            setDragRotation(0);

            // Lock scale when starting drag - store current scale
            const currentScale = entry.mesh.scale.x;
            lockedScaleRef.current.set(tappedFurnitureId, currentScale);
            if (!furnitureScale[tappedFurnitureId]) {
              setFurnitureScale(prev => ({ ...prev, [tappedFurnitureId]: currentScale }));
            }

            // Initialize gesture state to IDLE (will transition to MOVE_SINGLE_FINGER on first pan)
            setGestureState('IDLE');

            // Create ghost preview
            if (showDragGuides) {
              let ghostGeometry: THREE.BufferGeometry | null = null;
              if (entry.mesh instanceof THREE.Mesh && entry.mesh.geometry) {
                ghostGeometry = entry.mesh.geometry.clone();
              } else if (entry.mesh instanceof THREE.Group) {
                // Create bounding box geometry for groups
                const box = new THREE.Box3().setFromObject(entry.mesh);
                const size = box.getSize(new THREE.Vector3());
                ghostGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
              }

              if (ghostGeometry && rootGroupRef.current) {
                const ghostMaterial = new THREE.MeshStandardMaterial({
                  color: entry.item.color,
                  transparent: true,
                  opacity: 0.3,
                  wireframe: true,
                  side: THREE.DoubleSide,
                });
                const ghost = new THREE.Mesh(ghostGeometry, ghostMaterial);
                ghost.position.copy(entry.mesh.position);
                ghost.rotation.copy(entry.mesh.rotation);
                ghost.scale.copy(entry.mesh.scale);
                rootGroupRef.current.add(ghost);
                dragGhostRef.current = ghost;
              }
            }
          }

          // Haptic feedback
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
        }
        return;
      }

      // If dragging, end drag
      if (isDraggingFurniture && draggedFurnitureId) {
        const draggedId = draggedFurnitureId; // Store before clearing

        // CRITICAL: Set flags BEFORE any async operations to prevent race conditions
        setIsDraggingFurniture(false);
        setDraggedFurnitureId(null);

        // Reset gesture state to IDLE
        setGestureState('IDLE');

        // Apply final drag position update using ref to prevent race conditions
        // Use the latest aligned position from ref instead of recalculating from potentially stale screen coordinates
        if (latestDragPositionRef.current) {
          const entry = furnitureMapRef.current.get(draggedId);
          if (entry) {
            const alignedPosition = latestDragPositionRef.current;
            // Apply final position update using the ref value, not stale state
            entry.mesh.position.set(
              alignedPosition.x,
              alignedPosition.y + entry.item.dimensions.height / 2,
              alignedPosition.z
            );
          }
          latestDragPositionRef.current = null;
        } else if (pendingDragPositionRef.current && rootGroupRef.current && raycasterRef.current && floorPlaneRef.current && cameraRef.current) {
          // Fallback: If ref is not available, recalculate from screen coordinates
          const finalPos = pendingDragPositionRef.current;
          const entry = furnitureMapRef.current.get(draggedId);
          if (entry) {
            const { width, height } = glLayoutRef.current;
            if (width > 0 && height > 0) {
              const ndc = new THREE.Vector2(
                (finalPos.locationX / width) * 2 - 1,
                -(finalPos.locationY / height) * 2 + 1,
              );

              raycasterRef.current.setFromCamera(ndc, cameraRef.current);
              const intersectionPoint = new THREE.Vector3();
              if (raycasterRef.current.ray.intersectPlane(floorPlaneRef.current, intersectionPoint)) {
                const projected = arAnchorManager.projectToWorld(vector3ToSpatial(intersectionPoint));
                const worldVector = spatialToVector3(projected);
                const alignedPosition = alignToFloor(worldVector);

                // Apply final position update
                entry.mesh.position.set(
                  alignedPosition.x,
                  alignedPosition.y + entry.item.dimensions.height / 2,
                  alignedPosition.z
                );
              }
            }
          }
          pendingDragPositionRef.current = null;
          latestDragPositionRef.current = null;
        }

        // Use try-finally to ensure cleanup always happens, even if placement logic fails
        try {
          const entry = furnitureMapRef.current.get(draggedId);
          if (entry) {
            // Reset emissive color immediately
            if (entry.mesh instanceof THREE.Mesh && entry.mesh.material instanceof THREE.MeshStandardMaterial) {
              entry.mesh.material.emissive.setHex(0x000000);
              entry.mesh.material.emissiveIntensity = 0;
            } else if (entry.mesh instanceof THREE.Group) {
              entry.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
                  child.material.emissive.setHex(0x000000);
                  child.material.emissiveIntensity = 0;
                }
              });
            }

            // Final safety check
            if (!entry.mesh.position) return;
            const currentPos = entry.mesh.position.clone();
            currentPos.y -= entry.item.dimensions.height / 2; // Get floor position
            const tempBox = createFurnitureBoundingBox(
              currentPos,
              entry.item.dimensions,
              { y: entry.mesh.rotation.y }
            );
            const safetyInfo = getPlacementSafety(
              tempBox,
              obstacleMapRef.current,
              furnitureMapRef.current,
              roomData,
              draggedId,
              CONFIG.COLLISION_MARGIN
            );

            // If unsafe, revert to start position and rotation
            if (safetyInfo.safetyLevel === 'danger' && dragStartPosition && dragStartRotation !== null) {
              entry.mesh.position.copy(dragStartPosition);
              entry.mesh.rotation.y = dragStartRotation;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => { });
              setComponentError('Cannot place here - collision detected. Reverted to previous position.');
            } else {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => { });
              // Save to history if enabled (with validation to prevent corruption)
              if (CONFIG.DRAG_HISTORY_ENABLED) {
                saveToHistoryWithSceneCheck([...placedFurniture]);
              }
            }
          }
        } finally {
          // Guaranteed cleanup - always executes, even if placement logic throws an error
          cleanupAlignmentLines();
          cleanupDimensionLabels();
          cleanupConstraintLines();

          // Clean up drag ghost
          if (dragGhostRef.current && rootGroupRef.current) {
            rootGroupRef.current.remove(dragGhostRef.current);
            if (dragGhostRef.current instanceof THREE.Group) {
              disposeObjectRecursive(dragGhostRef.current);
            } else {
              disposeMesh(dragGhostRef.current);
            }
            dragGhostRef.current = null;
          }

          // Reset all drag-related state
          setDragRotation(0);
          setMagneticSnapActive(false);
          setSnapType(null);
          setDragStartPosition(null);
          setDragStartRotation(null);
          setPlacementSafety({
            isSafe: true,
            safetyLevel: 'safe',
            safetyScore: 100,
            reason: null,
            hasObstacleCollision: false,
            hasFurnitureCollision: false,
            hasWallCollision: false,
            isOutOfBounds: false,
            nearestObstacleDistance: null,
            nearestWallDistance: null,
            nearestFurnitureDistance: null,
            recommendations: [],
          });

          // Hide reticle after placing furniture
          if (reticleRef.current) {
            reticleRef.current.visible = false;
          }

          // Clear drag position refs
          latestDragPositionRef.current = null;
          reticleWorldPositionRef.current = null;
          reticleSmoothedPositionRef.current = null;

          // Remove and dispose preview ghost completely after placing
          if (previewGhostRef.current && rootGroupRef.current) {
            rootGroupRef.current.remove(previewGhostRef.current);
            disposeObjectRecursive(previewGhostRef.current);
            previewGhostRef.current = null;
          }

          // Clear pending drag position to prevent stale data
          pendingDragPositionRef.current = null;
          latestDragPositionRef.current = null;
        }

        return;
      }

      // Normal placement flow
      if (!selectedLibraryItem) {
        return;
      }

      updateReticleFromScreen();

      const fallbackIntersection = new THREE.Vector3();
      let worldPoint: THREE.Vector3 | null = null;

      if (reticleWorldPositionRef.current) {
        // Reuse Vector3 object instead of cloning
        worldPoint = new THREE.Vector3();
        worldPoint.copy(reticleWorldPositionRef.current);
      } else {
        const { width, height } = glLayoutRef.current;
        if (height === 0 || width === 0) {
          return;
        }

        const ndc = new THREE.Vector2(
          (locationX / width) * 2 - 1,
          -(locationY / height) * 2 + 1,
        );

        if (!raycasterRef.current || !floorPlaneRef.current) return;

        raycasterRef.current.setFromCamera(ndc, cameraRef.current);
        if (raycasterRef.current.ray.intersectPlane(floorPlaneRef.current, fallbackIntersection)) {
          const projectedPoint = arAnchorManager.projectToWorld(vector3ToSpatial(fallbackIntersection));
          worldPoint = spatialToVector3(projectedPoint);
        }
      }

      if (worldPoint) {
        // Clean up any existing visual guides before placing
        cleanupAlignmentLines();
        cleanupDimensionLabels();
        cleanupConstraintLines();

        // Hide reticle before placing
        if (reticleRef.current) {
          reticleRef.current.visible = false;
        }

        addFurnitureToScene(worldPoint);
      }
    },
    [rendererReady, addFurnitureToScene, selectedLibraryItem, updateReticleFromScreen, isDraggingFurniture, draggedFurnitureId, dragStartPosition, detectFurnitureAtScreenPoint, roomData, measurementMode, measurementPoints, calculateDistance, calculateArea, calculateVolume, cleanupAlignmentLines, cleanupDimensionLabels, cleanupConstraintLines],
  );

  // Update dimension labels during drag
  const updateDimensionLabels = useCallback((
    furnitureMesh: THREE.Mesh | THREE.Group,
    item: FurnitureLibraryItem
  ) => {
    if (!rootGroupRef.current || !showDragGuides) {
      cleanupDimensionLabels();
      return;
    }

    // Clean up old labels
    cleanupDimensionLabels();

    // Create new label group
    const labelGroup = new THREE.Group();
    const pos = furnitureMesh.position;
    const labelHeight = pos.y + item.dimensions.height / 2 + 0.3; // Above furniture

    // Create canvas texture for dimension text
    if (typeof document === 'undefined' || !document.createElement) {
      return;
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#5ac8fa';
    context.font = 'bold 24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const dimensionText = `${item.dimensions.width.toFixed(2)}m × ${item.dimensions.length.toFixed(2)}m × ${item.dimensions.height.toFixed(2)}m`;
    context.fillText(dimensionText, canvas.width / 2, canvas.height / 2);

    // Create texture from canvas with Expo GL compatible settings
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false; // Prevent pixelStorei warning in Expo GL
    texture.needsUpdate = true;

    // Create plane with text texture
    const planeGeometry = new THREE.PlaneGeometry(1.5, 0.4);
    const planeMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const textPlane = new THREE.Mesh(planeGeometry, planeMaterial);

    // Position label above furniture, always facing camera
    textPlane.position.set(pos.x, labelHeight, pos.z);
    textPlane.lookAt(cameraRef.current?.position || new THREE.Vector3(0, 1.6, 4));
    textPlane.rotateY(Math.PI); // Flip to face camera

    labelGroup.add(textPlane);
    dimensionLabelRef.current = labelGroup;
    rootGroupRef.current.add(labelGroup);
  }, [showDragGuides, cleanupDimensionLabels]);

  // Show room boundary constraint visualization
  const showRoomConstraints = useCallback((position: THREE.Vector3, furnitureDimensions: { width: number; length: number; height: number }) => {
    if (!rootGroupRef.current || !roomData || !showDragGuides) {
      cleanupConstraintLines();
      return;
    }

    // Clear old constraints
    cleanupConstraintLines();

    const unit = roomData.dimensions.unit;
    const widthMeters = unitToMeters(roomData.dimensions.width, unit);
    const lengthMeters = unitToMeters(roomData.dimensions.length, unit);
    const halfWidth = widthMeters / 2;
    const halfLength = lengthMeters / 2;

    // Calculate furniture bounds
    const halfFurnitureWidth = furnitureDimensions.width / 2;
    const halfFurnitureLength = furnitureDimensions.length / 2;

    // Calculate constraint boundaries (where furniture would hit walls)
    const leftBoundary = -halfWidth + halfFurnitureWidth;
    const rightBoundary = halfWidth - halfFurnitureWidth;
    const frontBoundary = -halfLength + halfFurnitureLength;
    const backBoundary = halfLength - halfFurnitureLength;

    const lineHeight = position.y + furnitureDimensions.height / 2 + 0.1;
    const lineColor = 0xff6b6b; // Red for constraints
    const lineMaterial = new THREE.LineBasicMaterial({
      color: lineColor,
      linewidth: 2,
      transparent: true,
      opacity: 0.6,
    });

    // Draw constraint lines showing valid placement boundaries
    // Left boundary
    if (position.x <= leftBoundary + 0.3) {
      const leftLineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(leftBoundary, lineHeight, frontBoundary),
        new THREE.Vector3(leftBoundary, lineHeight, backBoundary),
      ]);
      const leftLine = new THREE.Line(leftLineGeometry, lineMaterial);
      rootGroupRef.current.add(leftLine);
      constraintLinesRef.current.push(leftLine);
    }

    // Right boundary
    if (position.x >= rightBoundary - 0.3) {
      const rightLineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(rightBoundary, lineHeight, frontBoundary),
        new THREE.Vector3(rightBoundary, lineHeight, backBoundary),
      ]);
      const rightLine = new THREE.Line(rightLineGeometry, lineMaterial);
      rootGroupRef.current.add(rightLine);
      constraintLinesRef.current.push(rightLine);
    }

    // Front boundary
    if (position.z <= frontBoundary + 0.3) {
      const frontLineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(leftBoundary, lineHeight, frontBoundary),
        new THREE.Vector3(rightBoundary, lineHeight, frontBoundary),
      ]);
      const frontLine = new THREE.Line(frontLineGeometry, lineMaterial);
      rootGroupRef.current.add(frontLine);
      constraintLinesRef.current.push(frontLine);
    }

    // Back boundary
    if (position.z >= backBoundary - 0.3) {
      const backLineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(leftBoundary, lineHeight, backBoundary),
        new THREE.Vector3(rightBoundary, lineHeight, backBoundary),
      ]);
      const backLine = new THREE.Line(backLineGeometry, lineMaterial);
      rootGroupRef.current.add(backLine);
      constraintLinesRef.current.push(backLine);
    }

    // Draw corner constraints if near corners
    const cornerThreshold = 0.3;
    const nearLeftFront = position.x <= leftBoundary + cornerThreshold && position.z <= frontBoundary + cornerThreshold;
    const nearRightFront = position.x >= rightBoundary - cornerThreshold && position.z <= frontBoundary + cornerThreshold;
    const nearLeftBack = position.x <= leftBoundary + cornerThreshold && position.z >= backBoundary - cornerThreshold;
    const nearRightBack = position.x >= rightBoundary - cornerThreshold && position.z >= backBoundary - cornerThreshold;

    if (nearLeftFront || nearRightFront || nearLeftBack || nearRightBack) {
      // Draw corner indicator
      const cornerMaterial = new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 3,
        transparent: true,
        opacity: 0.8,
      });

      const cornerSize = 0.2;
      const corners = [
        { x: leftBoundary, z: frontBoundary, active: nearLeftFront },
        { x: rightBoundary, z: frontBoundary, active: nearRightFront },
        { x: leftBoundary, z: backBoundary, active: nearLeftBack },
        { x: rightBoundary, z: backBoundary, active: nearRightBack },
      ];

      corners.forEach(corner => {
        if (corner.active && rootGroupRef.current) {
          const cornerGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(corner.x - cornerSize, lineHeight, corner.z - cornerSize),
            new THREE.Vector3(corner.x + cornerSize, lineHeight, corner.z - cornerSize),
            new THREE.Vector3(corner.x + cornerSize, lineHeight, corner.z + cornerSize),
            new THREE.Vector3(corner.x - cornerSize, lineHeight, corner.z + cornerSize),
            new THREE.Vector3(corner.x - cornerSize, lineHeight, corner.z - cornerSize),
          ]);
          const cornerLine = new THREE.Line(cornerGeometry, cornerMaterial);
          rootGroupRef.current.add(cornerLine);
          constraintLinesRef.current.push(cornerLine);
        }
      });
    }
  }, [roomData, showDragGuides, cleanupConstraintLines]);

  // Update alignment lines visualization
  const updateAlignmentLines = useCallback((
    furnitureMesh: THREE.Mesh | THREE.Group,
    alignments: { x?: number; z?: number }
  ) => {
    // Always clean up existing lines first, regardless of showDragGuides state
    cleanupAlignmentLines();

    if (!rootGroupRef.current || !showDragGuides) {
      // If guides are off, just ensure cleanup is done (already done above)
      return;
    }

    const pos = furnitureMesh.position;
    const item = furnitureMapRef.current.get(draggedFurnitureId || '')?.item;
    if (!item) return;

    const lineHeight = pos.y - item.dimensions.height / 2 + 0.01;
    const lineLength = 2.0; // 2 meters line length

    // Create alignment lines
    if (alignments.x !== undefined) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(alignments.x, lineHeight, pos.z - lineLength / 2),
        new THREE.Vector3(alignments.x, lineHeight, pos.z + lineLength / 2),
      ]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        linewidth: 3,
        transparent: true,
        opacity: 0.7
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      rootGroupRef.current.add(line);
      alignmentLinesRef.current.push(line);
    }

    if (alignments.z !== undefined) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(pos.x - lineLength / 2, lineHeight, alignments.z),
        new THREE.Vector3(pos.x + lineLength / 2, lineHeight, alignments.z),
      ]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        linewidth: 3,
        transparent: true,
        opacity: 0.7
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      rootGroupRef.current.add(line);
      alignmentLinesRef.current.push(line);
    }
  }, [showDragGuides, draggedFurnitureId, cleanupAlignmentLines, updateDimensionLabels, cleanupDimensionLabels]);

  const handleScenePan = useCallback(
    (event: GestureResponderEvent) => {
      if (!rendererReady || !cameraRef.current) {
        return;
      }

      const { locationX, locationY, touches } = event.nativeEvent;
      const touchCount = touches?.length || 1;

      // Gesture State Machine: Handle state transitions
      if (touchCount === 2 && selectedPlacedId && isARActive) {
        // Transition to PINCH_OR_ROTATE_TWO_FINGERS state
        if (gestureState !== 'PINCH_OR_ROTATE_TWO_FINGERS') {
          setGestureState('PINCH_OR_ROTATE_TWO_FINGERS');
          // Reset single-finger drag state
          if (isDraggingFurniture) {
            setIsDraggingFurniture(false);
            setDraggedFurnitureId(null);
          }
        }
      } else if (touchCount === 1 && selectedPlacedId && isARActive) {
        // Start dragging if furniture is selected and user moves finger
        // Transition to MOVE_SINGLE_FINGER state
        if (gestureState !== 'MOVE_SINGLE_FINGER') {
          setGestureState('MOVE_SINGLE_FINGER');

          // Start dragging if not already dragging
          if (!isDraggingFurniture) {
            setIsDraggingFurniture(true);
            setDraggedFurnitureId(selectedPlacedId);

            // Store initial position
            const entry = furnitureMapRef.current.get(selectedPlacedId);
            if (entry && entry.mesh && entry.mesh.position) {
              setDragStartPosition(entry.mesh.position.clone());
              setDragStartRotation(entry.mesh.rotation.y);
              setDragRotation(0);

              // Lock scale when entering single-finger move mode
              const currentScale = entry.mesh.scale.x;
              lockedScaleRef.current.set(selectedPlacedId, currentScale);
              if (!furnitureScale[selectedPlacedId]) {
                setFurnitureScale(prev => ({ ...prev, [selectedPlacedId]: currentScale }));
              }
            }
          } else if (draggedFurnitureId) {
            // Already dragging, just ensure scale is locked
            const entry = furnitureMapRef.current.get(draggedFurnitureId);
            if (entry) {
              const currentScale = entry.mesh.scale.x;
              lockedScaleRef.current.set(draggedFurnitureId, currentScale);
            }
          }

          // Reset two-finger rotation state
          if (isRotatingFurniture) {
            setIsRotatingFurniture(false);
            setRotationStartAngle(null);
            setRotationStartTouchAngle(null);
            twoFingerStartRef.current = null;
          }
        }
      }

      // Two finger gesture: Rotate furniture (PINCH_OR_ROTATE_TWO_FINGERS state)
      if (touchCount === 2 && selectedPlacedId && isARActive && gestureState === 'PINCH_OR_ROTATE_TWO_FINGERS') {
        const touch1 = touches[0];
        const touch2 = touches[1];

        // Calculate center point and angle between two touches
        const centerX = (touch1.pageX + touch2.pageX) / 2;
        const centerY = (touch1.pageY + touch2.pageY) / 2;
        const dx = touch2.pageX - touch1.pageX;
        const dy = touch2.pageY - touch1.pageY;
        const currentAngle = Math.atan2(dy, dx);
        const currentDistance = Math.sqrt(dx * dx + dy * dy);

        if (!isRotatingFurniture) {
          // Start rotation
          setIsRotatingFurniture(true);
          const entry = furnitureMapRef.current.get(selectedPlacedId);
          if (entry) {
            setRotationStartAngle(entry.mesh.rotation.y);
            setRotationStartTouchAngle(currentAngle);
            twoFingerStartRef.current = { angle: currentAngle, distance: currentDistance, centerX, centerY };
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
          }
        } else if (rotationStartAngle !== null && rotationStartTouchAngle !== null) {
          // Continue rotation
          const entry = furnitureMapRef.current.get(selectedPlacedId);
          if (entry) {
            const angleDelta = currentAngle - rotationStartTouchAngle;
            const newRotation = rotationStartAngle + angleDelta;

            // Apply rotation with snapping if enabled
            const finalRotation = snapToGrid ? snapRotation(newRotation) : newRotation;
            entry.mesh.rotation.y = finalRotation;

            // Provide haptic feedback during rotation
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
          }
        }
        return;
      }

      // Single finger gesture: Move furniture ONLY (MOVE_SINGLE_FINGER state)
      // Also allow dragging if furniture is selected, even if gesture state hasn't fully transitioned yet
      if (touchCount === 1 && (gestureState === 'MOVE_SINGLE_FINGER' || (selectedPlacedId && isARActive))) {
        // If dragging furniture, update its position with enhancements
        const furnitureId = draggedFurnitureId || selectedPlacedId || '';
        if (furnitureId && (isDraggingFurniture || selectedPlacedId)) {
          // Ensure dragging state is set
          if (!isDraggingFurniture) {
            setIsDraggingFurniture(true);
            setDraggedFurnitureId(furnitureId);
          }
          // Throttle drag updates for performance, but always store the latest position
          const now = Date.now();
          const shouldUpdate = now - lastDragUpdateRef.current >= CONFIG.DRAG_UPDATE_THROTTLE;

          // Always store the latest position to ensure final update is never missed
          pendingDragPositionRef.current = { locationX, locationY };

          // Skip update if throttled, but position is stored for final update
          if (!shouldUpdate) {
            return;
          }

          lastDragUpdateRef.current = now;
          const { width, height } = glLayoutRef.current;
          if (width === 0 || height === 0) return;

          const ndc = new THREE.Vector2(
            (locationX / width) * 2 - 1,
            -(locationY / height) * 2 + 1,
          );

          if (!raycasterRef.current || !floorPlaneRef.current) return;

          raycasterRef.current.setFromCamera(ndc, cameraRef.current);
          const intersectionPoint = new THREE.Vector3();

          if (raycasterRef.current.ray.intersectPlane(floorPlaneRef.current, intersectionPoint)) {
            const projected = arAnchorManager.projectToWorld(vector3ToSpatial(intersectionPoint));
            let worldVector = spatialToVector3(projected);
            let alignedPosition = alignToFloor(worldVector);

            // Apply grid snapping if enabled
            if (snapToGrid) {
              alignedPosition = snapToGridPosition(alignedPosition);
            }

            // Check for alignment with other furniture
            const entry = furnitureMapRef.current.get(furnitureId);
            if (entry) {
              const item = entry.item;

              // CRITICAL: Lock scale during single-finger drag - NEVER allow scale to change
              const lockedScale = lockedScaleRef.current.get(furnitureId) ?? (furnitureScale[furnitureId] || 1.0);
              // Force scale to locked value - this prevents ANY accidental scaling
              if (Math.abs(entry.mesh.scale.x - lockedScale) > 0.001 ||
                Math.abs(entry.mesh.scale.y - lockedScale) > 0.001 ||
                Math.abs(entry.mesh.scale.z - lockedScale) > 0.001) {
                entry.mesh.scale.setScalar(lockedScale);
              }

              // Check for magnetic snapping (wall, corner, edge, furniture)
              let detectedSnapType: 'wall' | 'corner' | 'edge' | 'furniture' | null = null;
              let snapApplied = false;

              // Priority: Corner > Wall > Edge > Furniture
              const cornerSnap = findCornerSnapTargets(alignedPosition, roomData);
              if (cornerSnap) {
                if (cornerSnap.x !== undefined) alignedPosition.x = cornerSnap.x;
                if (cornerSnap.z !== undefined) alignedPosition.z = cornerSnap.z;
                detectedSnapType = 'corner';
                snapApplied = true;
              } else {
                const wallSnaps = findWallSnapTargets(alignedPosition, roomData);
                if (wallSnaps.x !== undefined || wallSnaps.z !== undefined) {
                  if (wallSnaps.x !== undefined) alignedPosition.x = wallSnaps.x;
                  if (wallSnaps.z !== undefined) alignedPosition.z = wallSnaps.z;
                  detectedSnapType = 'wall';
                  snapApplied = true;
                } else {
                  const edgeSnaps = findEdgeAlignmentTargets(alignedPosition, item.dimensions, roomData);
                  if (edgeSnaps.x !== undefined || edgeSnaps.z !== undefined) {
                    if (edgeSnaps.x !== undefined) alignedPosition.x = edgeSnaps.x;
                    if (edgeSnaps.z !== undefined) alignedPosition.z = edgeSnaps.z;
                    detectedSnapType = 'edge';
                    snapApplied = true;
                  } else {
                    const alignments = findAlignmentTargets(
                      alignedPosition,
                      furnitureMapRef.current,
                      furnitureId || ''
                    );
                    if (alignments.x !== undefined || alignments.z !== undefined) {
                      if (alignments.x !== undefined) alignedPosition.x = alignments.x;
                      if (alignments.z !== undefined) alignedPosition.z = alignments.z;
                      detectedSnapType = 'furniture';
                      snapApplied = true;
                    }
                  }
                }
              }

              // Update magnetic snap state and provide haptic feedback (batched)
              if (snapApplied && detectedSnapType) {
                const wasSnapping = magneticSnapActive && snapType === detectedSnapType;
                if (!wasSnapping) {
                  // New snap detected - provide haptic feedback
                  updateDragState({
                    magneticSnap: true,
                    snapType: detectedSnapType,
                  });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => { });
                }
              } else {
                // No snap detected - clear state (batched)
                if (magneticSnapActive) {
                  updateDragState({
                    magneticSnap: false,
                    snapType: null,
                  });
                }
              }

              // Apply alignments (for furniture alignment, already applied above)
              if (!snapApplied) {
                const alignments = findAlignmentTargets(
                  alignedPosition,
                  furnitureMapRef.current,
                  furnitureId
                );
                if (alignments.x !== undefined) {
                  alignedPosition.x = alignments.x;
                }
                if (alignments.z !== undefined) {
                  alignedPosition.z = alignments.z;
                }
              }

              // Apply rotation smoothly - always calculate from start rotation + current drag rotation
              const currentRotation = dragStartRotation !== null
                ? dragStartRotation + dragRotation
                : dragRotation;

              // Apply snapped rotation if needed
              const finalRotation = snapToGrid ? snapRotation(currentRotation) : currentRotation;
              entry.mesh.rotation.y = finalRotation;

              // Update furniture position
              entry.mesh.position.set(
                alignedPosition.x,
                alignedPosition.y + item.dimensions.height / 2,
                alignedPosition.z
              );

              // Always store latest aligned position to prevent race conditions with rapid state updates
              latestDragPositionRef.current = alignedPosition.clone();

              // Update ghost preview with rotation (only if still dragging)
              if (dragGhostRef.current && showDragGuides && isDraggingFurniture && draggedFurnitureId) {
                dragGhostRef.current.position.set(
                  alignedPosition.x,
                  alignedPosition.y + item.dimensions.height / 2,
                  alignedPosition.z
                );
                dragGhostRef.current.rotation.y = finalRotation;
              } else if (dragGhostRef.current && (!isDraggingFurniture || !draggedFurnitureId)) {
                // Clean up drag ghost if drag ended
                if (rootGroupRef.current && dragGhostRef.current instanceof THREE.Mesh) {
                  rootGroupRef.current.remove(dragGhostRef.current);
                  if (dragGhostRef.current.geometry) {
                    dragGhostRef.current.geometry.dispose();
                  }
                  if (dragGhostRef.current.material) {
                    if (Array.isArray(dragGhostRef.current.material)) {
                      dragGhostRef.current.material.forEach((mat: THREE.Material) => mat.dispose());
                    } else {
                      dragGhostRef.current.material.dispose();
                    }
                  }
                  dragGhostRef.current = null;
                } else if (rootGroupRef.current && dragGhostRef.current instanceof THREE.Group) {
                  rootGroupRef.current.remove(dragGhostRef.current);
                  disposeObjectRecursive(dragGhostRef.current);
                  dragGhostRef.current = null;
                }
              }

              // Check safety during drag with current rotation (throttled)
              if (now - lastCollisionCheckRef.current >= CONFIG.COLLISION_CHECK_THROTTLE) {
                lastCollisionCheckRef.current = now;

                const tempBox = createFurnitureBoundingBox(
                  alignedPosition,
                  item.dimensions,
                  { y: finalRotation }
                );
                const safetyInfo = getPlacementSafety(
                  tempBox,
                  obstacleMapRef.current,
                  furnitureMapRef.current,
                  roomData,
                  draggedFurnitureId || undefined,
                  CONFIG.COLLISION_MARGIN
                );

                // Update safety indicator (batched)
                updateDragState({ safety: safetyInfo });

                // Announce safety status changes for accessibility
                if (safetyInfo.safetyLevel !== placementSafety.safetyLevel) {
                  const safetyAnnouncement = `Safety status: ${safetyInfo.safetyLevel}. Safety score: ${safetyInfo.safetyScore} percent. ${safetyInfo.reason || ''}`;
                  AccessibilityInfo.announceForAccessibility(safetyAnnouncement);
                }

                // Visual feedback: change color based on safety
                const updateSafetyEmissive = (mesh: THREE.Mesh | THREE.Group, hex: number, intensity: number) => {
                  if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
                    mesh.material.emissive.setHex(hex);
                    mesh.material.emissiveIntensity = intensity;
                  } else if (mesh instanceof THREE.Group) {
                    mesh.traverse((child) => {
                      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
                        child.material.emissive.setHex(hex);
                        child.material.emissiveIntensity = intensity;
                      }
                    });
                  }
                };

                if (safetyInfo.safetyLevel === 'danger') {
                  updateSafetyEmissive(entry.mesh, 0xff0000, 0.4);
                } else if (safetyInfo.safetyLevel === 'warning') {
                  updateSafetyEmissive(entry.mesh, 0xffaa00, 0.25);
                } else {
                  updateSafetyEmissive(entry.mesh, 0x00ff00, 0.15);
                }
              }

              // Update visual guides only if still actively dragging
              if (isDraggingFurniture && draggedFurnitureId) {
                // Update alignment lines if enabled and alignments exist
                // Check for furniture alignment separately (not part of magnetic snap)
                const furnitureAlignments = findAlignmentTargets(
                  alignedPosition,
                  furnitureMapRef.current,
                  draggedFurnitureId
                );
                if (showDragGuides && (furnitureAlignments.x !== undefined || furnitureAlignments.z !== undefined)) {
                  updateAlignmentLines(entry.mesh, furnitureAlignments);
                } else {
                  // Always clear lines when no alignments or guides are off
                  cleanupAlignmentLines();
                }

                // Update dimension labels during drag
                if (showDragGuides) {
                  updateDimensionLabels(entry.mesh, item);
                } else {
                  cleanupDimensionLabels();
                }

                // Show room boundary constraints
                if (showDragGuides) {
                  showRoomConstraints(alignedPosition, item.dimensions);
                } else {
                  cleanupConstraintLines();
                }
              } else {
                // Drag ended - clean up all visual guides
                cleanupAlignmentLines();
                cleanupDimensionLabels();
                cleanupConstraintLines();
              }

              // Save to history (throttled to prevent flooding)
              if (CONFIG.DRAG_HISTORY_ENABLED) {
                const now = Date.now();
                if (now - lastHistorySaveRef.current >= CONFIG.DRAG_HISTORY_THROTTLE) {
                  lastHistorySaveRef.current = now;
                  // History will be saved on drag end
                }
              }
            }
          }
        } else {
          // Normal reticle update when not dragging
          updateReticleFromScreen();
        }
      } else {
        // No valid touch count or invalid state - reset to IDLE
        if (gestureState !== 'IDLE') {
          setGestureState('IDLE');
        }
      }
    },
    [rendererReady, updateReticleFromScreen, isDraggingFurniture, draggedFurnitureId, roomData, snapToGrid, showDragGuides, dragRotation, dragStartRotation, updateAlignmentLines, magneticSnapActive, cleanupAlignmentLines, updateDimensionLabels, cleanupDimensionLabels, showRoomConstraints, cleanupConstraintLines, selectedPlacedId, isARActive, isRotatingFurniture, rotationStartAngle, rotationStartTouchAngle, gestureState, furnitureScale],
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _rotateSelectedFurniture = useCallback(
    (direction: 'left' | 'right' | number) => {
      if (!selectedPlacedId) {
        return;
      }
      const entry = furnitureMapRef.current.get(selectedPlacedId);
      if (!entry) {
        return;
      }
      const delta = typeof direction === 'number'
        ? direction
        : direction === 'left' ? Math.PI / 12 : -Math.PI / 12;
      entry.mesh.rotation.y += delta;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
    },
    [selectedPlacedId],
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _duplicateFurniture = useCallback(() => {
    if (!selectedPlacedId) {
      return;
    }
    const entry = furnitureMapRef.current.get(selectedPlacedId);
    if (!entry || !rootGroupRef.current) {
      return;
    }

    // Get current position and offset slightly
    if (!entry.mesh.position) return;
    const currentPos = entry.mesh.position.clone();
    const offset = new THREE.Vector3(0.3, 0, 0.3); // Offset by 30cm diagonally
    const newPosition = currentPos.clone().add(offset);
    const alignedPosition = alignToFloor(newPosition);

    const libraryItem = entry.item;
    if (!libraryItem) return;

    // Create new furniture mesh
    const widthSegs = Math.max(2, Math.floor(libraryItem.dimensions.width * 2));
    const heightSegs = Math.max(2, Math.floor(libraryItem.dimensions.height * 2));
    const depthSegs = Math.max(2, Math.floor(libraryItem.dimensions.length * 2));
    const geometry = new THREE.BoxGeometry(
      libraryItem.dimensions.width,
      libraryItem.dimensions.height,
      libraryItem.dimensions.length,
      widthSegs,
      heightSegs,
      depthSegs,
    );
    const colorValue = libraryItem.color || '#808080';
    const baseColor = new THREE.Color(colorValue);
    // Validate color was created successfully
    if (!baseColor || !baseColor.isColor) {
      baseColor.setHex(0x808080);
    }
    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.6,
      metalness: 0.2,
    });
    const newMesh = new THREE.Mesh(geometry, material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    newMesh.position.copy(alignedPosition);
    newMesh.rotation.y = entry.mesh.rotation.y;

    const meshId = `furniture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    newMesh.userData = {
      type: 'furniture',
      id: meshId,
      libraryId: libraryItem.id,
    };

    rootGroupRef.current.add(newMesh);
    furnitureMapRef.current.set(meshId, {
      mesh: newMesh,
      item: libraryItem,
      libraryId: libraryItem.id,
    });

    const newFurniture = {
      id: meshId,
      libraryId: libraryItem.id,
      name: libraryItem.name,
      emoji: libraryItem.emoji || '',
      price: libraryItem.price,
    };

    const updatedFurniture = [...placedFurniture, newFurniture];
    saveToHistoryWithSceneCheck(updatedFurniture);
    setPlacedFurniture(updatedFurniture);
    setSelectedPlacedId(meshId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
  }, [selectedPlacedId, placedFurniture, saveToHistoryWithSceneCheck, alignToFloor]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _swapFurniture = useCallback((newLibraryId: string) => {
    if (!selectedPlacedId) {
      return;
    }
    const entry = furnitureMapRef.current.get(selectedPlacedId);
    if (!entry || !rootGroupRef.current) {
      return;
    }

    const libraryItem = furnitureLibraryById[newLibraryId];
    if (!libraryItem) {
      return;
    }

    // Store current position and rotation
    if (!entry.mesh.position) return;
    const currentPosition = entry.mesh.position.clone();
    const currentRotation = entry.mesh.rotation.y;

    // Remove old mesh
    rootGroupRef.current.remove(entry.mesh);
    if (entry.mesh instanceof THREE.Group) {
      disposeObjectRecursive(entry.mesh);
    } else {
      disposeMesh(entry.mesh);
    }

    // Create new mesh with same position/rotation
    const widthSegs = Math.max(2, Math.floor(libraryItem.dimensions.width * 2));
    const heightSegs = Math.max(2, Math.floor(libraryItem.dimensions.height * 2));
    const depthSegs = Math.max(2, Math.floor(libraryItem.dimensions.length * 2));
    const geometry = new THREE.BoxGeometry(
      libraryItem.dimensions.width,
      libraryItem.dimensions.height,
      libraryItem.dimensions.length,
      widthSegs,
      heightSegs,
      depthSegs,
    );
    const colorValue = libraryItem.color || '#808080';
    const baseColor = new THREE.Color(colorValue);
    // Validate color was created successfully
    if (!baseColor || !baseColor.isColor) {
      baseColor.setHex(0x808080);
    }
    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.6,
      metalness: 0.2,
    });
    const newMesh = new THREE.Mesh(geometry, material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    newMesh.position.copy(currentPosition);
    newMesh.rotation.y = currentRotation;
    newMesh.userData = {
      type: 'furniture',
      id: selectedPlacedId,
      libraryId: newLibraryId,
    };

    rootGroupRef.current.add(newMesh);
    furnitureMapRef.current.set(selectedPlacedId, {
      mesh: newMesh,
      item: libraryItem,
      libraryId: newLibraryId,
    });

    // Update furniture list
    const updated = placedFurniture.map(item =>
      item.id === selectedPlacedId
        ? { ...item, libraryId: newLibraryId, name: libraryItem.name, emoji: libraryItem.emoji || '', price: libraryItem.price }
        : item
    );
    saveToHistoryWithSceneCheck(updated);
    setPlacedFurniture(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
  }, [selectedPlacedId, furnitureLibraryById, placedFurniture, saveToHistoryWithSceneCheck]);

  const nudgeSelectedFurniture = useCallback(
    (axis: 'x' | 'z', delta: number) => {
      if (!selectedPlacedId) {
        return;
      }
      const entry = furnitureMapRef.current.get(selectedPlacedId);
      if (!entry) {
        return;
      }
      entry.mesh.position[axis] += delta;
    },
    [selectedPlacedId],
  );

  // Demo Mode: Preset furniture arrangements
  const DEMO_PRESETS = [
    {
      name: 'Living Room Setup',
      description: 'Complete living room with sofa, coffee table, and accessories',
      furniture: [
        { id: 'sofa-modern', position: { x: 0, z: -1 }, rotation: 0 },
        { id: 'coffee-table', position: { x: 0, z: 0.5 }, rotation: 0 },
        { id: 'floor-lamp', position: { x: -1.5, z: -0.5 }, rotation: 0 },
        { id: 'accent-chair', position: { x: 1.2, z: -0.8 }, rotation: Math.PI / 4 },
      ],
    },
    {
      name: 'Office Setup',
      description: 'Productive workspace arrangement',
      furniture: [
        { id: 'bookshelf', position: { x: -1.5, z: -1.5 }, rotation: Math.PI / 2 },
        { id: 'accent-chair', position: { x: 0, z: 0 }, rotation: 0 },
        { id: 'planter', position: { x: 1.5, z: 1.5 }, rotation: 0 },
      ],
    },
    {
      name: 'Minimalist Setup',
      description: 'Clean and simple arrangement',
      furniture: [
        { id: 'sofa-modern', position: { x: 0, z: -1 }, rotation: 0 },
        { id: 'coffee-table', position: { x: 0, z: 0.3 }, rotation: 0 },
      ],
    },
  ];

  // Demo Mode: Guided tour steps
  const DEMO_TOUR_STEPS = [
    { title: 'Welcome to AR Interior Design', description: 'This demo will show you how to place and arrange furniture in AR space', duration: 3000 },
    { title: 'Select Furniture', description: 'Choose furniture from the library below', duration: 2000 },
    { title: 'Place in AR', description: 'Tap on the floor to place furniture in your room', duration: 2000 },
    { title: 'Drag & Rotate', description: 'Tap furniture to drag it, use rotate buttons to change orientation', duration: 2500 },
    { title: 'Safety System', description: 'Watch the safety indicator - green means safe placement', duration: 2000 },
    { title: 'Measurements', description: 'Use measurement tools to check distances and areas', duration: 2000 },
  ];

  // Start demo mode
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _startDemoMode = useCallback(() => {
    if (!roomData || !rendererReady) {
      Alert.alert('Demo Mode', 'Please wait for AR to initialize and room data to load.');
      return;
    }

    setDemoMode(true);
    _setDemoStep(0);
    _setDemoTourActive(true);

    // Clear existing furniture for clean demo
    placedFurniture.forEach(item => {
      const entry = furnitureMapRef.current.get(item.id);
      if (entry && rootGroupRef.current) {
        rootGroupRef.current.remove(entry.mesh);
        if (entry.mesh instanceof THREE.Group) {
          disposeObjectRecursive(entry.mesh);
        } else {
          disposeMesh(entry.mesh);
        }
      }
    });
    furnitureMapRef.current.clear();
    setPlacedFurniture([]);

    // Start guided tour
    let currentStep = 0;
    const showTourStep = () => {
      if (currentStep < DEMO_TOUR_STEPS.length) {
        const step = DEMO_TOUR_STEPS[currentStep];
        _setDemoStep(currentStep);
        setComponentError(null);

        // Show step message
        Alert.alert(
          step.title,
          step.description,
          [{
            text: 'Next', onPress: () => {
              currentStep++;
              if (currentStep < DEMO_TOUR_STEPS.length) {
                demoTimeoutRef.current = setTimeout(showTourStep, 500);
              } else {
                // After tour, load preset
                loadDemoPreset(0);
              }
            }
          }]
        );
      }
    };

    showTourStep();
  }, [roomData, rendererReady, placedFurniture]);

  // Load demo preset
  const loadDemoPreset = useCallback((presetIndex: number) => {
    if (presetIndex >= DEMO_PRESETS.length) {
      setDemoMode(false);
      _setDemoTourActive(false);
      return;
    }

    const preset = DEMO_PRESETS[presetIndex];
    setComponentError(null);

    // Place furniture from preset with delays for visual effect
    preset.furniture.forEach((item, index) => {
      setTimeout(() => {
        const libraryItem = furnitureLibraryById[item.id];
        if (!libraryItem || !roomData) return;

        const worldPosition = new THREE.Vector3(
          item.position.x,
          0,
          item.position.z
        );

        // Create furniture mesh
        const widthSegs = Math.max(2, Math.floor(libraryItem.dimensions.width * 2));
        const heightSegs = Math.max(2, Math.floor(libraryItem.dimensions.height * 2));
        const depthSegs = Math.max(2, Math.floor(libraryItem.dimensions.length * 2));

        const geometry = new THREE.BoxGeometry(
          libraryItem.dimensions.width,
          libraryItem.dimensions.height,
          libraryItem.dimensions.length,
          widthSegs,
          heightSegs,
          depthSegs
        );

        const material = new THREE.MeshStandardMaterial({
          color: libraryItem.color,
          metalness: 0.3,
          roughness: 0.7,
          envMapIntensity: 0.5,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(
          worldPosition.x,
          worldPosition.y + libraryItem.dimensions.height / 2,
          worldPosition.z
        );
        mesh.rotation.y = item.rotation;

        if (rootGroupRef.current) {
          rootGroupRef.current.add(mesh);
        }

        const furnitureId = `demo-${item.id}-${Date.now()}-${index}`;
        furnitureMapRef.current.set(furnitureId, {
          mesh,
          item: libraryItem,
          libraryId: item.id,
        });

        const newFurniture: PlacedFurnitureMeta = {
          id: furnitureId,
          libraryId: item.id,
          name: libraryItem.name,
          emoji: libraryItem.emoji || '',
          price: libraryItem.price,
        };

        setPlacedFurniture(prev => [...prev, newFurniture]);

        // Highlight furniture with animation
        setHighlightedFurniture(furnitureId);
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }
        highlightTimeoutRef.current = setTimeout(() => {
          setHighlightedFurniture(null);
        }, CONFIG.INTERACTIVE_HIGHLIGHT_DURATION);

        // Haptic feedback
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
      }, index * 800); // Stagger placement for visual effect
    });

    // Auto-advance to next preset after delay
    demoTimeoutRef.current = setTimeout(() => {
      if (presetIndex < DEMO_PRESETS.length - 1) {
        // Clear current preset
        placedFurniture.forEach(item => {
          const entry = furnitureMapRef.current.get(item.id);
          if (entry && rootGroupRef.current) {
            rootGroupRef.current.remove(entry.mesh);
            if (entry.mesh instanceof THREE.Group) {
              disposeObjectRecursive(entry.mesh);
            } else {
              disposeMesh(entry.mesh);
            }
          }
        });
        furnitureMapRef.current.clear();
        setPlacedFurniture([]);

        // Load next preset
        setTimeout(() => loadDemoPreset(presetIndex + 1), 1000);
      } else {
        setDemoMode(false);
        _setDemoTourActive(false);
        Alert.alert('Demo Complete', 'You can now interact with the furniture or start a new demo.');
      }
    }, preset.furniture.length * 800 + 3000);
  }, [roomData, furnitureLibraryById, placedFurniture]);

  // Stop demo mode
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _stopDemoMode = useCallback(() => {
    setDemoMode(false);
    _setDemoTourActive(false);
    _setDemoStep(0);

    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    if (demoTimeoutRef.current) {
      clearTimeout(demoTimeoutRef.current);
      demoTimeoutRef.current = null;
    }
  }, []);

  // Cleanup demo on unmount
  useEffect(() => {
    return () => {
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
      }
      if (demoTimeoutRef.current) {
        clearTimeout(demoTimeoutRef.current);
      }
    };
  }, []);

  const removeFurniture = useCallback((id: string) => {
    const entry = furnitureMapRef.current.get(id);
    if (!entry) {
      return;
    }
    const furnitureName = entry.item.name;
    rootGroupRef.current?.remove(entry.mesh);
    if (entry.mesh instanceof THREE.Group) {
      disposeObjectRecursive(entry.mesh);
    } else {
      disposeMesh(entry.mesh);
    }
    furnitureMapRef.current.delete(id);
    const updated = placedFurniture.filter((item) => item.id !== id);

    // Accessibility announcement for furniture removal
    AccessibilityInfo.announceForAccessibility(
      `Removed ${furnitureName} from scene. ${updated.length} furniture item${updated.length !== 1 ? 's' : ''} remaining.`
    );

    // Save to history with validation to prevent corruption
    saveToHistoryWithSceneCheck(updated);

    setPlacedFurniture(updated);
    if (selectedPlacedId === id) {
      setSelectedPlacedId(null);
    }
  }, [selectedPlacedId, placedFurniture, saveToHistoryWithSceneCheck]);

  const restoreFurnitureState = useCallback((state: PlacedFurnitureMeta[]) => {
    if (!rootGroupRef.current) return;

    // Validate state before restoring to prevent corruption
    // Don't check scene presence during restoration since we're about to restore the furniture
    const validatedState = validateHistoryState(state, false);

    // Warn if validation removed items
    if (validatedState.length !== state.length) {
      console.warn(`[ARView] History restoration: Removed ${state.length - validatedState.length} invalid items from restored state.`);
    }

    // Remove all current furniture
    furnitureMapRef.current.forEach(({ mesh }) => {
      rootGroupRef.current?.remove(mesh);
      if (mesh instanceof THREE.Group) {
        disposeObjectRecursive(mesh);
      } else {
        disposeMesh(mesh);
      }
    });
    furnitureMapRef.current.clear();

    // Restore validated state (not the original potentially corrupted state)
    if (validatedState && validatedState.length > 0) {
      validatedState.forEach((item) => {
        const libraryItem = furnitureLibraryById[item.libraryId];
        if (libraryItem && rootGroupRef.current) {
          // Enhanced geometry for restored furniture
          const widthSegs = Math.max(2, Math.floor(libraryItem.dimensions.width * 2));
          const heightSegs = Math.max(2, Math.floor(libraryItem.dimensions.height * 2));
          const depthSegs = Math.max(2, Math.floor(libraryItem.dimensions.length * 2));
          const geometry = new THREE.BoxGeometry(
            libraryItem.dimensions.width,
            libraryItem.dimensions.height,
            libraryItem.dimensions.length,
            widthSegs,
            heightSegs,
            depthSegs,
          );
          const colorValue = libraryItem.color || '#808080';
          const baseColor = new THREE.Color(colorValue);
          // Validate color was created successfully
          if (!baseColor || !baseColor.isColor) {
            baseColor.setHex(0x808080);
          }
          const material = new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.6,
            metalness: 0.2,
            envMapIntensity: 0.5,
            emissive: baseColor.clone().multiplyScalar(0.05),
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = {
            type: 'furniture',
            id: item.id,
            libraryId: item.libraryId,
          };
          rootGroupRef.current.add(mesh);
          furnitureMapRef.current.set(item.id, {
            mesh,
            item: libraryItem,
            libraryId: item.libraryId,
          });
        }
      });
    }
  }, [furnitureLibraryById, validateHistoryState]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _undoFurniture = useCallback(() => {
    const previousState = undo();
    if (previousState) {
      // Validate and restore state to prevent corruption
      const validatedState = validateHistoryState(previousState);
      restoreFurnitureState(validatedState);
      setPlacedFurniture(validatedState);
      setSelectedPlacedId(null);
    }
  }, [undo, restoreFurnitureState, validateHistoryState]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _redoFurniture = useCallback(() => {
    const nextState = redo();
    if (nextState) {
      // Validate and restore state
      const validatedState = validateHistoryState(nextState);
      restoreFurnitureState(validatedState);
      setPlacedFurniture(validatedState);
      setSelectedPlacedId(null);
    }
  }, [redo, restoreFurnitureState, validateHistoryState]);

  // Calculate total cost of all placed furniture
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _calculateTotalCost = useCallback((): number => {
    return placedFurniture.reduce((total, item) => {
      const priceStr = item.price.replace(/[^0-9.]/g, '');
      const price = parseFloat(priceStr) || 0;
      return total + price;
    }, 0);
  }, [placedFurniture]);

  // OPTIMIZED: Get filtered furniture by category with limit for performance
  const filteredFurnitureLibrary = useMemo(() => {
    let filtered = selectedCategory === 'all'
      ? FURNITURE_LIBRARY
      : FURNITURE_LIBRARY.filter(item => item.category === selectedCategory);

    // Performance optimization: Limit to first 100 items for display
    return filtered;
  }, [selectedCategory]);

  // Get unique categories
  const furnitureCategories = useMemo(() => {
    const categories = new Set<FurnitureLibraryItem['category']>();
    FURNITURE_LIBRARY.forEach(item => categories.add(item.category));
    return Array.from(categories);
  }, []);

  // Helper function to get icon for furniture category
  const getFurnitureIcon = (category: string): any => {
    const iconMap: Record<string, any> = {
      'seating': 'cafe',
      'tables': 'grid',
      'storage': 'cube',
      'bedroom': 'bed',
      'lighting': 'bulb',
      'decor': 'flower',
      'office': 'briefcase',
    };
    return iconMap[category] || 'cube';
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _clearFurniture = useCallback(() => {
    resetFurnitureMeshes();
  }, [resetFurnitureMeshes]);

  // ============================================================================
  // PERSISTENCE: Save/Load/Export
  // ============================================================================

  const STORAGE_KEY = 'ar_furniture_layouts';
  const CURRENT_LAYOUT_KEY = 'ar_current_layout';

  // Save current layout
  const _saveCurrentLayout = useCallback(async (name?: string, silent: boolean = false) => {
    if (placedFurniture.length === 0 && !silent) {
      Alert.alert('No Furniture', 'Please place some furniture before saving.');
      return;
    }

    // For auto-save (silent), we still want to persist the empty state if it was cleared
    // but the layout definition expects furniture. So we allow empty furniture array.

    const layoutName = name || `Layout ${new Date().toLocaleString()}`;
    const layout: SavedLayout = {
      id: `layout-${Date.now()}`,
      name: layoutName,
      timestamp: Date.now(),
      roomData,
      furniture: Array.from(furnitureMapRef.current.entries()).map(([id, entry]) => ({
        id,
        libraryId: entry.libraryId,
        position: {
          x: entry.mesh.position.x,
          y: entry.mesh.position.y - entry.item.dimensions.height / 2,
          z: entry.mesh.position.z,
        },
        rotation: {
          x: entry.mesh.rotation.x,
          y: entry.mesh.rotation.y,
          z: entry.mesh.rotation.z,
        },
      })),
      metadata: {
        totalFurniture: interactiveStats.totalFurniture,
        totalArea: interactiveStats.totalArea,
        averageSafety: interactiveStats.averageSafety,
      },
    };

    try {
      if (!silent) {
        const savedLayouts = await getJson<SavedLayout[]>(STORAGE_KEY, []);
        savedLayouts.push(layout);
        // Keep only last 20 layouts
        const recentLayouts = savedLayouts.slice(-20);
        await setJson(STORAGE_KEY, recentLayouts);
      }

      await setJson(CURRENT_LAYOUT_KEY, layout);

      if (!silent) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
        Alert.alert('Saved', `Layout "${layoutName}" has been saved successfully.`);
      }
    } catch (error) {
      console.error('[ARView] Save error:', error);
      if (!silent) Alert.alert('Save Failed', 'Unable to save layout. Please try again.');
    }
  }, [placedFurniture, roomData, interactiveStats]);

  // Load saved layout
  const _loadSavedLayout = useCallback(async (layout: SavedLayout, silent: boolean = false) => {
    if (!rootGroupRef.current || !roomData) {
      if (!silent) Alert.alert('Error', 'AR must be initialized before loading a layout.');
      return;
    }

    // Clear existing furniture
    resetFurnitureMeshes();
    setPlacedFurniture([]);
    setSelectedPlacedId(null);
    setSelectedFurnitureIds(new Set());

    // Load furniture from layout
    const loadedFurniture: PlacedFurnitureMeta[] = [];

    for (const item of layout.furniture) {
      const libraryItem = furnitureLibraryById[item.libraryId];
      if (!libraryItem) continue;

      const widthSegs = Math.max(2, Math.floor(libraryItem.dimensions.width * 2));
      const heightSegs = Math.max(2, Math.floor(libraryItem.dimensions.height * 2));
      const depthSegs = Math.max(2, Math.floor(libraryItem.dimensions.length * 2));

      const geometry = new THREE.BoxGeometry(
        libraryItem.dimensions.width,
        libraryItem.dimensions.height,
        libraryItem.dimensions.length,
        widthSegs,
        heightSegs,
        depthSegs
      );

      const colorValue = libraryItem.color || '#808080';
      const baseColor = new THREE.Color(colorValue);
      // Validate color was created successfully
      if (!baseColor || !baseColor.isColor) {
        baseColor.setHex(0x808080);
      }
      const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.6,
        metalness: 0.2,
        envMapIntensity: 0.5,
        emissive: baseColor.clone().multiplyScalar(0.05),
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(
        item.position.x,
        item.position.y + libraryItem.dimensions.height / 2,
        item.position.z
      );
      mesh.rotation.set(
        item.rotation.x || 0,
        item.rotation.y || 0,
        item.rotation.z || 0
      );
      mesh.userData = {
        type: 'furniture',
        id: item.id,
        libraryId: item.libraryId,
      };

      rootGroupRef.current.add(mesh);
      furnitureMapRef.current.set(item.id, {
        mesh,
        item: libraryItem,
        libraryId: item.libraryId,
      });

      loadedFurniture.push({
        id: item.id,
        libraryId: item.libraryId,
        name: libraryItem.name,
        emoji: libraryItem.emoji || '',
        price: libraryItem.price,
      });
    }

    setPlacedFurniture(loadedFurniture);
    if (layout.metadata) {
      setInteractiveStats({
        totalFurniture: layout.metadata.totalFurniture,
        totalArea: layout.metadata.totalArea,
        averageSafety: layout.metadata.averageSafety,
        placementCount: layout.metadata.totalFurniture,
      });
    }

    if (!silent) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
      Alert.alert('Loaded', `Layout "${layout.name}" has been loaded successfully.`);
    }
  }, [roomData, furnitureLibraryById, resetFurnitureMeshes]);

  // Export layout as JSON
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _exportLayout = useCallback(async () => {
    if (placedFurniture.length === 0) {
      Alert.alert('No Furniture', 'Please place some furniture before exporting.');
      return;
    }

    const exportData: SavedLayout = {
      id: `export-${Date.now()}`,
      name: `Exported Layout ${new Date().toLocaleString()}`,
      timestamp: Date.now(),
      roomData,
      furniture: Array.from(furnitureMapRef.current.entries()).map(([id, entry]) => ({
        id,
        libraryId: entry.libraryId,
        position: {
          x: entry.mesh.position.x,
          y: entry.mesh.position.y - entry.item.dimensions.height / 2,
          z: entry.mesh.position.z,
        },
        rotation: {
          x: entry.mesh.rotation.x,
          y: entry.mesh.rotation.y,
          z: entry.mesh.rotation.z,
        },
      })),
      metadata: {
        totalFurniture: interactiveStats.totalFurniture,
        totalArea: interactiveStats.totalArea,
        averageSafety: interactiveStats.averageSafety,
      },
    };

    try {
      const jsonString = JSON.stringify(exportData, null, 2);

      if (Platform.OS === 'web' && typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
        // Web: Download as file (only if running in web environment)
        try {
          const blob = new Blob([jsonString], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `ar-layout-${Date.now()}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } catch (error) {
          console.warn('[ARView] Web export failed, falling back to share:', error);
          // Fall through to Share API
        }
      }

      // Mobile or web fallback: Use Share API
      if (Platform.OS !== 'web' || (Platform.OS === 'web' && typeof Share !== 'undefined')) {
        await Share.share({
          message: jsonString,
          title: 'AR Layout Export',
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
    } catch (error) {
      console.error('[ARView] Export error:', error);
      Alert.alert('Export Failed', 'Unable to export layout. Please try again.');
    }
  }, [placedFurniture, roomData, interactiveStats]);

  // ============================================================================
  // MULTI-SELECT FUNCTIONALITY
  // ============================================================================

  // Toggle furniture selection
  const toggleFurnitureSelection = useCallback((id: string) => {
    setSelectedFurnitureIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
  }, []);

  // Select all furniture
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _selectAllFurniture = useCallback(() => {
    const allIds = new Set(placedFurniture.map(f => f.id));
    setSelectedFurnitureIds(allIds);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => { });
  }, [placedFurniture]);

  // Clear selection
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _clearSelection = useCallback(() => {
    setSelectedFurnitureIds(new Set());
    setSelectedPlacedId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
  }, []);

  // Delete selected furniture
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _deleteSelectedFurniture = useCallback(() => {
    if (selectedFurnitureIds.size === 0) {
      Alert.alert('No Selection', 'Please select furniture to delete.');
      return;
    }

    Alert.alert(
      'Delete Furniture',
      `Delete ${selectedFurnitureIds.size} furniture item(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            selectedFurnitureIds.forEach(id => {
              removeFurniture(id);
            });
            setSelectedFurnitureIds(new Set());
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
          },
        },
      ]
    );
  }, [selectedFurnitureIds, removeFurniture]);

  // ============================================================================
  // FURNITURE GROUPING FUNCTIONALITY
  // ============================================================================

  /**
   * Calculate the center position of multiple furniture items
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _calculateGroupCenter = useCallback((furnitureIds: string[]): THREE.Vector3 => {
    const positions: THREE.Vector3[] = [];
    furnitureIds.forEach(id => {
      const entry = furnitureMapRef.current.get(id);
      if (entry && entry.mesh && entry.mesh.position) {
        positions.push(entry.mesh.position.clone());
      }
    });

    if (positions.length === 0) {
      return new THREE.Vector3(0, 0, 0);
    }

    const center = new THREE.Vector3();
    positions.forEach(pos => center.add(pos));
    center.divideScalar(positions.length);
    return center;
  }, []);

  /**
   * DISABLED: Create a group from selected furniture
   * All furniture is now treated as individual items - no grouping
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _createFurnitureGroup = useCallback(() => {
    // GROUP FUNCTIONALITY DISABLED - All furniture is individual
    Alert.alert(
      'Group Disabled',
      'All furniture items are now individual. Group selection has been removed.',
      [{ text: 'OK' }]
    );
    return;
    // ALL GROUP CODE BELOW IS DISABLED - Function returns early above
  }, [selectedFurnitureIds]);

  /**
   * DISABLED: Ungroup selected group
   * All furniture is now treated as individual items - no grouping
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ungroupFurniture = useCallback((groupId: string) => {
    // UNGROUP FUNCTIONALITY DISABLED - All furniture is already individual
    console.warn('[ARView] Ungroup functionality is disabled. All furniture is individual.');
    return;
    // DISABLED CODE - Group functionality removed
    /*
    const group = furnitureGroups.get(groupId);
    if (!group) {
      console.warn(`[ARView] Group ${groupId} not found for ungrouping`);
      return;
    }
    
    // Remove groupId from furniture metadata
    setPlacedFurniture(prev => prev.map(item => 
      group.furnitureIds.includes(item.id)
        ? { ...item, groupId: undefined }
        : item
    ));
    
    // Remove group
    setFurnitureGroups(prev => {
      const newMap = new Map(prev);
      newMap.delete(groupId);
      return newMap;
    });
    
    // Clear selected group
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
    }
    
    // Save to history
    const updatedFurniture = placedFurniture.map(item => 
      group.furnitureIds.includes(item.id)
        ? { ...item, groupId: undefined }
        : item
    );
    saveToHistoryWithSceneCheck(updatedFurniture);
    
    // Screen reader announcement
    AccessibilityInfo.announceForAccessibility(
      `Ungrouped ${group.furnitureIds.length} furniture items`
    );
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    */
  }, []);

  /**
   * Get furniture items in a group
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getGroupFurniture = useCallback((groupId: string): FurnitureMapEntry[] => {
    // GROUP FUNCTIONALITY DISABLED - All furniture is individual
    // Return empty array since there are no groups
    return [];
    // DISABLED CODE:
    /*
    const group = furnitureGroups.get(groupId);
    if (!group) return [];
    
    return group.furnitureIds
      .map(id => furnitureMapRef.current.get(id))
      .filter((entry): entry is FurnitureMapEntry => entry !== undefined);
    */
  }, []);

  /**
   * Move group as a unit
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _moveGroup = useCallback((groupId: string, deltaPosition: THREE.Vector3) => {
    // GROUP FUNCTIONALITY DISABLED - All furniture is individual
    console.warn('[ARView] Move group functionality is disabled. All furniture is individual.');
    return;
    // DISABLED CODE:
    /*
    const groupFurniture = getGroupFurniture(groupId);
    if (groupFurniture.length === 0) return;
    
    groupFurniture.forEach(entry => {
      entry.mesh.position.add(deltaPosition);
    });
    
    // DISABLED CODE - All group functionality removed
    /*
    // Update group center
    setFurnitureGroups(prev => {
      const group = prev.get(groupId);
      if (!group) return prev;
      
      const newMap = new Map(prev);
      newMap.set(groupId, {
        ...group,
        centerPosition: group.centerPosition.clone().add(deltaPosition),
      });
      return newMap;
    });
    */
  }, []);

  /**
   * Rotate group as a unit around its center
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _rotateGroup = useCallback((groupId: string, rotationAngle: number) => {
    // GROUP FUNCTIONALITY DISABLED - All furniture is individual
    console.warn('[ARView] Rotate group functionality is disabled. All furniture is individual.');
    return;
    // DISABLED CODE - All group functionality removed
    /*
    groupFurniture.forEach(entry => {
      // Calculate relative position to group center
      if (!entry.mesh.position || !group.centerPosition) continue;
      const relativePos = entry.mesh.position.clone().sub(group.centerPosition);
      
      // Rotate relative position
      const rotatedPos = new THREE.Vector3();
      rotatedPos.x = relativePos.x * Math.cos(rotationAngle) - relativePos.z * Math.sin(rotationAngle);
      rotatedPos.z = relativePos.x * Math.sin(rotationAngle) + relativePos.z * Math.cos(rotationAngle);
      rotatedPos.y = relativePos.y;
      
      // Update position
      entry.mesh.position.copy(group.centerPosition.clone().add(rotatedPos));
      
      // Also rotate the furniture itself
      entry.mesh.rotation.y += rotationAngle;
    });
    */
  }, []);

  // Move selected furniture group
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _moveSelectedFurniture = useCallback((delta: { x: number; z: number }) => {
    if (selectedFurnitureIds.size === 0) return;

    selectedFurnitureIds.forEach(id => {
      const entry = furnitureMapRef.current.get(id);
      if (entry) {
        entry.mesh.position.x += delta.x;
        entry.mesh.position.z += delta.z;
      }
    });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
  }, [selectedFurnitureIds]);

  // Rotate selected furniture group
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _rotateSelectedFurnitureGroup = useCallback((delta: number) => {
    if (selectedFurnitureIds.size === 0) return;

    // Calculate center of selected group
    let centerX = 0;
    let centerZ = 0;
    let count = 0;

    selectedFurnitureIds.forEach(id => {
      const entry = furnitureMapRef.current.get(id);
      if (entry) {
        centerX += entry.mesh.position.x;
        centerZ += entry.mesh.position.z;
        count++;
      }
    });

    if (count === 0) return;

    centerX /= count;
    centerZ /= count;

    // Rotate each furniture around center
    selectedFurnitureIds.forEach(id => {
      const entry = furnitureMapRef.current.get(id);
      if (entry) {
        const dx = entry.mesh.position.x - centerX;
        const dz = entry.mesh.position.z - centerZ;
        const angle = Math.atan2(dz, dx) + delta;
        const distance = Math.sqrt(dx * dx + dz * dz);

        entry.mesh.position.x = centerX + Math.cos(angle) * distance;
        entry.mesh.position.z = centerZ + Math.sin(angle) * distance;
        entry.mesh.rotation.y += delta;
      }
    });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
  }, [selectedFurnitureIds]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleAnchorRecentering = useCallback(() => {
    if (!reticleWorldPositionRef.current) {
      return;
    }
    const point = reticleWorldPositionRef.current;
    arAnchorManager.setManualAnchor(
      { x: point.x, y: point.y, z: point.z },
      [0, 0, 0, 1],
    );
    setAnchorStatus(arAnchorManager.getStatus());
  }, []);

  const handleMarkerScanned = useCallback((result: any) => {
    if (!markerTrackingEnabled) return;
    if (!rendererReady) return;
    if (!cameraRef.current) return;
    if (!raycasterRef.current || !floorPlaneRef.current) return;

    const now = Date.now();
    if (now - lastMarkerUpdateRef.current < 250) return; // throttle

    const { width, height } = glLayoutRef.current;
    if (width === 0 || height === 0) return;

    // Expo camera barcode scan shape varies by platform.
    // Try cornerPoints first, then bounds.
    let centerX: number | null = null;
    let centerY: number | null = null;

    const cornerPoints = result?.cornerPoints;
    if (Array.isArray(cornerPoints) && cornerPoints.length > 0) {
      const sum = cornerPoints.reduce(
        (acc: { x: number; y: number }, p: any) => ({
          x: acc.x + (p?.x ?? 0),
          y: acc.y + (p?.y ?? 0),
        }),
        { x: 0, y: 0 }
      );
      centerX = sum.x / cornerPoints.length;
      centerY = sum.y / cornerPoints.length;
    } else if (result?.bounds?.origin && result?.bounds?.size) {
      const { origin, size } = result.bounds;
      centerX = (origin?.x ?? 0) + (size?.width ?? 0) / 2;
      centerY = (origin?.y ?? 0) + (size?.height ?? 0) / 2;
    }

    if (centerX === null || centerY === null) return;

    // Only accept QR scans (defensive)
    if (result?.type && result.type !== 'qr') return;

    const screenPointToFloor = (x: number, y: number): THREE.Vector3 | null => {
      const ndc = new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);
      raycasterRef.current!.setFromCamera(ndc, cameraRef.current!);
      const p = new THREE.Vector3();
      const ok = raycasterRef.current!.ray.intersectPlane(floorPlaneRef.current!, p);
      return ok ? p : null;
    };

    const intersection = screenPointToFloor(centerX, centerY);
    if (!intersection) return;

    lastMarkerUpdateRef.current = now;
    const payload = typeof result?.data === 'string' ? result.data : null;
    setLastMarkerPayload(payload);
    setMarkerLastSeenAt(now);

    const alignedCenter = alignToFloor(intersection);

    // --- Pose estimation from corner points projected onto the floor ---
    // This is NOT full 6DOF, but gives usable yaw + scale calibration on a flat floor.
    let yaw = markerYawRef.current;
    let scale = markerScaleRef.current;

    type ScreenPt = { x: number; y: number };
    const cornerPointsForPose: { x: number; y: number }[] | null =
      Array.isArray(cornerPoints) && cornerPoints.length >= 4
        ? cornerPoints.map((p: any) => ({ x: p?.x ?? 0, y: p?.y ?? 0 }))
        : null;

    if (cornerPointsForPose) {
      // Normalize corners into TL, TR, BL, BR by screen-space sorting
      const pts: ScreenPt[] = cornerPointsForPose.slice(0, 4);
      pts.sort((a: ScreenPt, b: ScreenPt) => (a.y - b.y) || (a.x - b.x)); // top to bottom
      const top2 = pts.slice(0, 2).sort((a: ScreenPt, b: ScreenPt) => a.x - b.x);
      const bot2 = pts.slice(2, 4).sort((a: ScreenPt, b: ScreenPt) => a.x - b.x);
      const tl = top2[0];
      const tr = top2[1];
      const bl = bot2[0];
      const br = bot2[1];

      const wTL = screenPointToFloor(tl.x, tl.y);
      const wTR = screenPointToFloor(tr.x, tr.y);
      const wBL = screenPointToFloor(bl.x, bl.y);
      const wBR = screenPointToFloor(br.x, br.y);

      if (wTL && wTR && wBL && wBR) {
        const vTop = wTR.clone().sub(wTL);
        // yaw around Y axis from direction of top edge on the floor
        const rawYaw = Math.atan2(vTop.z, vTop.x);

        // marker size measured in "world meters" on our floor plane
        const wWidth = wTR.distanceTo(wTL);
        const wHeight = wBL.distanceTo(wTL);
        const measured = Math.max(0.0001, (wWidth + wHeight) / 2);

        // expected marker size in meters: default 0.20m, or allow QR payload like "size=0.15"
        let expected = 0.2;
        if (payload) {
          const m = payload.match(/size\s*=\s*(\d+(\.\d+)?)/i);
          if (m && m[1]) {
            const parsed = Number(m[1]);
            if (Number.isFinite(parsed) && parsed > 0.02 && parsed < 2) expected = parsed;
          }
        }

        const rawScale = Math.max(0.25, Math.min(4, expected / measured));

        // Smooth yaw (shortest angle) + scale
        const SMOOTH = 0.25;
        const delta = Math.atan2(Math.sin(rawYaw - yaw), Math.cos(rawYaw - yaw));
        yaw = yaw + delta * SMOOTH;
        scale = scale + (rawScale - scale) * SMOOTH;

        markerYawRef.current = yaw;
        markerScaleRef.current = scale;
      }
    }

    // Build anchor quaternion (yaw-only)
    const qy = Math.sin(yaw / 2);
    const qw = Math.cos(yaw / 2);
    const quat: [number, number, number, number] = [0, qy, 0, qw];

    // Anchor offset chosen so marker center maps to world origin after rotation+scale:
    // world = anchorPos + R * (local * scale), so anchorPos = -R*(center*scale)
    const rotatedScaledCenter = alignedCenter
      .clone()
      .multiplyScalar(scale)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    const rawOffset = rotatedScaledCenter.multiplyScalar(-1);

    // Smooth offset updates to reduce jitter while the marker is in view
    const SMOOTHING = 0.25;
    if (!markerAnchorOffsetRef.current) {
      markerAnchorOffsetRef.current = rawOffset.clone();
    } else {
      markerAnchorOffsetRef.current.lerp(rawOffset, SMOOTHING);
    }

    arAnchorManager.setMarkerAnchor(vector3ToSpatial(markerAnchorOffsetRef.current), quat, scale);
    setAnchorStatus(arAnchorManager.getStatus());
  }, [markerTrackingEnabled, rendererReady]);

  const handleToggleAR = useCallback(() => {
    if (!permission?.granted) {
      requestPermission().catch((error) => {
        console.error('[ARView] Permission request error:', error);
        setComponentError(ERROR_MESSAGES.CAMERA_PERMISSION_DENIED);
        setArUnavailable(true);

        // Screen reader announcement
        AccessibilityInfo.announceForAccessibility(
          'Camera permission required for AR features. Please grant permission to continue.'
        );

        Alert.alert(
          'Camera Permission Required',
          ERROR_MESSAGES.CAMERA_PERMISSION_DENIED,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Retry',
              onPress: () => {
                requestPermission().then((result) => {
                  if (result.granted) {
                    setArUnavailable(false);
                    setIsARActive(true);
                    AccessibilityInfo.announceForAccessibility('AR mode activated');
                  }
                }).catch(() => { });
              },
            },
          ]
        );
      });
      return;
    }

    setIsARActive((prev) => {
      const next = !prev;
      if (!next) {
        // Reset states when turning AR off
        setArUnavailable(false);
        setRetryCount(0);
      }
      if (next) {
        try {
          const status = arAnchorManager.getStatus();
          setAnchorStatus(status);

          // Graceful degradation: Check if AR is actually available
          // Only show warning after multiple retries and if not dismissed
          if (status.quality === 'poor' && retryCount < 3) {
            const currentRetry = retryCount;
            setRetryCount(prev => prev + 1);
            setTimeout(() => {
              // Retry anchor initialization
              try {
                const newStatus = arAnchorManager.getStatus();
                // Only show alert after 2+ retries and if not dismissed
                if (newStatus.quality === 'poor' && currentRetry >= 1 && !arLimitedDismissed) {
                  setArUnavailable(true);
                  Alert.alert(
                    'AR Limited',
                    'AR tracking quality is poor. Some features may be limited. You can continue in preview mode.',
                    [
                      {
                        text: 'Use Preview Mode', onPress: () => {
                          setCameraMode('preview');
                          setArLimitedDismissed(true);
                        }
                      },
                      {
                        text: 'Continue Anyway', onPress: () => {
                          setArUnavailable(false);
                          setArLimitedDismissed(true);
                        }
                      },
                    ]
                  );
                  AccessibilityInfo.announceForAccessibility(
                    'AR tracking quality is limited. Preview mode available as alternative.'
                  );
                } else if (newStatus.quality !== 'poor') {
                  setArUnavailable(false);
                  setArLimitedDismissed(false); // Reset if quality improves
                }
              } catch (error) {
                console.error('[ARView] Retry error:', error);
                // Don't set arUnavailable on error, let it continue
              }
            }, 1000);
          } else if (status.quality !== 'poor') {
            // Reset dismissed state if quality improves
            setArUnavailable(false);
            setArLimitedDismissed(false);
          }

          // Screen reader announcement
          AccessibilityInfo.announceForAccessibility(
            next ? 'AR mode activated' : 'AR mode deactivated'
          );
        } catch (error) {
          console.error('[ARView] Error getting anchor status:', error);
          setComponentError(ERROR_MESSAGES.ANCHOR_ERROR);
          setArUnavailable(true);

          // Fallback to preview mode
          Alert.alert(
            'AR Unavailable',
            'AR features are not available. Would you like to use preview mode instead?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Use Preview Mode',
                onPress: () => {
                  setCameraMode('preview');
                  setIsARActive(false);
                  AccessibilityInfo.announceForAccessibility('Switched to preview mode');
                },
              },
            ]
          );
        }
      } else if (reticleRef.current) {
        reticleRef.current.visible = false;
        AccessibilityInfo.announceForAccessibility('AR mode deactivated');
      }
      return next;
    });
  }, [permission?.granted, requestPermission, retryCount]);

  /**
   * Graceful degradation: Fall back to 2D preview mode when AR fails
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _fallbackToPreviewMode = useCallback(() => {
    console.log('[ARView] Falling back to 2D preview mode...');
    setIsARActive(false);
    setCameraMode('preview');
    setComponentError('AR mode unavailable. Using 2D preview mode instead.');

    // Show user-friendly notification
    Alert.alert(
      'Switched to Preview Mode',
      'AR features are currently unavailable. You can still view and arrange furniture in 2D preview mode.',
      [
        { text: 'OK', style: 'default' },
        {
          text: 'Try AR Again',
          onPress: () => {
            setComponentError(null);
            handleToggleAR();
          }
        }
      ]
    );
  }, [handleToggleAR]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _selectedFurnitureDetails = useMemo(() => {
    if (!selectedPlacedId) {
      return null;
    }
    const entry = furnitureMapRef.current.get(selectedPlacedId);
    if (!entry) {
      return null;
    }
    return entry.item;
  }, [selectedPlacedId]);


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _obstructionCount = roomData?.obstacles.length ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _canRecentre = Boolean(reticleWorldPositionRef.current);

  const screenHeight = Dimensions.get('window').height;
  const maxPanelHeightLimit = screenHeight * 0.75; // Safety cap at 75%
  const collapsedHeight = 60; // Height of peek area when collapsed
  const [measuredContentHeight, setMeasuredContentHeight] = useState(400);

  // Calculate Target Height: Dynamic based on content, but capped at max limit
  const targetExpandedHeight = useMemo(() => {
    // 80 is roughly the height of the title area (60) + extra padding/offsets
    const calculated = measuredContentHeight + 80;
    return Math.min(maxPanelHeightLimit, Math.max(collapsedHeight + 100, calculated));
  }, [measuredContentHeight, maxPanelHeightLimit, collapsedHeight]);

  const maxPanelHeight = targetExpandedHeight;

  // Bottom sheet modal animation - animate height instead of translateY
  const bottomSheetHeight = useRef(new Animated.Value(collapsedHeight)).current;
  const bottomSheetOpacity = useRef(new Animated.Value(1)).current;
  const currentHeightRef = useRef(collapsedHeight); // Track current height for pan responder
  const isDragging = useRef(false);

  // Animate bottom sheet when visibility changes
  useEffect(() => {
    if (isDragging.current) return; // Don't fight the user's drag

    if (libraryPanelVisible) {
      currentHeightRef.current = maxPanelHeight;
      Animated.parallel([
        Animated.spring(bottomSheetHeight, {
          toValue: maxPanelHeight, // Fully expanded
          useNativeDriver: false, // Height animation doesn't support native driver
          tension: 65,
          friction: 11,
        }),
        Animated.timing(bottomSheetOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      currentHeightRef.current = collapsedHeight;
      Animated.parallel([
        Animated.spring(bottomSheetHeight, {
          toValue: collapsedHeight, // Collapsed to peek area
          useNativeDriver: false,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(bottomSheetOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [libraryPanelVisible, screenHeight, maxPanelHeight, collapsedHeight, bottomSheetHeight, bottomSheetOpacity]);

  // Pan responder for dragging bottom sheet - follows gesture smoothly
  const dragStartHeightRef = useRef(0);
  const bottomSheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        // Always capture touches on draggable areas
        return true;
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to vertical drags (more vertical than horizontal)
        return Math.abs(gestureState.dy) > 3 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 0.5;
      },
      onPanResponderGrant: (evt) => {
        isDragging.current = true;
        // Stop any ongoing animation and capture the exact starting height
        bottomSheetHeight.stopAnimation((value) => {
          const startHeight = value || (libraryPanelVisible ? maxPanelHeight : collapsedHeight);
          dragStartHeightRef.current = startHeight;
          currentHeightRef.current = startHeight;
        });
      },
      onPanResponderMove: (evt, gestureState) => {
        // Follow gesture in real-time - drag down (positive dy) decreases height
        const startHeight = dragStartHeightRef.current || currentHeightRef.current;
        const newValue = startHeight - gestureState.dy;
        const clampedValue = Math.max(collapsedHeight, Math.min(maxPanelHeight, newValue));

        // Update animated value immediately to follow finger
        bottomSheetHeight.setValue(clampedValue);
        currentHeightRef.current = clampedValue;
      },
      onPanResponderRelease: (evt, gestureState) => {
        isDragging.current = false;
        // Get the final position from the current animated value
        const finalValue = currentHeightRef.current;
        const closingThreshold = collapsedHeight + (maxPanelHeight - collapsedHeight) * 0.25; // Close if dragged more than 75% down
        const expansionThreshold = collapsedHeight + (maxPanelHeight - collapsedHeight) * 0.75; // Expand if dragged more than 25% up

        // Determine if should expand or collapse based on position and velocity
        const shouldExpand = (finalValue > expansionThreshold && !libraryPanelVisible) || (gestureState.vy < -0.5);
        const shouldCollapse = (finalValue < closingThreshold && libraryPanelVisible) || (gestureState.vy > 0.5);

        if (shouldExpand && !libraryPanelVisible) {
          setLibraryPanelVisible(true);
        } else if (shouldCollapse && libraryPanelVisible) {
          setLibraryPanelVisible(false);
        } else {
          // Snap back to current state
          Animated.spring(bottomSheetHeight, {
            toValue: libraryPanelVisible ? maxPanelHeight : collapsedHeight,
            useNativeDriver: false,
            tension: 65,
            friction: 11,
          }).start(() => {
            currentHeightRef.current = libraryPanelVisible ? maxPanelHeight : collapsedHeight;
          });
        }
      },
      onPanResponderTerminate: () => {
        isDragging.current = false;
        // Handle interruption (e.g., by system gesture)
        Animated.spring(bottomSheetHeight, {
          toValue: libraryPanelVisible ? maxPanelHeight : collapsedHeight,
          useNativeDriver: false,
          tension: 65,
          friction: 11,
        }).start(() => {
          currentHeightRef.current = libraryPanelVisible ? maxPanelHeight : collapsedHeight;
        });
      },
    })
  ).current;

  // AUTO-PERSISTENCE: Auto-load last saved layout
  useEffect(() => {
    const autoLoad = async () => {
      if (rendererReady && rootGroupRef.current && roomData && !isInitializing) {
        try {
          const lastLayout = await getJson<SavedLayout | null>(CURRENT_LAYOUT_KEY, null);
          if (lastLayout && lastLayout.furniture && lastLayout.furniture.length > 0) {
            console.log('[ARView] Auto-loading last session furniture...');
            await _loadSavedLayout(lastLayout, true);
            AccessibilityInfo.announceForAccessibility(`Restored ${lastLayout.furniture.length} items from your previous session.`);
          }

          // Ensure interaction states are clean after load
          setIsDraggingFurniture(false);
          setDraggedFurnitureId(null);
          setIsRotatingFurniture(false);
          setGestureState('IDLE');
        } catch (error) {
          console.error('[ARView] Auto-load error:', error);
        }
      }
    };
    autoLoad();
  }, [rendererReady, rootGroupRef.current, roomData, isInitializing, _loadSavedLayout]);

  // AUTO-PERSISTENCE: Debounced auto-save
  useEffect(() => {
    const timer = setTimeout(() => {
      _saveCurrentLayout(undefined, true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [placedFurniture, _saveCurrentLayout]);

  return (
    <View
      style={styles.container}
      accessibilityLabel={isARActive ? "AR view with furniture placement" : "AR view inactive"}
    >
      <StatusBar style="light" />
      {permission && !permission.granted ? (
        <View style={styles.permissionContainer}>
          <View style={styles.permissionIconContainer}>
            <Ionicons name="camera" size={64} color={colors.accent} />
          </View>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionText}>
            Allow camera access to enter the augmented reality workspace.
          </Text>
          <AnimatedButton
            style={styles.permissionButton}
            onPress={requestPermission}
            accessibilityRole="button"
            accessibilityLabel="Grant camera permission"
            hapticType="success"
          >
            <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </AnimatedButton>
        </View>
      ) : (
        <>
          <View style={styles.cameraWrapper}>
            {isARActive ? (
              <>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  onBarcodeScanned={markerTrackingEnabled ? handleMarkerScanned : undefined}
                  barcodeScannerSettings={markerTrackingEnabled ? { barcodeTypes: ['qr'] } : undefined}
                />
                <View
                  style={styles.glContainer}
                  onLayout={handleCanvasLayout}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleScenePan}
                  onResponderMove={handleScenePan}
                  onResponderRelease={(event) => {
                    // Reset gesture state on release
                    setGestureState('IDLE');
                    // Reset rotation state on release
                    if (isRotatingFurniture) {
                      setIsRotatingFurniture(false);
                      setRotationStartAngle(null);
                      setRotationStartTouchAngle(null);
                      twoFingerStartRef.current = null;
                    }
                    handleSceneTap(event);
                  }}
                >
                  <GLView
                    style={StyleSheet.absoluteFill}
                    onContextCreate={onContextCreate}
                  />
                </View>
              </>
            ) : (
              <>
                <View style={styles.placeholderView}>
                  <View style={styles.placeholderIconContainer}>
                    <Ionicons name="cube" size={80} color={colors.accent} />
                  </View>
                  <Text style={styles.placeholderTitle}>AR Studio</Text>
                  <Text style={styles.placeholderText}>
                    {cameraMode === 'preview'
                      ? 'Preview Mode: Use gestures to orbit, pan, and zoom'
                      : 'Activate AR to project your generated layouts into real space.'}
                  </Text>
                </View>
                {rendererReady && (
                  <View style={styles.previewModeControls}>
                    <TouchableOpacity
                      style={[styles.previewModeButton, cameraMode === 'preview' && styles.previewModeButtonActive]}
                      onPress={() => {
                        const newMode = cameraMode === 'preview' ? 'ar' : 'preview';
                        setCameraMode(newMode);
                        if (cameraMode === 'ar') {
                          // Reset camera for preview mode
                          setCameraZoom(1.0);
                          setCameraRotation({ x: 0.5, y: 0 });
                        }
                        AccessibilityInfo.announceForAccessibility(
                          `Switched to ${newMode === 'preview' ? 'preview' : 'AR'} mode`
                        );
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={cameraMode === 'preview' ? 'Switch to AR mode' : 'Switch to preview mode'}
                      accessibilityState={{ selected: cameraMode === 'preview' }}
                    >
                      <Ionicons
                        name={cameraMode === 'preview' ? 'phone-portrait' : 'cube'}
                        size={18}
                        color="#FFFFFF"
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.previewModeButtonText}>
                        {cameraMode === 'preview' ? 'Preview Mode' : 'AR Mode'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            <View style={styles.topControls}>
              <AnimatedButton
                style={styles.backButton}
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    // Fallback to home/index if no previous screen
                    router.replace('/(tabs)');
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hapticType="light"
              >
                <Ionicons name="arrow-back" size={20} color={colors.accent} />
                <Text style={styles.backButtonText}>Back</Text>
              </AnimatedButton>

              {/* Error Banner */}
              {(rendererError || componentError) && (
                <View style={styles.errorBanner}>
                  <View style={styles.errorBannerContent}>
                    <Ionicons name="warning" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.errorText}>{rendererError || componentError}</Text>
                  </View>
                  <View style={styles.errorActions}>
                    <TouchableOpacity
                      style={styles.retryButton}
                      onPress={() => {
                        setComponentError(null);
                        setRetryCount(prev => prev + 1);
                        // Retry last operation based on context
                        if (isPlacingFurniture && selectedLibraryItem) {
                          // Retry furniture placement
                          const retryPosition = reticleWorldPositionRef.current || new THREE.Vector3(0, 0, 0);
                          addFurnitureToScene(retryPosition);
                        } else if (isARActive) {
                          // Retry AR initialization
                          handleToggleAR();
                          setTimeout(() => handleToggleAR(), 500);
                        }
                        AccessibilityInfo.announceForAccessibility('Retrying operation');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Retry operation"
                    >
                      <Ionicons name="refresh" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                    {arUnavailable && (
                      <TouchableOpacity
                        style={styles.fallbackButton}
                        onPress={() => {
                          setCameraMode('preview');
                          setIsARActive(false);
                          setComponentError(null);
                          AccessibilityInfo.announceForAccessibility('Switched to preview mode as fallback');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Use preview mode"
                      >
                        <Ionicons name="phone-portrait" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.fallbackButtonText}>Preview Mode</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {/* AR Unavailable Fallback - Only show if not dismissed */}
              {arUnavailable && !componentError && !arLimitedDismissed && (
                <View style={styles.fallbackBanner}>
                  <TouchableOpacity
                    style={styles.fallbackDismissButton}
                    onPress={() => {
                      setArLimitedDismissed(true);
                      setArUnavailable(false);
                    }}
                    accessibilityLabel="Dismiss warning"
                  >
                    <Ionicons name="close" size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                  <View style={styles.fallbackContent}>
                    <Ionicons name="information-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.fallbackText}>
                      AR features limited. Preview mode available.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.fallbackButton}
                    onPress={() => {
                      setCameraMode('preview');
                      setArUnavailable(false);
                      setArLimitedDismissed(true);
                      AccessibilityInfo.announceForAccessibility('Preview mode activated');
                    }}
                  >
                    <Ionicons name="phone-portrait" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.fallbackButtonText}>Switch to Preview</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Loading Indicator with Skeleton */}
              {isInitializing && !rendererReady ? (
                <ARViewSkeleton />
              ) : isInitializing ? (
                <View style={styles.loadingIndicator} accessibilityLabel="Initializing AR view">
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.loadingTextPrimary} accessibilityLiveRegion="polite">
                    Initializing...
                  </Text>
                </View>
              ) : null}



            </View>

            {/* Anchor Status Badge - Auto-hides after surface detection, subtle when furniture is placed */}
            {isARActive && (!anchorStatus.hasLock || !statusMessageDismissed) && (
              <View
                style={[
                  styles.anchorStatusBadge,
                  anchorStatus.quality === 'good'
                    ? styles.anchorStatusGood
                    : anchorStatus.quality === 'medium'
                      ? styles.anchorStatusMedium
                      : styles.anchorStatusPoor,
                  // Reduce opacity and size when furniture is placed
                  placedFurniture.length > 0 && styles.anchorStatusSubtle,
                  // Move to corner when furniture is placed
                  placedFurniture.length > 0 && styles.anchorStatusCorner,
                ]}
              >
                <Text style={[
                  styles.anchorStatusTitle,
                  placedFurniture.length > 0 && styles.anchorStatusTitleSmall
                ]}>
                  {anchorStatus.hasLock
                    ? anchorStatus.quality === 'good'
                      ? 'Anchor locked'
                      : 'Anchor stabilizing'
                    : 'Searching for surface'}
                </Text>
                {(!placedFurniture.length || !statusMessageDismissed) && (
                  <Text style={[
                    styles.anchorStatusSubtitle,
                    placedFurniture.length > 0 && styles.anchorStatusSubtitleSmall
                  ]}>
                    {anchorStatus.anchor
                      ? `confidence ${(Math.min(1, anchorStatus.anchor.confidence) * 100).toFixed(0)}%`
                      : anchorStatus.hints[0] ?? 'Move device slowly'}
                  </Text>
                )}
              </View>
            )}

            {/* Subtle corner indicator when status is dismissed but surface is detected */}
            {isARActive && anchorStatus.hasLock && statusMessageDismissed && (
              <View style={styles.cornerStatusIndicator}>
                <View style={[
                  styles.cornerStatusDot,
                  anchorStatus.quality === 'good' && styles.cornerStatusDotGood,
                  anchorStatus.quality === 'medium' && styles.cornerStatusDotMedium,
                  anchorStatus.quality === 'poor' && styles.cornerStatusDotPoor,
                ]} />
              </View>
            )}

            {/* Simple Placement Safety Indicator */}
            {showPlacementHint && isARActive && selectedLibraryItem && !isPlacingFurniture && placementSafety.safetyLevel === 'danger' && (
              <View
                style={styles.safetyIndicatorUnsafe}
                accessibilityRole="alert"
              >
                <Ionicons name="close-circle" size={24} color="#EF4444" style={{ marginRight: 8 }} />
                <Text style={styles.safetyIndicatorTitle}>Cannot place here</Text>
              </View>
            )}

            {/* Gesture Instructions */}
            {isDraggingFurniture && draggedFurnitureId && (
              <View style={[styles.dragIndicator, styles.dragIndicatorSubtle]}>
                <Ionicons name="move" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.dragIndicatorText}>Move to reposition</Text>
              </View>
            )}
            {isRotatingFurniture && selectedPlacedId && (
              <View style={[styles.dragIndicator, styles.dragIndicatorSubtle]}>
                <Ionicons name="sync" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.dragIndicatorText}>Rotating object</Text>
              </View>
            )}
            {!isDraggingFurniture && !isRotatingFurniture && selectedPlacedId && isARActive && (
              <View style={[styles.dragIndicator, styles.dragIndicatorSubtle]}>
                <Ionicons name="hand-left" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.dragIndicatorText}>One finger to move, two fingers to rotate</Text>
              </View>
            )}




            {/* Simple Placement Hint */}
            {showPlacementHint && isARActive && selectedLibraryItem && (
              <View style={styles.placementHint}>
                {isPlacingFurniture ? (
                  <View style={styles.placingIndicator}>
                    <ActivityIndicator size="small" color="#6B4CE6" />
                    <Text style={styles.placingText}>Placing...</Text>
                  </View>
                ) : (
                  <View style={styles.hintContent}>
                    <Ionicons name="hand-left-outline" size={20} color="#4C1D95" style={{ marginRight: 8 }} />
                    <Text style={styles.hintTitle}>Tap to place furniture</Text>
                  </View>
                )}
              </View>
            )}


          </View>

          {/* Bottom Sheet Modal - Always visible with peek area */}
          <View
            style={styles.bottomSheetOverlay}
            pointerEvents="box-none"
          >
            {/* Backdrop - Only visible when expanded */}
            {libraryPanelVisible && (
              <Animated.View
                style={[
                  styles.bottomSheetBackdrop,
                  {
                    opacity: bottomSheetOpacity,
                  },
                ]}
              >
                <TouchableOpacity
                  style={StyleSheet.absoluteFill}
                  activeOpacity={1}
                  onPress={() => setLibraryPanelVisible(false)}
                />
              </Animated.View>
            )}

            {/* Bottom Sheet Content */}
            <Animated.View
              style={[
                styles.bottomSheetContainer,
                {
                  height: bottomSheetHeight,
                  maxHeight: maxPanelHeight,
                  paddingTop: libraryPanelVisible ? 12 : 16,
                  paddingBottom: libraryPanelVisible ? 20 : 0,
                },
              ]}
              {...bottomSheetPanResponder.panHandlers}
            >
              {/* Draggable Handle - Only show when expanded */}
              {libraryPanelVisible && (
                <View style={styles.panelDragHandle}>
                  <View style={styles.dragHandleBar} />
                </View>
              )}

              {/* Title - Always visible, this is what peeks when collapsed */}
              <TouchableOpacity
                style={styles.panelTitleContainer}
                onPress={() => {
                  if (!libraryPanelVisible) {
                    setLibraryPanelVisible(true);
                  }
                }}
                activeOpacity={0.7}
                delayPressIn={100}
              >
                <Text style={styles.panelTitle}>AR Furniture Library</Text>
              </TouchableOpacity>

              {libraryPanelVisible && (
                <View
                  style={styles.panelScrollContent}
                  onLayout={(event) => {
                    const { height } = event.nativeEvent.layout;
                    if (height > 0 && Math.abs(height - measuredContentHeight) > 1) {
                      setMeasuredContentHeight(height);
                    }
                  }}
                >
                  <View style={styles.panelHeader}>
                    <View style={styles.panelHeaderButtons}>
                      <TouchableOpacity
                        style={[
                          styles.toggleButton,
                          isARActive ? styles.toggleActive : styles.toggleInactive,
                        ]}
                        onPress={handleToggleAR}
                        accessibilityRole="button"
                        accessibilityLabel={isARActive ? 'Exit AR mode' : 'Enter AR mode'}
                        accessibilityState={{ selected: isARActive }}
                      >
                        <Text
                          style={[
                            styles.toggleButtonText,
                            !isARActive && styles.toggleButtonTextInactive,
                          ]}
                        >
                          {isARActive ? 'Exit AR' : 'Enter AR'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.markerButton,
                          markerTrackingEnabled && styles.markerButtonActive,
                          !isARActive && styles.markerButtonDisabled,
                        ]}
                        onPress={() => {
                          if (!isARActive) return;
                          setMarkerTrackingEnabled((prev) => !prev);
                          setLastMarkerPayload(null);
                          setMarkerLastSeenAt(null);
                          markerAnchorOffsetRef.current = null;
                        }}
                        disabled={!isARActive}
                        accessibilityRole="button"
                        accessibilityLabel={markerTrackingEnabled ? 'Disable marker lock' : 'Enable marker lock'}
                        accessibilityState={{ selected: markerTrackingEnabled, disabled: !isARActive }}
                      >
                        <Text style={styles.markerButtonText}>
                          {markerTrackingEnabled ? 'Marker ON' : 'Marker OFF'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Category Filter */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.categoryFilter}
                    contentContainerStyle={styles.categoryFilterContent}
                  >
                    <TouchableOpacity
                      style={[
                        styles.categoryButton,
                        selectedCategory === 'all' && styles.categoryButtonActive
                      ]}
                      onPress={() => setSelectedCategory('all')}
                    >
                      <Text style={[
                        styles.categoryButtonText,
                        selectedCategory === 'all' && styles.categoryButtonTextActive
                      ]}>All</Text>
                    </TouchableOpacity>
                    {furnitureCategories.map(category => (
                      <TouchableOpacity
                        key={category}
                        style={[
                          styles.categoryButton,
                          selectedCategory === category && styles.categoryButtonActive
                        ]}
                        onPress={() => setSelectedCategory(category)}
                      >
                        <Text style={[
                          styles.categoryButtonText,
                          selectedCategory === category && styles.categoryButtonTextActive
                        ]}>
                          {category.charAt(0).toUpperCase() + category.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {isARActive && anchorStatus.hints.length > 0 && !anchorStatus.hasLock && (
                    <View style={styles.anchorHintCard}>
                      <Text style={styles.anchorHintText}>
                        {anchorStatus.hints[0]}
                      </Text>
                    </View>
                  )}

                  {isARActive && markerTrackingEnabled && (
                    <View style={styles.anchorHintCard}>
                      <Text style={styles.anchorHintText}>
                        {lastMarkerPayload
                          ? `Marker detected: ${lastMarkerPayload}${markerLastSeenAt ? ` • ${Math.round((Date.now() - markerLastSeenAt) / 1000)}s ago` : ''
                          }`
                          : 'Marker lock enabled. Point camera at a QR marker to lock the anchor.'}
                      </Text>
                    </View>
                  )}

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.libraryScroll}
                    snapToInterval={162}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    pagingEnabled={false}
                    scrollEventThrottle={16}
                    bounces={true}
                    alwaysBounceHorizontal={true}
                    directionalLockEnabled={true}
                    scrollEnabled={true}
                    nestedScrollEnabled={true}
                    removeClippedSubviews={true}
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredFurnitureLibrary.length === 0 ? (
                      <View key="empty" style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>No furniture found</Text>
                        <Text style={styles.emptySubtext}>Try selecting a different category</Text>
                      </View>
                    ) : (
                      filteredFurnitureLibrary.map((item, index) => {
                        const isSelected = selectedLibraryItem === item.id;
                        // Ensure unique key - use id if available and valid, otherwise use index
                        const uniqueKey = item?.id && item.id !== '' ? item.id : `furniture-item-${index}`;
                        return (
                          <AnimatedCard
                            key={uniqueKey}
                            style={[
                              styles.furnitureCard,
                              isSelected && styles.furnitureCardSelected,
                            ]}
                            onPress={() => {
                              if (!isARActive) {
                                handleToggleAR();
                                setSelectedLibraryItem(item.id);
                                setShowFloor(false); // Hide floor when selecting furniture
                                return;
                              }
                              setSelectedLibraryItem((prev) => {
                                const newSelection = prev === item.id ? null : item.id;
                                setShowFloor(newSelection === null); // Show floor when deselecting
                                return newSelection;
                              });
                            }}
                            hapticFeedback={true}
                          >
                            <View style={styles.furnitureThumbnail}>
                              <Ionicons
                                name={getFurnitureIcon(item.category)}
                                size={32}
                                color={isSelected ? '#6B4CE6' : '#7C3AED'}
                              />
                              {item.thumbnail && (
                                <View style={styles.thumbnailOverlay}>
                                  {/* Thumbnail image would go here if available */}
                                </View>
                              )}
                            </View>
                            <Text style={styles.furnitureName}>{item.name}</Text>
                            <Text style={styles.furniturePrice}>{item.price}</Text>
                            <Text style={styles.furnitureSizeLabel}>
                              {item.dimensions.width.toFixed(1)}m × {item.dimensions.length.toFixed(1)}m
                            </Text>
                            <Text style={styles.furnitureCategoryLabel}>
                              {item.category}
                            </Text>
                          </AnimatedCard>
                        );
                      }))}
                  </ScrollView>
                </View>
              )}
            </Animated.View>
          </View>
        </>
      )}
    </View>
  );
}

// Export wrapped with error boundary
export default function ARViewScreenWithErrorBoundary() {
  return (
    <ARViewErrorBoundary>
      <ARViewScreen />
    </ARViewErrorBoundary>
  );
}

