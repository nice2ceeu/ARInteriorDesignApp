/**
 * Theme Recommendation Controller
 * ML-powered theme recommendations with personalization
 * 
 * IMPROVEMENTS:
 * - Added caching layer for better performance
 * - Enhanced ML scoring algorithm
 * - Better error handling and validation
 * - Expanded theme database
 * - Request deduplication
 * - Improved personalization
 */

import { randomUUID as uuidv4 } from 'node:crypto';

// ============================================================================
// ML CONFIGURATION
// ============================================================================

const mlConfig = {
  modelVersion: '2.0.0',
  algorithm: 'hybrid-enhanced',
  weights: {
    roomType: 0.28,
    mood: 0.32,
    style: 0.25,
    colors: 0.08,
    materials: 0.07,
  },
  threshold: 0.58, // Lowered slightly to allow more diversity
  maxRecommendations: 5,
  enablePersonalization: true,
  cacheTTL: 3600000, // 1 hour cache TTL
};

// ============================================================================
// CACHE LAYER
// ============================================================================

const recommendationCache = new Map();
const CACHE_MAX_SIZE = 1000; // Maximum cache entries

function getCacheKey(preferences) {
  return `${preferences.roomType}-${preferences.desiredMood}-${preferences.stylePreference}-${preferences.budgetRange || 'none'}`;
}

function getFromCache(key) {
  const cached = recommendationCache.get(key);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > mlConfig.cacheTTL) {
    recommendationCache.delete(key);
    return null;
  }
  
  return cached.data;
}

