/**
 * Spatial Mapping Helper Functions
 * Utility functions for formatting, conversions, and insights
 */

import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { RoomData, SpatialMappingResult } from '@/types/spatial-mapping';
import type { ScanStats } from '@/types/spatial-mapping-ui';
import { 
  UNIT_CONVERSIONS, 
  CONFIDENCE_COLORS, 
  CONFIDENCE_THRESHOLDS,
  ROOM_SIZE_THRESHOLDS,
  RATING_COLORS,
  COMPLIANCE_COLORS,
  PRIORITY_COLORS,
  OBSTACLE_EMOJIS,
} from '@/config/spatialMapping.config';

// ============================================================================
// FORMATTING FUNCTIONS
// ============================================================================

/**
 * Convert meters to feet
 */
export function convertToFeet(meters: number): number {
  return parseFloat((meters * UNIT_CONVERSIONS.METERS_TO_FEET).toFixed(2));
}

/**
 * Format dimension with unit
 */
export function formatDimension(meters: number, useMetric: boolean): string {
  if (useMetric) {
    return `${meters.toFixed(2)} m`;
  }
  return `${convertToFeet(meters).toFixed(2)} ft`;
}

/**
 * Format area with unit
 */
export function formatArea(sqMeters: number, useMetric: boolean): string {
  if (useMetric) {
    return `${sqMeters.toFixed(2)} m²`;
  }
  const sqFeet = sqMeters * UNIT_CONVERSIONS.SQ_METERS_TO_SQ_FEET;
  return `${sqFeet.toFixed(2)} sq ft`;
}

/**
 * Format volume with unit
 */
export function formatVolume(cubicMeters: number, useMetric: boolean): string {
  if (useMetric) {
    return `${cubicMeters.toFixed(2)} m³`;
  }
  const cubicFeet = cubicMeters * UNIT_CONVERSIONS.CUBIC_METERS_TO_CUBIC_FEET;
  return `${cubicFeet.toFixed(2)} ft³`;
}

// ============================================================================
// COLOR FUNCTIONS
// ============================================================================

/**
 * Get confidence color based on value
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence > CONFIDENCE_THRESHOLDS.HIGH) {
    return CONFIDENCE_COLORS.HIGH;
  }
  if (confidence > CONFIDENCE_THRESHOLDS.MEDIUM) {
    return CONFIDENCE_COLORS.MEDIUM;
  }
  return CONFIDENCE_COLORS.LOW;
}

/**
 * Get rating color style
 */
export function getRatingColor(rating: string): { color: string } {
  return { color: RATING_COLORS[rating.toLowerCase()] || '#666' };
}

/**
 * Get compliance color style
 */
export function getComplianceColor(compliance: string): { color: string } {
  return { color: COMPLIANCE_COLORS[compliance.toLowerCase()] || '#666' };
}

/**
 * Get priority color style
 */
export function getPriorityColor(priority: string): { color: string } {
  return { color: PRIORITY_COLORS[priority.toLowerCase()] || '#666' };
}

/**
 * Get emoji for obstacle type
 */
export function getObstacleEmoji(type: string): string {
  return OBSTACLE_EMOJIS[type] || OBSTACLE_EMOJIS.default;
}

// ============================================================================
// ROOM ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Generate room insights based on dimensions and features
 */
export function generateRoomInsights(roomData: RoomData): string[] {
  const insights: string[] = [];
  const { width, length } = roomData.dimensions;
  const area = roomData.area;

  // Room size analysis
  if (area < ROOM_SIZE_THRESHOLDS.SMALL) {
    insights.push('💡 This is a compact room - consider space-saving furniture');
  } else if (area > ROOM_SIZE_THRESHOLDS.LARGE) {
    insights.push('💡 Large room detected - perfect for multiple functional zones');
  } else {
    insights.push('💡 Medium-sized room - versatile for various layouts');
  }

  // Aspect ratio analysis
  const aspectRatio = length / width;
  if (aspectRatio > ROOM_SIZE_THRESHOLDS.RECTANGULAR) {
    insights.push('📐 Rectangular room - consider placing furniture along the longer walls');
  } else if (aspectRatio < ROOM_SIZE_THRESHOLDS.NARROW) {
    insights.push('📐 Narrow room - maximize vertical storage solutions');
  } else {
    insights.push('📐 Square-ish room - flexible furniture arrangement options');
  }

  // Lighting analysis
  const windowCount = roomData.obstacles.filter(obs => obs.type === 'Window').length;
  if (windowCount === 0) {
    insights.push('💡 No windows detected - prioritize artificial lighting design');
  } else if (windowCount >= 2) {
    insights.push('☀️ Multiple windows detected - great natural light potential');
  }

  // Obstacle recommendations
  if (roomData.obstacles.some(obs => obs.type === 'Door')) {
    insights.push('🚪 Door detected - ensure clear walkway paths');
  }

  if (roomData.obstacles.some(obs => obs.type === 'Window')) {
    insights.push('🪟 Window detected - consider furniture placement to maximize views');
  }

  return insights;
}

/**
 * Suggest room type based on dimensions and features
 */
export function suggestRoomType(roomData: RoomData): string | null {
  const { width, length } = roomData.dimensions;
  const area = roomData.area;
  
  const hasBathroomFeatures = roomData.obstacles.some(obs => 
    obs.type.toLowerCase().includes('toilet') || obs.type.toLowerCase().includes('sink')
  );

  if (hasBathroomFeatures) return 'Bathroom';

  if (area < 8) {
    return 'Bathroom';
  } else if (area >= 8 && area < 15) {
    if (width < 3 || length < 3) return 'Bathroom';
    return 'Bedroom';
  } else if (area >= 15 && area < 25) {
    return 'Bedroom';
  } else if (area >= 25 && area < 40) {
    return 'Living Room';
  } else {
    return 'Living Room';
  }
}

