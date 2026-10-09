import { randomUUID } from 'node:crypto';
import { getCatalog } from './furnitureCatalogService.js';
import { STYLE_PALETTES } from '../data/furnitureCatalog.js';
import { rankCandidates } from './mlService.js';

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function footprint(item) {
  const rotated = item.position.rotation % 180 !== 0;
  return {
    x: item.position.x, z: item.position.z,
    width: rotated ? item.dimensions.length : item.dimensions.width,
    length: rotated ? item.dimensions.width : item.dimensions.length,
  };
}

export function overlaps(a, b, gap = 0) {
  return !(a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x ||
    a.z + a.length + gap <= b.z || b.z + b.length + gap <= a.z);
}

function normalize(input) {
  const dimensions = input.dimensions || input.roomDimensions;
  const room = dimensions && { width: dimensions.width, length: dimensions.length ?? dimensions.depth, height: dimensions.height };
  if (!room || Object.values(room).some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0) ||
      room.width > 50 || room.length > 50 || room.height > 10) {
    throw invalid('Provide positive room width, length/depth and height in meters (maximum 50m × 50m × 10m)');
  }
  if (typeof input.roomType !== 'string' || !input.roomType.trim()) throw invalid('roomType is required');
  if (input.budgetPHP !== undefined && (!Number.isFinite(input.budgetPHP) || input.budgetPHP <= 0)) {
    throw invalid('budgetPHP must be a positive number');
  }
  const required = input.requiredFurniture || [];
  if (!Array.isArray(required) || required.length > 20 || required.some(type => typeof type !== 'string' || type.length > 100)) {
    throw invalid('requiredFurniture must be an array of up to 20 catalog item IDs or types');
  }
  const limits = input.constraints?.objectProximityLimits || {};
  const gap = limits.minDistanceBetweenFurniture ?? 0.3;
  const wall = limits.minDistanceFromWalls ?? 0.1;
  if (![gap, wall].every(value => Number.isFinite(value) && value >= 0 && value <= 2)) {
    throw invalid('Furniture and wall clearances must be between 0 and 2 meters');
  }
  const fixed = input.constraints?.fixedObstacles || [];
  if (!Array.isArray(fixed) || fixed.length > 50) throw invalid('Too many fixed obstacles');
  const obstacles = fixed.map(item => {
    if (!item?.position || !item?.dimensions) throw invalid('Fixed obstacles need measured positions and dimensions');
    const rect = footprint({ ...item, position: { ...item.position, rotation: item.position.rotation || 0 } });
    if (Object.values(rect).some(value => !Number.isFinite(value)) || rect.width <= 0 || rect.length <= 0 ||
        rect.x < 0 || rect.z < 0 || rect.x + rect.width > room.width || rect.z + rect.length > room.length) {
      throw invalid('Fixed obstacles must have valid footprints inside the room');
    }
    return rect;
  });
  return { room, gap, wall, obstacles, required };
}

function chooseFurniture(catalog, required, budgetPHP, room) {
  const mandatory = required.map(key => {
    const item = catalog.find(entry => entry.id === key || entry.type === key);
    if (!item) throw invalid(`Required furniture '${key}' is not in this room's catalog`);
    return { ...item, mandatory: true };
  });
  const affordable = budgetPHP ?? Infinity;
  let total = mandatory.reduce((sum, item) => sum + item.pricePHP, 0);
  if (total > affordable) throw invalid('Required furniture exceeds the peso budget', 422);
  const selected = [...mandatory];
  for (const item of catalog) {
    if (mandatory.some(entry => entry.id === item.id)) continue;
    if (total + item.pricePHP > affordable || item.dimensions.height > room.height ||
        Math.min(item.dimensions.width, item.dimensions.length) > Math.min(room.width, room.length)) continue;
    selected.push({ ...item, mandatory: false });
    total += item.pricePHP;
    if (selected.length >= 20) break;
  }
  if (!selected.length) throw invalid('No catalog furniture fits the supplied budget and dimensions', 422);
  return selected.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) ||
    b.dimensions.width * b.dimensions.length - a.dimensions.width * a.dimensions.length);
}