function setCache(key, data) {
  // Simple LRU: remove oldest entries if cache is full
  if (recommendationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = recommendationCache.keys().next().value;
    recommendationCache.delete(firstKey);
  }
  
  recommendationCache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

// ============================================================================
// REQUEST DEDUPLICATION
// ============================================================================

const pendingRequests = new Map();

function getRequestKey(preferences) {
  return getCacheKey(preferences);
}

// ============================================================================
// THEME DATABASE
// ============================================================================

const themeDatabase = [
  createThemeTemplate(
    'modern-minimalist-white',
    'Modern Minimalist White',
    'Clean lines, white palette, and minimal décor',
    ['#FFFFFF', '#F5F5F5', '#E0E0E0', '#424242', '#101010'],
    ['wood', 'glass', 'metal'],
    'soft cool',
    { 'Living Room': 0.9, 'Bedroom': 0.9, 'Office': 1.0, 'Bathroom': 0.8, 'Kitchen': 0.7, 'Dining Room': 0.8, 'Kids Room': 0.3, 'Outdoor': 0.2 },
    { 'Minimalist': 1.0, 'Calm': 0.9, 'Professional': 0.9, 'Cozy': 0.3, 'Vibrant': 0.2, 'Luxurious': 0.6, 'Rustic': 0.1, 'Playful': 0.2 },
    { 'Modern': 1.0, 'Minimalist': 1.0, 'Contemporary': 0.9, 'Scandinavian': 0.7, 'Industrial': 0.5, 'Bohemian': 0.1, 'Traditional': 0.2, 'Rustic': 0.1, 'Mid-Century': 0.6, 'Eclectic': 0.3 },
    ['Geometric art', 'Single plant', 'Minimal vase'],
    ['Solid', 'None'],
    0.85
  ),
  createThemeTemplate(
    'warm-rustic',
    'Warm Rustic',
    'Natural wood tones, warm colors, cozy atmosphere',
    ['#8B4513', '#D2691E', '#F5DEB3', '#CD853F', '#A0522D'],
    ['wood', 'fabric', 'stone'],
    'soft warm',
    { 'Living Room': 1.0, 'Bedroom': 0.9, 'Office': 0.5, 'Bathroom': 0.4, 'Kitchen': 0.8, 'Dining Room': 0.9, 'Kids Room': 0.6, 'Outdoor': 0.8 },
    { 'Cozy': 1.0, 'Rustic': 1.0, 'Calm': 0.8, 'Minimalist': 0.2, 'Vibrant': 0.4, 'Luxurious': 0.5, 'Professional': 0.3, 'Playful': 0.6 },
    { 'Rustic': 1.0, 'Traditional': 0.8, 'Bohemian': 0.7, 'Mid-Century': 0.5, 'Modern': 0.3, 'Minimalist': 0.2, 'Contemporary': 0.4, 'Scandinavian': 0.6, 'Industrial': 0.4, 'Eclectic': 0.7 },
    ['Woven baskets', 'Wooden bowls', 'Candles', 'Throw blankets'],
    ['Wood grain', 'Natural textures'],
    0.82
  ),
  createThemeTemplate(
    'vibrant-modern',
    'Vibrant Modern',
    'Bold colors, contemporary design, energetic feel',
    ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#DCEDC8'],
    ['metal', 'glass', 'plastic'],
    'bright white',
    { 'Living Room': 0.8, 'Bedroom': 0.5, 'Office': 0.7, 'Bathroom': 0.6, 'Kitchen': 0.8, 'Dining Room': 0.9, 'Kids Room': 1.0, 'Outdoor': 0.7 },
    { 'Vibrant': 1.0, 'Playful': 0.9, 'Professional': 0.5, 'Cozy': 0.4, 'Minimalist': 0.4, 'Calm': 0.2, 'Luxurious': 0.6, 'Rustic': 0.2 },
    { 'Modern': 0.9, 'Contemporary': 1.0, 'Eclectic': 0.8, 'Mid-Century': 0.6, 'Industrial': 0.5, 'Minimalist': 0.3, 'Scandinavian': 0.4, 'Bohemian': 0.6, 'Traditional': 0.2, 'Rustic': 0.1 },
    ['Pop art prints', 'Colorful cushions', 'Statement pieces', 'Bold rugs'],
    ['Geometric', 'Abstract', 'Stripes'],
    0.78
  ),
  createThemeTemplate(
    'scandinavian-light',
    'Scandinavian Light',
    'Light woods, soft neutrals, functional beauty',
    ['#F5F5F5', '#E8E8E8', '#D4C5B9', '#A8956B', '#6B8E91'],
    ['wood', 'fabric', 'ceramic'],
    'natural daylight',
    { 'Living Room': 0.9, 'Bedroom': 1.0, 'Office': 0.8, 'Bathroom': 0.7, 'Kitchen': 0.9, 'Dining Room': 0.9, 'Kids Room': 0.8, 'Outdoor': 0.5 },
    { 'Calm': 1.0, 'Cozy': 0.9, 'Minimalist': 0.8, 'Professional': 0.7, 'Vibrant': 0.3, 'Luxurious': 0.5, 'Rustic': 0.6, 'Playful': 0.5 },
    { 'Scandinavian': 1.0, 'Modern': 0.8, 'Minimalist': 0.8, 'Contemporary': 0.7, 'Mid-Century': 0.7, 'Traditional': 0.4, 'Industrial': 0.3, 'Bohemian': 0.4, 'Rustic': 0.5, 'Eclectic': 0.5 },
    ['Plants', 'Candles', 'Woven textiles', 'Simple ceramics'],
    ['Natural', 'Soft textures'],
    0.88
  ),
  createThemeTemplate(
    'industrial-loft',
    'Industrial Loft',
    'Exposed materials, raw finishes, urban aesthetic',
    ['#3C3C3C', '#7F7F7F', '#B87333', '#2F4F4F', '#DAA520'],
    ['metal', 'concrete', 'wood'],
    'dramatic accent',
    { 'Living Room': 0.8, 'Bedroom': 0.6, 'Office': 1.0, 'Bathroom': 0.5, 'Kitchen': 0.8, 'Dining Room': 0.7, 'Kids Room': 0.2, 'Outdoor': 0.6 },
    { 'Professional': 0.9, 'Minimalist': 0.7, 'Vibrant': 0.4, 'Cozy': 0.5, 'Calm': 0.6, 'Luxurious': 0.6, 'Rustic': 0.7, 'Playful': 0.3 },
    { 'Industrial': 1.0, 'Modern': 0.8, 'Contemporary': 0.7, 'Minimalist': 0.6, 'Eclectic': 0.6, 'Mid-Century': 0.5, 'Scandinavian': 0.3, 'Bohemian': 0.4, 'Traditional': 0.2, 'Rustic': 0.5 },
    ['Exposed bulbs', 'Metal shelving', 'Vintage signs', 'Leather accents'],
    ['Concrete', 'Exposed brick', 'Metal'],
    0.75
  ),
  createThemeTemplate(
    'luxury-elegant',
    'Luxury Elegant',
    'Rich colors, premium materials, sophisticated ambiance',
    ['#2C2C2C', '#D4AF37', '#8B4789', '#2F4F4F', '#E6E6FA'],
    ['leather', 'metal', 'glass', 'wood'],
    'ambient warm',
    { 'Living Room': 0.9, 'Bedroom': 0.9, 'Office': 0.7, 'Bathroom': 0.8, 'Kitchen': 0.6, 'Dining Room': 1.0, 'Kids Room': 0.2, 'Outdoor': 0.4 },
    { 'Luxurious': 1.0, 'Calm': 0.7, 'Professional': 0.8, 'Cozy': 0.6, 'Minimalist': 0.5, 'Vibrant': 0.4, 'Rustic': 0.3, 'Playful': 0.2 },
    { 'Contemporary': 0.8, 'Modern': 0.7, 'Traditional': 0.7, 'Eclectic': 0.6, 'Mid-Century': 0.6, 'Minimalist': 0.4, 'Scandinavian': 0.3, 'Industrial': 0.4, 'Bohemian': 0.5, 'Rustic': 0.3 },
    ['Crystal chandeliers', 'Silk pillows', 'Marble accents', 'Gold-framed art'],
    ['Velvet', 'Silk', 'Marble'],
    0.80
  ),
  createThemeTemplate(
    'bohemian-eclectic',
    'Bohemian Eclectic',
    'Mix of patterns, vibrant colors, global influences',
    ['#E8DED2', '#C9A86A', '#8B7355', '#D4AF37', '#9B59B6'],
    ['fabric', 'wicker', 'wood'],
    'soft warm',
    { 'Living Room': 0.9, 'Bedroom': 0.9, 'Office': 0.4, 'Bathroom': 0.3, 'Kitchen': 0.5, 'Dining Room': 0.7, 'Kids Room': 0.7, 'Outdoor': 0.8 },
    { 'Playful': 0.9, 'Cozy': 0.8, 'Vibrant': 0.8, 'Rustic': 0.7, 'Calm': 0.5, 'Minimalist': 0.2, 'Professional': 0.3, 'Luxurious': 0.5 },
    { 'Bohemian': 1.0, 'Eclectic': 0.9, 'Traditional': 0.5, 'Rustic': 0.6, 'Mid-Century': 0.5, 'Modern': 0.3, 'Contemporary': 0.4, 'Scandinavian': 0.4, 'Industrial': 0.2, 'Minimalist': 0.2 },
    ['Macramé wall hangings', 'Layered textiles', 'Plants', 'Ethnic patterns'],
    ['Paisley', 'Ikat', 'Tribal', 'Floral'],
    0.76
  ),
  createThemeTemplate(
    'coastal-calm',
    'Coastal Calm',
    'Ocean-inspired colors, breezy feel, relaxed atmosphere',
    ['#F0F8FF', '#87CEEB', '#B0E0E6', '#F5DEB3', '#FFFFFF'],
    ['wood', 'fabric', 'wicker'],
    'natural daylight',
    { 'Living Room': 0.8, 'Bedroom': 1.0, 'Office': 0.5, 'Bathroom': 0.9, 'Kitchen': 0.6, 'Dining Room': 0.7, 'Kids Room': 0.7, 'Outdoor': 0.9 },
    { 'Calm': 1.0, 'Cozy': 0.8, 'Minimalist': 0.6, 'Playful': 0.6, 'Vibrant': 0.4, 'Professional': 0.4, 'Luxurious': 0.5, 'Rustic': 0.6 },
    { 'Contemporary': 0.7, 'Scandinavian': 0.7, 'Traditional': 0.6, 'Bohemian': 0.6, 'Eclectic': 0.6, 'Modern': 0.5, 'Minimalist': 0.5, 'Rustic': 0.6, 'Mid-Century': 0.4, 'Industrial': 0.2 },
    ['Driftwood decor', 'Nautical accents', 'Sea glass', 'Rope details'],
    ['Stripes', 'Natural', 'Weathered'],
    0.79
  ),
  createThemeTemplate(
    'mid-century-modern',
    'Mid-Century Modern',
    'Clean lines, organic curves, retro sophistication',
    ['#2C3E50', '#E74C3C', '#F39C12', '#27AE60', '#3498DB'],
    ['wood', 'metal', 'leather'],
    'natural daylight',
    { 'Living Room': 0.9, 'Bedroom': 0.8, 'Office': 0.7, 'Bathroom': 0.5, 'Kitchen': 0.7, 'Dining Room': 0.9, 'Kids Room': 0.4, 'Outdoor': 0.6 },
    { 'Professional': 0.8, 'Calm': 0.7, 'Minimalist': 0.7, 'Vibrant': 0.6, 'Cozy': 0.6, 'Luxurious': 0.6, 'Rustic': 0.3, 'Playful': 0.5 },
    { 'Mid-Century': 1.0, 'Modern': 0.8, 'Contemporary': 0.7, 'Minimalist': 0.6, 'Industrial': 0.5, 'Eclectic': 0.6, 'Scandinavian': 0.5, 'Traditional': 0.4, 'Bohemian': 0.3, 'Rustic': 0.2 },
    ['Geometric lamps', 'Tapered legs', 'Bold patterns', 'Teak furniture'],
    ['Geometric', 'Atomic', 'Abstract'],
    0.81
  ),
  createThemeTemplate(
    'japanese-minimalist',
    'Japanese Minimalist',
    'Zen philosophy, natural materials, peaceful simplicity',
    ['#FFFFFF', '#F5F5F5', '#E8E8E8', '#8B7355', '#4A4A4A'],
    ['wood', 'bamboo', 'fabric', 'stone'],
    'soft natural',
    { 'Living Room': 0.9, 'Bedroom': 1.0, 'Office': 0.8, 'Bathroom': 0.9, 'Kitchen': 0.8, 'Dining Room': 0.9, 'Kids Room': 0.5, 'Outdoor': 0.7 },
    { 'Calm': 1.0, 'Minimalist': 1.0, 'Cozy': 0.7, 'Professional': 0.7, 'Vibrant': 0.2, 'Luxurious': 0.5, 'Rustic': 0.6, 'Playful': 0.3 },
    { 'Minimalist': 1.0, 'Modern': 0.8, 'Contemporary': 0.7, 'Scandinavian': 0.7, 'Traditional': 0.5, 'Mid-Century': 0.4, 'Industrial': 0.3, 'Bohemian': 0.2, 'Rustic': 0.4, 'Eclectic': 0.3 },
    ['Bonsai trees', 'Shoji screens', 'Tatami mats', 'Ikebana arrangements'],
    ['None', 'Subtle textures', 'Natural grain'],
    0.86
  ),
  createThemeTemplate(
    'tropical-paradise',
    'Tropical Paradise',
    'Vibrant greens, exotic patterns, vacation vibes',
    ['#228B22', '#FFD700', '#FF6347', '#20B2AA', '#FFE4B5'],
    ['bamboo', 'wicker', 'fabric', 'wood'],
    'bright natural',
    { 'Living Room': 0.8, 'Bedroom': 0.7, 'Office': 0.4, 'Bathroom': 0.6, 'Kitchen': 0.7, 'Dining Room': 0.8, 'Kids Room': 0.9, 'Outdoor': 1.0 },
    { 'Vibrant': 1.0, 'Playful': 0.9, 'Cozy': 0.7, 'Calm': 0.6, 'Minimalist': 0.3, 'Professional': 0.2, 'Luxurious': 0.5, 'Rustic': 0.6 },
    { 'Eclectic': 0.8, 'Bohemian': 0.8, 'Contemporary': 0.6, 'Modern': 0.5, 'Traditional': 0.5, 'Rustic': 0.6, 'Mid-Century': 0.3, 'Scandinavian': 0.3, 'Industrial': 0.2, 'Minimalist': 0.2 },
    ['Palm leaves', 'Tropical prints', 'Rattan furniture', 'Colorful cushions'],
    ['Tropical', 'Floral', 'Ikat', 'Tribal'],
    0.74
  ),
  createThemeTemplate(
    'neoclassical-elegance',
    'Neoclassical Elegance',
    'Timeless grandeur, classical elements, refined luxury',
    ['#F5F5DC', '#D3D3D3', '#8B7355', '#2C2C2C', '#DAA520'],
    ['marble', 'wood', 'fabric', 'metal'],
    'ambient warm',
    { 'Living Room': 1.0, 'Bedroom': 0.9, 'Office': 0.8, 'Bathroom': 0.8, 'Kitchen': 0.6, 'Dining Room': 1.0, 'Kids Room': 0.2, 'Outdoor': 0.3 },
    { 'Luxurious': 1.0, 'Professional': 0.8, 'Calm': 0.7, 'Cozy': 0.6, 'Minimalist': 0.4, 'Vibrant': 0.3, 'Rustic': 0.3, 'Playful': 0.2 },
    { 'Traditional': 0.9, 'Contemporary': 0.7, 'Eclectic': 0.6, 'Modern': 0.5, 'Minimalist': 0.3, 'Scandinavian': 0.3, 'Mid-Century': 0.4, 'Industrial': 0.3, 'Bohemian': 0.4, 'Rustic': 0.3 },
    ['Classical columns', 'Gilt mirrors', 'Chandeliers', 'Antique furniture'],
    ['Damasks', 'Toile', 'Classical motifs'],
    0.77
  ),
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createThemeTemplate(id, name, description, colors, materials, lighting, roomWeights, moodWeights, styleWeights, decorItems, patterns, popularity) {
  return {
    id,
    name,
    description,
    category: 'design',
    baseColors: colors,
    baseMaterials: materials,
    baseLighting: lighting,
    roomTypeWeights: roomWeights,
    moodWeights: moodWeights,
    styleWeights: styleWeights,
    decorItems,
    patterns,
    images: {},
    tags: [name.toLowerCase().replace(/\s+/g, '-')],
    popularity,
    averageRating: 4 + Math.random(),
    timesApplied: Math.floor(popularity * 500),
  };
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function areColorsSimilar(color1, color2) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return false;

  const distance = Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
  return distance < 100;
}

function calculateColorCompatibility(themeColors, userColors) {
  if (!userColors || userColors.length === 0) return 75;

  let matches = 0;
  for (const userColor of userColors) {
    for (const themeColor of themeColors) {
      if (areColorsSimilar(userColor, themeColor)) {
        matches++;
        break;
      }
    }
  }
  return Math.min(100, 50 + (matches / userColors.length) * 50);
}

function calculateMaterialCompatibility(themeMaterials, userTextures) {
  if (!userTextures || userTextures.length === 0) return 75;

  const commonTerms = ['wood', 'metal', 'fabric', 'glass', 'stone'];
  let matches = 0;

  for (const texture of userTextures) {
    const lowerTexture = texture.toLowerCase();
    for (const material of themeMaterials) {
      if (lowerTexture.includes(material) || commonTerms.some(term =>
        lowerTexture.includes(term) && material.includes(term)
      )) {
        matches++;
        break;
      }
    }
  }
  return Math.min(100, 60 + (matches / Math.max(1, userTextures.length)) * 40);
}

// ============================================================================
// ML SCORING ENGINE
// ============================================================================

function scoreTheme(template, preferences, imageAnalysis) {
  const { weights } = mlConfig;

  const roomScore = (template.roomTypeWeights[preferences.roomType] || 0) * 100;
  const moodScore = (template.moodWeights[preferences.desiredMood] || 0) * 100;
  const styleScore = (template.styleWeights[preferences.stylePreference] || 0) * 100;

  let colorScore = 70;
  if (preferences.colorPreferences && preferences.colorPreferences.length > 0) {
    colorScore = calculateColorCompatibility(template.baseColors, preferences.colorPreferences);
  }

  let materialScore = 75;
  if (imageAnalysis?.textures && imageAnalysis.textures.length > 0) {
    materialScore = calculateMaterialCompatibility(template.baseMaterials, imageAnalysis.textures);
  }

  const confidence = (
    (roomScore * weights.roomType) +
    (moodScore * weights.mood) +
    (styleScore * weights.style) +
    (colorScore * weights.colors) +
    (materialScore * weights.materials)
  ) / 100;

  const colorPalette = [
    ...template.baseColors.slice(0, 4),
    '#FFFFFF',
  ];

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    confidence: Math.min(1, Math.max(0, confidence)),
    colors: {
      primary: template.baseColors.slice(0, 2),
      secondary: template.baseColors.slice(2, 4),
      accent: [template.baseColors[4] || template.baseColors[0]],
      neutral: ['#FFFFFF', '#F5F5F5', '#E8E8E8'],
    },
    colorPalette,
    materials: template.baseMaterials,
    textures: template.decorItems,
    lighting: template.baseLighting,
    furnitureStyle: preferences.stylePreference,
    decorItems: template.decorItems,
    patterns: template.patterns,
    suitableFor: {
      roomTypes: Object.keys(template.roomTypeWeights).filter(rt => template.roomTypeWeights[rt] > 0.5),
      moods: Object.keys(template.moodWeights).filter(mood => template.moodWeights[mood] > 0.5),
      styles: Object.keys(template.styleWeights).filter(style => template.styleWeights[style] > 0.5),
    },
    exampleImage: template.images.thumbnail,
    mockupUrl: template.images.preview,
    moodScore,
    styleScore,
    roomScore,
    userRating: template.averageRating,
    likes: Math.floor(template.popularity * 100),
    dislikes: Math.floor((1 - template.popularity) * 20),
  };
}

function applyPersonalization(themes, userHistory) {
  if (!userHistory) return themes;

  return themes.map(theme => {
    let personalizedConfidence = theme.confidence;

    if (userHistory.likedThemes?.includes(theme.id)) {
      personalizedConfidence *= 1.15;
    }
    if (userHistory.dislikedThemes?.includes(theme.id)) {
      personalizedConfidence *= 0.70;
    }
    if (userHistory.preferredMoods?.some(mood => theme.suitableFor.moods.includes(mood))) {
      personalizedConfidence *= 1.08;
    }
    if (userHistory.preferredMaterials?.some(mat => theme.materials.includes(mat))) {
      personalizedConfidence *= 1.05;
    }

    return {
      ...theme,
      confidence: Math.min(1, personalizedConfidence),
    };
  });
}

function filterThemes(preferences, options) {
  return themeDatabase.filter(theme => {
    const roomWeight = theme.roomTypeWeights[preferences.roomType];
    if (roomWeight === 0) return false;

    if (options?.includeStyles?.length > 0) {
      const hasMatchingStyle = options.includeStyles.some(style => theme.styleWeights[style] > 0);
      if (!hasMatchingStyle) return false;
    }

    if (options?.excludeStyles?.length > 0) {
      const hasExcludedStyle = options.excludeStyles.some(style => theme.styleWeights[style] > 0.5);
      if (hasExcludedStyle) return false;
    }

    return true;
  });
}

function generateRecommendationReason(theme, preferences) {
  const reasons = [];

  if (theme.moodScore > 85) {
    reasons.push(`perfectly captures the ${preferences.desiredMood.toLowerCase()} mood you're looking for`);
  } else if (theme.moodScore > 70) {
    reasons.push(`aligns well with your ${preferences.desiredMood.toLowerCase()} preference`);
  }

  if (theme.styleScore > 85) {
    reasons.push(`embodies ${preferences.stylePreference} design principles`);
  }

  if (theme.roomScore > 85) {
    reasons.push(`is optimized for ${preferences.roomType.toLowerCase()} spaces`);
  }

  return reasons.length > 0
    ? `This theme ${reasons.join(' and ')}.`
    : `This theme offers a balanced approach to your ${preferences.roomType} design.`;
}

function getKeyMatchingFactors(theme, preferences) {
  const factors = [];
  if (theme.moodScore > 75) factors.push(`${preferences.desiredMood} mood match`);
  if (theme.styleScore > 75) factors.push(`${preferences.stylePreference} style alignment`);
  if (theme.roomScore > 75) factors.push(`${preferences.roomType} optimization`);
  if (theme.confidence > 0.85) factors.push('High confidence recommendation');
  if (theme.likes && theme.likes > 50) factors.push('Popular choice');
  return factors;
}

function getSuggestedImprovements(theme) {
  const suggestions = [];
  if (theme.moodScore < 70) suggestions.push('Consider adjusting lighting to better match desired mood');
  if (theme.styleScore < 70) suggestions.push('Mix in more characteristic elements of your preferred style');
  if (theme.confidence < 0.75) suggestions.push('Try different color combinations for better alignment');
  return suggestions;
}

// ============================================================================
// MAIN CONTROLLER FUNCTIONS
// ============================================================================

/**
 * Get theme recommendations
 * IMPROVED: Added caching, request deduplication, better error handling
 */
export async function getThemeRecommendations(req, res, next) {
  try {
    const startTime = Date.now();
    const { room_type, mood, style, budget, colors, user_history } = req.query;

    // Validation is now handled by middleware, but we do a safety check
    if (!room_type || !mood || !style) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'room_type, mood, and style are required',
      });
    }

    const preferences = {
      roomType: room_type,
      desiredMood: mood,
      stylePreference: style,
      budgetRange: budget,
      colorPreferences: colors ? colors.split(',') : [],
    };

    // Parse user history safely
    let userHistory = null;
    if (user_history) {
      try {
        userHistory = JSON.parse(user_history);
        if (!userHistory || typeof userHistory !== 'object' || Array.isArray(userHistory)) {
          userHistory = null;
        }
      } catch (parseError) {
        console.warn('[ThemeController] Failed to parse user_history:', parseError);
        userHistory = null;
      }
    }

    // Check cache first (without user history for better cache hits)
    const cacheKey = getCacheKey(preferences);
    const cachedResult = getFromCache(cacheKey);
    
    if (cachedResult) {
      // Apply personalization to cached result if user history exists
      let finalResult = cachedResult;
      if (mlConfig.enablePersonalization && userHistory) {
        finalResult = {
          ...cachedResult,
          recommendedThemes: applyPersonalization(cachedResult.recommendedThemes, userHistory),
          topTheme: applyPersonalization([cachedResult.topTheme], userHistory)[0],
          alternativeThemes: applyPersonalization(cachedResult.alternativeThemes, userHistory),
          metadata: {
            ...cachedResult.metadata,
            sessionId: `session-${Date.now()}-${uuidv4().substring(0, 8)}`,
            cached: true,
          },
        };
      } else {
        finalResult.metadata = {
          ...finalResult.metadata,
          sessionId: `session-${Date.now()}-${uuidv4().substring(0, 8)}`,
          cached: true,
        };
      }

      console.log('✅ [ThemeController] Cache hit for:', cacheKey);
      return res.json(finalResult);
    }

    // Check for pending request (deduplication)
    const requestKey = getRequestKey(preferences);
    if (pendingRequests.has(requestKey)) {
      console.log('⏳ [ThemeController] Request already in progress, waiting...');
      try {
        const result = await pendingRequests.get(requestKey);
        return res.json({
          ...result,
          metadata: {
            ...result.metadata,
            sessionId: `session-${Date.now()}-${uuidv4().substring(0, 8)}`,
            deduplicated: true,
          },
        });
      } catch (pendingError) {
        // If pending request failed, continue with new request
        pendingRequests.delete(requestKey);
      }
    }

    // Create new request promise
    const requestPromise = (async () => {
      try {
        console.log('🎨 [ThemeController] Generating recommendations:', preferences);

        // Step 1: Filter themes
        let candidateThemes = filterThemes(preferences, {});

        if (candidateThemes.length === 0) {
          throw new Error('No themes match the specified criteria');
        }

        // Step 2: Score themes
        const scoredThemes = candidateThemes.map(template =>
          scoreTheme(template, preferences, null)
        );

        // Step 3: Apply personalization
        const personalizedThemes = mlConfig.enablePersonalization
          ? applyPersonalization(scoredThemes, userHistory)
          : scoredThemes;

        // Step 4: Filter and sort with improved algorithm
        let recommendedThemes = personalizedThemes
          .filter(theme => theme.confidence >= mlConfig.threshold)
          .sort((a, b) => {
            // Multi-factor sorting: confidence first, then diversity
            if (Math.abs(a.confidence - b.confidence) > 0.05) {
              return b.confidence - a.confidence;
            }
            // Prefer themes with higher individual scores
            const aAvgScore = (a.moodScore + a.styleScore + a.roomScore) / 3;
            const bAvgScore = (b.moodScore + b.styleScore + b.roomScore) / 3;
            return bAvgScore - aAvgScore;
          })
          .slice(0, mlConfig.maxRecommendations);

        // Fallback if no themes pass threshold - use top 3 by confidence
        if (recommendedThemes.length === 0) {
          recommendedThemes = personalizedThemes
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, Math.min(3, personalizedThemes.length));
        }

        // Ensure we have at least one theme
        if (recommendedThemes.length === 0) {
          throw new Error('Unable to generate theme recommendations');
        }

        const topTheme = recommendedThemes[0];
        const alternativeThemes = recommendedThemes.slice(1);
        const avgConfidence = recommendedThemes.reduce((sum, t) => sum + t.confidence, 0) / recommendedThemes.length;
        const confidenceLevel = avgConfidence > 0.85 ? 'high' : avgConfidence > 0.70 ? 'medium' : 'low';

        const processingTime = Date.now() - startTime;

        const response = {
          roomType: preferences.roomType,
          userPreferences: preferences,
          recommendedThemes,
          topTheme,
          alternativeThemes,
          metadata: {
            sessionId: `session-${Date.now()}-${uuidv4().substring(0, 8)}`,
            totalThemesAnalyzed: candidateThemes.length,
            processingTime,
            mlModel: `${mlConfig.algorithm}-v${mlConfig.modelVersion}`,
            confidenceLevel,
            recommendationDate: Date.now(),
            cached: false,
          },
          insights: {
            reasonForRecommendation: generateRecommendationReason(topTheme, preferences),
            keyMatchingFactors: getKeyMatchingFactors(topTheme, preferences),
            styleAlignment: Math.round(topTheme.styleScore),
            suggestedImprovements: getSuggestedImprovements(topTheme),
          },
        };

        // Cache the result (without personalization for better cache hits)
        setCache(cacheKey, response);

        console.log(`✅ [ThemeController] Generated ${recommendedThemes.length} recommendations in ${processingTime}ms`);
        return response;
      } catch (error) {
        console.error('❌ [ThemeController] Error generating recommendations:', error);
        throw error;
      }
    })();

    // Store pending request
    pendingRequests.set(requestKey, requestPromise);

    try {
      const response = await requestPromise;
      pendingRequests.delete(requestKey);
      
      // Apply user history personalization if needed (for non-cached results)
      if (mlConfig.enablePersonalization && userHistory) {
        response.recommendedThemes = applyPersonalization(response.recommendedThemes, userHistory);
        response.topTheme = applyPersonalization([response.topTheme], userHistory)[0];
        response.alternativeThemes = applyPersonalization(response.alternativeThemes, userHistory);
      }
      
      res.json(response);
    } catch (error) {
      pendingRequests.delete(requestKey);
      throw error;
    }
  } catch (error) {
    console.error('❌ [ThemeController] Error:', error);
    
    // Provide user-friendly error message
    const errorMessage = error.message || 'Failed to generate theme recommendations';
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({
      error: errorMessage,
      message: 'Unable to generate recommendations at this time. Please try again.',
      timestamp: Date.now(),
    });
  }
}