/**
 * Get quality label based on confidence
 */
export function getQualityLabel(confidence: number): string {
  if (confidence > 0.8) return 'Excellent';
  if (confidence > 0.6) return 'Good';
  return 'Fair';
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Generate CSV export content
 */
export function generateCSVExport(
  roomData: RoomData,
  scanResult: SpatialMappingResult,
  scanStats: ScanStats
): string {
  const csvRows: string[] = [
    'Type,Label,Value',
    `Dimensions,Width,${roomData.dimensions.width}m`,
    `Dimensions,Length,${roomData.dimensions.length}m`,
    `Dimensions,Height,${roomData.dimensions.height}m`,
    `Calculations,Area,${roomData.area}m²`,
    `Calculations,Volume,${roomData.volume || 0}m³`,
    `Properties,Floor Type,${roomData.floorType || 'Unknown'}`,
    `Properties,Natural Light,${roomData.naturalLight || 'Unknown'}`,
    `Properties,Walls Detected,${roomData.walls?.length || 0}`,
    `Stats,Confidence,${Math.round(scanResult.confidence * 100)}%`,
    `Stats,Planes,${scanResult.planes?.length || 0}`,
    `Stats,Obstacles,${scanResult.roomData?.obstacles?.length || 0}`,
    `Stats,Processing Time,${(scanStats.processingTime / 1000).toFixed(2)}s`,
  ];

  // Add obstacles
  roomData.obstacles.forEach((obs, idx) => {
    csvRows.push(`Obstacle ${idx + 1},Type,${obs.type}`);
    csvRows.push(`Obstacle ${idx + 1},Position,${obs.position}`);
    csvRows.push(`Obstacle ${idx + 1},Size,${obs.size}`);
  });

  return csvRows.join('\n');
}

/**
 * Generate JSON export content
 */
export function generateJSONExport(
  roomData: RoomData,
  scanResult: SpatialMappingResult,
  scanStats: ScanStats
): string {
  const exportData = {
    scanDate: new Date().toISOString(),
    confidence: scanResult.confidence,
    planesDetected: scanResult.planes?.length || 0,
    dimensions: roomData.dimensions,
    area: roomData.area,
    volume: roomData.volume,
    obstacles: roomData.obstacles.map(obs => ({
      type: obs.type,
      label: obs.label,
      position: obs.position,
      size: obs.size,
      distance: obs.distanceFromCamera,
      confidence: obs.confidence,
    })),
    walls: roomData.walls.map(wall => ({
      orientation: wall.orientation,
      length: wall.length,
      startPoint: wall.startPoint,
      endPoint: wall.endPoint,
    })),
    floorType: roomData.floorType,
    naturalLight: roomData.naturalLight,
    stats: scanStats,
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * Export scan data to file
 */
export async function exportScanData(
  format: 'json' | 'csv',
  roomData: RoomData,
  scanResult: SpatialMappingResult,
  scanStats: ScanStats,
  useMetric: boolean
): Promise<{ success: boolean; uri?: string; error?: string }> {
  try {
    let exportContent: string;
    let filename: string;

    if (format === 'csv') {
      exportContent = generateCSVExport(roomData, scanResult, scanStats);
      filename = `room_scan_${Date.now()}.csv`;
    } else {
      exportContent = generateJSONExport(roomData, scanResult, scanStats);
      filename = `room_scan_${Date.now()}.json`;
    }

    const directory = (FileSystem as any).documentDirectory ?? null;
    if (!directory) {
      throw new Error('No document directory available');
    }
    
    const fileUri = `${directory}${filename}`;
    await FileSystem.writeAsStringAsync(fileUri, exportContent);

    // Share the file
    await Share.share({
      message: `Room Scan Data\n\nDimensions: ${formatDimension(roomData.dimensions.width, useMetric)} × ${formatDimension(roomData.dimensions.length, useMetric)} × ${formatDimension(roomData.dimensions.height, useMetric)}\nArea: ${formatArea(roomData.area, useMetric)}\nObstacles: ${roomData.obstacles.length}\nConfidence: ${Math.round(scanResult.confidence * 100)}%`,
      url: fileUri,
      title: `Room Scan Export (${format.toUpperCase()})`,
    });

    return { success: true, uri: fileUri };
  } catch (error) {
    console.error('Export error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Export failed' 
    };
  }
}

/**
 * Generate shareable summary text
 */
export function generateSummaryText(
  roomData: RoomData,
  scanResult: SpatialMappingResult,
  useMetric: boolean
): string {
  return `Room Scan Summary

Dimensions: ${formatDimension(roomData.dimensions.width, useMetric)} × ${formatDimension(roomData.dimensions.length, useMetric)} × ${formatDimension(roomData.dimensions.height, useMetric)}
Area: ${formatArea(roomData.area, useMetric)}
Volume: ${formatVolume(roomData.volume || 0, useMetric)}

Confidence: ${Math.round(scanResult.confidence * 100)}%
Planes Detected: ${scanResult.planes?.length || 0}
Obstacles: ${roomData.obstacles.length}

Floor Type: ${roomData.floorType || 'Unknown'}
Natural Light: ${roomData.naturalLight || 'Unknown'}

Scan Date: ${new Date().toLocaleString()}`;
}

