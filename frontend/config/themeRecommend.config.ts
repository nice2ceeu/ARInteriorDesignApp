/**
 * Theme Recommend Configuration
 * Constants and configuration for theme recommendations
 */

import type {
  RoomType,
  DesignMood,
  DesignStyle,
} from '@/types/theme-recommendation';

// ============================================================================
// ROOM, MOOD, STYLE OPTIONS
// ============================================================================

export { ROOM_TYPES, ROOM_EMOJIS } from '@/constants/design';

export const DESIGN_MOODS: readonly DesignMood[] = [
  'Cozy',
  'Minimalist',
  'Vibrant',
  'Calm',
  'Luxurious',
  'Rustic',
  'Playful',
  'Professional',
] as const;

export const MOOD_EMOJIS: Record<DesignMood, string> = {
  'Cozy': '🔥',
  'Minimalist': '⬜',
  'Vibrant': '🌈',
  'Calm': '🌙',
  'Luxurious': '💎',
  'Rustic': '🌲',
  'Playful': '🎉',
  'Professional': '💼',
} as const;

export { DESIGN_STYLES, STYLE_EMOJIS } from '@/constants/design';

// ============================================================================
// BUDGET OPTIONS
// ============================================================================

export type BudgetValue = 'low' | 'medium' | 'high' | 'luxury';

export interface BudgetOption {
  value: BudgetValue;
  label: string;
  emoji: string;
  range: string;
  description: string;
}

export const BUDGET_OPTIONS: readonly BudgetOption[] = [
  { value: 'low', label: 'Budget-Friendly', emoji: '💰', range: '$500 - $2,000', description: 'Affordable options with smart choices' },
  { value: 'medium', label: 'Moderate', emoji: '💵', range: '$2,000 - $5,000', description: 'Balanced quality and value' },
  { value: 'high', label: 'Premium', emoji: '💎', range: '$5,000 - $15,000', description: 'High-quality materials and design' },
  { value: 'luxury', label: 'Luxury', emoji: '👑', range: '$15,000+', description: 'Premium designer pieces' },
] as const;

// ============================================================================
// APP CONFIGURATION
// ============================================================================

export const CONFIG = {
  HISTORY_KEY: 'userThemeHistory',
  MAX_HISTORY_ITEMS: 5,
  SUGGESTED_STYLES_COUNT: 5,
  MAX_COLOR_SWATCHES: 5,
  MAX_DECOR_ITEMS_DISPLAY: 3,
  DEBOUNCE_DELAY: 300,
  ANIMATION_DURATION: 200,
  RECOMMENDATION_TIMEOUT: 30000,
  IMAGE_ANALYSIS_TIMEOUT: 15000,
} as const;

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
  HISTORY: 'userThemeHistory',
  SELECTIONS: 'themeRecommend_selections',
  CACHE: 'themeRecommend_cache',
  LIKED_THEMES: 'themeRecommend_liked',
  COLLECTIONS: 'themeRecommend_collections',
  PREFERENCES: 'themeRecommend_preferences',
} as const;

// ============================================================================
// STEP TYPES
// ============================================================================

export type StepType = 'welcome' | 'room' | 'mood' | 'style' | 'budget' | 'results';

// ============================================================================
// FlatList PERFORMANCE
// ============================================================================

export const ALTERNATIVE_THEME_ITEM_HEIGHT = 150;

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
  INCOMPLETE_SELECTION: 'Please choose both a room and mood before selecting a style.',
  GENERATION_FAILED: 'Failed to generate recommendations. Please try again.',
  EXPORT_FAILED: 'Could not export themes.',
  NO_DOCUMENT_DIR: 'No document directory available on this device.',
  FEEDBACK_ERROR: 'Unable to record your feedback right now.',
  LIKE_ERROR: 'Unable to record your like right now.',
  NETWORK_ERROR: 'Network error. Please check your internet connection and try again.',
  TIMEOUT_ERROR: 'Request timed out. Please check your connection and try again.',
  IMAGE_PICKER_ERROR: 'Failed to pick image. Please try again.',
  IMAGE_ANALYSIS_ERROR: 'Failed to analyze image. Please try again.',
  IMAGE_URI_ERROR: 'Failed to get image URI. Please try again.',
  IMAGE_ANALYSIS_TIMEOUT: 'Image analysis timed out. Please try again with a smaller image or check your connection.',
  IMAGE_INVALID_FORMAT: 'Invalid image format. Please select a valid image file.',
  SHARE_ERROR: 'Could not share. Please try again.',
  EXPORT_COLOR_PALETTE_ERROR: 'Could not export color palette.',
  SAVE_ERROR: 'Failed to save. Please try again.',
  LOAD_ERROR: 'Failed to load data. Please try again.',
  INVALID_THEME_DATA: 'Invalid theme data. Please try again.',
  INVALID_COLLECTION_NAME: 'Please enter a collection name.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
} as const;

// ============================================================================
// COST CALCULATION
// ============================================================================

export const BUDGET_MULTIPLIERS: Record<BudgetValue, number> = {
  low: 1,
  medium: 2.5,
  high: 5,
  luxury: 10,
};

export const ROOM_BASE_COSTS: Record<RoomType, { furniture: number; decor: number; lighting: number; paint: number; accessories: number }> = {
  'Living Room': { furniture: 800, decor: 200, lighting: 150, paint: 100, accessories: 150 },
  'Bedroom': { furniture: 600, decor: 150, lighting: 100, paint: 80, accessories: 100 },
  'Kitchen': { furniture: 1000, decor: 100, lighting: 200, paint: 120, accessories: 80 },
  'Bathroom': { furniture: 400, decor: 100, lighting: 150, paint: 60, accessories: 90 },
  'Office': { furniture: 500, decor: 120, lighting: 100, paint: 70, accessories: 110 },
  'Dining Room': { furniture: 700, decor: 180, lighting: 120, paint: 90, accessories: 130 },
  'Kids Room': { furniture: 450, decor: 200, lighting: 80, paint: 80, accessories: 190 },
  'Outdoor': { furniture: 600, decor: 150, lighting: 200, paint: 100, accessories: 150 },
};

// ============================================================================
// COLOR NAME MAPPING
// ============================================================================

export const COLOR_NAMES: Record<string, string> = {
  '#FF0000': 'Red',
  '#00FF00': 'Green',
  '#0000FF': 'Blue',
  '#FFFF00': 'Yellow',
  '#FF00FF': 'Magenta',
  '#00FFFF': 'Cyan',
  '#FFFFFF': 'White',
  '#000000': 'Black',
  '#808080': 'Gray',
  '#FFA500': 'Orange',
  '#800080': 'Purple',
  '#A52A2A': 'Brown',
  '#FFC0CB': 'Pink',
  '#FFD700': 'Gold',
  '#C0C0C0': 'Silver',
};

