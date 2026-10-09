/**
 * AI Design Generation Hook
 * Manages design generation state and logic
 */

import { useState, useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import type { DesignProposal, GenerativeDesignOutput } from '@/types/ai-design';
import type { BudgetType, OptimizationGoal } from '@/types/ai-design-ui';
import { LIMITS } from '@/config/aiDesign.config';
import { saveDesignHistory } from '@/utils/aiDesignStorage';
import {
  generateDesignProposals,
  trackUserBehavior,
} from '@/utils/aiDesignBusinessLogic';

interface GenerationParams {
  selectedRoom: string;
  selectedStyle: string;
  roomWidth: string;
  roomLength: string;
  roomHeight: string;
  budget: BudgetType;
  optimizationGoal: OptimizationGoal;
  prompt?: string;
}

export function useAIDesignGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDesigns, setGeneratedDesigns] = useState<DesignProposal[]>([]);
  const [generationResult, setGenerationResult] = useState<GenerativeDesignOutput | null>(null);
  const [designHistory, setDesignHistory] = useState<DesignProposal[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  const handleGenerate = useCallback(async (
    params: GenerationParams,
    isOffline: boolean,
    retryAttempt: number = 0
  ) => {
    if (isGenerating) return;

    setIsGenerating(true);
    setGeneratedDesigns([]);
    setGenerationResult(null);
    setRetryCount(retryAttempt);

    try {
      const width = parseFloat(params.roomWidth);
      const length = parseFloat(params.roomLength);
      const height = parseFloat(params.roomHeight);

      // Generate new designs (Caching removed to ensure fresh results every time)
      const result = await generateDesignProposals({
        selectedRoom: params.selectedRoom,
        selectedStyle: params.selectedStyle,
        roomWidth: width,
        roomLength: length,
        roomHeight: height,
        budget: params.budget,
        optimizationGoal: params.optimizationGoal,
        prompt: params.prompt,
      });

      // Track preferences; custom ranker training uses rated layout datasets offline.
      await trackUserBehavior(params.selectedRoom, params.selectedStyle, params.budget);

      // Update state
      setGenerationResult(result);
      setGeneratedDesigns(result.proposals);
      setRetryCount(0);

      // Save to history
      const updatedHistory = [...result.proposals, ...designHistory].slice(0, LIMITS.MAX_DESIGNS_HISTORY);
      setDesignHistory(updatedHistory);
      await saveDesignHistory(updatedHistory);

      return result;

    } catch (error: unknown) {
      console.error('❌ Generation error:', error);

      // Retry logic
      if (retryAttempt < LIMITS.MAX_RETRIES && !isOffline) {
        console.log(`⚠️ Retrying... (${retryAttempt + 1}/${LIMITS.MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryAttempt + 1)));
        return handleGenerate(params, isOffline, retryAttempt + 1);
      }

      const errorMessage = error instanceof Error
        ? error.message
        : 'Could not generate design. Please try again.';

      if (isOffline) {
        Alert.alert('Offline Mode', 'Cannot generate designs while offline.');
      } else if (retryAttempt >= LIMITS.MAX_RETRIES) {
        Alert.alert('Generation Failed', `Failed after ${LIMITS.MAX_RETRIES} attempts. ${errorMessage}`);
      } else {
        Alert.alert('Generation Failed', errorMessage);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, designHistory]);

  return useMemo(() => ({
    isGenerating,
    generatedDesigns,
    generationResult,
    designHistory,
    retryCount,
    handleGenerate,
    setDesignHistory,
  }), [
    isGenerating,
    generatedDesigns,
    generationResult,
    designHistory,
    retryCount,
    handleGenerate,
  ]);
}

