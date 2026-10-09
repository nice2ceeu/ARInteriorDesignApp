// User Input & Preferences
export interface DesignPreferences {
  layoutType: 'room' | 'workspace' | 'interface' | 'outdoor';
  roomType: string; // Living Room, Bedroom, etc.
  designStyle: string; // Modern, Minimalist, etc.
  dimensions: {
    width: number;  // in meters
    length: number; // in meters
    height: number; // in meters
  };
  aestheticPreferences: {
    colorScheme?: string[];
    lighting?: 'bright' | 'dim' | 'natural' | 'mixed';
    materialPreferences?: string[]; // wood, metal, fabric, etc.
    budget?: 'low' | 'medium' | 'high' | 'luxury';
  };
  functionalRequirements: string[]; // 'home office', 'entertainment', 'relaxation'
  userPrompt?: string;
  requiredFurniture?: string[];
  budgetPHP?: number;
}

// Constraint Parameters
export interface DesignConstraints {
  minimumWalkwayDistance: number; // in meters
  doorClearance: number;
  windowZones: Array<{
    position: { x: number; y: number; z: number };
    width: number;
    height: number;
  }>;
  lightingZones: Array<{
    type: 'natural' | 'ambient' | 'task';
    position: { x: number; y: number };
    radius: number;
  }>;
  objectProximityLimits: {
    minDistanceBetweenFurniture: number;
    minDistanceFromWalls: number;
    minDistanceFromDoors: number;
  };
  fixedObstacles: Array<{
    id: string;
    type: string;
    position: { x: number; y: number; z: number };
    dimensions: { width: number; length: number; height: number };
    isMovable: boolean;
  }>;
  ergonomics: {
    seatHeightRange: [number, number];
    tableHeightRange: [number, number];
    reachDistance: number;
  };
  accessibility: {
    wheelchairAccessible: boolean;
    clearanceWidth: number;
  };
}

// Furniture/Equipment Types
export interface FurnitureItem {
  id: string;
  type: string;
  category: 'seating' | 'table' | 'storage' | 'decor' | 'lighting' | 'other';
  name: string;
  dimensions: {
    width: number;
    length: number;
    height: number;
  };
  position: {
    x: number;
    y: number;
    z: number;
    rotation: number; // in degrees
  };
  properties: {
    color?: string;
    material?: string;
    style?: string;
    price?: number;
  };
  estimatedPrice?: {
    low: number;
    high: number;
  };
  zIndex: number; // for layering
  modelUrl?: string;
  priceSource?: string;
}

// Generated Layout
export interface GeneratedLayout {
  id: string;
  version: number;
  furniture: FurnitureItem[];
  metadata: {
    generatedAt: number;
    algorithm: 'genetic' | 'reinforcement' | 'rule-based' | 'hybrid';
    iterationsCount: number;
  };
}

// Performance Scores
export interface LayoutPerformanceScore {
  spaceEfficiency: number;      // 0-100
  comfort: number;               // 0-100
  symmetry: number;              // 0-100
  accessibility: number;         // 0-100
  aesthetics: number;            // 0-100
  functionalFlow: number;        // 0-100
  lighting: number;              // 0-100
  ergonomics: number;            // 0-100
  overall: number;               // 0-100 (weighted average)
}

// Optimized Design Proposal
export interface DesignProposal {
  id: string;
  roomType: string;
  title: string;
  description: string;
  layout: GeneratedLayout;
  performanceScore: LayoutPerformanceScore;
  visualization: {
    thumbnail2D?: string; // base64 or URL
    thumbnail3D?: string;
    renderData?: any;
  };
  colorPalette: string[];
  recommendedFurniture: FurnitureItem[];
  estimatedCost: {
    low: number;
    mid: number;
    high: number;
  };
  pros: string[];
  cons: string[];
  rank: number; // 1 = best
  currency?: 'PHP';
}

// Simulation Options
export interface SimulationOptions {
  generateMultipleVariations: boolean;
  numberOfVariations: number;
  enableInteractivePreview: boolean;
  enable3DRendering: boolean;
  optimizationGoal: 'space' | 'comfort' | 'aesthetics' | 'balanced';
  constraintWeights: {
    ergonomics: number;
    accessibility: number;
    symmetry: number;
    spaceEfficiency: number;
  };
}

// Output Format
export interface GenerativeDesignOutput {
  proposals: DesignProposal[];
  bestFitRecommendation: DesignProposal;
  alternativeOptions: DesignProposal[];
  metadata: {
    totalProposalsGenerated: number;
    processingTime: number; // milliseconds
    algorithm: string;
    confidenceScore: number | null; // null until model confidence is evaluated
    rankingSource?: 'geometric' | 'xgboost';
    modelVersion?: string | null;
    currency?: string;
    warnings?: string[];
  };
  exportData: {
    json: string;
    cad?: string; // CAD-compatible format
    structuredData: any;
  };
}

// Optimization Parameters
export interface OptimizationConfig {
  algorithm: 'genetic' | 'reinforcement' | 'evolutionary' | 'hybrid';
  maxIterations: number;
  convergenceThreshold: number;
  mutationRate: number;
  crossoverRate: number;
  populationSize: number;
  eliteCount: number;
}

// Spatial Reasoning Data
export interface SpatialReasoningData {
  walkways: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number;
    isClear: boolean;
  }>;
  zones: Array<{
    id: string;
    type: 'conversation' | 'work' | 'rest' | 'circulation';
    bounds: { x: number; y: number; width: number; height: number };
    furniture: string[]; // IDs of furniture in this zone
  }>;
  heatmap: number[][]; // occupancy/usage heatmap
  sightlines: Array<{
    from: { x: number; y: number };
    to: { x: number; y: number };
    isBlocked: boolean;
  }>;
}

// Rule-Based Constraints
export interface DesignRule {
  id: string;
  name: string;
  type: 'hard' | 'soft'; // hard = must follow, soft = preference
  description: string;
  validator: (layout: GeneratedLayout, constraints: DesignConstraints) => {
    isValid: boolean;
    score: number;
    violations?: string[];
  };
  weight: number; // importance (0-1)
}

// Generative Engine State
export interface GenerativeEngineState {
  isGenerating: boolean;
  currentIteration: number;
  bestScore: number;
  currentPopulation: GeneratedLayout[];
  convergenceHistory: number[];
}
