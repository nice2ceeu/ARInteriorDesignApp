/**
 * AI Training Controller
 * Machine learning pattern tracking and prediction
 * 
 * Moved from: frontend/services/AITrainingService.ts
 */

import { getDatabase } from '../db/database.js';


// ============================================================================
// DEFAULT COLOR PALETTES
// ============================================================================

const DEFAULT_COLORS = {
  'Modern': ['#FFFFFF', '#2C3E50', '#ECF0F1', '#3498DB'],
  'Minimalist': ['#FFFFFF', '#F5F5F5', '#E0E0E0', '#424242'],
  'Scandinavian': ['#FFFFFF', '#F0EAD6', '#D4B896', '#A0826D'],
  'Industrial': ['#3C3C3C', '#7F7F7F', '#B87333', '#2F4F4F'],
  'Bohemian': ['#E8D5C4', '#C9A86A', '#8B7355', '#D4AF37'],
  'Traditional': ['#8B4513', '#D2691E', '#F5DEB3', '#800020'],
  'Contemporary': ['#2C2C2C', '#4A4A4A', '#007AFF', '#FFFFFF'],
};

// ============================================================================
// OPTIMIZATION DEFAULTS
// ============================================================================

const STYLE_OPTIMIZATIONS = {
  'Minimalist': 'space',
  'Modern': 'aesthetics',
  'Scandinavian': 'comfort',
  'Industrial': 'aesthetics',
  'Bohemian': 'aesthetics',
  'Traditional': 'comfort',
};

// ============================================================================
// IN-MEMORY TRAINING DATA (would be stored in DB in production)
// ============================================================================

const trainingData = new Map();

function getOrCreateTrainingData(userId) {
  if (!trainingData.has(userId)) {
    trainingData.set(userId, {
      patterns: {
        styleRoomCombinations: {},
        colorStyleMap: {},
        budgetStyleMap: {},
        optimizationPatterns: {},
      },
      successMetrics: {
        likedDesigns: 0,
        appliedDesigns: 0,
        totalGenerations: 0,
        accuracyScore: 0.5,
      },
      trainedModels: {
        stylePredictor: {},
        roomPredictor: {},
        colorPredictor: {},
      },
      lastTrainingDate: Date.now(),
    });
  }
  return trainingData.get(userId);
}

// ============================================================================
// CONTROLLER FUNCTIONS
// ============================================================================

/**
 * Train model from user data
 */
