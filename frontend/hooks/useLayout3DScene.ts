/**
 * useLayout3DScene Hook
 * Manages 3D scene state and rendering for layout visualization.
 *
 * View modes:
 * - perspective: realistic orbit view (drag to orbit, pinch to zoom)
 * - top-down:    orthographic plan view, north wall at the top (drag to pan, pinch to zoom)
 * - orthographic: isometric view without perspective distortion (drag turns in 90° steps, pinch to zoom)
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { PanResponder, PixelRatio } from 'react-native';
import * as THREE from 'three';
import { Renderer } from '@/utils/ExpoGLRenderer';
import { ExpoWebGLRenderingContext } from 'expo-gl';
import type { RoomDimensions, ViewMode, CameraControls, GLLayoutDimensions } from '@/types/layout-3d';
import type { DesignProposal } from '@/types/ai-design';
import {
  createScene,
  createPerspectiveCamera,
  createOrthographicCamera,
  createLighting,
  createRoom,
  createFurnitureGroup,
  createMeasurementLines,
  highlightFurniture,
  resetFurnitureMaterial,
} from '@/utils/layout3dSceneBuilder';
import { CONTROL_DEFAULTS } from '@/config/layout3d.config';

// Isometric elevation (about 35.26°) and the four isometric headings
const ISO_PITCH = Math.atan(1 / Math.SQRT2);
const ISO_STEP = Math.PI / 2;
const ISO_START = Math.PI / 4;
const ORTHO_DISTANCE = 40;
const ORTHO_ZOOM = { min: 0.5, max: 4 };
const FRAME_MARGIN = 1.15;

interface UseLayout3DSceneProps {
  roomDimensions: RoomDimensions;
  design: DesignProposal | null;
  viewMode: ViewMode;
  showGrid: boolean;
  showMeasurements: boolean;
}

interface UseLayout3DSceneReturn {
  // Refs
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>;
  rendererRef: React.MutableRefObject<Renderer | null>;
  controlsRef: React.MutableRefObject<CameraControls>;
  roomGroupRef: React.MutableRefObject<THREE.Group | null>;
  furnitureGroupRef: React.MutableRefObject<THREE.Group | null>;
  measurementGroupRef: React.MutableRefObject<THREE.Group | null>;
  glLayoutRef: React.MutableRefObject<GLLayoutDimensions>;
  glRef: React.MutableRefObject<ExpoWebGLRenderingContext | null>;
  raycasterRef: React.MutableRefObject<THREE.Raycaster>;
  // State
  isRendering: boolean;
  furnitureMeshes: Map<string, THREE.Mesh>;
  selectedFurnitureId: string | null;
  // Functions
  onGLContextCreate: (gl: ExpoWebGLRenderingContext) => Promise<void>;
  handleFurnitureTap: (locationX: number, locationY: number) => void;
  resetCamera: () => void;
  panResponder: ReturnType<typeof PanResponder.create>;
}

/** Starting camera controls for each mode, framed to the room. */
export function defaultControls(mode: ViewMode, room: RoomDimensions): CameraControls {
  if (mode === 'perspective') {
    const distance = Math.min(CONTROL_DEFAULTS.maxZoom,
      Math.max(CONTROL_DEFAULTS.minZoom, Math.max(room.width, room.length) * 1.3 + 2));
    return { rotationX: 0.85, rotationY: 0.6, zoom: distance, panX: 0, panY: 0 };
  }
  if (mode === 'top-down') {
    return { rotationX: 0, rotationY: 0, zoom: 1, panX: 0, panY: 0 };
  }
  return { rotationX: ISO_PITCH, rotationY: ISO_START, zoom: 1, panX: 0, panY: 0 };
}

/** Half the visible height (meters) that fits the whole room at zoom 1. */
export function orthoHalfHeight(mode: ViewMode, room: RoomDimensions, aspect: number): number {
  if (mode === 'top-down') {
    return Math.max(room.length / 2, room.width / 2 / aspect) * FRAME_MARGIN;
  }
  // Isometric: the room's footprint diagonal spans the screen width; height adds the walls
  const span = (room.width + room.length) / Math.SQRT2;
  const tall = span * Math.sin(ISO_PITCH) + room.height * Math.cos(ISO_PITCH);
  return Math.max(span / 2 / aspect, tall / 2) * FRAME_MARGIN;
}

