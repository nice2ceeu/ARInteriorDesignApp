/**
 * Layout 3D Export Utilities
 * Functions for exporting 3D layouts in various formats
 */

import * as THREE from 'three';
import * as FileSystem from 'expo-file-system/legacy';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Share } from 'react-native';
import type {
  RoomDimensions,
  ExportFormat
} from '@/types/layout-3d';
import type { DesignProposal } from '@/types/ai-design';
import { buildFloorPlanPdf, formatPHP } from './floorPlanPdf';
import { buildGlb, toBase64 } from './glbExport';

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  glb: 'model/gltf-binary',
  obj: 'text/plain',
  json: 'application/json',
};

const exportFileName = (design: DesignProposal | null, extension: string) =>
  `${(design?.title || 'layout').replace(/[^a-z0-9\-]+/gi, '_')}_${Date.now()}.${extension}`;

/**
 * Calculate room area
 */
export function calculateArea(dimensions: RoomDimensions): string {
  return (dimensions.width * dimensions.length).toFixed(1);
}

/**
 * Export as PNG: a snapshot of the current 3D view
 */
export async function exportAsPNG(
  design: DesignProposal | null,
  gl: ExpoWebGLRenderingContext | null
): Promise<string> {
  if (!gl) throw new Error('The 3D view is not ready yet. Try again in a moment.');
  const snapshot = await GLView.takeSnapshotAsync(gl, { format: 'png' });
  const source = typeof snapshot.uri === 'string' ? snapshot.uri : '';
  if (!source) throw new Error('Could not capture the 3D view.');

  const uri = (FileSystem.documentDirectory || '') + exportFileName(design, 'png');
  await FileSystem.copyAsync({ from: source, to: uri });
  return uri;
}

/**
 * Export as OBJ format
 */
export async function exportAsOBJ(
  design: DesignProposal | null,
  roomGroup: THREE.Group | null,
  furnitureGroup: THREE.Group | null
): Promise<string> {
  let objContent = '# 3D Layout Export\n';
  objContent += `# Room: ${design?.title || 'Untitled'}\n`;
  objContent += `# Exported: ${new Date().toISOString()}\n\n`;
  
  let vertexIndex = 1;
  
  // Helper to add geometry vertices
  const addGeometryVertices = (group: THREE.Group | null, groupName: string) => {
    if (!group) return;
    
    objContent += `# ${groupName}\n`;
    
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geometry = child.geometry;
        const position = geometry.attributes.position;
        
        // Get world matrix to transform vertices
        child.updateMatrixWorld();
        const matrix = child.matrixWorld;
        
        objContent += `g ${child.userData.furnitureName || child.name || 'object'}\n`;
        
        // Add vertices
        for (let i = 0; i < position.count; i++) {
          const vertex = new THREE.Vector3(
            position.getX(i),
            position.getY(i),
            position.getZ(i)
          );
          vertex.applyMatrix4(matrix);
          objContent += `v ${vertex.x.toFixed(4)} ${vertex.y.toFixed(4)} ${vertex.z.toFixed(4)}\n`;
        }
        
        // Add faces (triangles)
        const indices = geometry.index;
        if (indices) {
          for (let i = 0; i < indices.count; i += 3) {
            const a = indices.getX(i) + vertexIndex;
            const b = indices.getX(i + 1) + vertexIndex;
            const c = indices.getX(i + 2) + vertexIndex;
            objContent += `f ${a} ${b} ${c}\n`;
          }
        }
        
        vertexIndex += position.count;
        objContent += '\n';
      }
    });
  };
  
  // Add room geometry
  addGeometryVertices(roomGroup, 'Room Geometry');
  
  // Add furniture geometry
  addGeometryVertices(furnitureGroup, 'Furniture');
  
  const filename = `layout_${Date.now()}.obj`;
  const uri = (FileSystem.documentDirectory || '') + filename;
  await FileSystem.writeAsStringAsync(uri, objContent);
  
  return uri;
}

/**
 * Export as GLB: binary glTF of the room and furniture meshes
 */
