/**
 * AI Design Routes
 * API endpoints for AI-powered design generation
 */

import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import aiDesignController from '../controllers/aiDesignController.js';

const router = express.Router();

// Apply optional auth to all routes
router.use(optionalAuth);

/**
 * POST /api/v1/designs/generate
 * Generate AI design proposals
 * Body: { roomType, dimensions, designStyle, budget, userPrompt, optimizationGoal, constraints }
 */
router.post('/generate', aiDesignController.generateDesign);

/**
 * GET /api/v1/designs/rooms
 * Room types in the furniture catalog with their item counts
 */
router.get('/rooms', aiDesignController.getCatalogRooms);

/**
 * GET /api/v1/designs/furniture/:roomType
 * Get furniture catalog for a room type
 */
router.get('/furniture/:roomType', aiDesignController.getFurnitureCatalog);

/**
 * POST /api/v1/designs/estimate-cost
 * Estimate cost for furniture list
 * Body: { furniture, budget }
 */
router.post('/estimate-cost', aiDesignController.estimateFurnitureCost);

export default router;

