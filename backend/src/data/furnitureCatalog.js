// Built-in examples in meters; replace with the client catalog when available.
export const DEFAULT_CATALOG = {
  'Living Room': [
    { type: 'sofa', name: '3-Seater Sofa', width: 2.2, length: 0.9, height: 0.85, category: 'seating' },
    { type: 'armchair', name: 'Accent Armchair', width: 0.8, length: 0.8, height: 0.9, category: 'seating' },
    { type: 'coffee-table', name: 'Coffee Table', width: 1.2, length: 0.6, height: 0.45, category: 'table' },
    { type: 'side-table', name: 'Side Table', width: 0.5, length: 0.5, height: 0.55, category: 'table' },
    { type: 'tv-stand', name: 'TV Console', width: 1.8, length: 0.45, height: 0.5, category: 'storage' },
    { type: 'bookshelf', name: 'Bookshelf', width: 1.0, length: 0.35, height: 1.8, category: 'storage' },
    { type: 'floor-lamp', name: 'Floor Lamp', width: 0.4, length: 0.4, height: 1.7, category: 'lighting' },
    { type: 'rug', name: 'Area Rug', width: 2.5, length: 3.5, height: 0.02, category: 'decor' },
  ],
  'Bedroom': [
    { type: 'bed', name: 'Queen Bed', width: 1.6, length: 2.1, height: 0.5, category: 'bed' },
    { type: 'nightstand', name: 'Nightstand', width: 0.5, length: 0.4, height: 0.55, category: 'table' },
    { type: 'dresser', name: 'Dresser', width: 1.4, length: 0.5, height: 0.8, category: 'storage' },
    { type: 'wardrobe', name: 'Wardrobe', width: 1.8, length: 0.6, height: 2.2, category: 'storage' },
    { type: 'desk', name: 'Writing Desk', width: 1.2, length: 0.6, height: 0.75, category: 'table' },
    { type: 'chair', name: 'Desk Chair', width: 0.5, length: 0.5, height: 0.9, category: 'seating' },
  ],
  'Office': [
    { type: 'desk', name: 'Office Desk', width: 1.6, length: 0.8, height: 0.75, category: 'table' },
    { type: 'office-chair', name: 'Ergonomic Chair', width: 0.65, length: 0.65, height: 1.2, category: 'seating' },
    { type: 'bookshelf', name: 'Office Bookshelf', width: 1.2, length: 0.35, height: 2.0, category: 'storage' },
    { type: 'filing-cabinet', name: 'Filing Cabinet', width: 0.5, length: 0.6, height: 0.7, category: 'storage' },
    { type: 'guest-chair', name: 'Guest Chair', width: 0.6, length: 0.6, height: 0.85, category: 'seating' },
  ],
  'Kitchen': [
    { type: 'dining-table', name: 'Dining Table', width: 1.4, length: 0.9, height: 0.75, category: 'table' },
    { type: 'dining-chair', name: 'Dining Chair', width: 0.45, length: 0.5, height: 0.9, category: 'seating' },
    { type: 'kitchen-island', name: 'Kitchen Island', width: 1.2, length: 0.8, height: 0.9, category: 'storage' },
    { type: 'bar-stool', name: 'Bar Stool', width: 0.4, length: 0.4, height: 0.75, category: 'seating' },
  ],
  'Dining Room': [
    { type: 'dining-table', name: 'Dining Table', width: 1.8, length: 1.0, height: 0.75, category: 'table' },
    { type: 'dining-chair', name: 'Dining Chair', width: 0.45, length: 0.5, height: 0.9, category: 'seating' },
    { type: 'buffet', name: 'Buffet Cabinet', width: 1.6, length: 0.5, height: 0.85, category: 'storage' },
    { type: 'china-cabinet', name: 'China Cabinet', width: 1.2, length: 0.45, height: 1.8, category: 'storage' },
  ],
};

export const STYLE_PALETTES = {
  'Modern': ['#FFFFFF', '#F5F5F5', '#333333', '#007AFF', '#E0E0E0'],
  'Scandinavian': ['#F5F5F5', '#E8E8E8', '#D4C5B9', '#A8956B', '#6B8E91'],
  'Industrial': ['#3C3C3C', '#7F7F7F', '#B87333', '#2F4F4F', '#DAA520'],
  'Bohemian': ['#E8DED2', '#C9A86A', '#8B7355', '#D4AF37', '#9B59B6'],
  'Minimalist': ['#FFFFFF', '#F0F0F0', '#CCCCCC', '#333333', '#666666'],
  'Traditional': ['#8B4513', '#D2691E', '#F5DEB3', '#CD853F', '#FFFFFF'],
  'Contemporary': ['#2C2C2C', '#4A4A4A', '#007AFF', '#FFFFFF', '#F5F5F5'],
  'Rustic': ['#8B4513', '#D2691E', '#F5DEB3', '#228B22', '#654321'],
  'Mid-Century': ['#E07B53', '#2C5F2D', '#D4A574', '#F5E6C8', '#4A4A4A'],
  'Eclectic': ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#9B59B6'],
};
