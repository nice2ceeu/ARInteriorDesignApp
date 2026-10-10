/**
 * Layout 3D Types
 * TypeScript definitions for 3D layout visualization
 */

import * as THREE from 'three';

// View mode type
export type ViewMode = 'perspective' | 'top-down' | 'orthographic';

// Export format type
export type ExportFormat = 'pdf' | 'png' | 'obj' | 'glb' | 'json';

// Room dimensions
export interface RoomDimensions {
  width: number;
  length: number;
  height: number;
}

// Camera controls state
export interface CameraControls {
  rotationX: number;
  rotationY: number;
  zoom: number;
  panX: number;
  panY: number;
}

// Touch gesture state
export interface TouchState {
  x: number;
  y: number;
  distance: number;
}

// Furniture item for 3D rendering
export interface Layout3DFurnitureItem {
  id: string;
  name: string;
  category?: string;
  color?: string;
  dimensions: {
    width: number;
    length: number;
    height: number;
  };
  position?: {
    x: number;
    y?: number;
    z: number;
    rotation?: number;
  };
  material?: {
    roughness?: number;
    metalness?: number;
    textureUrl?: string;
  };
}

// Export option
export interface ExportOption {
  id: ExportFormat;
  name: string;
  emoji: string;
  description: string;
}

// Export data structure
export interface ExportData {
  design?: string;
  dimensions: RoomDimensions;
  furniture?: Layout3DFurnitureItem[];
  exportedAt: number;
  format: ExportFormat;
  note?: string;
}

// Floor plan export data
export interface FloorPlanExportData {
  title?: string;
  dimensions: RoomDimensions;
  area: string;
  furniture?: Array<{
    name: string;
    position: Layout3DFurnitureItem['position'];
    dimensions: Layout3DFurnitureItem['dimensions'];
  }>;
  exportedAt: number;
  format: 'pdf';
  note?: string;
}

// Project save data
export interface Layout3DProjectData {
  id?: string;
  title: string;
  roomDimensions: RoomDimensions;
  furniture: Layout3DFurnitureItem[];
  colorPalette?: string[];
  estimatedCost?: {
    low: number;
    high: number;
  };
  savedAt: number;
  version: string;
}

// Scene refs
export interface Layout3DSceneRefs {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  renderer: THREE.WebGLRenderer | null;
  roomGroup: THREE.Group | null;
  furnitureGroup: THREE.Group | null;
  measurementGroup: THREE.Group | null;
}

// GL layout dimensions
export interface GLLayoutDimensions {
  width: number;
  height: number;
}

