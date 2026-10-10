/**
 * useLayout3DScene Hook
 * Manages 3D scene state and rendering for layout visualization
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { PanResponder } from 'react-native';
import * as THREE from 'three';
import { Renderer } from '@/utils/ExpoGLRenderer';
import { ExpoWebGLRenderingContext } from 'expo-gl';
import type { RoomDimensions, ViewMode, CameraControls, GLLayoutDimensions, Layout3DFurnitureItem } from '@/types/layout-3d';
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
  const rendererRef = useRef<Renderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const roomGroupRef = useRef<THREE.Group | null>(null);
  const furnitureGroupRef = useRef<THREE.Group | null>(null);
  const measurementGroupRef = useRef<THREE.Group | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const glLayoutRef = useRef<GLLayoutDimensions>({ width: 0, height: 0 });
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());

  // Control refs
  const controlsRef = useRef<CameraControls>({ ...CONTROL_DEFAULTS });
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const isPanningRef = useRef(false);
  const isZoomingRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; distance: number } | null>(null);

  // State
  const [isRendering, setIsRendering] = useState(false);
  const [furnitureMeshes, setFurnitureMeshes] = useState<Map<string, THREE.Mesh>>(new Map());
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);

  // Animation loop
  const animate = useCallback(() => {
    if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;

    try {
      const controls = controlsRef.current;
      
      if (cameraRef.current instanceof THREE.PerspectiveCamera) {
        const radius = controls.zoom;
        const theta = controls.rotationY;
        const phi = controls.rotationX;

        cameraRef.current.position.x = radius * Math.sin(phi) * Math.sin(theta) + controls.panX;
        cameraRef.current.position.y = radius * Math.cos(phi) + controls.panY;
        cameraRef.current.position.z = radius * Math.sin(phi) * Math.cos(theta);

        cameraRef.current.lookAt(controls.panX, 0, controls.panY);
      } else if (cameraRef.current instanceof THREE.OrthographicCamera) {
        cameraRef.current.position.set(0, controls.zoom, 0);
        cameraRef.current.lookAt(0, 0, 0);
        cameraRef.current.zoom = controls.zoom;
        cameraRef.current.updateProjectionMatrix();
      }

      rendererRef.current.render(sceneRef.current, cameraRef.current);
      animationFrameRef.current = requestAnimationFrame(animate);
    } catch (error) {
      console.error('[Layout3DScene] Animation error:', error);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, []);

  // Initialize 3D scene
  const onGLContextCreate = useCallback(
    async (gl: ExpoWebGLRenderingContext) => {
      const { drawingBufferWidth, drawingBufferHeight } = gl;
      glRef.current = gl;

      // Create scene
      const scene = createScene();
      sceneRef.current = scene;

      // Create camera based on view mode
      const aspect = drawingBufferWidth / drawingBufferHeight;
      const camera = viewMode === 'top-down' || viewMode === 'orthographic'
        ? createOrthographicCamera(aspect)
        : createPerspectiveCamera(aspect);
      cameraRef.current = camera;

      // Create renderer
      const renderer = new Renderer({ gl });
      renderer.setSize(drawingBufferWidth, drawingBufferHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      rendererRef.current = renderer;

      // Add lighting
      const lights = createLighting();
      lights.children.forEach(light => scene.add(light));

      // Create room
      const roomGroup = createRoom(roomDimensions, showGrid);
      roomGroupRef.current = roomGroup;
      scene.add(roomGroup);

      // Create furniture
      const furnitureGroup = new THREE.Group();
      furnitureGroupRef.current = furnitureGroup;
      scene.add(furnitureGroup);

      // Create measurement group
      const measurementGroup = new THREE.Group();
      measurementGroupRef.current = measurementGroup;
      scene.add(measurementGroup);

      // Add furniture if design is loaded
      const newFurnitureMeshes = new Map<string, THREE.Mesh>();
      if (design?.layout?.furniture) {
        const { meshMap } = createFurnitureGroup(design.layout.furniture);
        meshMap.forEach((mesh, id) => {
          furnitureGroup.add(mesh);
          newFurnitureMeshes.set(id, mesh);
        });
      }
      setFurnitureMeshes(newFurnitureMeshes);

      // Store GL layout dimensions
      glLayoutRef.current = { width: drawingBufferWidth, height: drawingBufferHeight };

      // Create measurements if enabled
      if (showMeasurements) {
        const measurements = createMeasurementLines(roomDimensions);
        measurementGroupRef.current.add(measurements);
      }

      setIsRendering(true);
      animate();
    },
    [roomDimensions, design, viewMode, showGrid, showMeasurements, animate]
  );

  // Handle furniture tap
  const handleFurnitureTap = useCallback(
    (locationX: number, locationY: number) => {
      if (!sceneRef.current || !cameraRef.current) return;

      const { width, height } = glLayoutRef.current;
      if (width === 0 || height === 0) return;

      // Convert screen coordinates to NDC
      const ndc = new THREE.Vector2(
        (locationX / width) * 2 - 1,
        -(locationY / height) * 2 + 1
      );

      raycasterRef.current.setFromCamera(ndc, cameraRef.current);

      // Check intersection with furniture
      const furnitureArray = Array.from(furnitureMeshes.values());
      const intersects = raycasterRef.current.intersectObjects(furnitureArray, true);

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
        // Reset all furniture materials
        furnitureMeshes.forEach((mesh) => {
          const furniture = design?.layout?.furniture.find((f: any) => f.id === mesh.userData.furnitureId);
          if (furniture) {
            resetFurnitureMaterial(mesh, furniture.category);
          }
        });
      }
    },
    [furnitureMeshes, design]
  );

  // Reset camera to default position
  const resetCamera = useCallback(() => {
    controlsRef.current = { ...CONTROL_DEFAULTS };
  }, []);

  // Pan responder for touch gestures
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
      if (touches.length === 1 && isPanningRef.current && lastPanRef.current) {
        const deltaX = (touches[0].pageX - lastPanRef.current.x) * CONTROL_DEFAULTS.rotationSensitivity;
        const deltaY = (touches[0].pageY - lastPanRef.current.y) * CONTROL_DEFAULTS.rotationSensitivity;

        controlsRef.current.rotationY += deltaX;
        controlsRef.current.rotationX = Math.max(
          CONTROL_DEFAULTS.minRotationX,
          Math.min(CONTROL_DEFAULTS.maxRotationX, controlsRef.current.rotationX + deltaY)
        );

        lastPanRef.current = { x: touches[0].pageX, y: touches[0].pageY };
      } else if (touches.length === 2 && isZoomingRef.current && touchStartRef.current) {
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const zoomDelta = (touchStartRef.current.distance - distance) * CONTROL_DEFAULTS.zoomSensitivity;

        controlsRef.current.zoom = Math.max(
          CONTROL_DEFAULTS.minZoom,
          Math.min(CONTROL_DEFAULTS.maxZoom, controlsRef.current.zoom + zoomDelta)
        );
        touchStartRef.current.distance = distance;
      }
    },
    onPanResponderRelease: () => {
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

