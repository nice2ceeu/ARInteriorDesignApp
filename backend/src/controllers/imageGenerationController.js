/**
 * Image Generation Controller
 * Uses Pexels API to search for interior design photos based on user input
 * 
 * Moved from: frontend/services/DesignImageGenerationService.ts
 * 
 * SECURITY: API keys are stored on the server, never exposed to frontend
 */

import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const PEXELS_API_URL = 'https://api.pexels.com/v1/search';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 2;

// Get Pexels API key from environment
const getPexelsApiKey = () => {
  // Pexels API key for theme recommendation
  const pexelsKey = process.env.PEXELS_API_KEY || process.env.THEME_RECOMMENDATION_API_KEY;
  if (pexelsKey && pexelsKey.trim().length > 20) {
    console.log('[ImageGeneration] Using Pexels API key');
    return pexelsKey.trim();
  }
  console.warn('[ImageGeneration] No valid Pexels API key configured');
  return null;
};

// ============================================================================
// SEARCH QUERY BUILDER
// ============================================================================

const DESIGN_VIBES = [
  'cinematic', 'lifestyle', 'cozy', 'luxurious', 'bright and airy',
  'moody', 'hyper-realistic', 'wide angle', 'professional photography',
  'high resolution', 'detailed interior', 'magazine style'
];

/**
 * Build search query for Pexels API from user input
 */
function buildSearchQuery(proposal, preferences) {
  const {
    roomType = 'room',
    style = 'modern',
    colors = [],
    mood,
    materials = [],
    customDesign, // Custom design text from user
  } = preferences;

  // Select a random vibe to ensure variety even for identical prompts
  const randomVibe = DESIGN_VIBES[Math.floor(Math.random() * DESIGN_VIBES.length)];

  // If user provided custom design text, use it as the primary search query
  if (customDesign && customDesign.trim().length > 0) {
    // Extract key terms from custom design text
    const customText = customDesign.trim();
    // Remove common words and keep key design terms
    const keywords = customText
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 3 && !['the', 'with', 'and', 'for', 'from', 'look'].includes(word))
      .slice(0, 5)
      .join(' ');

    return `${keywords || customText} ${randomVibe}`.substring(0, 100);
  }

  // Build search query from preferences
  const queryParts = [];

  if (roomType) {
    queryParts.push(roomType);
  }

  if (style) {
    queryParts.push(style);
  }

  queryParts.push(randomVibe);

  if (mood) {
    queryParts.push(mood);
  }

  // Add first color if available
  if (colors.length > 0) {
    queryParts.push(colors[0]);
  }

  // Add first material if available
  if (materials.length > 0) {
    queryParts.push(materials[0]);
  }

  // Add "interior design" to improve relevance
  queryParts.push('interior design');

  return queryParts.join(' ').substring(0, 100);
}

// ============================================================================
// MAIN CONTROLLER FUNCTIONS
// ============================================================================

/**
 * Search for design images using Pexels API
 */
export async function generateDesignImage(req, res, next) {
  try {
    const { proposal, preferences } = req.body;

    if (!proposal || !preferences) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'proposal and preferences are required',
      });
    }

    const apiKey = getPexelsApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Image search service is not configured. Please contact administrator.',
      });
    }

    const searchQuery = buildSearchQuery(proposal, preferences);
    console.log(`[ImageGeneration] Request for: ${proposal.title || 'Untitled'}`);

    // Optional inspiration-photo search; not generative image inference.
    return await performPexelsSearch(searchQuery, proposal, res);
  } catch (error) {
    console.error('[ImageGeneration] Error:', error);
    next(error);
  }
}

/**
 * Internal helper for Pexels search
 */
async function performPexelsSearch(query, proposal, res) {
  const apiKey = getPexelsApiKey();
  if (!apiKey) {
    return res.status(503).json({
      error: 'Service unavailable',
      message: 'Image search service is not configured.',
    });
  }

  console.log(`[ImageGeneration] Searching Pexels for: "${query}"`);

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      const url = new URL(PEXELS_API_URL);
      url.searchParams.append('query', query);
      url.searchParams.append('per_page', '20'); // Fetch more for better variety

      // Randomize orientation for even more variety (landscape or square)
      const orientation = Math.random() > 0.5 ? 'landscape' : 'square';
      url.searchParams.append('orientation', orientation);

      // Use higher page numbers for more diverse results
      const randomPage = Math.floor(Math.random() * 10) + 1;
      url.searchParams.append('page', randomPage.toString());

      console.log(`[ImageGeneration] Pexels Search Attempt ${attempt + 1}/${MAX_RETRIES + 1} (Page ${randomPage}) for: "${query}"`);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Authorization': apiKey },
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.photos && data.photos.length > 0) {
          // Map Pexels photos to include cache-busting if needed, or just return them
          const enhancedPhotos = data.photos.map(photo => {
            const timestamp = Date.now();
            let imageUrl = photo.src?.large || photo.src?.original;
            let thumbnailUrl = photo.src?.medium || imageUrl;

            // Add cache-busting timestamp to URLs
            imageUrl += imageUrl.includes('?') ? `&t=${timestamp}` : `?t=${timestamp}`;
            thumbnailUrl += thumbnailUrl.includes('?') ? `&t=${timestamp}` : `?t=${timestamp}`;

            return {
              ...photo,
              src: {
                ...photo.src,
                large: imageUrl,
                medium: thumbnailUrl,
              }
            };
          });

          // Pick the first one as the default for single-image use cases
          const bestPhoto = enhancedPhotos[0];

          console.log(`[ImageGeneration] ✅ Returning ${enhancedPhotos.length} photos`);
          return res.json({
            success: true,
            photos: enhancedPhotos, // Return all photos for Explore screen
            imageUrl: bestPhoto.src.large,
            thumbnailUrl: bestPhoto.src.medium,
            prompt: query,
            generatedAt: Date.now(),
            attribution: {
              photographer: bestPhoto.photographer,
              source: `Pexels / ${bestPhoto.photographer}`,
            },
          });
        }

        console.warn(`[ImageGeneration] ⚠️ No photos found on random page ${randomPage}, retrying with another...`);
        lastError = new Error('Empty results on page');
        continue;
      }

      if (response.status === 429 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) continue;
    }
  }
  throw lastError || new Error('Search failed');
}


/**
 * Check if image search service is available
 */
export async function checkServiceStatus(req, res) {
  res.json({
    available: !!apiKey,
    model: 'pexels-search',
    maxPromptLength: 1000,
    supportedSizes: ['1024x1024', 'large', 'medium'],
    supportedQualities: ['hd', 'standard', 'original'],
  });
}

/**
 * Preview search query (for debugging)
 */
export async function previewPrompt(req, res) {
  try {
    const { proposal, preferences } = req.body;
    const searchQuery = buildSearchQuery(proposal || {}, preferences || {});
    res.json({
      prompt: searchQuery,
      length: searchQuery.length,
      truncated: searchQuery.length > 100,
    });
  } catch (error) {
    res.status(400).json({
      error: 'Invalid request',
      message: error.message,
    });
  }
}

export default {
  generateDesignImage,
  checkServiceStatus,
  previewPrompt,
};

