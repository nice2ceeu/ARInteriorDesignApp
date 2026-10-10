/**
 * Layout 3D Storage Utilities
 * Functions for saving and loading 3D layout projects
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RoomDimensions, Layout3DProjectData } from '@/types/layout-3d';
import type { DesignProposal } from '@/types/ai-design';
import { savedItemsService } from '@/services/SavedItemsService';

const STORAGE_KEYS = {
  PROJECT_PREFIX: 'project_',
  FINALIZED_PREFIX: 'finalized_',
} as const;

/**
 * Save project to AsyncStorage
 */
export async function saveProject(
  design: DesignProposal,
  roomDimensions: RoomDimensions
): Promise<void> {
  const projectId = design.id || String(Date.now());
  const projectData: Layout3DProjectData = {
    id: projectId,
    title: design.title,
    roomDimensions,
    furniture: design.layout?.furniture || [],
    colorPalette: design.colorPalette,
    estimatedCost: design.estimatedCost,
    savedAt: Date.now(),
    version: '1.0',
  };

  const storageKey = `${STORAGE_KEYS.PROJECT_PREFIX}${projectId}`;
  await AsyncStorage.setItem(storageKey, JSON.stringify(projectData));
  await savedItemsService.saveItem({
    id: `layout-project:${projectId}`,
    name: design.title || 'Room design',
    type: 'project',
    iconName: 'cube-outline',
    metadata: { source: 'layout-3d', design: { ...design, id: projectId }, roomDimensions },
  });
}

/**
 * Load project from AsyncStorage
 */
export async function loadProject(projectId: string): Promise<Layout3DProjectData | null> {
  try {
    const storageKey = `${STORAGE_KEYS.PROJECT_PREFIX}${projectId}`;
    const data = await AsyncStorage.getItem(storageKey);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Layout3DStorage] Failed to load project:', error);
    return null;
  }
}

/**
 * Finalize design and save to storage
 */
export async function finalizeDesign(
  design: DesignProposal,
  roomDimensions: RoomDimensions
): Promise<void> {
  const finalizedData = {
    ...design,
    roomDimensions,
    finalizedAt: Date.now(),
    status: 'finalized',
  };

  const storageKey = `${STORAGE_KEYS.FINALIZED_PREFIX}${design.id || Date.now()}`;
  await AsyncStorage.setItem(storageKey, JSON.stringify(finalizedData));
}

/**
 * Get all saved projects
 */
export async function getAllProjects(): Promise<Layout3DProjectData[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const projectKeys = allKeys.filter(key => key.startsWith(STORAGE_KEYS.PROJECT_PREFIX));
    
    const projects = await Promise.all(
      projectKeys.map(async (key) => {
        const data = await AsyncStorage.getItem(key);
        return data ? JSON.parse(data) : null;
      })
    );
    
    return projects.filter(Boolean) as Layout3DProjectData[];
  } catch (error) {
    console.error('[Layout3DStorage] Failed to get all projects:', error);
    return [];
  }
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string): Promise<void> {
  const storageKey = `${STORAGE_KEYS.PROJECT_PREFIX}${projectId}`;
  await AsyncStorage.removeItem(storageKey);
  await savedItemsService.removeSavedItem(`layout-project:${projectId}`);
}

/**
 * Parse design data from route params
 */
export function parseDesignFromParams(params: {
  designId?: string;
  designData?: string;
  roomDimensions?: string;
}): {
  design: DesignProposal | null;
  dimensions: RoomDimensions | null;
} {
  let design: DesignProposal | null = null;
  let dimensions: RoomDimensions | null = null;

  // Parse design data
  if (params.designId && params.designData) {
    try {
      const parsedData = JSON.parse(params.designData as string);
      if (parsedData && typeof parsedData === 'object') {
        design = parsedData;
        if (parsedData.layout?.metadata?.dimensions) {
          dimensions = parsedData.layout.metadata.dimensions;
        }
      }
    } catch (error) {
      console.warn('[Layout3DStorage] Failed to parse design data:', error);
    }
  }

  // Parse room dimensions separately if provided
  if (params.roomDimensions) {
    try {
      const parsedDims = JSON.parse(params.roomDimensions as string);
      if (parsedDims && parsedDims.width && parsedDims.length && parsedDims.height) {
        dimensions = parsedDims;
      }
    } catch (error) {
      console.warn('[Layout3DStorage] Failed to parse room dimensions:', error);
    }
  }

  return { design, dimensions };
}

