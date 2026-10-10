// Theme Recommendation Module Types

export type { RoomType, DesignStyle } from './project';
import type { RoomType, DesignStyle } from './project';

export type DesignMood = 
  | 'Cozy'
  | 'Minimalist'
  | 'Vibrant'
  | 'Calm'
  | 'Luxurious'
  | 'Rustic'
  | 'Playful'
  | 'Professional';


export type MaterialType = 
  | 'wood'
  | 'metal'
  | 'glass'
  | 'fabric'
  | 'leather'
  | 'stone'
  | 'concrete'
  | 'ceramic'
  | 'plastic'
  | 'wicker';

export type LightingType = 
  | 'soft warm'
  | 'bright white'
  | 'natural daylight'
  | 'ambient warm'
  | 'task focused'
  | 'dramatic accent'
  | 'soft cool'
  | 'mixed lighting';

// User Input & Preferences
export interface UserThemePreferences {
  roomType: RoomType;
  desiredMood: DesignMood;
  stylePreference: DesignStyle;
  colorPreferences?: string[]; // Hex colors
  avoidColors?: string[];
  existingColors?: string[]; // From room image analysis
  budgetRange?: 'low' | 'medium' | 'high' | 'luxury';
  naturalLight?: 'abundant' | 'moderate' | 'limited';
  roomSize?: 'small' | 'medium' | 'large';
  additionalNotes?: string;
}

// Room Image Analysis (Optional)
export interface RoomImageAnalysis {
  dominantColors: string[];
  textures: string[];
  lightingCondition: 'bright' | 'dim' | 'natural' | 'mixed';
  existingStyle?: string;
  detectedObjects?: string[];
}

// Theme Definition
export interface DesignTheme {
  id: string;
  name: string;
  description: string;
  confidence: number; // 0-1 ML confidence score
  
  // Visual Elements
  colors: {
    primary: string[];
    secondary: string[];
    accent: string[];
    neutral: string[];
  };
  
  colorPalette: string[]; // All colors combined for easy display
  
  materials: MaterialType[];
  textures: string[];
  lighting: LightingType;
  
  // Furniture & Decor
  furnitureStyle: string;
  decorItems: string[];
  patterns: string[];
  
  // Metadata
  suitableFor: {
    roomTypes: RoomType[];
    moods: DesignMood[];
    styles: DesignStyle[];
  };
  
  // Visual Preview
  exampleImage?: string;
  mockupUrl?: string;
  palettePreview?: string;
  
  // ML Scoring
  moodScore: number; // How well it matches mood (0-100)
  styleScore: number; // How well it matches style (0-100)
  roomScore: number; // How well it matches room type (0-100)
  
  // User Feedback
  userRating?: number; // 1-5 stars
  likes?: number;
  dislikes?: number;
  
  // Budget & Pricing
  estimatedCost?: {
    total: number; // Total estimated cost in USD
    breakdown: {
      furniture: number;
      decor: number;
      lighting: number;
      paint: number;
      accessories: number;
    };
    priceRange: 'low' | 'medium' | 'high' | 'luxury';
    currency?: string; // Default: 'USD'
  };
}

// Recommendation Output
export interface ThemeRecommendationOutput {
  roomType: RoomType;
  userPreferences: UserThemePreferences;
  recommendedThemes: DesignTheme[];
  topTheme: DesignTheme;
  alternativeThemes: DesignTheme[];
  
  metadata: {
    totalThemesAnalyzed: number;
    processingTime: number; // milliseconds
    mlModel: string;
    confidenceLevel: 'high' | 'medium' | 'low';
    recommendationDate: number;
    sessionId?: string;
  };
  
  insights: {
    reasonForRecommendation: string;
    keyMatchingFactors: string[];
    styleAlignment: number; // 0-100
    suggestedImprovements?: string[];
  };
}

// User Feedback
export interface ThemeFeedback {
  themeId: string;
  userId?: string;
  action: 'like' | 'dislike' | 'apply' | 'skip';
  rating?: number; // 1-5
  comments?: string;
  timestamp: number;
}

// Theme History & Personalization
export interface UserThemeHistory {
  userId?: string;
  viewedThemes: string[];
  likedThemes: string[];
  dislikedThemes: string[];
  appliedThemes: string[];
  preferredColors: string[];
  preferredMaterials: MaterialType[];
  preferredMoods: DesignMood[];
  lastUpdated: number;
}

// Theme Collections & Mood Boards
export interface ThemeCollection {
  id: string;
  name: string;
  description?: string;
  coverImage?: string;
  themes: DesignTheme[];
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  isPublic?: boolean;
}

