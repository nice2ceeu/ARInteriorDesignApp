import { randomUUID as uuidv4 } from 'node:crypto';

/**
 * Generate interior design layout proposals
 * @param {Object} requestBody - Layout generation request
 * @param {Object} user - Authenticated user (optional)
 * @returns {Promise<Object>} Generated layout proposals
 */
export async function generateLayout(requestBody, user = null) {
  const startTime = Date.now();

  try {
    // Extract request parameters
    const {
      type = 'dashboard',
      style = 'modern',
      color_scheme = [],
      sections = [],
      constraints = {},
      context = {},
    } = requestBody;

    // Validate required fields
    if (!constraints.room_dimensions) {
      throw new Error('room_dimensions are required');
    }

    const { room_dimensions } = constraints;
    const { width, length, height } = room_dimensions;

    if (!width || !length || !height || width <= 0 || length <= 0 || height <= 0) {
      throw new Error('Invalid room dimensions');
    }

    // Generate layout proposals using algorithm
    const proposals = generateLayoutProposals({
      style,
      colorScheme: color_scheme,
      roomType: sections[0] || 'Living Room',
      dimensions: room_dimensions,
      optimizationGoal: context.optimization_goal || 'balanced',
      walkwayClearance: constraints.walkway_clearance || 0.9,
      userPrompt: context.user_prompt || '',
    });

    const processingTime = Date.now() - startTime;
    const layoutId = `layout-${Date.now()}-${uuidv4().substring(0, 8)}`;

    return {
      layout_id: layoutId,
      proposals: proposals.map((proposal, index) => ({
        id: proposal.id,
        structure: proposal.structure,
        components: proposal.components,
        preview_url: proposal.previewUrl,
        confidence_score: proposal.confidence,
      })),
      metadata: {
        generated_at: new Date().toISOString(),
        model_version: '1.0.0',
        processing_time_ms: processingTime,
        user_id: user?.id || null,
      },
    };
  } catch (error) {
    console.error('[LayoutController] Error generating layout:', error);
    throw error;
  }
}

/**
 * Generate layout proposals using spatial optimization algorithm
 */
function generateLayoutProposals({
  style,
  colorScheme,
  roomType,
  dimensions,
  optimizationGoal,
  walkwayClearance,
  userPrompt,
}) {
  const proposals = [];
  const numProposals = 3; // Generate 3 variations

  for (let i = 0; i < numProposals; i++) {
    const proposal = generateSingleProposal({
      style,
      colorScheme,
      roomType,
      dimensions,
      optimizationGoal,
      walkwayClearance,
      variation: i,
    });

    proposals.push(proposal);
  }

  // Sort by confidence score
  proposals.sort((a, b) => b.confidence - a.confidence);

  return proposals;
}

/**
 * Generate a single layout proposal
 */
function generateSingleProposal({
  style,
  colorScheme,
  roomType,
  dimensions,
  optimizationGoal,
  walkwayClearance,
  variation,
}) {
  const { width, length, height } = dimensions;
  const roomArea = width * length;

  // Generate furniture items based on room type and size
  const furnitureTemplates = getFurnitureTemplates(roomType, style);
  const furniture = [];

  // Calculate how many items can fit
  const maxItems = Math.floor(roomArea / 4); // ~1 item per 4 m²
  const numItems = Math.min(maxItems, furnitureTemplates.length);

  let usedArea = 0;
  const placedItems = [];

  for (let i = 0; i < numItems && usedArea < roomArea * 0.6; i++) {
    const template = furnitureTemplates[i % furnitureTemplates.length];
    const itemWidth = template.dimensions.width;
    const itemLength = template.dimensions.length;
    const itemArea = itemWidth * itemLength;

    if (usedArea + itemArea > roomArea * 0.6) break;

    // Calculate position (avoiding overlaps)
    const position = findValidPosition(
      { width: itemWidth, length: itemLength },
      dimensions,
      placedItems,
      walkwayClearance,
      variation
    );

    const furnitureItem = {
      id: `furniture-${i}-${Date.now()}`,
      type: template.type,
      category: template.category,
      name: template.name,
      dimensions: template.dimensions,
      position: {
        x: position.x,
        y: 0,
        z: position.z,
        rotation: position.rotation || 0,
      },
      properties: {
        color: colorScheme[i % colorScheme.length] || '#FFFFFF',
        material: template.material || 'wood',
      },
    };

    furniture.push(furnitureItem);
    placedItems.push({
      x: position.x,
      z: position.z,
      width: itemWidth,
      length: itemLength,
    });
    usedArea += itemArea;
  }

  // Calculate confidence based on space utilization and optimization goal
  const spaceUtilization = usedArea / roomArea;
  let confidence = 0.7;

  if (optimizationGoal === 'space') {
    confidence = Math.min(0.95, 0.6 + spaceUtilization * 0.35);
  } else if (optimizationGoal === 'comfort') {
    confidence = Math.min(0.95, 0.65 + (1 - spaceUtilization) * 0.3);
  } else {
    confidence = Math.min(0.95, 0.7 + Math.abs(spaceUtilization - 0.5) * 0.25);
  }

  // Add variation to confidence
  confidence += (variation === 0 ? 0.1 : variation === 1 ? 0.05 : 0) - (variation * 0.02);

  return {
    id: `proposal-${Date.now()}-${variation}`,
    structure: {
      id: `structure-${Date.now()}-${variation}`,
      furniture,
      room_dimensions: dimensions,
      style,
      color_palette: colorScheme.length > 0 ? colorScheme : generateDefaultColorPalette(style),
    },
    components: furniture.map(item => ({
      id: item.id,
      type: item.type,
      label: item.name,
      name: item.name,
      dimensions: item.dimensions,
      position: item.position,
      properties: item.properties,
    })),
    previewUrl: null, // Could generate preview image URL here
    confidence: Math.max(0.5, Math.min(1, confidence)),
  };
}

