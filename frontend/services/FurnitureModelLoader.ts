/**
 * Furniture 3D Model Loader Service
 * Loads GLB/GLTF models for furniture items in AR view
 * 
 * Free 3D Model Sources:
 * - Poly Haven: https://polyhaven.com/models (CC0 - Free)
 * - Sketchfab: https://sketchfab.com (filter by CC0/CC-BY)
 * - Free3D: https://free3d.com
 * - TurboSquid Free: https://www.turbosquid.com/Search/3D-Models/free
 */

import * as THREE from 'three';
import * as FileSystem from 'expo-file-system/legacy';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FurnitureLibraryItem } from '@/types/ar-view';

export interface FurnitureModelConfig {
  id: string;
  name: string;
  modelUrl?: string; // URL to GLB/GLTF file
  fallbackToBox: boolean; // Use box geometry if model fails
  scale?: number; // Scale multiplier for the model
  rotation?: { x?: number; y?: number; z?: number }; // Default rotation
  offset?: { x?: number; y?: number; z?: number }; // Position offset
}

// Cache for loaded models
const modelCache = new Map<string, THREE.Object3D>();

// Free 3D Model URLs (using CDN or public repositories)
// NOTE: Replace these with actual URLs to your hosted models or use free CDN services
const FURNITURE_MODEL_URLS: Record<string, string> = {
  // Using placeholder URLs - you'll need to replace these with actual model URLs
  // Option 1: Host models on your server/CDN
  // Option 2: Use free model hosting services
  // Option 3: Use models from Poly Haven or other free sources
  
  'sofa-modern': 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/sofa.glb',
  'coffee-table': 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/table.glb',
  'floor-lamp': 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/lamp.glb',
  'bookshelf': 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/bookshelf.glb',
  'accent-chair': 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/chair.glb',
  'planter': 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/planter.glb',
};

// Default model configurations
const MODEL_CONFIGS: Record<string, FurnitureModelConfig> = {
  'sofa-modern': {
    id: 'sofa-modern',
    name: 'Modern Sofa',
    modelUrl: FURNITURE_MODEL_URLS['sofa-modern'],
    fallbackToBox: true,
    scale: 1.0,
    rotation: { y: 0 },
  },
  'coffee-table': {
    id: 'coffee-table',
    name: 'Coffee Table',
    modelUrl: FURNITURE_MODEL_URLS['coffee-table'],
    fallbackToBox: true,
    scale: 1.0,
  },
  'floor-lamp': {
    id: 'floor-lamp',
    name: 'Floor Lamp',
    modelUrl: FURNITURE_MODEL_URLS['floor-lamp'],
    fallbackToBox: true,
    scale: 1.0,
  },
  'bookshelf': {
    id: 'bookshelf',
    name: 'Bookshelf',
    modelUrl: FURNITURE_MODEL_URLS['bookshelf'],
    fallbackToBox: true,
    scale: 1.0,
  },
  'accent-chair': {
    id: 'accent-chair',
    name: 'Accent Chair',
    modelUrl: FURNITURE_MODEL_URLS['accent-chair'],
    fallbackToBox: true,
    scale: 1.0,
  },
  'planter': {
    id: 'planter',
    name: 'Tall Planter',
    modelUrl: FURNITURE_MODEL_URLS['planter'],
    fallbackToBox: true,
    scale: 1.0,
  },
};

export class FurnitureModelLoader {
  private loader: GLTFLoader;
  private loadingPromises: Map<string, Promise<THREE.Object3D | null>> = new Map();

  constructor() {
    this.loader = new GLTFLoader();
  }