export interface MoodBoard {
  id: string;
  name: string;
  description?: string;
  collectionId?: string; // Optional link to a collection
  themes: DesignTheme[];
  images?: string[]; // User-uploaded inspiration images
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

// ML Model Configuration
export interface ThemeMLConfig {
  modelVersion: string;
  algorithm: 'collaborative-filtering' | 'content-based' | 'hybrid' | 'neural-network';
  weights: {
    roomType: number;
    mood: number;
    style: number;
    colors: number;
    materials: number;
  };
  threshold: number; // Minimum confidence to recommend
  maxRecommendations: number;
  enablePersonalization: boolean;
}

// Theme Filter Options
export interface ThemeFilterOptions {
  minConfidence?: number;
  maxResults?: number;
  sortBy?: 'confidence' | 'popularity' | 'recent' | 'rating';
  includeStyles?: DesignStyle[];
  excludeStyles?: DesignStyle[];
  priceRange?: 'low' | 'medium' | 'high' | 'luxury';
}

// Theme Template (Database Schema)
export interface ThemeTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  
  baseColors: string[];
  baseMaterials: MaterialType[];
  baseLighting: LightingType;
  
  roomTypeWeights: Record<RoomType, number>;
  moodWeights: Record<DesignMood, number>;
  styleWeights: Record<DesignStyle, number>;
  
  decorItems: string[];
  patterns: string[];
  
  images: {
    thumbnail?: string;
    preview?: string;
    examples?: string[];
  };
  
  tags: string[];
  popularity: number;
  averageRating: number;
  timesApplied: number;
}

// Recommendation Request
export interface ThemeRecommendationRequest {
  preferences: UserThemePreferences;
  imageAnalysis?: RoomImageAnalysis;
  filterOptions?: ThemeFilterOptions;
  mlConfig?: Partial<ThemeMLConfig>;
  userHistory?: UserThemeHistory;
}

// Structured JSON Export
export interface ThemeExportData {
  selectedTheme: DesignTheme;
  userPreferences: UserThemePreferences;
  applicationDate: number;
  metadata: {
    confidence: number;
    matchScore: number;
    recommendation: string;
  };
}

// Validation Utilities

/**
 * Validates if an object conforms to the DesignTheme interface
 * Use before operations that require valid theme data
 * 
 * @param theme - The object to validate
 * @returns Type predicate indicating if theme is a valid DesignTheme
 * 
 * @example
 * ```typescript
 * if (!validateThemeData(topTheme)) {
 *   console.error('Invalid theme data');
 *   return;
 * }
 * ```
 */
export const validateThemeData = (theme: any): theme is DesignTheme => {
  return (
    typeof theme === 'object' &&
    theme !== null &&
    typeof theme.id === 'string' &&
    typeof theme.name === 'string' &&
    typeof theme.description === 'string' &&
    typeof theme.confidence === 'number' &&
    theme.confidence >= 0 &&
    theme.confidence <= 1 &&
    typeof theme.colors === 'object' &&
    theme.colors !== null &&
    Array.isArray(theme.colors.primary) &&
    Array.isArray(theme.colors.secondary) &&
    Array.isArray(theme.colors.accent) &&
    Array.isArray(theme.colors.neutral) &&
    Array.isArray(theme.colorPalette) &&
    Array.isArray(theme.materials) &&
    Array.isArray(theme.textures) &&
    typeof theme.lighting === 'string' &&
    typeof theme.furnitureStyle === 'string' &&
    Array.isArray(theme.decorItems) &&
    Array.isArray(theme.patterns) &&
    typeof theme.suitableFor === 'object' &&
    theme.suitableFor !== null &&
    Array.isArray(theme.suitableFor.roomTypes) &&
    Array.isArray(theme.suitableFor.moods) &&
    Array.isArray(theme.suitableFor.styles) &&
    typeof theme.moodScore === 'number' &&
    theme.moodScore >= 0 &&
    theme.moodScore <= 100 &&
    typeof theme.styleScore === 'number' &&
    theme.styleScore >= 0 &&
    theme.styleScore <= 100 &&
    typeof theme.roomScore === 'number' &&
    theme.roomScore >= 0 &&
    theme.roomScore <= 100 &&
    (theme.estimatedCost === undefined ||
      (typeof theme.estimatedCost === 'object' &&
        theme.estimatedCost !== null &&
        typeof theme.estimatedCost.total === 'number' &&
        typeof theme.estimatedCost.breakdown === 'object' &&
        theme.estimatedCost.breakdown !== null &&
        typeof theme.estimatedCost.priceRange === 'string'))
  );
};
