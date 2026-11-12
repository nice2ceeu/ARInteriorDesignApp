/**
 * Layout 3D Scene Builder
 * Utilities for building the 3D scene (room, walls, furniture)
 */

import * as THREE from 'three';
import type { RoomDimensions, Layout3DFurnitureItem } from '@/types/layout-3d';
import { threePose } from '@/utils/planView';
import {
  WALL_CONFIG,
  FLOOR_CONFIG,
  CEILING_CONFIG,
  GRID_CONFIG,
  LIGHTING_CONFIG,
  SCENE_CONFIG,
  FURNITURE_COLORS,
  MEASUREMENT_CONFIG,
} from '@/config/layout3d.config';

/**
 * Create the 3D scene with background
 */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_CONFIG.backgroundColor);
  return scene;
}

/**
 * Create perspective camera
 */
export function createPerspectiveCamera(
  aspect: number,
  fov: number = 65,
  near: number = 0.1,
  far: number = 100
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(8, 6, 8);
  camera.lookAt(0, 0, 0);
  return camera;
}

/**
 * Create orthographic camera (for top-down view)
 */
export function createOrthographicCamera(
  aspect: number,
  viewSize: number = 10,
  near: number = 0.1,
  far: number = 100
): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(
    -viewSize * aspect,
    viewSize * aspect,
    viewSize,
    -viewSize,
    near,
    far
  );
  camera.position.set(0, 15, 0);
  camera.lookAt(0, 0, 0);
  return camera;
}

/**
 * Create default lighting for the scene
 */
export function createLighting(): THREE.Group {
  const lightGroup = new THREE.Group();
  
  // Ambient light
  const ambientLight = new THREE.AmbientLight(
    LIGHTING_CONFIG.ambient.color,
    LIGHTING_CONFIG.ambient.intensity
  );
  lightGroup.add(ambientLight);
  
  // Directional light (main light with shadows)
  const directionalLight = new THREE.DirectionalLight(
    LIGHTING_CONFIG.directional.color,
    LIGHTING_CONFIG.directional.intensity
  );
  directionalLight.position.set(
    LIGHTING_CONFIG.directional.position.x,
    LIGHTING_CONFIG.directional.position.y,
    LIGHTING_CONFIG.directional.position.z
  );
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = LIGHTING_CONFIG.directional.shadowMapSize;
  directionalLight.shadow.mapSize.height = LIGHTING_CONFIG.directional.shadowMapSize;
  directionalLight.shadow.camera.near = LIGHTING_CONFIG.directional.shadowNear;
  directionalLight.shadow.camera.far = LIGHTING_CONFIG.directional.shadowFar;
  directionalLight.shadow.camera.left = -LIGHTING_CONFIG.directional.shadowCameraSize;
  directionalLight.shadow.camera.right = LIGHTING_CONFIG.directional.shadowCameraSize;
  directionalLight.shadow.camera.top = LIGHTING_CONFIG.directional.shadowCameraSize;
  directionalLight.shadow.camera.bottom = -LIGHTING_CONFIG.directional.shadowCameraSize;
  lightGroup.add(directionalLight);
  
  // Hemisphere light for realistic ambient
  const hemisphereLight = new THREE.HemisphereLight(
    LIGHTING_CONFIG.hemisphere.skyColor,
    LIGHTING_CONFIG.hemisphere.groundColor,
    LIGHTING_CONFIG.hemisphere.intensity
  );
  hemisphereLight.position.set(
    LIGHTING_CONFIG.hemisphere.position.x,
    LIGHTING_CONFIG.hemisphere.position.y,
    LIGHTING_CONFIG.hemisphere.position.z
  );
  lightGroup.add(hemisphereLight);
  
  return lightGroup;
}

/**
 * Create floor mesh
 */
export function createFloor(dimensions: RoomDimensions): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(dimensions.width, dimensions.length);
  const material = new THREE.MeshStandardMaterial({
    color: FLOOR_CONFIG.color,
    roughness: FLOOR_CONFIG.roughness,
    metalness: FLOOR_CONFIG.metalness,
  });
  
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  
  return floor;
}

/**
 * Create floor grid helper
 */
export function createFloorGrid(dimensions: RoomDimensions): THREE.GridHelper {
  const gridSize = Math.max(dimensions.width, dimensions.length);
  const grid = new THREE.GridHelper(
    gridSize,
    GRID_CONFIG.divisions,
    GRID_CONFIG.mainColor,
    GRID_CONFIG.secondaryColor
  );
  grid.position.y = GRID_CONFIG.yOffset;
  return grid;
}

/**
 * Create ceiling mesh
 */
export function createCeiling(dimensions: RoomDimensions): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(dimensions.width, dimensions.length);
  const material = new THREE.MeshStandardMaterial({
    color: CEILING_CONFIG.color,
    roughness: CEILING_CONFIG.roughness,
  });
  
  const ceiling = new THREE.Mesh(geometry, material);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = dimensions.height;
  ceiling.receiveShadow = true;
  
  return ceiling;
}

/**
 * Create wall material
 */
function createWallMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: WALL_CONFIG.color,
    roughness: WALL_CONFIG.roughness,
  });
}

/**
 * Create all four walls
 */