function positions(room, dimensions, wall, variant) {
  const points = [];
  for (const rotation of [0, 90]) {
    const width = rotation ? dimensions.length : dimensions.width;
    const length = rotation ? dimensions.width : dimensions.length;
    if (width + wall * 2 > room.width || length + wall * 2 > room.length || dimensions.height > room.height) continue;
    // Bounded search: 11 × 11 grid positions per orientation, including room edges.
    for (let xi = 0; xi <= 10; xi++) {
      for (let zi = 0; zi <= 10; zi++) {
        const x = wall + (room.width - width - wall * 2) * xi / 10;
        const z = wall + (room.length - length - wall * 2) * zi / 10;
        const preference = variant % 4;
        const cost = preference === 0 ? x + z : preference === 1 ? room.width - x + z :
          preference === 2 ? x + room.length - z : room.width - x + room.length - z;
        points.push({ x, y: 0, z, rotation, cost });
      }
    }
  }
  return points.sort((a, b) => a.cost - b.cost);
}

function place(items, context, variant, palette) {
  const { room, gap, wall, obstacles } = context;
  const furniture = [];
  const omitted = [];
  for (const item of items) {
    const choices = positions(room, item.dimensions, wall, variant);
    const position = choices.find(point => {
      const rect = footprint({ ...item, position: point });
      return !obstacles.some(obstacle => overlaps(rect, obstacle, gap)) &&
        !furniture.some(existing => overlaps(rect, footprint(existing), gap));
    });
    if (!position) {
      if (item.mandatory) return null;
      omitted.push(item.name);
      continue;
    }
    const { cost, ...point } = position;
    furniture.push({
      id: `${item.id}-${furniture.length}`, catalogId: item.id, name: item.name, type: item.type,
      category: item.category, dimensions: item.dimensions, position: point,
      properties: { price: item.pricePHP, color: palette[furniture.length % palette.length] },
      modelUrl: item.modelUrl, priceSource: item.priceSource, zIndex: furniture.length + 1,
    });
  }
  return furniture.length ? { furniture, omitted } : null;
}