export async function trainFromUserData(req, res, next) {
  try {
    const userId = req.user?.id || 'anonymous';
    const { usagePatterns, likedDesigns, appliedDesigns } = req.body;

    console.log(`[AITraining] Training for user: ${userId}`);

    const training = getOrCreateTrainingData(userId);

    // Process usage patterns
    if (usagePatterns) {
      const { styleFrequency = {}, roomTypeFrequency = {}, budgetFrequency = {} } = usagePatterns;

      // Build style-room combinations
      Object.keys(styleFrequency).forEach(style => {
        if (!training.patterns.styleRoomCombinations[style]) {
          training.patterns.styleRoomCombinations[style] = {};
        }
        Object.keys(roomTypeFrequency).forEach(room => {
          if (!training.patterns.styleRoomCombinations[style][room]) {
            training.patterns.styleRoomCombinations[style][room] = 0;
          }
          training.patterns.styleRoomCombinations[style][room] +=
            (styleFrequency[style] || 0) * (roomTypeFrequency[room] || 0) * 0.1;
        });
      });

      // Train style predictor
      const totalStyleFreq = Object.values(styleFrequency).reduce((a, b) => a + b, 0) || 1;
      Object.entries(styleFrequency).forEach(([style, freq]) => {
        const weight = freq / totalStyleFreq;
        training.trainedModels.stylePredictor[style] =
          (training.trainedModels.stylePredictor[style] || 0) * 0.7 + weight * 0.3;
      });

      // Train room predictor
      const totalRoomFreq = Object.values(roomTypeFrequency).reduce((a, b) => a + b, 0) || 1;
      Object.entries(roomTypeFrequency).forEach(([room, freq]) => {
        const weight = freq / totalRoomFreq;
        training.trainedModels.roomPredictor[room] =
          (training.trainedModels.roomPredictor[room] || 0) * 0.7 + weight * 0.3;
      });

      // Build budget-style relationships
      Object.entries(budgetFrequency).forEach(([budget]) => {
        if (!training.patterns.budgetStyleMap[budget]) {
          training.patterns.budgetStyleMap[budget] = [];
        }
        const topStyles = Object.entries(styleFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([style]) => style);
        training.patterns.budgetStyleMap[budget] = topStyles;
      });
    }

    // Update success metrics
    if (likedDesigns !== undefined) {
      training.successMetrics.likedDesigns = likedDesigns;
    }
    if (appliedDesigns !== undefined) {
      training.successMetrics.appliedDesigns = appliedDesigns;
    }
    training.successMetrics.totalGenerations++;

    // Calculate accuracy score
    if (training.successMetrics.totalGenerations > 0) {
      const acceptanceRate = (training.successMetrics.likedDesigns + training.successMetrics.appliedDesigns) /
        (training.successMetrics.totalGenerations * 2);
      training.successMetrics.accuracyScore = Math.min(1, Math.max(0, acceptanceRate));
    }

    training.lastTrainingDate = Date.now();

    res.json({
      success: true,
      message: 'Training data updated',
      metrics: training.successMetrics,
    });
  } catch (error) {
    console.error('[AITraining] Error:', error);
    next(error);
  }
}

/**
 * Predict style based on context
 */
export async function predictStyle(req, res) {
  const userId = req.user?.id || 'anonymous';
  const { roomType, budget, prompt } = req.query;

  const training = getOrCreateTrainingData(userId);
  const styleWeights = training.trainedModels.stylePredictor;

  if (Object.keys(styleWeights).length === 0) {
    return res.json({ predictedStyle: null, confidence: 0 });
  }

  const sorted = Object.entries(styleWeights).sort((a, b) => b[1] - a[1]);

  // Check budget-style relationship
  if (budget && training.patterns.budgetStyleMap[budget]) {
    const budgetStyles = training.patterns.budgetStyleMap[budget];
    const matched = sorted.find(([style]) => budgetStyles.includes(style));
    if (matched) {
      return res.json({
        predictedStyle: matched[0],
        confidence: matched[1],
        reason: `Matched based on ${budget} budget preference`,
      });
    }
  }

  res.json({
    predictedStyle: sorted[0]?.[0] || null,
    confidence: sorted[0]?.[1] || 0,
    reason: 'Based on usage frequency',
  });
}

/**
 * Predict room based on context
 */
export async function predictRoom(req, res) {
  const userId = req.user?.id || 'anonymous';
  const { style, prompt } = req.query;

  const training = getOrCreateTrainingData(userId);
  const roomWeights = training.trainedModels.roomPredictor;

  if (Object.keys(roomWeights).length === 0) {
    return res.json({ predictedRoom: null, confidence: 0 });
  }

  // Check style-room combinations
  if (style && training.patterns.styleRoomCombinations[style]) {
    const roomCombos = training.patterns.styleRoomCombinations[style];
    const topRoom = Object.entries(roomCombos).sort((a, b) => b[1] - a[1])[0];
    if (topRoom && topRoom[1] > 0.1) {
      return res.json({
        predictedRoom: topRoom[0],
        confidence: topRoom[1],
        reason: `Common combination with ${style} style`,
      });
    }
  }

  const sorted = Object.entries(roomWeights).sort((a, b) => b[1] - a[1]);

  res.json({
    predictedRoom: sorted[0]?.[0] || null,
    confidence: sorted[0]?.[1] || 0,
    reason: 'Based on usage frequency',
  });
}

