import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Rect, Text as SvgText, Circle } from 'react-native-svg';

export interface RoomDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface FurnitureItem {
  name: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  color: string;
}

/** A door or window on a wall; offset is its center along the wall (0..1, left-to-right or top-to-bottom). */
export interface Opening {
  type: 'door' | 'window';
  wall: 'north' | 'east' | 'south' | 'west';
  offset?: number;
  width?: number;
}

interface FloorPlan2DProps {
  roomDimensions: RoomDimensions;
  furniture: FurnitureItem[];
  obstacles: string[];
  openings?: Opening[];
}

const OPENING_COLORS = { door: '#b45309', window: '#0ea5e9' };

/** Dark text on light furniture colors, white text on dark ones. */
export function labelColor(fill: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(fill);
  if (!match) return '#0f172a';
  const value = parseInt(match[1], 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 0xff, value & 0xff];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#ffffff';
}

export default function FloorPlan2D({ roomDimensions, furniture, obstacles, openings = [] }: FloorPlan2DProps) {
  // Screen width minus padding
  const containerWidth = Dimensions.get('window').width - 32;
  
  // Calculate scale to fit room into container
  // Assume room is laid out in X-Z space (width and depth)
  const roomWidthMeters = roomDimensions.width || 5;
  const roomDepthMeters = roomDimensions.depth || 5;
  
  const scale = containerWidth / Math.max(roomWidthMeters, roomDepthMeters);
  
  const svgWidth = roomWidthMeters * scale;
  const svgHeight = roomDepthMeters * scale;

  return (
    <View style={[styles.container, { width: svgWidth, height: svgHeight }]}>
      <Svg width={svgWidth} height={svgHeight}>
        {/* Room Boundary */}
        <Rect
          x="0"
          y="0"
          width={svgWidth}
          height={svgHeight}
          fill="#f8fafc"
          stroke="#cbd5e1"
          strokeWidth="4"
        />

        {/* Doors and windows drawn on their walls */}
        {openings.map((opening, idx) => {
          const horizontal = opening.wall === 'north' || opening.wall === 'south';
          const wallLength = horizontal ? svgWidth : svgHeight;
          const span = (opening.width ?? (opening.type === 'door' ? 0.9 : 1.2)) * scale;
          const start = (opening.offset ?? 0.5) * wallLength - span / 2;
          const thickness = 8;
          const x = horizontal ? start : opening.wall === 'west' ? 0 : svgWidth - thickness;
          const y = horizontal ? (opening.wall === 'north' ? 0 : svgHeight - thickness) : start;
          return (
            <Rect
              key={`opening-${idx}`}
              x={x}
              y={y}
              width={horizontal ? span : thickness}
              height={horizontal ? thickness : span}
              fill={OPENING_COLORS[opening.type]}
            />
          );
        })}

        {/* Other obstacles (simplified markers; doors and windows with known walls are drawn above) */}
        {obstacles.filter(obs => !openings.some(opening => opening.type === obs)).map((obs, idx) => {
          // Simplistic obstacle rendering on the borders
          const isDoor = obs.toLowerCase().includes('door');
          const isWindow = obs.toLowerCase().includes('window');
          
          let cx = isDoor ? svgWidth / 2 : (idx * 50) % svgWidth;
          let cy = isDoor ? 0 : isWindow ? svgHeight : 10;
          
          return (
            <Circle
              key={`obs-${idx}`}
              cx={cx}
              cy={cy}
              r={10}
              fill={isDoor ? '#ef4444' : isWindow ? '#3b82f6' : '#f59e0b'}
            />
          );
        })}

        {/* Furniture Items */}
        {furniture.map((item, idx) => {
          const itemWidth = item.width * scale;
          const itemHeight = item.depth * scale; // Mapping depth to SVG height
          const itemX = item.x * scale;
          const itemY = item.y * scale; // Assuming y represents depth/z position in 2D
          
          // Calculate center for rotation
          const centerX = itemX + itemWidth / 2;
          const centerY = itemY + itemHeight / 2;
          
          return (
            <React.Fragment key={`furn-${idx}`}>
              <Rect
                x={itemX}
                y={itemY}
                width={itemWidth}
                height={itemHeight}
                fill={item.color || '#94a3b8'}
                stroke="#475569"
                strokeWidth="1"
                rx="4"
                rotation={item.rotation || 0}
                origin={`${centerX}, ${centerY}`}
              />
              <SvgText
                x={centerX}
                y={centerY}
                fill={labelColor(item.color || '#94a3b8')}
                fontSize="10"
                fontWeight="bold"
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {item.name}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    alignSelf: 'center',
    marginVertical: 16,
  },
});
