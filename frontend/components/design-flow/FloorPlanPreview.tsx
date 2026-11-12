import React, { useId, useMemo, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { ClipPath, Defs, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { AppText } from '@/components/ui/Text';
import { useTheme } from '@/contexts/ThemeContext';
import { designItemColor } from '@/utils/designItemColors';
import type { DesignLayoutItem, ScannedOpening, ScannedRoom } from '@/types/design-flow';
import { planFootprint, planX } from '@/utils/planView';

interface FloorPlanPreviewProps {
  widthM: number;
  lengthM: number;
  items: DesignLayoutItem[];
  /** What the scan found: your own furniture (drawn grey) and the doors and windows. */
  scannedRoom?: ScannedRoom | null;
  maxHeight?: number;
}

type SymbolKind = 'sofa' | 'bed' | 'chair' | 'table' | 'rug' | 'other';

/** Space around the room for the dimension labels (px). */
const LABEL_PAD = 18;
/** Width used until the container has been measured (px). */
const FALLBACK_WIDTH = 280;
const GRID_STEP_M = 0.5;
/** Furniture already in the room: neutral, so the new pieces stand out. */
const EXISTING_COLOR = '#8C8579';
const WINDOW_COLOR = '#4A9BD9';

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return `rgba(37, 99, 235, ${alpha})`;
  const n = parseInt(raw, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function symbolKind(item: DesignLayoutItem): SymbolKind {
  const text = `${item.role || ''} ${item.category || ''} ${item.displayName || ''}`.toLowerCase();
  if (/\brug\b/.test(text)) return 'rug';
  if (/sofa|couch|sectional|loveseat/.test(text)) return 'sofa';
  if (/\bbed\b/.test(text)) return 'bed';
  if (/chair|stool|seat/.test(text)) return 'chair';
  if (/table|desk/.test(text)) return 'table';
  return 'other';
}

function formatMeters(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)} m`;
}

/** Short label that fits a small footprint: "Bahamas Sofa" → "Bahamas". */
function shortName(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name;
  const first = name.split(/\s+/)[0] || name;
  return first.length <= maxChars ? first : `${first.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * Top-down symbol in local pixels: (0,0)–(w,d), back edge at the top, facing down (+z).
 */
function FurnitureSymbol({ kind, w, d, color, line }: {
  kind: SymbolKind;
  w: number;
  d: number;
  color: string;
  line: number;
}) {
  const fill = hexToRgba(color, 0.28);
  const solid = hexToRgba(color, 0.5);
  const radius = Math.min(w, d) * 0.12;

  if (kind === 'rug') {
    return (
      <Rect x={0} y={0} width={w} height={d} rx={radius} fill={hexToRgba(color, 0.25)}
        stroke={color} strokeWidth={line} strokeDasharray={`${line * 3},${line * 2}`} />
    );
  }

  if (kind === 'sofa') {
    const back = d * 0.24;
    const arm = Math.min(w * 0.12, d * 0.3);
    const seats = w / d > 1.6 ? 3 : 2;
    const seatW = (w - arm * 2) / seats;
    return (
      <G>
        <Rect x={0} y={0} width={w} height={d} rx={radius} fill={fill} stroke={color} strokeWidth={line} />
        <Rect x={0} y={0} width={w} height={back} rx={radius} fill={solid} stroke={color} strokeWidth={line} />
        <Rect x={0} y={0} width={arm} height={d} rx={radius} fill={solid} stroke={color} strokeWidth={line} />
        <Rect x={w - arm} y={0} width={arm} height={d} rx={radius} fill={solid} stroke={color} strokeWidth={line} />
        {Array.from({ length: seats - 1 }, (_, i) => (
          <Line key={i} x1={arm + seatW * (i + 1)} y1={back} x2={arm + seatW * (i + 1)} y2={d}
            stroke={color} strokeWidth={line * 0.8} />
        ))}
      </G>
    );
  }

  if (kind === 'bed') {
    const head = d * 0.07;
    const pillowY = head + d * 0.03;
    const pillowH = d * 0.14;
    const blanketY = pillowY + pillowH + d * 0.06;
    return (
      <G>
        <Rect x={0} y={0} width={w} height={d} rx={radius * 0.5} fill={fill} stroke={color} strokeWidth={line} />
        <Rect x={0} y={0} width={w} height={head} fill={solid} stroke={color} strokeWidth={line} />
        <Rect x={w * 0.07} y={pillowY} width={w * 0.4} height={pillowH} rx={pillowH * 0.3}
          fill="rgba(255,255,255,0.7)" stroke={color} strokeWidth={line * 0.8} />
        <Rect x={w * 0.53} y={pillowY} width={w * 0.4} height={pillowH} rx={pillowH * 0.3}
          fill="rgba(255,255,255,0.7)" stroke={color} strokeWidth={line * 0.8} />
        <Rect x={0} y={blanketY} width={w} height={d - blanketY} fill={solid} stroke={color} strokeWidth={line} />
      </G>
    );
  }

  if (kind === 'chair') {
    return (
      <G>
        <Rect x={w * 0.1} y={d * 0.15} width={w * 0.8} height={d * 0.8} rx={radius} fill={fill}
          stroke={color} strokeWidth={line} />
        <Rect x={w * 0.05} y={0} width={w * 0.9} height={d * 0.2} rx={radius * 0.6} fill={solid}
          stroke={color} strokeWidth={line} />
      </G>
    );
  }

  if (kind === 'table') {
    const inset = Math.min(w, d) * 0.1;
    return (
      <G>
        <Rect x={0} y={0} width={w} height={d} rx={radius * 0.5} fill={fill} stroke={color} strokeWidth={line} />
        <Rect x={inset} y={inset} width={w - inset * 2} height={d - inset * 2} rx={radius * 0.4}
          fill="none" stroke={color} strokeWidth={line * 0.6} />
      </G>
    );
  }

  return <Rect x={0} y={0} width={w} height={d} rx={radius} fill={fill} stroke={color} strokeWidth={line} />;
}

/** A scanned piece in the layout item shape the symbols are drawn from. */
function existingAsItem(piece: ScannedRoom['existingFurniture'][number]): DesignLayoutItem {
  return {
    instanceId: `existing-${piece.id}`,
    furnitureId: piece.id,
    displayName: piece.name.charAt(0).toUpperCase() + piece.name.slice(1),
    category: piece.role,
    role: piece.role,
    width: piece.width,
    height: piece.height,
    depth: piece.length,
    localPosition: piece.position,
    rotationY: piece.position.rotation,
    pricePhp: 0,
  };
}

/**
 * A door or window on the wall, in plan pixels: the wall is cut open where it is, a window
 * gets a line across the gap and a door its leaf and swing into the room.
 */
function OpeningMark({ opening, kind, scale, widthM, roomW, roomH, wall, floor, line }: {
  opening: ScannedOpening;
  kind: 'door' | 'window';
  scale: number;
  widthM: number;
  roomW: number;
  roomH: number;
  wall: number;
  floor: string;
  line: string;
}) {
  const x1 = planX(opening.x1, widthM) * scale;
  const y1 = opening.z1 * scale;
  const x2 = planX(opening.x2, widthM) * scale;
  const y2 = opening.z2 * scale;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 2) return null;

  const cut = <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={floor} strokeWidth={wall + 1} />;
  if (kind === 'window') {
    return (
      <G>
        {cut}
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={WINDOW_COLOR} strokeWidth={Math.max(2, wall * 0.6)} />
      </G>
    );
  }

  // Swing into the room: the normal of the opening that points at the room's middle.
  let nx = -(y2 - y1) / length;
  let ny = (x2 - x1) / length;
  if ((roomW / 2 - x1) * nx + (roomH / 2 - y1) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const leafX = x1 + nx * length;
  const leafY = y1 + ny * length;
  // SVG y points down, so a positive cross product is a clockwise sweep.
  const sweep = (x2 - x1) * (leafY - y1) - (y2 - y1) * (leafX - x1) > 0 ? 1 : 0;
  return (
    <G>
      {cut}
      <Line x1={x1} y1={y1} x2={leafX} y2={leafY} stroke={line} strokeWidth={1.4} />
      <Path d={`M ${x2} ${y2} A ${length} ${length} 0 0 ${sweep} ${leafX} ${leafY}`} fill="none"
        stroke={line} strokeWidth={1} strokeDasharray="3,2" />
    </G>
  );
}

/**
 * Top view of a room layout: floor grid, walls, dimensions and furniture symbols drawn
 * to scale, sized to the available width. With a scanned room, your own furniture is drawn
 * grey and the doors and windows sit on the walls, as the layout was planned around them.
 * Drawn the way round the room really is (see utils/planView), and in the scanned shape.
 */
export function FloorPlanPreview({
  widthM,
  lengthM,
  items,
  scannedRoom,
  maxHeight = 180,
}: FloorPlanPreviewProps) {
  const { colors, isDark } = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);
  // One per plan: a screen can show several.
  const clipId = `room-floor-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const safeW = widthM > 0 ? widthM : 4;
  const safeL = lengthM > 0 ? lengthM : 5;

  const plan = useMemo(() => {
    const availableW = Math.max(120, (containerWidth || FALLBACK_WIDTH) - LABEL_PAD * 2);
    const availableH = Math.max(80, maxHeight - LABEL_PAD * 2);
    const scale = Math.min(availableW / safeW, availableH / safeL);
    const roomW = safeW * scale;
    const roomH = safeL * scale;
    return {
      scale,
      roomW,
      roomH,
      svgW: roomW + LABEL_PAD * 2,
      svgH: roomH + LABEL_PAD * 2,
      wall: Math.max(3, Math.min(8, scale * 0.1)),
    };
  }, [containerWidth, maxHeight, safeL, safeW]);

  const onLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0 && width !== containerWidth) setContainerWidth(width);
  };

  const floor = isDark ? '#2B2823' : '#F4EEE4';
  const grid = isDark ? '#38332C' : '#E6DDCF';
  const wallColor = colors.textPrimary;
  const solidCount = items.filter((item) => symbolKind(item) !== 'rug').length;
  const ordered = [...items].sort((a, b) => Number(symbolKind(b) === 'rug') - Number(symbolKind(a) === 'rug'));
  const existing = useMemo(() => (scannedRoom?.existingFurniture || []).map(existingAsItem), [scannedRoom]);
  const outline = useMemo(() => {
    const points = scannedRoom?.outline;
    if (!points || points.length < 3) return null;
    const fits = points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)
      && p.x >= -0.05 && p.z >= -0.05 && p.x <= safeW + 0.05 && p.z <= safeL + 0.05);
    if (!fits) return null;
    return points.map((p) => `${planX(p.x, safeW) * plan.scale},${p.z * plan.scale}`).join(' ');
  }, [plan.scale, safeL, safeW, scannedRoom]);
  const doors = scannedRoom?.doors || [];
  const windows = scannedRoom?.windows || [];
  const scanParts = [
    existing.length > 0 ? `${existing.length} of your own ${existing.length === 1 ? 'piece' : 'pieces'}` : '',
    doors.length > 0 ? `${doors.length} ${doors.length === 1 ? 'door' : 'doors'}` : '',
    windows.length > 0 ? `${windows.length} ${windows.length === 1 ? 'window' : 'windows'}` : '',
  ].filter(Boolean);

  const gridLines: React.ReactNode[] = [];
  for (let x = GRID_STEP_M; x < safeW - 0.01; x += GRID_STEP_M) {
    gridLines.push(<Line key={`gx${x}`} x1={x * plan.scale} y1={0} x2={x * plan.scale} y2={plan.roomH} stroke={grid} strokeWidth={1} />);
  }
  for (let z = GRID_STEP_M; z < safeL - 0.01; z += GRID_STEP_M) {
    gridLines.push(<Line key={`gz${z}`} x1={0} y1={z * plan.scale} x2={plan.roomW} y2={z * plan.scale} stroke={grid} strokeWidth={1} />);
  }

  return (
    <View style={styles.container} onLayout={onLayout}>
      <Svg
        width={plan.svgW}
        height={plan.svgH}
        accessibilityLabel={`Floor plan ${safeW.toFixed(1)} by ${safeL.toFixed(1)} meters with ${solidCount} pieces`
          + (scanParts.length > 0 ? `, ${scanParts.join(', ')}` : '')}
      >
        <SvgText x={LABEL_PAD + plan.roomW / 2} y={LABEL_PAD - 6} fontSize={10} fill={colors.textMuted}
          textAnchor="middle">
          {formatMeters(safeW)}
        </SvgText>
        <SvgText x={LABEL_PAD + plan.roomW + 6} y={LABEL_PAD + plan.roomH / 2} fontSize={10} fill={colors.textMuted}
          textAnchor="middle" transform={`rotate(90, ${LABEL_PAD + plan.roomW + 6}, ${LABEL_PAD + plan.roomH / 2})`}>
          {formatMeters(safeL)}
        </SvgText>

        {outline ? (
          <Defs>
            <ClipPath id={clipId}>
              <Polygon points={outline} />
            </ClipPath>
          </Defs>
        ) : null}

        <G transform={`translate(${LABEL_PAD}, ${LABEL_PAD})`}>
          {outline ? (
            <G>
              <Polygon points={outline} fill={floor} />
              <G clipPath={`url(#${clipId})`}>{gridLines}</G>
            </G>
          ) : (
            <G>
              <Rect x={0} y={0} width={plan.roomW} height={plan.roomH} fill={floor} />
              {gridLines}
            </G>
          )}

          {existing.map((item) => {
            const w = item.width * plan.scale;
            const d = item.depth * plan.scale;
            const foot = planFootprint(item, safeW);
            const cx = foot.centerX * plan.scale;
            const cz = foot.centerZ * plan.scale;
            return (
              <G key={item.instanceId}
                transform={`translate(${cx}, ${cz}) rotate(${item.rotationY}) translate(${-w / 2}, ${-d / 2})`}>
                <FurnitureSymbol kind={symbolKind(item)} w={w} d={d} color={EXISTING_COLOR} line={1} />
              </G>
            );
          })}

          {ordered.map((item, index) => {
            const kind = symbolKind(item);
            const w = item.width * plan.scale;
            const d = item.depth * plan.scale;
            const foot = planFootprint(item, safeW);
            const cx = foot.centerX * plan.scale;
            const cz = foot.centerZ * plan.scale;
            const color = designItemColor(items.indexOf(item), item.category, item.role);
            // Rotation 0 faces +z (down the plan); with x running right to left, AR's turn is a
            // clockwise SVG turn (utils/planView).
            return (
              <G key={item.instanceId || index}
                transform={`translate(${cx}, ${cz}) rotate(${item.rotationY}) translate(${-w / 2}, ${-d / 2})`}>
                <FurnitureSymbol kind={kind} w={w} d={d} color={color} line={1.2} />
              </G>
            );
          })}

          {[...existing, ...ordered].map((item, index) => {
            if (symbolKind(item) === 'rug') return null;
            const foot = planFootprint(item, safeW);
            const footW = foot.width * plan.scale;
            const footD = foot.depth * plan.scale;
            if (footW < 34 || footD < 16) return null;
            const fontSize = Math.max(7, Math.min(11, Math.min(footW, footD) * 0.2));
            const label = shortName(item.displayName, Math.floor(footW / (fontSize * 0.6)));
            return (
              <SvgText key={`label-${item.instanceId || index}`}
                x={foot.centerX * plan.scale}
                y={foot.centerZ * plan.scale + fontSize * 0.35}
                fontSize={fontSize} fontWeight="600" fill={colors.textPrimary} textAnchor="middle">
                {label}
              </SvgText>
            );
          })}

          {outline ? (
            <Polygon points={outline} fill="none" stroke={wallColor} strokeWidth={plan.wall}
              strokeLinejoin="round" />
          ) : (
            <Rect x={0} y={0} width={plan.roomW} height={plan.roomH} fill="none" stroke={wallColor}
              strokeWidth={plan.wall} />
          )}

          {doors.map((door) => (
            <OpeningMark key={`door-${door.id}`} opening={door} kind="door" scale={plan.scale}
              widthM={safeW} roomW={plan.roomW} roomH={plan.roomH} wall={plan.wall} floor={floor} line={wallColor} />
          ))}
          {windows.map((win) => (
            <OpeningMark key={`window-${win.id}`} opening={win} kind="window" scale={plan.scale}
              widthM={safeW} roomW={plan.roomW} roomH={plan.roomH} wall={plan.wall} floor={floor} line={wallColor} />
          ))}

          {solidCount === 0 ? (
            <SvgText x={plan.roomW / 2} y={plan.roomH / 2 + 4} fontSize={11} fill={colors.textMuted}
              textAnchor="middle">
              No furniture fits this room
            </SvgText>
          ) : null}
        </G>
      </Svg>
      {scanParts.length > 0 ? (
        <View style={styles.legend}>
          {existing.length > 0 ? (
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: hexToRgba(EXISTING_COLOR, 0.35), borderColor: EXISTING_COLOR }]} />
              <AppText variant="caption" color="textMuted">Your furniture</AppText>
            </View>
          ) : null}
          {doors.length > 0 ? (
            <View style={styles.legendItem}>
              <View style={[styles.doorSwatch, { borderColor: wallColor }]} />
              <AppText variant="caption" color="textMuted">Door</AppText>
            </View>
          ) : null}
          {windows.length > 0 ? (
            <View style={styles.legendItem}>
              <View style={[styles.windowSwatch, { backgroundColor: WINDOW_COLOR }]} />
              <AppText variant="caption" color="textMuted">Window</AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 12,
    height: 9,
    borderRadius: 2,
    borderWidth: 1,
  },
  doorSwatch: {
    width: 10,
    height: 10,
    borderTopRightRadius: 10,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderStyle: 'dashed',
  },
  windowSwatch: {
    width: 14,
    height: 3,
    borderRadius: 1,
  },
});
