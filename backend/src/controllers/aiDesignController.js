import { planLayouts, footprint } from '../services/layoutPlanner.js';
import { getCatalog } from '../services/furnitureCatalogService.js';
import DesignSession from '../models/DesignSession.js';
import { isMongoDBConnected } from '../db/mongodb.js';

export async function generateDesign(req, res, next) {
  try { res.json(await planLayouts(req.body)); } catch (error) { next(error); }
}

// Preserve the floor-plan screen's array response contract.
export async function generateLayout(req, res, next) {
  try {
    const result = await planLayouts(req.body);
    const layouts = result.proposals.map(proposal => ({
      id: proposal.id,
      furniture: proposal.layout.furniture.map(item => {
        const bounds = footprint(item);
        // FloorPlan2D receives oriented footprints to avoid double rotation.
        return { id: item.id, name: item.name, type: item.type, catalogId: item.catalogId,
          x: bounds.x, y: bounds.z, width: bounds.width, depth: bounds.length,
          rotation: 0, placementRotation: item.position.rotation,
          color: item.properties.color, pricePHP: item.properties.price, modelUrl: item.modelUrl };
      }),
      safety_warnings: proposal.cons, score: proposal.performanceScore.overall,
      rankingScore: proposal.rankingScore, rankingSource: result.metadata.rankingSource,
      estimatedCostPHP: proposal.estimatedCost.mid, currency: 'PHP',
    }));
    if (isMongoDBConnected()) {
      const dimensions = req.body.roomDimensions || req.body.dimensions;
      await DesignSession.create({
        userId: /^[a-f0-9]{24}$/i.test(req.user?.userId || '') ? req.user.userId : null,
        roomDimensions: { width: dimensions.width, depth: dimensions.depth ?? dimensions.length, height: dimensions.height },
        detectedObstacles: req.body.detectedObstacles || [],
        preferences: { roomType: req.body.roomType, style: req.body.style || req.body.designStyle || 'Modern', availableFloorSpace: req.body.availableFloorSpace },
        generatedLayouts: layouts,
      });
    }
    res.json(layouts);
  } catch (error) { next(error); }
}

export function getFurnitureCatalog(req, res, next) {
  try {
    const furniture = getCatalog(req.params.roomType);
    res.json({ roomType: req.params.roomType, furniture, total: furniture.length, currency: 'PHP' });
  } catch (error) { next(error); }
}

export function estimateFurnitureCost(req, res) {
  const { furniture } = req.body;
  if (!Array.isArray(furniture) || furniture.some(item => !Number.isFinite(item?.pricePHP ?? item?.properties?.price) ||
      (item.pricePHP ?? item.properties.price) < 0)) {
    return res.status(400).json({ message: 'Provide a furniture array with nonnegative catalog pricePHP values' });
  }
  const total = furniture.reduce((sum, item) => sum + (item.pricePHP ?? item.properties.price), 0);
  res.json({ low: total, high: total, average: total, currency: 'PHP' });
}

export default { generateDesign, generateLayout, getFurnitureCatalog, estimateFurnitureCost };