export async function exportAsGLB(
  design: DesignProposal | null,
  roomGroup: THREE.Group | null,
  furnitureGroup: THREE.Group | null
): Promise<string> {
  const glb = buildGlb([roomGroup, furnitureGroup]);
  const uri = (FileSystem.documentDirectory || '') + exportFileName(design, 'glb');
  await FileSystem.writeAsStringAsync(uri, toBase64(glb), { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/**
 * Export as PDF: to-scale floor plan, furniture list and cost breakdown
 */
export async function exportAsPDF(
  design: DesignProposal | null,
  dimensions: RoomDimensions,
  budgetPHP?: number
): Promise<string> {
  if (!design) throw new Error('There is no design to export');
  const pdf = buildFloorPlanPdf({ design, room: dimensions, budgetPHP });
  const uri = (FileSystem.documentDirectory || '') + exportFileName(design, 'pdf');
  await FileSystem.writeAsStringAsync(uri, pdf);
  return uri;
}

/**
 * Export as JSON
 */
export async function exportAsJSON(
  design: DesignProposal | null,
  dimensions: RoomDimensions
): Promise<string> {
  const exportData = {
    design: design?.title,
    furniture: design?.layout?.furniture,
    dimensions,
    colors: design?.colorPalette,
    cost: design?.estimatedCost,
    exportedAt: Date.now(),
    format: 'json',
  };
  
  const filename = `${(design?.title || 'layout').replace(/[^a-z0-9\-]+/gi, '_')}_${Date.now()}.json`;
  const uri = (FileSystem.documentDirectory || '') + filename;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(exportData, null, 2));
  
  return uri;
}

/**
 * Main export function that handles all formats
 */
export async function exportLayout(
  format: ExportFormat,
  design: DesignProposal | null,
  dimensions: RoomDimensions,
  roomGroup?: THREE.Group | null,
  furnitureGroup?: THREE.Group | null,
  gl?: ExpoWebGLRenderingContext | null
): Promise<string> {
  switch (format) {
    case 'png':
      return exportAsPNG(design, gl || null);
    case 'obj':
      return exportAsOBJ(design, roomGroup || null, furnitureGroup || null);
    case 'glb':
      return exportAsGLB(design, roomGroup || null, furnitureGroup || null);
    case 'pdf':
      return exportAsPDF(design, dimensions);
    default:
      return exportAsJSON(design, dimensions);
  }
}

// expo-sharing is a native module; builds made before it was added fall back to Share.
async function loadSharing() {
  try {
    const Sharing = await import('expo-sharing');
    return (await Sharing.isAvailableAsync()) ? Sharing : null;
  } catch {
    return null;
  }
}

/**
 * Share exported file
 */
export async function shareExportedFile(
  uri: string,
  format: string,
  title: string
): Promise<void> {
  const Sharing = await loadSharing();
  if (Sharing) {
    await Sharing.shareAsync(uri, {
      mimeType: MIME_TYPES[format],
      dialogTitle: `${title} (${format.toUpperCase()})`,
    });
    return;
  }
  // React Native's Share attaches files on iOS only; Android receives the text.
  await Share.share({
    url: uri,
    title: `3D Layout Export (${format.toUpperCase()})`,
    message: `3D Layout: ${title}`,
  });
}

/**
 * Generate share text for design
 */
export function generateShareText(
  design: DesignProposal | null,
  dimensions: RoomDimensions
): string {
  if (!design) return '';
  
  return `
🏠 ${design.title}

📐 Dimensions: ${dimensions.width}m × ${dimensions.length}m × ${dimensions.height}m
📏 Area: ${calculateArea(dimensions)} m²
🪑 Furniture: ${design.layout?.furniture?.length || 0} pieces
💰 Estimated cost: ${formatPHP(design.estimatedCost?.mid ?? 0)}

🎨 Colors: ${design.colorPalette?.join(', ') || 'N/A'}
📊 Score: ${design.performanceScore?.overall?.toFixed(0) || 0}/100
  `.trim();
}

