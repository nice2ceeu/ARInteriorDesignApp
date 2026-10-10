/**
 * Layout 3D Configuration
 * Constants and configuration for 3D layout visualization
 */

// Export options
export const EXPORT_OPTIONS = [
  { id: 'pdf', name: 'PDF Floor Plan', emoji: '📄', description: 'To-scale plan, furniture list and cost breakdown' },
  { id: 'png', name: 'Image (PNG)', emoji: '🖼️', description: 'Snapshot of the current 3D view' },
  { id: 'obj', name: '3D Model (OBJ)', emoji: '📦', description: 'For 3D software' },
  { id: 'glb', name: '3D Model (GLB)', emoji: '🎮', description: 'For AR/VR apps' },
] as const;

// View modes
export const VIEW_MODES = ['perspective', 'top-down', 'orthographic'] as const;

// Default room dimensions (in meters)
export const DEFAULT_ROOM_DIMENSIONS = {
  width: 5.0,
  length: 6.0,
  height: 2.7,
} as const;

// Camera defaults
export const CAMERA_DEFAULTS = {
  perspective: {
    fov: 65,
    near: 0.1,
    far: 100,
    position: { x: 8, y: 6, z: 8 },
  },
  orthographic: {
    viewSize: 10,
    near: 0.1,
    far: 100,
    position: { x: 0, y: 15, z: 0 },
  },
} as const;

// Control defaults
export const CONTROL_DEFAULTS = {
  rotationX: 0.5,
  rotationY: 0,
  zoom: 8,
  panX: 0,
  panY: 0,
  minZoom: 3,
  maxZoom: 20,
  minRotationX: 0.1,
  maxRotationX: Math.PI - 0.1,
  rotationSensitivity: 0.01,
  zoomSensitivity: 0.01,
} as const;

// Material colors for furniture
export const FURNITURE_COLORS: Record<string, number> = {
  sofa: 0x8b4513,
  table: 0x654321,
  chair: 0x4a4a4a,
  bed: 0x4169e1,
  desk: 0x2f4f4f,
  default: 0x696969,
};

// Wall configuration
export const WALL_CONFIG = {
  thickness: 0.1,
  color: 0xffffff,
  roughness: 0.9,
} as const;

// Floor configuration
export const FLOOR_CONFIG = {
  color: 0xe8e8e8,
  roughness: 0.8,
  metalness: 0.1,
} as const;

// Ceiling configuration
export const CEILING_CONFIG = {
  color: 0xf5f5f5,
  roughness: 0.9,
} as const;

// Grid configuration
export const GRID_CONFIG = {
  divisions: 10,
  mainColor: 0x888888,
  secondaryColor: 0xcccccc,
  yOffset: 0.01,
} as const;

// Lighting configuration
export const LIGHTING_CONFIG = {
  ambient: {
    color: 0xffffff,
    intensity: 0.6,
  },
  directional: {
    color: 0xffffff,
    intensity: 0.8,
    position: { x: 10, y: 15, z: 10 },
    shadowMapSize: 2048,
    shadowNear: 0.5,
    shadowFar: 50,
    shadowCameraSize: 10,
  },
  hemisphere: {
    skyColor: 0xffffff,
    groundColor: 0x444444,
    intensity: 0.4,
    position: { x: 0, y: 20, z: 0 },
  },
} as const;

// Scene background
export const SCENE_CONFIG = {
  backgroundColor: 0x87ceeb, // Sky blue
} as const;

// Measurement line configuration
export const MEASUREMENT_CONFIG = {
  color: 0x00ff00,
  lineWidth: 2,
  yOffset: 0.1,
  labelOffset: 0.5,
} as const;

// Selection highlight
export const SELECTION_CONFIG = {
  highlightColor: 0x00ff00,
  roughness: 0.7,
  metalness: 0.1,
} as const;

