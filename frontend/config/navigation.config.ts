/**
 * Navigation Configuration
 * Centralized screen definitions and navigation options
 */

// Using generic object type for Expo Router screen options
// Expo Router uses its own navigation types internally

// Screen names type for better type safety
export type ScreenName = 
  | 'index'
  | 'splash'
  | 'onboarding'
  | 'login'
  | 'signup'
  | '(tabs)'
  | 'ai-design'
  | 'theme-recommend'
  | 'spatial-mapping'
  | 'live-scan'
  | 'ar-view'
  | 'layout-3d'
  | 'create-project';

// Screen configuration type
export interface ScreenConfig {
  name: ScreenName;
  options: {
    animation?: 'fade' | 'slide_from_right' | 'slide_from_bottom' | 'slide_from_left' | 'none';
    gestureEnabled?: boolean;
    presentation?: 'modal' | 'card' | 'transparentModal';
    orientation?: 'portrait' | 'landscape' | 'all';
    headerShown?: boolean;
    [key: string]: any;
  };
}

// Animation presets for reusability
export const ANIMATION_PRESETS = {
  fade: {
    animation: 'fade' as const,
    gestureEnabled: false,
  },
  slideRight: {
    animation: 'slide_from_right' as const,
  },
  modal: {
    animation: 'slide_from_bottom' as const,
    presentation: 'modal' as const,
  },
  card: {
    animation: 'slide_from_right' as const,
    presentation: 'card' as const,
  },
};

// Screen configurations organized by category
export const NAVIGATION_SCREENS: Record<string, ScreenConfig[]> = {
  // Entry and Splash Screens
  entry: [
    {
      name: 'index',
      options: {
        ...ANIMATION_PRESETS.fade,
      },
    },
    {
      name: 'splash',
      options: {
        ...ANIMATION_PRESETS.fade,
      },
    },
  ],

  // Onboarding Flow
  onboarding: [
    {
      name: 'onboarding',
      options: {
        gestureEnabled: false,
      },
    },
  ],

  // Authentication Flow
  auth: [
    {
      name: 'login',
      options: {
        ...ANIMATION_PRESETS.modal,
      },
    },
    {
      name: 'signup',
      options: {
        ...ANIMATION_PRESETS.modal,
      },
    },
  ],

  // Main App (Tab Navigation)
  main: [
    {
      name: '(tabs)',
      options: {
        gestureEnabled: false,
      },
    },
  ],

  // AI & Design Features
  aiDesign: [
    {
      name: 'ai-design',
      options: {
        ...ANIMATION_PRESETS.slideRight,
      },
    },
    {
      name: 'theme-recommend',
      options: {
        ...ANIMATION_PRESETS.slideRight,
      },
    },
  ],

  // AR & Spatial Features
  arSpatial: [
    {
      name: 'spatial-mapping',
      options: {
        ...ANIMATION_PRESETS.slideRight,
      },
    },
    {
      name: 'live-scan',
      options: {
        ...ANIMATION_PRESETS.slideRight,
      },
    },
    {
      name: 'ar-view',
      options: {
        ...ANIMATION_PRESETS.slideRight,
        orientation: 'portrait',
      },
    },
    {
      name: 'layout-3d',
      options: {
        ...ANIMATION_PRESETS.slideRight,
      },
    },
  ],

  // Utility Screens
  utility: [
    {
      name: 'create-project',
      options: {
        ...ANIMATION_PRESETS.card,
      },
    },
  ],
};

// Flatten all screens into a single array for easy iteration
export const ALL_SCREENS: ScreenConfig[] = Object.values(NAVIGATION_SCREENS).flat();