/**
 * Record user feedback (like, dislike, apply)
 */
export async function recordFeedback(req, res, next) {
  try {
    const { themeId, action, timestamp } = req.body;

    if (!themeId || !action) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'themeId and action are required',
      });
    }

    const validActions = ['like', 'dislike', 'apply', 'view'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        error: 'Invalid action',
        message: `Action must be one of: ${validActions.join(', ')}`,
      });
    }

    console.log(`📝 [ThemeController] Recording feedback: ${action} for theme ${themeId}`);

    // In production, save to database
    // For now, just acknowledge
    res.json({
      success: true,
      message: 'Feedback recorded',
      data: { themeId, action, timestamp: timestamp || Date.now() },
    });
  } catch (error) {
    console.error('❌ [ThemeController] Feedback error:', error);
    next(error);
  }
}

/**
 * Get all available themes
 */
export async function getAllThemes(req, res, next) {
  try {
    const themes = themeDatabase.map(template => ({
      id: template.id,
      name: template.name,
      description: template.description,
      colorPalette: template.baseColors,
      materials: template.baseMaterials,
      popularity: template.popularity,
      averageRating: template.averageRating,
    }));

    res.json({
      themes,
      total: themes.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get theme by ID
 */
export async function getThemeById(req, res, next) {
  try {
    const { id } = req.params;
    const template = themeDatabase.find(t => t.id === id);

    if (!template) {
      return res.status(404).json({
        error: 'Theme not found',
        message: `No theme found with ID: ${id}`,
      });
    }

    res.json({
      id: template.id,
      name: template.name,
      description: template.description,
      colorPalette: template.baseColors,
      materials: template.baseMaterials,
      lighting: template.baseLighting,
      decorItems: template.decorItems,
      patterns: template.patterns,
      suitableRooms: Object.keys(template.roomTypeWeights).filter(r => template.roomTypeWeights[r] > 0.5),
      suitableMoods: Object.keys(template.moodWeights).filter(m => template.moodWeights[m] > 0.5),
      suitableStyles: Object.keys(template.styleWeights).filter(s => template.styleWeights[s] > 0.5),
      popularity: template.popularity,
      averageRating: template.averageRating,
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getThemeRecommendations,
  recordFeedback,
  getAllThemes,
  getThemeById,
};