/**
 * Find valid position for furniture item
 */
function findValidPosition(itemDims, roomDims, existingItems, walkwayClearance, variation) {
  const maxAttempts = 50;
  const margin = walkwayClearance || 0.3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Vary position based on variation number
    const xOffset = (variation * 0.3) % 1;
    const zOffset = ((variation * 0.5) % 1) * 0.7;

    const x = margin + (roomDims.width - itemDims.width - margin * 2) * (Math.random() * 0.7 + xOffset * 0.3);
    const z = margin + (roomDims.length - itemDims.length - margin * 2) * (Math.random() * 0.7 + zOffset * 0.3);
    const rotation = [0, 90, 180, 270][Math.floor(Math.random() * 4)];

    // Check collision
    let collision = false;
    for (const existing of existingItems) {
      const distance = Math.sqrt(
        Math.pow(x - existing.x, 2) + Math.pow(z - existing.z, 2)
      );
      const minDistance = (itemDims.width + existing.width) / 2 + walkwayClearance;

      if (distance < minDistance) {
        collision = true;
        break;
      }
    }

    if (!collision && 
        x >= margin && 
        x + itemDims.width <= roomDims.width - margin &&
        z >= margin && 
        z + itemDims.length <= roomDims.length - margin) {
      return { x, z, rotation };
    }
  }

  // Fallback: center position
  return {
    x: roomDims.width / 2 - itemDims.width / 2,
    z: roomDims.length / 2 - itemDims.length / 2,
    rotation: 0,
  };
}

/**
 * Get furniture templates for room type and style
 */
function getFurnitureTemplates(roomType, style) {
  const templates = {
    'Living Room': [
      { type: 'sofa', category: 'seating', name: 'Sofa', dimensions: { width: 2.0, length: 0.9, height: 0.9 }, material: 'fabric' },
      { type: 'coffee_table', category: 'table', name: 'Coffee Table', dimensions: { width: 1.2, length: 0.6, height: 0.4 }, material: 'wood' },
      { type: 'tv_stand', category: 'storage', name: 'TV Stand', dimensions: { width: 1.8, length: 0.5, height: 0.6 }, material: 'wood' },
      { type: 'armchair', category: 'seating', name: 'Armchair', dimensions: { width: 0.9, length: 0.9, height: 0.9 }, material: 'fabric' },
      { type: 'bookshelf', category: 'storage', name: 'Bookshelf', dimensions: { width: 0.8, length: 0.4, height: 1.8 }, material: 'wood' },
    ],
    'Bedroom': [
      { type: 'bed', category: 'bedding', name: 'Bed', dimensions: { width: 1.6, length: 2.0, height: 0.5 }, material: 'wood' },
      { type: 'wardrobe', category: 'storage', name: 'Wardrobe', dimensions: { width: 1.2, length: 0.6, height: 2.0 }, material: 'wood' },
      { type: 'nightstand', category: 'table', name: 'Nightstand', dimensions: { width: 0.5, length: 0.4, height: 0.6 }, material: 'wood' },
      { type: 'dresser', category: 'storage', name: 'Dresser', dimensions: { width: 1.2, length: 0.5, height: 0.8 }, material: 'wood' },
    ],
    'Kitchen': [
      { type: 'kitchen_cabinet', category: 'storage', name: 'Kitchen Cabinet', dimensions: { width: 0.6, length: 0.6, height: 0.9 }, material: 'wood' },
      { type: 'dining_table', category: 'table', name: 'Dining Table', dimensions: { width: 1.5, length: 0.9, height: 0.75 }, material: 'wood' },
      { type: 'chair', category: 'seating', name: 'Chair', dimensions: { width: 0.5, length: 0.5, height: 0.9 }, material: 'wood' },
    ],
  };

  return templates[roomType] || templates['Living Room'];
}

/**
 * Generate default color palette based on style
 */
function generateDefaultColorPalette(style) {
  const palettes = {
    modern: ['#FFFFFF', '#F5F5F5', '#424242', '#000000'],
    minimalist: ['#FFFFFF', '#E8E8E8', '#CCCCCC', '#999999'],
    rustic: ['#8B4513', '#D2691E', '#F5DEB3', '#CD853F'],
    scandinavian: ['#F5F5F5', '#E8E8E8', '#D4C5B9', '#A8956B'],
    industrial: ['#3C3C3C', '#7F7F7F', '#B87333', '#2F4F4F'],
  };

  return palettes[style.toLowerCase()] || palettes.modern;
}

