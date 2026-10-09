/**
 * Layout 3D Export Utilities
 * Functions for exporting 3D layouts in various formats
 */

import * as THREE from 'three';
import * as FileSystem from 'expo-file-system/legacy';
import { Share } from 'react-native';
import type { 
  RoomDimensions, 
  Layout3DFurnitureItem,
  ExportData,
  FloorPlanExportData,
  ExportFormat 
} from '@/types/layout-3d';
import type { DesignProposal } from '@/types/ai-design';

/**
 * Calculate room area
 */
export function calculateArea(dimensions: RoomDimensions): string {
  return (dimensions.width * dimensions.length).toFixed(1);
}

/**
 * Export as PNG (metadata for now - actual image capture requires canvas)
 */
export async function exportAsPNG(
  design: DesignProposal | null,
  dimensions: RoomDimensions
): Promise<string> {
  const exportData: ExportData = {
    design: design?.title,
    dimensions,
    furniture: design?.layout?.furniture,
    exportedAt: Date.now(),
    format: 'png',
  };
  
  const filename = `layout_${Date.now()}.png.json`;
  const uri = (FileSystem.documentDirectory || '') + filename;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(exportData, null, 2));
  
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
 * Export as GLB (JSON metadata - full GLB requires GLTFExporter)
 */
export async function exportAsGLB(
  design: DesignProposal | null,
  dimensions: RoomDimensions
): Promise<string> {
  const exportData: ExportData = {
    design: design?.title,
    dimensions,
    furniture: design?.layout?.furniture,
    exportedAt: Date.now(),
    format: 'glb',
    note: 'Full GLB export requires GLTFExporter library',
  };
  
  const filename = `layout_${Date.now()}.glb.json`;
  const uri = (FileSystem.documentDirectory || '') + filename;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(exportData, null, 2));
  
  return uri;
}

/**
 * Export as PDF (floor plan data as JSON)
 */
export async function exportAsPDF(
  design: DesignProposal | null,
  dimensions: RoomDimensions
): Promise<string> {
  const floorPlanData: FloorPlanExportData = {
    title: design?.title,
    dimensions,
    area: calculateArea(dimensions),
    furniture: design?.layout?.furniture?.map((item: any) => ({
      name: item.name,
      position: item.position,
      dimensions: item.dimensions,
    })),
    exportedAt: Date.now(),
    format: 'pdf',
    note: 'Full PDF export requires PDF generation library',
  };
  
  const filename = `floor_plan_${Date.now()}.pdf.json`;
  const uri = (FileSystem.documentDirectory || '') + filename;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(floorPlanData, null, 2));
  
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
  furnitureGroup?: THREE.Group | null
): Promise<string> {
  switch (format) {
    case 'png':
      return exportAsPNG(design, dimensions);
    case 'obj':
      return exportAsOBJ(design, roomGroup || null, furnitureGroup || null);
    case 'glb':
      return exportAsGLB(design, dimensions);
    case 'pdf':
      return exportAsPDF(design, dimensions);
    default:
      return exportAsJSON(design, dimensions);
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
💰 Cost: $${design.estimatedCost?.low?.toLocaleString() || 0} - $${design.estimatedCost?.high?.toLocaleString() || 0}

🎨 Colors: ${design.colorPalette?.join(', ') || 'N/A'}
📊 Score: ${design.performanceScore?.overall?.toFixed(0) || 0}/100
  `.trim();
}

