/**
 * Idea Assistant Controller
 * AI-powered design prompt analysis and idea generation
 * 
 * Moved from: frontend/services/IdeaAssistantService.ts
 * 
 * Uses local rules; model inference is provided by the ML service.
 */

import dotenv from 'dotenv';


dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================


// ============================================================================
// DEFAULT DIMENSIONS BY ROOM TYPE
// ============================================================================

const DEFAULT_DIMENSIONS = {
  'Bedroom': { width: 4.5, length: 5.0, height: 2.7 },
  'Living Room': { width: 5.0, length: 6.0, height: 2.7 },
  'Kitchen': { width: 3.5, length: 4.0, height: 2.7 },
  'Bathroom': { width: 2.5, length: 3.0, height: 2.4 },
  'Office': { width: 3.0, length: 4.0, height: 2.7 },
  'Dining Room': { width: 4.0, length: 5.0, height: 2.7 },
};

// ============================================================================
// COLOR PALETTES BY STYLE
// ============================================================================

const STYLE_COLORS = {
  'Modern': ['#FFFFFF', '#2C3E50', '#ECF0F1', '#3498DB'],
  'Minimalist': ['#FFFFFF', '#F5F5F5', '#E0E0E0', '#424242'],
  'Scandinavian': ['#FFFFFF', '#F0EAD6', '#D4B896', '#A0826D'],
  'Industrial': ['#3C3C3C', '#7F7F7F', '#B87333', '#2F4F4F'],
  'Bohemian': ['#E8D5C4', '#C9A86A', '#8B7355', '#D4AF37'],
  'Traditional': ['#8B4513', '#D2691E', '#F5DEB3', '#800020'],
  'Contemporary': ['#2C2C2C', '#4A4A4A', '#007AFF', '#FFFFFF'],
};

// ============================================================================
// COLOR HARMONIES
// ============================================================================

const COLOR_HARMONIES = {
  '#FFFFFF': ['#F5F5F5', '#E8E8E8', '#2C3E50', '#3498DB'],
  '#2C3E50': ['#34495E', '#ECF0F1', '#3498DB', '#FFFFFF'],
  '#3498DB': ['#2980B9', '#ECF0F1', '#FFFFFF', '#34495E'],
  '#E8D5C4': ['#F5E6D3', '#8B7355', '#D4AF37', '#FFFFFF'],
};

// ============================================================================
// STYLE FUSIONS
// ============================================================================

const STYLE_FUSIONS = {
  'Modern+Minimalist': 'Modern Minimal',
  'Modern+Scandinavian': 'Scandi Modern',
  'Modern+Industrial': 'Modern Industrial',
  'Minimalist+Scandinavian': 'Minimal Scandi',
  'Minimalist+Bohemian': 'Minimal Boho',
  'Scandinavian+Traditional': 'Scandi Traditional',
  'Scandinavian+Industrial': 'Scandi Industrial',
};

// ============================================================================
// LOCAL KEYWORD ANALYSIS
// ============================================================================

function analyzePromptLocally(prompt) {
  const lower = prompt.toLowerCase();
  const suggestions = {};

  // Detect room type
  if (lower.match(/\b(bedroom|bed|sleep|master)\b/)) suggestions.roomType = 'Bedroom';
  else if (lower.match(/\b(kitchen|cook|stove|oven|fridge)\b/)) suggestions.roomType = 'Kitchen';
  else if (lower.match(/\b(bathroom|bath|shower|toilet)\b/)) suggestions.roomType = 'Bathroom';
  else if (lower.match(/\b(office|work|desk|study)\b/)) suggestions.roomType = 'Office';
  else if (lower.match(/\b(dining|dinner|table|eat)\b/)) suggestions.roomType = 'Dining Room';
  else if (lower.match(/\b(living|sofa|couch|tv|entertainment)\b/)) suggestions.roomType = 'Living Room';

  // Detect style
  if (lower.match(/\b(minimal|minimalist|clean|simple)\b/)) suggestions.style = 'Minimalist';
  else if (lower.match(/\b(modern|contemporary|sleek)\b/)) suggestions.style = 'Modern';
  else if (lower.match(/\b(scandinavian|scandi|nordic|light wood)\b/)) suggestions.style = 'Scandinavian';
  else if (lower.match(/\b(industrial|loft|exposed|metal)\b/)) suggestions.style = 'Industrial';
  else if (lower.match(/\b(bohemian|boho|eclectic|vibrant)\b/)) suggestions.style = 'Bohemian';
  else if (lower.match(/\b(traditional|classic|vintage)\b/)) suggestions.style = 'Traditional';

  // Detect budget
  if (lower.match(/\b(cheap|budget|affordable|low cost|economy)\b/)) suggestions.budget = 'low';
  else if (lower.match(/\b(luxury|premium|high-end|expensive|deluxe)\b/)) suggestions.budget = 'luxury';
  else if (lower.match(/\b(moderate|mid-range|standard)\b/)) suggestions.budget = 'medium';

  // Add dimensions based on room type
  if (suggestions.roomType) {
    suggestions.dimensions = DEFAULT_DIMENSIONS[suggestions.roomType] || DEFAULT_DIMENSIONS['Living Room'];
  }

  // Add colors based on style
  if (suggestions.style) {
    suggestions.colors = STYLE_COLORS[suggestions.style] || STYLE_COLORS['Modern'];
  }

  return suggestions;
}