export async function planLayouts(input) {
  const start = Date.now();
  const context = normalize(input);
  const catalog = getCatalog(input.roomType);
  const items = chooseFurniture(catalog, context.required, input.budgetPHP, context.room);
  const palette = STYLE_PALETTES[input.designStyle || input.style] || STYLE_PALETTES.Modern;
  const candidates = [];
  const seen = new Set();
  for (let variant = 0; variant < 12; variant++) {
    // Try different placement orderings without changing required items or inventory.
    const mandatory = items.filter(item => item.mandatory);
    const optional = items.filter(item => !item.mandatory);
    const ordered = variant >= 4 ? [...mandatory.slice().reverse(), ...optional.slice().reverse()] : items;
    const result = place(ordered, context, variant, palette);
    if (!result) continue;
    const key = JSON.stringify(result.furniture.map(item => [item.catalogId, item.position]));
    if (seen.has(key)) continue;
    seen.add(key);
    const area = context.room.width * context.room.length;
    const occupied = result.furniture.reduce((sum, item) => sum + item.dimensions.width * item.dimensions.length, 0);
    const totalCost = result.furniture.reduce((sum, item) => sum + item.properties.price, 0);
    const center = { x: context.room.width / 2 - 0.45, z: context.room.length / 2 - 0.45, width: 0.9, length: 0.9 };
    const centerClear = result.furniture.every(item => !overlaps(footprint(item), center)) ? 1 : 0;
    const symmetry = result.furniture.reduce((sum, item) => {
      const bounds = footprint(item);
      return sum + 1 - Math.min(1, Math.abs(bounds.x + bounds.width / 2 - context.room.width / 2) / (context.room.width / 2));
    }, 0) / result.furniture.length;
    const meanX = result.furniture.reduce((sum, item) => sum + (footprint(item).x + footprint(item).width / 2) / context.room.width, 0) / result.furniture.length;
    const meanZ = result.furniture.reduce((sum, item) => sum + (footprint(item).z + footprint(item).length / 2) / context.room.length, 0) / result.furniture.length;
    const features = {
      roomArea: area, furnitureCount: result.furniture.length, occupancyRatio: occupied / area,
      budgetUtilization: input.budgetPHP ? totalCost / input.budgetPHP : 0,
      requiredCoverage: 1, minimumGap: context.gap,
      centerClear, symmetry, meanX, meanZ,
      heuristicScore: Math.max(0, Math.min(100, 80 + centerClear * 10 + symmetry * 10 - result.omitted.length * 5 - occupied / area * 20)),
    };
    candidates.push({ id: randomUUID(), ...result, totalCost, features });
  }
  if (!candidates.length) throw invalid('No feasible layout found. Reduce furniture, increase the room size, or adjust clearances.', 422);
  const ranking = await rankCandidates(candidates.map(item => ({ id: item.id, features: item.features })));
  candidates.forEach((candidate, index) => { candidate.rankScore = ranking.scores[index]; });
  candidates.sort((a, b) => b.rankScore - a.rankScore);
  const warnings = [
    'Room dimensions must be measured; image detections alone do not provide 3D coordinates.',
    'Clearance checks cover furniture and measured obstacles; connected walkway access requires review.',
    'Performance scores are geometric proxies; comfort, lighting and aesthetics have not been independently evaluated.',
  ];
  if (catalog.some(item => item.priceSource === 'sample-estimate')) warnings.push('Prices are sample PHP estimates; replace them with supplier prices.');
  if (input.detectedObstacles?.length && !context.obstacles.length) warnings.push('Detected obstacle labels have no measured locations; verify door and window clearance manually.');
  if (ranking.source === 'geometric') warnings.push('Layouts use geometric scoring until a trained layout ranker is available.');
  const proposals = candidates.slice(0, 3).map((candidate, index) => {
    const score = Math.round(candidate.features.heuristicScore);
    return {
      id: candidate.id, roomType: input.roomType, title: `${input.designStyle || input.style || 'Modern'} ${input.roomType} — option ${index + 1}`,
      description: `Constraint-based arrangement of ${candidate.furniture.length} furniture items.`,
      layout: { id: candidate.id, version: 1, furniture: candidate.furniture,
        metadata: { generatedAt: Date.now(), algorithm: ranking.source === 'xgboost' ? 'hybrid' : 'rule-based', iterationsCount: 12, dimensions: context.room } },
      performanceScore: Object.fromEntries(['overall', 'spaceEfficiency', 'comfort', 'symmetry', 'accessibility', 'aesthetics', 'functionalFlow', 'lighting', 'ergonomics'].map(key => [key, score])),
      visualization: { renderData: null }, colorPalette: palette, recommendedFurniture: candidate.furniture,
      estimatedCost: { low: candidate.totalCost, mid: candidate.totalCost, high: candidate.totalCost },
      currency: 'PHP', pros: ['Furniture fits room bounds', 'No furniture overlaps', 'Required items included'],
      cons: [...warnings, ...candidate.omitted.map(name => `Omitted ${name}: insufficient space`)], rank: index + 1,
      rankingScore: candidate.rankScore, features: candidate.features,
    };
  });
  return {
    proposals, bestFitRecommendation: proposals[0], alternativeOptions: proposals.slice(1),
    metadata: { totalProposalsGenerated: proposals.length, processingTime: Date.now() - start,
      algorithm: 'constraint-placement', rankingSource: ranking.source, modelVersion: ranking.modelVersion,
      confidenceScore: null, currency: 'PHP', warnings },
    exportData: { json: JSON.stringify(proposals), structuredData: proposals },
  };
}
