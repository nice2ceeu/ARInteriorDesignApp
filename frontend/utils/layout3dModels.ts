/**
 * Real furniture models for the 3D layout: each piece's GLB, loaded once per URL and fitted
 * inside the footprint the layout planned for it (proportions kept), standing where its box is.
 */

import * as THREE from 'three';
import { furnitureModelLoader } from '@/services/FurnitureModelLoader';
import { fitModelToDimensions } from '@/utils/arModelEnhancer';
import type { Layout3DFurnitureItem } from '@/types/layout-3d';
import { threePose } from '@/utils/planView';

/** One download per model while the 3D layout is open; pieces using the same product share it. */
const modelCache = new Map<string, Promise<THREE.Object3D | null>>();

/**
 * Lets the models go when the 3D layout closes. They are a few MB each, and keeping them for the
 * whole app session would leave less memory for the AR scan.
 */
export function clearLayoutModelCache(): void {
  modelCache.clear();
}

function loadOnce(url: string): Promise<THREE.Object3D | null> {
  let pending = modelCache.get(url);
  if (!pending) {
    pending = furnitureModelLoader.loadGLBModel(url).catch(() => null);
    modelCache.set(url, pending);
    // A failed download can be tried again next time the layout opens.
    pending.then((model) => {
      if (!model) modelCache.delete(url);
    });
  }
  return pending;
}

/**
 * The piece's model, fitted inside its planned width × length × height and placed and turned
 * like its box (rotation 0 faces +z, as in glTF). Null when it has no model or it can't load.
 */
export async function loadPlacedModel(item: Layout3DFurnitureItem): Promise<THREE.Object3D | null> {
  if (!item.glbUrl || !item.dimensions) return null;
  const source = await loadOnce(item.glbUrl);
  if (!source) return null;

  // Clones share geometry and materials, so four of the same chair cost one download.
  const model = source.clone(true);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  fitModelToDimensions(model, item.dimensions);

  const placed = new THREE.Group();
  placed.add(model);
  // AR's pose in this right-handed scene, so it isn't the room's mirror image (utils/planView).
  const pose = threePose({ x: item.position?.x || 0, z: item.position?.z || 0, rotation: item.position?.rotation });
  placed.position.set(pose.x, 0, pose.z);
  placed.rotation.y = pose.rotationY;
  placed.userData.furnitureId = item.id;
  placed.userData.isFurnitureModel = true;
  return placed;
}

/** The box stays as the tap target under a loaded model, but invisible. */
export function hideBoxUnderModel(box: THREE.Mesh): void {
  box.userData.hasModel = true;
  box.castShadow = false;
  box.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
}