/**
 * Predict colors based on style and budget
 */
export async function predictColors(req, res) {
  const userId = req.user?.id || 'anonymous';
  const { style, budget } = req.query;

  if (!style) {
    return res.status(400).json({
      error: 'Missing parameter',
      message: 'style is required',
    });
  }

  const training = getOrCreateTrainingData(userId);

  // Check learned color associations
  if (training.patterns.colorStyleMap[style]) {
    return res.json({ colors: training.patterns.colorStyleMap[style] });
  }

  // Fall back to defaults
  const colors = DEFAULT_COLORS[style] || DEFAULT_COLORS['Modern'];
  res.json({ colors });
}

/**
 * Get optimization goal recommendation
 */
export async function getOptimizationGoal(req, res) {
  const userId = req.user?.id || 'anonymous';
  const { roomType, style } = req.query;

  if (!roomType || !style) {
    return res.status(400).json({
      error: 'Missing parameters',
      message: 'roomType and style are required',
    });
  }

  const training = getOrCreateTrainingData(userId);
  const key = `${roomType}+${style}`;

  if (training.patterns.optimizationPatterns[key]) {
    return res.json({
      optimizationGoal: training.patterns.optimizationPatterns[key],
      source: 'learned',
    });
  }

  const defaultGoal = STYLE_OPTIMIZATIONS[style] || 'balanced';
  res.json({
    optimizationGoal: defaultGoal,
    source: 'default',
  });
}

/**
 * Get training stats
 */
export async function getTrainingStats(req, res, next) {
  try {
    const userId = req.user?.id || 'anonymous';
    const training = getOrCreateTrainingData(userId);

    // Convert accuracy to percentage (0-100) for frontend compatibility
    const accuracyPercent = training.successMetrics.accuracyScore * 100;

    res.json({
      accuracy: accuracyPercent,
      totalGenerations: training.successMetrics.totalGenerations,
      likedDesigns: training.successMetrics.likedDesigns,
      appliedDesigns: training.successMetrics.appliedDesigns,
      lastTrained: training.lastTrainingDate,
      modelVersion: '1.0.0',
    });
  } catch (error) {
    console.error('[AITraining] getTrainingStats error:', error);
    next(error);
  }
}

/**
 * Refine model (improve predictions based on success rate)
 */
export async function refineModel(req, res, next) {
  try {
    const userId = req.user?.id || 'anonymous';
    const training = getOrCreateTrainingData(userId);

    // Adjust weights based on accuracy
    if (training.successMetrics.accuracyScore < 0.3) {
      // Reduce weights of less successful patterns
      Object.keys(training.trainedModels.stylePredictor).forEach(key => {
        training.trainedModels.stylePredictor[key] *= 0.9;
      });
      Object.keys(training.trainedModels.roomPredictor).forEach(key => {
        training.trainedModels.roomPredictor[key] *= 0.9;
      });
    }

    const likedRatio = training.successMetrics.likedDesigns /
      Math.max(1, training.successMetrics.totalGenerations);

    if (likedRatio < 0.5) {
      Object.keys(training.trainedModels.stylePredictor).forEach(key => {
        training.trainedModels.stylePredictor[key] *= 0.95;
      });
    }

    res.json({
      success: true,
      message: 'Model refined',
      accuracy: training.successMetrics.accuracyScore,
      likedRatio,
    });
  } catch (error) {
    console.error('[AITraining] Refine error:', error);
    next(error);
  }
}

/**
 * Reset training data
 */
export async function resetTraining(req, res) {
  const userId = req.user?.id || 'anonymous';
  trainingData.delete(userId);
  getOrCreateTrainingData(userId);

  res.json({
    success: true,
    message: 'Training data reset',
  });
}

export default {
  trainFromUserData,
  predictStyle,
  predictRoom,
  predictColors,
  getOptimizationGoal,
  getTrainingStats,
  refineModel,
  resetTraining,
};

