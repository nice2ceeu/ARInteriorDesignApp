/**
 * Remove Sample Saved Items
 * Earlier versions seeded the Saved tab with sample furniture on first launch.
 * This removes those seeded items once, so the Saved tab only shows what the user saved.
 */

import { savedItemsService } from '@/services/SavedItemsService';
import { getJson, removeKey } from '@/utils/storage';

// Set by the old seeding code; present only on installs that received the samples.
const LEGACY_INITIALIZATION_KEY = 'savedItemsInitialized';
const SAMPLE_ITEM_IDS = ['sofa-modern', 'dining-chair', 'floor-lamp'];

export async function removeSampleSavedItems(): Promise<void> {
  try {
    const seeded = await getJson<boolean>(LEGACY_INITIALIZATION_KEY, false);
    if (!seeded) return;

    await savedItemsService.removeSavedItems(SAMPLE_ITEM_IDS);
    await removeKey(LEGACY_INITIALIZATION_KEY);
  } catch (error) {
    console.error('[removeSampleSavedItems] Failed to remove sample items:', error);
    // Non-critical: the Saved tab still loads
  }
}