/** Nearest isometric heading (45° + k·90°). */
export function snapIsoHeading(angle: number): number {
  return ISO_START + Math.round((angle - ISO_START) / ISO_STEP) * ISO_STEP;
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material?.dispose());
    }
  });
}

export function useLayout3DScene({
  roomDimensions,
  design,
  viewMode,
  showGrid,
  showMeasurements,
}: UseLayout3DSceneProps): UseLayout3DSceneReturn {
  // Scene refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const roomGroupRef = useRef<THREE.Group | null>(null);
  const furnitureGroupRef = useRef<THREE.Group | null>(null);
  const measurementGroupRef = useRef<THREE.Group | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const glLayoutRef = useRef<GLLayoutDimensions>({ width: 0, height: 0 });
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());

  // Latest props for the render loop and GL setup, which outlive individual renders
  const modeRef = useRef<ViewMode>(viewMode);
  const roomRef = useRef<RoomDimensions>(roomDimensions);
  const designRef = useRef<DesignProposal | null>(design);
  const showGridRef = useRef(showGrid);
  const showMeasurementsRef = useRef(showMeasurements);
  modeRef.current = viewMode;
  roomRef.current = roomDimensions;
  designRef.current = design;
  showGridRef.current = showGrid;
  showMeasurementsRef.current = showMeasurements;

  // Control refs
  const controlsRef = useRef<CameraControls>(defaultControls(viewMode, roomDimensions));
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const isPanningRef = useRef(false);
  const isZoomingRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; distance: number } | null>(null);

  // State
  const [isRendering, setIsRendering] = useState(false);
  const [furnitureMeshes, setFurnitureMeshes] = useState<Map<string, THREE.Mesh>>(new Map());
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);

  /** View size in layout points (touch coordinates), not drawing-buffer pixels. */
  const viewSize = () => {
    const ratio = PixelRatio.get() || 1;
    return { width: glLayoutRef.current.width / ratio, height: glLayoutRef.current.height / ratio };
  };

  const aspect = () => {
    const { width, height } = glLayoutRef.current;
    return width > 0 && height > 0 ? width / height : 1;
  };

  // Position the active camera from the controls for the current mode
  const updateCamera = useCallback(() => {
    const controls = controlsRef.current;
    const mode = modeRef.current;
    const room = roomRef.current;

    if (mode === 'perspective') {
      const camera = perspectiveCameraRef.current;
      if (!camera) return;
      cameraRef.current = camera;
      if (Math.abs(camera.aspect - aspect()) > 1e-3) {
        camera.aspect = aspect();
        camera.updateProjectionMatrix();
      }
      const radius = controls.zoom;
      const phi = controls.rotationX;
      const theta = controls.rotationY;
      camera.up.set(0, 1, 0);
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta) + controls.panX,
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta) + controls.panY,
      );
      camera.lookAt(controls.panX, 0, controls.panY);
      return;
    }

    const camera = orthoCameraRef.current;
    if (!camera) return;
    cameraRef.current = camera;
    const halfHeight = orthoHalfHeight(mode, room, aspect()) / controls.zoom;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * aspect();
    camera.right = halfHeight * aspect();
    camera.zoom = 1;
    camera.near = 0.1;
    camera.far = ORTHO_DISTANCE * 2;
    camera.updateProjectionMatrix();

    if (mode === 'top-down') {
      // Straight down with the north wall at the top, like the 2D floor plan
      camera.up.set(0, 0, -1);
      camera.position.set(controls.panX, ORTHO_DISTANCE, controls.panY);
      camera.lookAt(controls.panX, 0, controls.panY);
    } else {
      const heading = controls.rotationY;
      const pitch = controls.rotationX;
      const targetY = room.height / 3;
      camera.up.set(0, 1, 0);
      camera.position.set(
        controls.panX + ORTHO_DISTANCE * Math.cos(pitch) * Math.sin(heading),
        targetY + ORTHO_DISTANCE * Math.sin(pitch),
        controls.panY + ORTHO_DISTANCE * Math.cos(pitch) * Math.cos(heading),
      );
      camera.lookAt(controls.panX, targetY, controls.panY);
    }
  }, []);

  // Animation loop
  const animate = useCallback(() => {
    if (!sceneRef.current || !rendererRef.current) return;

    try {
      updateCamera();
      if (cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      // Expo GL presents a frame on native only after endFrameEXP (no-op need on web)
      glRef.current?.endFrameEXP?.();
      animationFrameRef.current = requestAnimationFrame(animate);
    } catch (error) {
      console.error('[Layout3DScene] Animation error:', error);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [updateCamera]);

  // (Re)build the room shell; called on setup and when the grid or dimensions change
  const buildRoom = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (roomGroupRef.current) {
      scene.remove(roomGroupRef.current);
      disposeGroup(roomGroupRef.current);
    }
    const roomGroup = createRoom(roomRef.current, showGridRef.current);
    roomGroupRef.current = roomGroup;
    scene.add(roomGroup);
  }, []);

  // (Re)build furniture meshes; called on setup and whenever the design changes
  const buildFurniture = useCallback(() => {
    const group = furnitureGroupRef.current;
    if (!group) return;
    disposeGroup(group);
    group.clear();
    const meshes = new Map<string, THREE.Mesh>();
    const furniture = designRef.current?.layout?.furniture;
    if (furniture) {
      const { meshMap } = createFurnitureGroup(furniture);
      meshMap.forEach((mesh, id) => {
        group.add(mesh);
        meshes.set(id, mesh);
      });
    }
    setFurnitureMeshes(meshes);
    setSelectedFurnitureId(null);
  }, []);

  // Initialize 3D scene (GLView calls this once per mounted view)
  const onGLContextCreate = useCallback(
    async (gl: ExpoWebGLRenderingContext) => {
      const { drawingBufferWidth, drawingBufferHeight } = gl;
      glRef.current = gl;
      glLayoutRef.current = { width: drawingBufferWidth, height: drawingBufferHeight };

      const scene = createScene();
      sceneRef.current = scene;

      // Both cameras exist; the view mode picks one each frame
      const ratio = drawingBufferWidth / drawingBufferHeight;
      perspectiveCameraRef.current = createPerspectiveCamera(ratio);
      orthoCameraRef.current = createOrthographicCamera(ratio);

      const renderer = new Renderer({ gl });
      renderer.setSize(drawingBufferWidth, drawingBufferHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      rendererRef.current = renderer;

      const lights = createLighting();
      lights.children.forEach(light => scene.add(light));

      buildRoom();

      const furnitureGroup = new THREE.Group();
      furnitureGroupRef.current = furnitureGroup;
      scene.add(furnitureGroup);
      buildFurniture();

      const measurementGroup = new THREE.Group();
      measurementGroupRef.current = measurementGroup;
      scene.add(measurementGroup);
      if (showMeasurementsRef.current) {
        measurementGroup.add(createMeasurementLines(roomRef.current));
      }

      controlsRef.current = defaultControls(modeRef.current, roomRef.current);
      setIsRendering(true);
      animate();
    },
    [animate, buildRoom, buildFurniture]
  );

  // Switching mode swaps the camera and restores that mode's framing
  useEffect(() => {
    controlsRef.current = defaultControls(viewMode, roomRef.current);
  }, [viewMode]);

  // Rebuild furniture when the design arrives or changes
  useEffect(() => {
    buildFurniture();
  }, [design, buildFurniture]);

  // Rebuild the room when the grid toggle or dimensions change
  useEffect(() => {
    buildRoom();
  }, [showGrid, roomDimensions, buildRoom]);

  // Handle furniture tap (location in layout points)
  const handleFurnitureTap = useCallback(
    (locationX: number, locationY: number) => {
      if (!sceneRef.current || !cameraRef.current) return;

      const { width, height } = viewSize();
      if (width === 0 || height === 0) return;

      const ndc = new THREE.Vector2((locationX / width) * 2 - 1, -(locationY / height) * 2 + 1);
      raycasterRef.current.setFromCamera(ndc, cameraRef.current);

      const furnitureArray = Array.from(furnitureMeshes.values());
      const intersects = raycasterRef.current.intersectObjects(furnitureArray, true);

      // Reset previous highlight before selecting
      furnitureMeshes.forEach((mesh) => {
        const furniture = design?.layout?.furniture.find((f: any) => f.id === mesh.userData.furnitureId);
        if (furniture) {
          resetFurnitureMaterial(mesh, furniture.category);
        }
      });

      if (intersects.length > 0) {
        const selectedMesh = intersects[0].object as THREE.Mesh;
        for (const [id, mesh] of furnitureMeshes.entries()) {
          if (mesh === selectedMesh) {
            setSelectedFurnitureId(id);
            highlightFurniture(mesh, true);
            break;
          }
        }
      } else {
        setSelectedFurnitureId(null);
      }
    },
    [furnitureMeshes, design]
  );

  // Reset camera to the current mode's default framing
  const resetCamera = useCallback(() => {
    controlsRef.current = defaultControls(modeRef.current, roomRef.current);
  }, []);

  const clampPan = (value: number, extent: number) => Math.max(-extent / 2, Math.min(extent / 2, value));

  // Pan responder for touch gestures; behavior depends on the view mode
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      const touches = evt.nativeEvent.touches;
      if (touches.length === 1) {
        isPanningRef.current = true;
        lastPanRef.current = { x: touches[0].pageX, y: touches[0].pageY };
      } else if (touches.length === 2) {
        isZoomingRef.current = true;
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        touchStartRef.current = {
          x: (touches[0].pageX + touches[1].pageX) / 2,
          y: (touches[0].pageY + touches[1].pageY) / 2,
          distance: Math.sqrt(dx * dx + dy * dy),
        };
      }
    },
    onPanResponderMove: (evt) => {
      const touches = evt.nativeEvent.touches;
      const controls = controlsRef.current;
      const mode = modeRef.current;

      if (touches.length === 1 && isPanningRef.current && lastPanRef.current) {
        const dx = touches[0].pageX - lastPanRef.current.x;
        const dy = touches[0].pageY - lastPanRef.current.y;

        if (mode === 'perspective') {
          controls.rotationY += dx * CONTROL_DEFAULTS.rotationSensitivity;
          controls.rotationX = Math.max(
            CONTROL_DEFAULTS.minRotationX,
            Math.min(Math.PI / 2 - 0.05, controls.rotationX + dy * CONTROL_DEFAULTS.rotationSensitivity)
          );
        } else if (mode === 'top-down') {
          // Content follows the finger: move the view opposite to the drag
          const metersPerPoint = (2 * orthoHalfHeight(mode, roomRef.current, aspect()) / controls.zoom) / (viewSize().height || 1);
          controls.panX = clampPan(controls.panX - dx * metersPerPoint, roomRef.current.width);
          controls.panY = clampPan(controls.panY - dy * metersPerPoint, roomRef.current.length);
        } else {
          // Isometric: turn freely while dragging, snap to a 90° step on release
          controls.rotationY -= dx * CONTROL_DEFAULTS.rotationSensitivity;
        }

        lastPanRef.current = { x: touches[0].pageX, y: touches[0].pageY };
      } else if (touches.length === 2 && isZoomingRef.current && touchStartRef.current) {
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (mode === 'perspective') {
          const zoomDelta = (touchStartRef.current.distance - distance) * CONTROL_DEFAULTS.zoomSensitivity;
          controls.zoom = Math.max(CONTROL_DEFAULTS.minZoom, Math.min(CONTROL_DEFAULTS.maxZoom, controls.zoom + zoomDelta));
        } else if (touchStartRef.current.distance > 0) {
          const factor = distance / touchStartRef.current.distance;
          controls.zoom = Math.max(ORTHO_ZOOM.min, Math.min(ORTHO_ZOOM.max, controls.zoom * factor));
        }
        touchStartRef.current.distance = distance;
      }
    },
    onPanResponderRelease: () => {
      if (modeRef.current === 'orthographic') {
        controlsRef.current.rotationY = snapIsoHeading(controlsRef.current.rotationY);
      }
      isPanningRef.current = false;
      isZoomingRef.current = false;
      lastPanRef.current = null;
      touchStartRef.current = null;
    },
  });

  // Update measurements when toggle changes
  useEffect(() => {
    if (measurementGroupRef.current && sceneRef.current) {
      measurementGroupRef.current.clear();
      if (showMeasurements) {
        const measurements = createMeasurementLines(roomDimensions);
        measurementGroupRef.current.add(measurements);
      }
    }
  }, [showMeasurements, roomDimensions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    roomGroupRef,
    furnitureGroupRef,
    measurementGroupRef,
    glLayoutRef,
    glRef,
    raycasterRef,
    isRendering,
    furnitureMeshes,
    selectedFurnitureId,
    onGLContextCreate,
    handleFurnitureTap,
    resetCamera,
    panResponder,
  };
}
