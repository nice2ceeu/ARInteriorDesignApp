/**
 * Generative AI Design Service
 * 
 * REFACTORED: Now calls backend API for design generation
 * Backend logic moved to: backend/src/controllers/aiDesignController.js
 */

import { callApi } from './apiClient';
import type {
  DesignPreferences,
  DesignConstraints,
  FurnitureItem,
  GenerativeDesignOutput,
  SimulationOptions,
} from '@/types/ai-design';

/**
 * Generative AI Design Service
 * Client for backend AI design API
 */
export class GenerativeAIDesignService {
  /**
   * Generate AI design proposals via backend API
   */
  async generateDesignProposals(
    preferences: DesignPreferences,
    constraints: DesignConstraints,
    options: SimulationOptions
  ): Promise<GenerativeDesignOutput> {
    console.log('🎨 [GenerativeAIDesign] Requesting design from backend API...');

    try {
      const response = await callApi<GenerativeDesignOutput>('/designs/generate', {
        method: 'POST',
        body: {
          roomType: preferences.roomType,
          dimensions: preferences.dimensions,
          designStyle: preferences.designStyle,
          budget: preferences.aestheticPreferences?.budget,
          userPrompt: preferences.userPrompt,
          optimizationGoal: options.optimizationGoal,
          constraints,
          requiredFurniture: preferences.requiredFurniture,
          budgetPHP: preferences.budgetPHP,
        },
      });

      console.log('✅ [GenerativeAIDesign] Received design from backend');
      return response;

    } catch (error: any) {
      console.warn('[GenerativeAIDesign] Design generation failed:', error);
      
      // Invalid or unaffordable layouts must not be replaced with fabricated designs.
      throw error;
    }
  }

  /**
   * Get furniture catalog for a room type
   */
  async getFurnitureCatalog(roomType: string): Promise<{
    roomType: string;
    furniture: FurnitureItem[];
    total: number;
  }> {
    try {
      const response = await callApi<{
        roomType: string;
        furniture: FurnitureItem[];
        total: number;
      }>(`/designs/furniture/${encodeURIComponent(roomType)}`, {
        method: 'GET',
      });
      return response;
    } catch (error) {
      console.warn('[GenerativeAIDesign] Failed to fetch furniture catalog:', error);
      return {
        roomType,
        furniture: [],
        total: 0,
      };
    }
  }

  /**
   * Estimate cost for furniture list
   */
  async estimateCost(
    furniture: FurnitureItem[],
    budget: string = 'medium'
  ): Promise<{ low: number; high: number; average: number }> {
    try {
      const response = await callApi<{ low: number; high: number; average: number }>(
        '/designs/estimate-cost',
        {
          method: 'POST',
          body: { furniture, budget },
        }
      );
      return response;
    } catch (error) {
      console.warn('[GenerativeAIDesign] Failed to estimate cost:', error);
      throw error;
    }
  }

}

export const generativeAIDesignService = new GenerativeAIDesignService();