// ============================================================================
// LOCAL DESIGN IDEAS
// ============================================================================

function generateLocalIdeas(input) {
  const { roomType, designStyle, dimensions, budget } = input;
  const area = Math.round(dimensions.width * dimensions.length);

  return [
    {
      title: `Zoned ${designStyle} ${roomType}`,
      description: `Divide the ${area}m² space into clear zones (primary, secondary, circulation). Anchor with a focal piece and keep walkways ≥ 90cm. Use a 60/30/10 color balance to stay on-style.`,
    },
    {
      title: `Light-first layout`,
      description: `Place seating/work surfaces within 2m of natural light; float larger pieces to keep sightlines open. Layer task + ambient lighting; mirror opposite the brightest wall to amplify light.`,
    },
    {
      title: `Budget-smart material mix (${budget})`,
      description: `Prioritize touchpoints (sofa/desk) and save on storage/decor. Select 2 main materials and 1 accent; repeat them 3× for cohesion. Keep furniture 30cm off walls where possible for depth.`,
    },
  ];
}

// ============================================================================
// CONTROLLER FUNCTIONS
// ============================================================================

/**
 * Analyze design prompt
 */
export async function analyzePrompt(req, res, next) {
  try {
    const { prompt, userPreferences } = req.body;

    if (!prompt || prompt.length < 10) {
      return res.status(400).json({
        error: 'Invalid prompt',
        message: 'Prompt must be at least 10 characters',
      });
    }

    console.log('[IdeaAssistant] Analyzing prompt:', prompt.substring(0, 50) + '...');

    const suggestions = analyzePromptLocally(prompt);

    // Merge with user preferences if available
    if (userPreferences) {
      if (!suggestions.roomType && userPreferences.preferredRoomType) {
        suggestions.roomType = userPreferences.preferredRoomType;
      }
      if (!suggestions.style && userPreferences.preferredStyle) {
        suggestions.style = userPreferences.preferredStyle;
      }
      if (!suggestions.budget && userPreferences.preferredBudget) {
        suggestions.budget = userPreferences.preferredBudget;
      }
    }

    res.json(suggestions);
  } catch (error) {
    console.error('[IdeaAssistant] Error:', error);
    next(error);
  }
}

/**
 * Generate design ideas
 */
export async function generateIdeas(req, res, next) {
  try {
    const { roomType, designStyle, dimensions, budget, userPrompt } = req.body;

    if (!roomType || !designStyle || !dimensions) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'roomType, designStyle, and dimensions are required',
      });
    }

    const input = {
      roomType,
      designStyle,
      dimensions,
      budget: budget || 'medium',
      userPrompt,
    };

    console.log('[IdeaAssistant] Generating ideas for:', roomType, designStyle);

    const ideas = generateLocalIdeas(input);

    res.json({ ideas });
  } catch (error) {
    console.error('[IdeaAssistant] Error:', error);
    next(error);
  }
}

/**
 * Get color harmony suggestions
 */
export async function suggestColorHarmony(req, res) {
  const { primaryColor, style } = req.query;

  const harmony = COLOR_HARMONIES[primaryColor] || STYLE_COLORS[style] || ['#FFFFFF', '#F5F5F5', '#E0E0E0', '#2C3E50'];

  res.json({ colors: harmony });
}

/**
 * Fuse two styles
 */
export async function fuseStyles(req, res) {
  const { style1, style2 } = req.query;

  if (!style1 || !style2) {
    return res.status(400).json({
      error: 'Missing parameters',
      message: 'style1 and style2 are required',
    });
  }

  const key1 = `${style1}+${style2}`;
  const key2 = `${style2}+${style1}`;
  const fusedStyle = STYLE_FUSIONS[key1] || STYLE_FUSIONS[key2] || `${style1} + ${style2}`;

  res.json({ fusedStyle });
}

/**
 * Check service status
 */
export async function checkStatus(req, res) {
  res.json({
    available: true,
    aiEnabled: false,
    source: 'rule-based',
    supportedRoomTypes: Object.keys(DEFAULT_DIMENSIONS),
    supportedStyles: Object.keys(STYLE_COLORS),
  });
}

export default {
  analyzePrompt,
  generateIdeas,
  suggestColorHarmony,
  fuseStyles,
  checkStatus,
};