  /**
   * Load GLB/GLTF model from URL or asset
   * Supports both remote URLs and local file paths
   * Uses expo-file-system for React Native compatibility
   */
  async loadGLBModel(
    modelUrl: string,
    scale: number = 1.0
  ): Promise<THREE.Group | null> {
    try {
      console.log('[FurnitureModelLoader] Loading GLB model from:', modelUrl);
      
      let modelUri: string;
      
      // Check if it's a remote URL or local asset
      if (modelUrl.startsWith('http://') || modelUrl.startsWith('https://')) {
        // Remote URL - download to local file first (required for React Native)
        const fileName = `model_${Date.now()}.glb`;
        const localPath = FileSystem.documentDirectory + fileName;
        
        console.log('[FurnitureModelLoader] Downloading remote model to:', localPath);
        const downloadResult = await FileSystem.downloadAsync(modelUrl, localPath);
        modelUri = downloadResult.uri;
        console.log('[FurnitureModelLoader] Model downloaded to:', modelUri);
      } else {
        // Local asset - resolve file path
        if (modelUrl.startsWith('file://')) {
          modelUri = modelUrl;
        } else {
          // Try to resolve as document directory path
          modelUri = FileSystem.documentDirectory 
            ? `${FileSystem.documentDirectory}${modelUrl}`
            : modelUrl;
        }
        console.log('[FurnitureModelLoader] Using local file path:', modelUri);
      }
      
      if (!modelUri) {
        throw new Error('Failed to resolve model URI');
      }
      
      // Load with GLTFLoader
      return new Promise((resolve, reject) => {
        this.loader.load(
          modelUri,
          (gltf) => {
            console.log('[FurnitureModelLoader] GLB model loaded successfully');
            const model = gltf.scene;
            
            // Apply scale
            if (scale !== 1.0) {
              model.scale.set(scale, scale, scale);
            }
            
            // Enable shadows and optimize
            model.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Ensure materials are updated
                if (child.material instanceof THREE.MeshStandardMaterial) {
                  child.material.needsUpdate = true;
                }
              }
            });
            
            resolve(model);
          },
          (progress) => {
            // Loading progress
            if (progress.total > 0) {
              const percent = (progress.loaded / progress.total) * 100;
              console.log(`[FurnitureModelLoader] Loading progress: ${percent.toFixed(1)}%`);
            }
          },
          (error) => {
            console.error('[FurnitureModelLoader] Error loading GLB model:', error);
            reject(error);
          }
        );
      });
    } catch (error) {
      console.error('[FurnitureModelLoader] Failed to load GLB model:', error);
      return null;
    }
  }

  /**
   * Load a 3D model for furniture item
   * Returns a clone of the cached model or creates a box fallback
   */
  async loadModel(
    furnitureId: string,
    dimensions: { width: number; length: number; height: number },
    color?: string
  ): Promise<THREE.Object3D> {
    const config = MODEL_CONFIGS[furnitureId];
    
    // Check cache first
    if (modelCache.has(furnitureId)) {
      const cachedModel = modelCache.get(furnitureId)!;
      return this.cloneModel(cachedModel);
    }

    // Check if already loading
    if (this.loadingPromises.has(furnitureId)) {
      const loadedModel = await this.loadingPromises.get(furnitureId)!;
      if (loadedModel) {
        return this.cloneModel(loadedModel);
      }
    }

    // Start loading
    const loadPromise = this.loadModelInternal(furnitureId, dimensions, color, config);
    this.loadingPromises.set(furnitureId, loadPromise);

    const model = await loadPromise;
    if (model) {
      modelCache.set(furnitureId, model);
      return this.cloneModel(model);
    }

    // Fallback to box if model loading failed
    return this.createBoxFallback(furnitureId, dimensions, color);
  }

  private async loadModelInternal(
    furnitureId: string,
    dimensions: { width: number; length: number; height: number },
    color?: string,
    config?: FurnitureModelConfig
  ): Promise<THREE.Object3D | null> {
    if (!config?.modelUrl) {
      console.warn(`[FurnitureModelLoader] No model URL for ${furnitureId}, using fallback`);
      return null;
    }

    try {
      console.log(`[FurnitureModelLoader] Loading model for ${furnitureId} from ${config.modelUrl}`);
      
      // Use the new loadGLBModel method which supports React Native FileSystem
      const model = await this.loadGLBModel(config.modelUrl, config.scale || 1.0);
      
      if (!model) {
        throw new Error('Model loading returned null');
      }

      // Apply default rotation
      if (config.rotation) {
        if (config.rotation.x !== undefined) model.rotation.x = config.rotation.x;
        if (config.rotation.y !== undefined) model.rotation.y = config.rotation.y;
        if (config.rotation.z !== undefined) model.rotation.z = config.rotation.z;
      }

      // Apply offset
      if (config.offset) {
        if (config.offset.x !== undefined) model.position.x = config.offset.x;
        if (config.offset.y !== undefined) model.position.y = config.offset.y;
        if (config.offset.z !== undefined) model.position.z = config.offset.z;
      }

      // Calculate bounding box to ensure proper scaling
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      
      // Scale to match dimensions
      const scaleX = dimensions.width / size.x;
      const scaleY = dimensions.height / size.y;
      const scaleZ = dimensions.length / size.z;
      const uniformScale = Math.min(scaleX, scaleY, scaleZ);
      
      if (uniformScale !== Infinity && uniformScale > 0) {
        model.scale.multiplyScalar(uniformScale);
      }

      // Center the model
      box.setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.position.y += dimensions.height / 2; // Position on floor

      console.log(`[FurnitureModelLoader] Successfully loaded model for ${furnitureId}`);
      return model;
    } catch (error) {
      console.error(`[FurnitureModelLoader] Failed to load model for ${furnitureId}:`, error);
      
      if (config?.fallbackToBox) {
        console.log(`[FurnitureModelLoader] Using box fallback for ${furnitureId}`);
        return null; // Will trigger fallback
      }
      
      return null;
    }
  }

  private cloneModel(model: THREE.Object3D): THREE.Object3D {
    return model.clone();
  }

  private createBoxFallback(
    furnitureId: string,
    dimensions: { width: number; length: number; height: number },
    color?: string
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(
      dimensions.width,
      dimensions.height,
      dimensions.length
    );

    const baseColor = color ? new THREE.Color(color) : new THREE.Color(0x888888);
    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.6,
      metalness: 0.2,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  /**
   * Preload models for better performance
   */
  async preloadModels(furnitureIds: string[]): Promise<void> {
    const loadPromises = furnitureIds.map(async (id) => {
      const config = MODEL_CONFIGS[id];
      if (config) {
        // Use default dimensions from config or library
        const dimensions = { width: 1, length: 1, height: 1 };
        await this.loadModel(id, dimensions);
      }
    });

    await Promise.all(loadPromises);
  }

  /**
   * Clear model cache
   */
  clearCache(): void {
    modelCache.clear();
    this.loadingPromises.clear();
  }

  /**
   * Get model config for a furniture item
   */
  getModelConfig(furnitureId: string): FurnitureModelConfig | undefined {
    return MODEL_CONFIGS[furnitureId];
  }

  /**
   * Add or update model configuration
   */
  setModelConfig(config: FurnitureModelConfig): void {
    MODEL_CONFIGS[config.id] = config;
  }

  /**
   * Create detailed 3D furniture model based on category
   * Supports both GLB/GLTF files and procedural generation
   * Returns a Promise that resolves to a THREE.Group
   */
  async createDetailedFurnitureModel(item: FurnitureLibraryItem): Promise<THREE.Group> {
    const group = new THREE.Group();
    const { width, height, length } = item.dimensions;

    // Check if item has a 3D model URL (GLB/GLTF)
    if (item.model3D?.url && item.model3D?.format &&
      (item.model3D.format === 'glb' || item.model3D.format === 'gltf')) {
      try {
        console.log(`[FurnitureModelLoader] Loading external 3D model for ${item.name}:`, item.model3D.url);
        const loadedModel = await this.loadGLBModel(
          item.model3D.url,
          item.model3D.scale || 1.0
        );

        if (loadedModel) {
          // Scale model to match dimensions if needed
          const modelBox = new THREE.Box3().setFromObject(loadedModel);
          const modelSize = modelBox.getSize(new THREE.Vector3());

          // Calculate scale to match item dimensions
          const scaleX = width / modelSize.x;
          const scaleY = height / modelSize.y;
          const scaleZ = length / modelSize.z;
          const uniformScale = Math.min(scaleX, scaleY, scaleZ);

          if (uniformScale !== Infinity && uniformScale > 0) {
            loadedModel.scale.multiplyScalar(uniformScale);
          }

          // Center the model
          modelBox.setFromObject(loadedModel);
          const center = modelBox.getCenter(new THREE.Vector3());
          loadedModel.position.sub(center);
          loadedModel.position.y += height / 2; // Position on floor

          group.add(loadedModel);
          group.visible = true;

          console.log(`[FurnitureModelLoader] Successfully loaded GLB model for ${item.name}`);
          return group;
        } else {
          console.warn(`[FurnitureModelLoader] Failed to load GLB model, falling back to procedural generation`);
        }
      } catch (error) {
        console.error(`[FurnitureModelLoader] Error loading GLB model for ${item.name}:`, error);
        // Fall through to procedural generation
      }
    }

    // Fallback to procedural generation
    return this.createProceduralFurnitureModel(item);
  }

  /**
   * Create procedural 3D furniture model based on category
   */
  private createProceduralFurnitureModel(item: FurnitureLibraryItem): THREE.Group {
    const group = new THREE.Group();
    const { width, height, length } = item.dimensions;

    // Ensure color is valid, fallback to gray if not
    const colorValue = item.color || '#808080';
    const baseColor = new THREE.Color(colorValue);

    // Validate baseColor was created successfully
    if (!baseColor || !baseColor.isColor) {
      console.warn(`[FurnitureModelLoader] Invalid color for item ${item.id}, using fallback`);
      baseColor.setHex(0x808080);
    }

    // Ensure group is visible
    group.visible = true;

    // Base material properties
    const createMaterial = (color: THREE.Color, roughness: number = 0.7, metalness: number = 0.1) => {
      return new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        envMapIntensity: 0.5,
      });
    };

    switch (item.category) {
      case 'seating': {
        if (item.id.includes('sofa')) {
          // Enhanced realistic sofa model
          const isScandinavian = item.id.includes('scandinavian') || item.id.includes('two-seater');

          // Dimensions
          const seatHeight = height * 0.38; // Lower seat for modern look
          const backHeight = height * 0.55;
          const armHeight = height * 0.65;
          const armWidth = width * 0.06; // Thinner armrests for Scandinavian
          const cushionThickness = height * 0.18;
          const legHeight = 0.15; // Visible wooden legs
          const legThickness = 0.03; // Tapered legs

          // Base frame (hidden, supports everything)
          const baseFrame = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.98, seatHeight * 0.3, length * 0.92),
            createMaterial(baseColor.clone().multiplyScalar(0.7), 0.9, 0.0)
          );
          baseFrame.position.y = seatHeight * 0.15;
          baseFrame.visible = false; // Hidden but provides structure
          group.add(baseFrame);

          // Seat cushions - more realistic with rounded edges
          const numCushions = isScandinavian ? 2 : 3; // Two-seater has 2 cushions
          const cushionWidth = (width * 0.88) / numCushions;
          const cushionGap = 0.02; // Small gap between cushions

          for (let i = 0; i < numCushions; i++) {
            // Main cushion body with more segments for smoother look
            const cushion = new THREE.Mesh(
              new THREE.BoxGeometry(
                cushionWidth - cushionGap,
                cushionThickness,
                length * 0.82,
                8, 4, 8 // More segments for smoother appearance
              ),
              createMaterial(baseColor.clone().multiplyScalar(0.95), 0.85, 0.0)
            );

            // Position cushions with gaps
            const totalCushionWidth = numCushions * cushionWidth;
            const startX = -totalCushionWidth / 2 + cushionWidth / 2;
            cushion.position.set(
              startX + i * cushionWidth,
              seatHeight + cushionThickness / 2,
              0
            );

            // Add rounded top effect by adjusting normals
            cushion.geometry.computeVertexNormals();

            // Add subtle tufting effect (small indentations) for Scandinavian style
            if (isScandinavian) {
              // Add small tufting details on backrest side
              const tuftGeometry = new THREE.SphereGeometry(0.02, 8, 8);
              const tuftMaterial = createMaterial(baseColor.clone().multiplyScalar(0.85), 0.9, 0.0);
              for (let t = 0; t < 2; t++) {
                const tuft = new THREE.Mesh(tuftGeometry, tuftMaterial);
                tuft.position.set(
                  cushion.position.x + (t - 0.5) * cushionWidth * 0.3,
                  cushion.position.y - cushionThickness * 0.3,
                  cushion.position.z - length * 0.35
                );
                tuft.scale.set(1, 0.3, 1); // Flatten for tufting effect
                group.add(tuft);
              }
            }

            group.add(cushion);
          }

          // Backrest - curved for Scandinavian style
          if (isScandinavian) {
            // Curved backrest using multiple segments
            const backrestSegments = 8;
            const backrestDepth = length * 0.12;
            const curveRadius = width * 0.6;

            for (let s = 0; s < backrestSegments; s++) {
              const angle = (s / (backrestSegments - 1) - 0.5) * Math.PI * 0.3; // Subtle curve
              const segmentWidth = width / backrestSegments;
              const segmentHeight = backHeight;

              const segment = new THREE.Mesh(
                new THREE.BoxGeometry(segmentWidth * 1.05, segmentHeight, backrestDepth, 4, 4, 4),
                createMaterial(baseColor, 0.8, 0.05)
              );

              const curveOffset = Math.sin(angle) * curveRadius * 0.1;
              segment.position.set(
                (s - backrestSegments / 2 + 0.5) * segmentWidth,
                seatHeight + segmentHeight / 2,
                -length * 0.38 + curveOffset
              );
              segment.rotation.z = angle * 0.3; // Slight rotation for curve
              segment.geometry.computeVertexNormals();
              group.add(segment);
            }
          } else {
            // Straight backrest for other sofas
            const backrest = new THREE.Mesh(
              new THREE.BoxGeometry(width * 0.95, backHeight, length * 0.12, 8, 4, 4),
              createMaterial(baseColor, 0.8, 0.05)
            );
            backrest.position.set(0, seatHeight + backHeight / 2, -length * 0.38);
            backrest.geometry.computeVertexNormals();
            group.add(backrest);
          }

          // Armrests - thinner and more elegant for Scandinavian
          const armrestMaterial = createMaterial(baseColor, 0.8, 0.05);
          const armrestDepth = length * 0.8;

          // Left armrest
          const leftArm = new THREE.Mesh(
            new THREE.BoxGeometry(armWidth, armHeight, armrestDepth, 4, 4, 4),
            armrestMaterial
          );
          leftArm.position.set(-width * 0.46, armHeight / 2, 0);
          leftArm.geometry.computeVertexNormals();
          group.add(leftArm);

          // Right armrest
          const rightArm = new THREE.Mesh(
            new THREE.BoxGeometry(armWidth, armHeight, armrestDepth, 4, 4, 4),
            armrestMaterial
          );
          rightArm.position.set(width * 0.46, armHeight / 2, 0);
          rightArm.geometry.computeVertexNormals();
          group.add(rightArm);

          // Legs - tapered wooden legs for Scandinavian, metal for others
          const legPositions = [
            [-width * 0.42, -length * 0.38],
            [width * 0.42, -length * 0.38],
            [-width * 0.42, length * 0.38],
            [width * 0.42, length * 0.38]
          ];

          for (const [x, z] of legPositions) {
            if (isScandinavian) {
              // Tapered wooden legs (lighter color, wood material)
              const legTopRadius = legThickness * 1.2;
              const legBottomRadius = legThickness * 0.8; // Tapered
              const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(legTopRadius, legBottomRadius, legHeight, 8),
                createMaterial(new THREE.Color(0xD4B896), 0.7, 0.1) // Light wood color
              );
              leg.position.set(x, legHeight / 2, z);
              leg.rotation.z = Math.PI * 0.05; // Slight outward angle for tapered look
              group.add(leg);
            } else {
              // Metal legs for other sofas
              const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(legThickness, legThickness, legHeight, 8),
                createMaterial(new THREE.Color(0x4a4a4a), 0.3, 0.7)
              );
              leg.position.set(x, legHeight / 2, z);
              group.add(leg);
            }
          }
        } else {
          // Chair with backrest and legs
          const seatHeight = height * 0.45;
          const backHeight = height * 0.55;
          const legThickness = 0.03;

          // Seat
          const seat = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.9, seatHeight * 0.3, length * 0.9, 4, 2, 4),
            createMaterial(baseColor, 0.8, 0.05)
          );
          seat.position.y = seatHeight;
          seat.geometry.computeVertexNormals();
          group.add(seat);

          // Backrest
          const backrest = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.85, backHeight, length * 0.08),
            createMaterial(baseColor, 0.8, 0.05)
          );
          backrest.position.set(0, seatHeight + backHeight / 2, -length * 0.4);
          group.add(backrest);

          // Legs (4 legs)
          const legHeight = seatHeight * 0.9;
          for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const leg = new THREE.Mesh(
              new THREE.CylinderGeometry(legThickness, legThickness, legHeight, 8),
              createMaterial(new THREE.Color(0x4a4a4a), 0.3, 0.7)
            );
            leg.position.set(x * width * 0.35, legHeight / 2, z * length * 0.35);
            group.add(leg);
          }
        }
        break;
      }

      case 'tables': {
        const tabletopThickness = height * 0.1;
        const legThickness = 0.04;
        const legHeight = height - tabletopThickness;

        // Tabletop
        const tabletop = new THREE.Mesh(
          new THREE.BoxGeometry(width, tabletopThickness, length, 8, 2, 8),
          createMaterial(baseColor, 0.6, 0.2)
        );
        tabletop.position.y = height - tabletopThickness / 2;
        tabletop.geometry.computeVertexNormals();
        group.add(tabletop);

        // Legs (4 legs)
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(legThickness, legThickness * 1.1, legHeight, 8),
            createMaterial(new THREE.Color(0x3a3a3a), 0.4, 0.6)
          );
          leg.position.set(x * width * 0.4, legHeight / 2, z * length * 0.4);
          group.add(leg);
        }
        break;
      }

      case 'storage': {
        if (item.id.includes('bookshelf')) {
          // Bookshelf with shelves
          const shelfThickness = 0.02;
          const numShelves = 4;
          const shelfSpacing = (height - shelfThickness * 2) / numShelves;

          // Frame
          const frameThickness = 0.05;
          // Sides
          for (const x of [-width / 2 + frameThickness / 2, width / 2 - frameThickness / 2]) {
            const side = new THREE.Mesh(
              new THREE.BoxGeometry(frameThickness, height, length),
              createMaterial(baseColor, 0.7, 0.1)
            );
            side.position.set(x, height / 2, 0);
            group.add(side);
          }
          // Top and bottom
          for (const y of [shelfThickness / 2, height - shelfThickness / 2]) {
            const shelf = new THREE.Mesh(
              new THREE.BoxGeometry(width - frameThickness * 2, shelfThickness, length),
              createMaterial(baseColor, 0.7, 0.1)
            );
            shelf.position.set(0, y, 0);
            group.add(shelf);
          }
          // Middle shelves
          for (let i = 1; i < numShelves; i++) {
            const shelf = new THREE.Mesh(
              new THREE.BoxGeometry(width - frameThickness * 2, shelfThickness, length * 0.95),
              createMaterial(baseColor, 0.7, 0.1)
            );
            shelf.position.set(0, i * shelfSpacing, 0);
            group.add(shelf);
          }
          // Back panel
          const back = new THREE.Mesh(
            new THREE.BoxGeometry(width - frameThickness * 2, height - shelfThickness * 2, 0.01),
            createMaterial(baseColor.clone().multiplyScalar(0.8), 0.8, 0.0)
          );
          back.position.set(0, height / 2, -length / 2 + 0.01);
          group.add(back);
        } else {
          // Generic storage (wardrobe, TV stand, etc.)
          const doorThickness = 0.02;
          const topThickness = 0.05;

          // Main body
          const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height - topThickness, length),
            createMaterial(baseColor, 0.7, 0.1)
          );
          body.position.y = (height - topThickness) / 2;
          group.add(body);

          // Top
          const top = new THREE.Mesh(
            new THREE.BoxGeometry(width, topThickness, length),
            createMaterial(baseColor, 0.6, 0.2)
          );
          top.position.y = height - topThickness / 2;
          group.add(top);

          // Doors (2 doors)
          const doorWidth = (width - 0.02) / 2;
          for (const x of [-doorWidth / 2, doorWidth / 2]) {
            const door = new THREE.Mesh(
              new THREE.BoxGeometry(doorWidth, height - topThickness - 0.02, doorThickness),
              createMaterial(baseColor.clone().multiplyScalar(0.9), 0.5, 0.3)
            );
            door.position.set(x, (height - topThickness) / 2, length / 2 - doorThickness / 2);
            group.add(door);
          }
        }
        break;
      }

      case 'bedroom': {
        if (item.id.includes('bed')) {
          // Bed with mattress, headboard, and frame
          const mattressHeight = height * 0.6;
          const frameHeight = height * 0.4;
          const headboardHeight = height * 1.2;

          // Mattress
          const mattress = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.95, mattressHeight, length * 0.95, 8, 4, 8),
            createMaterial(baseColor.clone().multiplyScalar(0.95), 0.9, 0.0)
          );
          mattress.position.y = frameHeight + mattressHeight / 2;
          mattress.geometry.computeVertexNormals();
          group.add(mattress);

          // Bed frame
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(width, frameHeight, length),
            createMaterial(new THREE.Color(0x654321), 0.8, 0.1)
          );
          frame.position.y = frameHeight / 2;
          group.add(frame);

          // Headboard
          const headboard = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.9, headboardHeight, length * 0.15),
            createMaterial(new THREE.Color(0x654321), 0.8, 0.1)
          );
          headboard.position.set(0, frameHeight + mattressHeight + headboardHeight / 2, -length * 0.4);
          group.add(headboard);
        } else {
          // Nightstand
          const topThickness = 0.05;
          const drawerHeight = (height - topThickness) / 2;

          // Top
          const top = new THREE.Mesh(
            new THREE.BoxGeometry(width, topThickness, length),
            createMaterial(baseColor, 0.6, 0.2)
          );
          top.position.y = height - topThickness / 2;
          group.add(top);

          // Body
          const body = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.95, height - topThickness, length * 0.95),
            createMaterial(baseColor, 0.7, 0.1)
          );
          body.position.y = (height - topThickness) / 2;
          group.add(body);

          // Drawer
          const drawer = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.9, drawerHeight * 0.8, length * 0.85),
            createMaterial(baseColor.clone().multiplyScalar(0.85), 0.6, 0.2)
          );
          drawer.position.set(0, drawerHeight, length * 0.05);
          group.add(drawer);
        }
        break;
      }

      case 'lighting': {
        // Lamp with base, pole, and shade
        const baseHeight = height * 0.15;
        const poleHeight = height * 0.6;
        const shadeHeight = height * 0.25;

        // Base
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(width * 0.4, width * 0.5, baseHeight, 16),
          createMaterial(new THREE.Color(0x4a4a4a), 0.3, 0.7)
        );
        base.position.y = baseHeight / 2;
        group.add(base);

        // Pole
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, poleHeight, 8),
          createMaterial(new THREE.Color(0x3a3a3a), 0.4, 0.6)
        );
        pole.position.y = baseHeight + poleHeight / 2;
        group.add(pole);

        // Shade
        const shade = new THREE.Mesh(
          new THREE.ConeGeometry(width * 0.6, shadeHeight, 16),
          createMaterial(baseColor, 0.5, 0.0)
        );
        shade.position.y = baseHeight + poleHeight + shadeHeight / 2;
        shade.rotation.x = Math.PI;
        group.add(shade);
        break;
      }

      case 'decor': {
        if (item.id.includes('planter')) {
          // Planter pot
          const potHeight = height * 0.8;
          const rimThickness = 0.05;

          // Main pot
          const pot = new THREE.Mesh(
            new THREE.CylinderGeometry(width * 0.45, width * 0.4, potHeight, 16),
            createMaterial(baseColor, 0.7, 0.1)
          );
          pot.position.y = potHeight / 2;
          group.add(pot);

          // Rim
          const rim = new THREE.Mesh(
            new THREE.TorusGeometry(width * 0.45, rimThickness, 8, 16),
            createMaterial(baseColor.clone().multiplyScalar(0.9), 0.6, 0.2)
          );
          rim.position.y = potHeight;
          rim.rotation.x = Math.PI / 2;
          group.add(rim);
        } else {
          // Rug - flat with pattern
          const rug = new THREE.Mesh(
            new THREE.PlaneGeometry(width, length, 8, 8),
            createMaterial(baseColor, 0.9, 0.0)
          );
          rug.rotation.x = -Math.PI / 2;
          rug.position.y = 0.005;
          group.add(rug);
        }
        break;
      }

      default: {
        // Fallback: detailed box with rounded edges effect
        console.warn(`[FurnitureModelLoader] Unknown furniture category: ${item.category}, using default box`);
        const geometry = new THREE.BoxGeometry(width, height, length, 8, 8, 8);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, createMaterial(baseColor));
        mesh.visible = true;
        group.add(mesh);
      }
    }

    // CRITICAL SAFETY CHECK: Ensure group always has at least one mesh
    if (group.children.length === 0) {
      console.error(`[FurnitureModelLoader] ERROR: Furniture group is empty for item: ${item.name} (${item.category})`);
      // Create a simple visible box as absolute fallback
      const fallbackGeometry = new THREE.BoxGeometry(width, height, length);
      const fallbackMesh = new THREE.Mesh(fallbackGeometry, createMaterial(baseColor));
      fallbackMesh.visible = true;
      group.add(fallbackMesh);
      console.log('[FurnitureModelLoader] Added fallback mesh. Group now has', group.children.length, 'children');
    }

    // Enable shadows for all children and ensure visibility
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.visible = true; // Ensure all meshes are visible
        child.matrixAutoUpdate = true; // Ensure matrix updates
      }
    });

    // Ensure group is visible and properly configured
    group.visible = true;
    group.matrixAutoUpdate = true;

    return group;
  }
}

// Singleton instance
export const furnitureModelLoader = new FurnitureModelLoader();

