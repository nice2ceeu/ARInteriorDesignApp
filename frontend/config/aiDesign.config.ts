/**
 * AI Design Configuration
 * Constants and configuration for the AI Design feature
 */

export const BUDGET_OPTIONS = ['low', 'medium', 'high', 'luxury'] as const;

export const OPTIMIZATION_GOALS = ['space', 'comfort', 'aesthetics', 'balanced'] as const;

export const IMAGE_QUALITY_OPTIONS = ['standard', 'hd'] as const;

export const IMAGE_STYLE_OPTIONS = ['photorealistic', 'artistic', 'blueprint'] as const;

export const PHILIPPINE_STORES = ['ikea-ph', 'mandaue-foam', 'our-home', 'all'] as const;

export const SORT_OPTIONS = ['score', 'cost', 'date', 'none'] as const;

// Storage keys
export const STORAGE_KEYS = {
  DESIGN_HISTORY: 'userThemeHistory',
  DESIGN_STATE: 'aiDesignFormState',
  DESIGN_CACHE: 'aiDesignCache',
  DESIGN_COMMENTS: 'aiDesignComments',
  DESIGN_FAVORITES: 'aiDesignFavorites',
  USAGE_STATS: 'aiDesignUsageStats',
  TUTORIAL_SEEN: 'aiDesignTutorialSeen',
} as const;

// Limits and constraints
export const LIMITS = {
  MAX_HISTORY_SIZE: 20,
  MAX_RETRIES: 3,
  MAX_IMAGES_IN_MEMORY: 10,
  DESIGNS_PER_PAGE: 5,
  MAX_DESIGNS_HISTORY: 50,
  CACHE_EXPIRY_HOURS: 24,
  
  // Room dimension limits (in meters)
  MIN_ROOM_DIMENSION: 2,
  MAX_ROOM_WIDTH: 50,
  MAX_ROOM_LENGTH: 50,
  MAX_ROOM_HEIGHT: 10,
  MIN_ROOM_HEIGHT: 2,
  
  // Default room dimensions
  DEFAULT_ROOM_WIDTH: 5.0,
  DEFAULT_ROOM_LENGTH: 6.0,
  DEFAULT_ROOM_HEIGHT: 2.7,
} as const;

// Debounce timings (in milliseconds)
export const TIMINGS = {
  STATE_SAVE_DEBOUNCE: 250,
  HISTORY_SAVE_DEBOUNCE: 1000,
  PROMPT_ANALYSIS_DEBOUNCE: 500,
  STATE_PERSISTENCE_RETRY_DELAY: 100,
} as const;

// Tooltips for features
export const TOOLTIPS = {
  optimizationGoal: 'Choose what aspect of the design is most important to you',
  colorHarmony: 'AI-suggested colors based on your style preferences',
  trainingStats: 'Our AI learns from your feedback to improve suggestions',
  imageQuality: 'HD quality provides higher resolution but takes longer to generate',
  imageStyle: 'Photorealistic looks like a real photo, Artistic has creative flair, Blueprint shows technical layout',
  comparisonMode: 'Select up to 3 designs to compare side-by-side',
  filters: 'Search, filter by cost, and sort designs to find exactly what you need',
  shoppingList: 'Get prices from Philippine stores like IKEA, Mandaue Foam, and Our Home',
} as const;

// Furniture color mapping for visualization
export const FURNITURE_COLORS: Record<string, string> = {
  seating: '#3498DB',
  table: '#2ECC71',
  storage: '#9B59B6',
  decor: '#F39C12',
  lighting: '#E67E22',
  other: '#95A5A6',
};

