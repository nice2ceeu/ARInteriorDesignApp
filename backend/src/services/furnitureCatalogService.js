import { readFileSync } from 'node:fs';
import { DEFAULT_CATALOG } from '../data/furnitureCatalog.js';

// Demonstration PHP estimates, not supplier quotations.
const SAMPLE_PRICES = {
  sofa: 12000, bed: 10000, desk: 4500, chair: 1800, 'office-chair': 3500,
  'coffee-table': 2500, 'dining-table': 6000, 'dining-chair': 1800,
  wardrobe: 8000, nightstand: 1500, dresser: 5000, armchair: 4000,
};

function readClientCatalog() {
  const file = process.env.FURNITURE_CATALOG_PATH;
  if (!file) return null;
  const document = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(document.furniture)) throw new Error('Catalog must contain a furniture array');
  return document.furniture;
}

export function getCatalog(roomType, clientItems = readClientCatalog()) {
  const normalized = roomType === 'Dining Area' ? 'Dining Room' : roomType;
  const file = Boolean(clientItems);
  let entries;
  if (file) {
    entries = clientItems.filter(item => !item.roomTypes || item.roomTypes.includes(normalized));
  } else {
    entries = DEFAULT_CATALOG[normalized];
  }
  if (!entries?.length) {
    const error = new Error(`No furniture catalog is available for ${normalized}`);
    error.statusCode = 400;
    throw error;
  }
  return entries.map((item, index) => {
    const dimensions = item.dimensions || { width: item.width, length: item.length, height: item.height };
    const price = file ? item.pricePHP : SAMPLE_PRICES[item.type] ?? 2500;
    if (!item.type || !item.name || !dimensions ||
        ['width', 'length', 'height'].some(key => !Number.isFinite(dimensions[key]) || dimensions[key] <= 0) ||
        !Number.isFinite(price) || price < 0) {
      throw new Error('Catalog entries require type, name, positive meter dimensions and pricePHP');
    }
    return {
      id: item.id || `${item.type}-${index}`, type: item.type, name: item.name,
      category: item.category === 'bed' ? 'other' : item.category || 'other',
      dimensions, pricePHP: price, modelUrl: item.modelUrl,
      priceSource: file ? 'client-catalog' : 'sample-estimate',
    };
  });
}

// Item counts per room type. Room types come from the client catalog's roomTypes when one is configured.
export function getRoomSummary() {
  const clientItems = readClientCatalog();
  const declared = clientItems?.flatMap(item => item.roomTypes || []) || [];
  const roomTypes = declared.length ? [...new Set(declared)] : Object.keys(DEFAULT_CATALOG);
  const rooms = roomTypes.map(roomType => {
    try {
      return { roomType, itemCount: getCatalog(roomType, clientItems).length };
    } catch (error) {
      if (error.statusCode === 400) return { roomType, itemCount: 0 };
      throw error;
    }
  });
  return { source: clientItems ? 'client-catalog' : 'sample-catalog', rooms };
}
