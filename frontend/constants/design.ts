/**
 * Room types and design styles shared by every screen.
 * Keep in sync with STYLE_PALETTES and the furniture catalog room types in the backend.
 */

import type { RoomType, DesignStyle } from '@/types/project';

export const ROOM_TYPES: readonly RoomType[] = [
  'Living Room',
  'Bedroom',
  'Kitchen',
  'Bathroom',
  'Office',
  'Dining Room',
  'Kids Room',
  'Outdoor',
];

export const ROOM_EMOJIS: Record<RoomType, string> = {
  'Living Room': '🛋️',
  'Bedroom': '🛏️',
  'Kitchen': '🍳',
  'Bathroom': '🚿',
  'Office': '💼',
  'Dining Room': '🍽️',
  'Kids Room': '🧸',
  'Outdoor': '🌳',
};

/** Ionicons names for room cards */
export const ROOM_ICONS: Record<RoomType, string> = {
  'Living Room': 'tv',
  'Bedroom': 'bed',
  'Kitchen': 'cafe',
  'Bathroom': 'water',
  'Office': 'briefcase',
  'Dining Room': 'restaurant',
  'Kids Room': 'happy',
  'Outdoor': 'leaf',
};

export const DESIGN_STYLES: readonly DesignStyle[] = [
  'Modern',
  'Contemporary',
  'Minimalist',
  'Scandinavian',
  'Industrial',
  'Bohemian',
  'Traditional',
  'Rustic',
  'Mid-Century',
  'Eclectic',
];

export const STYLE_EMOJIS: Record<DesignStyle, string> = {
  'Modern': '🏢',
  'Contemporary': '🏙️',
  'Minimalist': '⬜',
  'Scandinavian': '🌲',
  'Industrial': '⚙️',
  'Bohemian': '🌺',
  'Traditional': '🏛️',
  'Rustic': '🪵',
  'Mid-Century': '🕰️',
  'Eclectic': '🎨',
};

/** Ionicons names for style cards */
export const STYLE_ICONS: Record<DesignStyle, string> = {
  'Modern': 'cube-outline',
  'Contemporary': 'layers-outline',
  'Minimalist': 'apps-outline',
  'Scandinavian': 'snow-outline',
  'Industrial': 'construct-outline',
  'Bohemian': 'flower-outline',
  'Traditional': 'business-outline',
  'Rustic': 'leaf-outline',
  'Mid-Century': 'time-outline',
  'Eclectic': 'color-palette-outline',
};

export const isRoomType = (value: unknown): value is RoomType =>
  typeof value === 'string' && (ROOM_TYPES as readonly string[]).includes(value);

export const isDesignStyle = (value: unknown): value is DesignStyle =>
  typeof value === 'string' && (DESIGN_STYLES as readonly string[]).includes(value);