export function createWalls(dimensions: RoomDimensions): THREE.Group {
  const wallGroup = new THREE.Group();
  const wallHeight = dimensions.height;
  const wallThickness = WALL_CONFIG.thickness;
  
  // North wall
  const northWall = new THREE.Mesh(
    new THREE.BoxGeometry(dimensions.width, wallHeight, wallThickness),
    createWallMaterial()
  );
  northWall.position.set(0, wallHeight / 2, -dimensions.length / 2);
  northWall.castShadow = true;
  wallGroup.add(northWall);
  
  // South wall
  const southWall = new THREE.Mesh(
    new THREE.BoxGeometry(dimensions.width, wallHeight, wallThickness),
    createWallMaterial()
  );
  southWall.position.set(0, wallHeight / 2, dimensions.length / 2);
  southWall.castShadow = true;
  wallGroup.add(southWall);
  
  // East wall
  const eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, dimensions.length),
    createWallMaterial()
  );
  eastWall.position.set(dimensions.width / 2, wallHeight / 2, 0);
  eastWall.castShadow = true;
  wallGroup.add(eastWall);
  
  // West wall
  const westWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, dimensions.length),
    createWallMaterial()
  );
  westWall.position.set(-dimensions.width / 2, wallHeight / 2, 0);
  westWall.castShadow = true;
  wallGroup.add(westWall);
  
  return wallGroup;
}

/**
 * Create complete room (floor, walls, ceiling)
 */
export function createRoom(dimensions: RoomDimensions, includeGrid: boolean = true): THREE.Group {
  const roomGroup = new THREE.Group();
  
  // Floor
  roomGroup.add(createFloor(dimensions));
  
  // Grid (optional)
  if (includeGrid) {
    roomGroup.add(createFloorGrid(dimensions));
  }
  
  // Walls
  roomGroup.add(createWalls(dimensions));
  
  // Ceiling
  roomGroup.add(createCeiling(dimensions));
  
  return roomGroup;
}

/**
 * Create furniture mesh from item data
 */
export function createFurnitureMesh(item: Layout3DFurnitureItem): THREE.Mesh | null {
  if (!item || !item.dimensions) return null;
  
  const { width, length, height } = item.dimensions;
  const geometry = new THREE.BoxGeometry(width, height, length);
  
  // Get color based on category
  const categoryColor = FURNITURE_COLORS[item.category?.toLowerCase() || 'default'] || FURNITURE_COLORS.default;
  const parsedColor = item.color && /^#?[0-9a-f]{6}$/i.test(item.color)
    ? parseInt(item.color.replace('#', ''), 16)
    : NaN;
  const color = Number.isFinite(parsedColor) ? parsedColor : categoryColor;
  
  // Create material
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: item.material?.roughness ?? 0.7,
    metalness: item.material?.metalness ?? 0.1,
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  
  // Position
  // AR's pose in this right-handed scene, so it isn't the room's mirror image (utils/planView).
  const pose = threePose({ x: item.position?.x || 0, z: item.position?.z || 0, rotation: item.position?.rotation });
  mesh.position.set(pose.x, height / 2, pose.z);
  mesh.rotation.y = pose.rotationY;
  
  // Shadows
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  // Store metadata
  mesh.userData.furnitureId = item.id;
  mesh.userData.furnitureName = item.name;
  mesh.userData.baseColor = color;
  
  return mesh;
}

/**
 * Create all furniture meshes from design data
 */
export function createFurnitureGroup(furniture: Layout3DFurnitureItem[]): {
  group: THREE.Group;
  meshMap: Map<string, THREE.Mesh>;
} {
  const group = new THREE.Group();
  const meshMap = new Map<string, THREE.Mesh>();
  
  furniture.forEach((item) => {
    const mesh = createFurnitureMesh(item);
    if (mesh && item.id) {
      mesh.userData.furnitureId = item.id;
      group.add(mesh);
      meshMap.set(item.id, mesh);
    }
  });
  
  return { group, meshMap };
}

/**
 * Create measurement lines
 */
export function createMeasurementLines(dimensions: RoomDimensions): THREE.Group {
  const measurementGroup = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: MEASUREMENT_CONFIG.color,
  });
  
  // Width measurement line
  const widthLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-dimensions.width / 2, MEASUREMENT_CONFIG.yOffset, -dimensions.length / 2 - MEASUREMENT_CONFIG.labelOffset),
      new THREE.Vector3(dimensions.width / 2, MEASUREMENT_CONFIG.yOffset, -dimensions.length / 2 - MEASUREMENT_CONFIG.labelOffset),
    ]),
    material
  );
  measurementGroup.add(widthLine);
  
  // Length measurement line
  const lengthLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(dimensions.width / 2 + MEASUREMENT_CONFIG.labelOffset, MEASUREMENT_CONFIG.yOffset, -dimensions.length / 2),
      new THREE.Vector3(dimensions.width / 2 + MEASUREMENT_CONFIG.labelOffset, MEASUREMENT_CONFIG.yOffset, dimensions.length / 2),
    ]),
    material
  );
  measurementGroup.add(lengthLine);
  
  return measurementGroup;
}

/**
 * Highlight a furniture mesh
 */
export function highlightFurniture(mesh: THREE.Mesh, highlight: boolean): void {
  if (highlight && mesh.userData.hasModel) {
    // The real model is drawn: outline its box instead of covering it.
    mesh.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    return;
  }
  if (highlight) {
    mesh.material = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      roughness: 0.7,
      metalness: 0.1,
    });
  }
}

/**
 * Reset furniture material to original
 */
export function resetFurnitureMaterial(mesh: THREE.Mesh, category?: string): void {
  if (mesh.userData.hasModel) {
    mesh.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    return;
  }
  const color = typeof mesh.userData.baseColor === 'number'
    ? mesh.userData.baseColor
    : FURNITURE_COLORS[category?.toLowerCase() || 'default'] || FURNITURE_COLORS.default;
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.1,
  });
}

