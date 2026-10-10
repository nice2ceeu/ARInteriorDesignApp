/**
 * useLayout3DActions Hook
 * Manages actions like export, save, finalize, and share for 3D layout
 */

import { useState, useCallback } from 'react';
import { Alert, Share } from 'react-native';
import { useRouter } from 'expo-router';
import * as THREE from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import type { RoomDimensions, ExportFormat } from '@/types/layout-3d';
import type { DesignProposal } from '@/types/ai-design';
import { exportLayout, shareExportedFile, generateShareText, calculateArea } from '@/utils/layout3dExport';
import { saveProject, finalizeDesign } from '@/utils/layout3dStorage';

interface UseLayout3DActionsProps {
  design: DesignProposal | null;
  roomDimensions: RoomDimensions;
  roomGroupRef?: React.MutableRefObject<THREE.Group | null>;
  furnitureGroupRef?: React.MutableRefObject<THREE.Group | null>;
  glRef?: React.MutableRefObject<ExpoWebGLRenderingContext | null>;
}

interface UseLayout3DActionsReturn {
  // State
  loading: boolean;
  isSaving: boolean;
  isFinalizing: boolean;
  error: string | null;
  // Functions
  handleExport: (format: string) => Promise<void>;
  handleShare: () => Promise<void>;
  handleSaveProject: () => Promise<void>;
  handleFinalizeDesign: () => void;
  clearError: () => void;
}

export function useLayout3DActions({
  design,
  roomDimensions,
  roomGroupRef,
  furnitureGroupRef,
  glRef,
}: UseLayout3DActionsProps): UseLayout3DActionsReturn {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Export handler
  const handleExport = useCallback(async (format: string) => {
    setLoading(true);
    setError(null);

    try {
      if (!design) {
        Alert.alert('No Design', 'Please select a design first');
        return;
      }

      const uri = await exportLayout(
        format as ExportFormat,
        design,
        roomDimensions,
        roomGroupRef?.current,
        furnitureGroupRef?.current,
        glRef?.current
      );

      await shareExportedFile(uri, format, design.title);
    } catch (err) {
      console.error('Export error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unable to export design. Please try again.';
      setError(errorMessage);
      Alert.alert('Export Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  }, [design, roomDimensions, roomGroupRef, furnitureGroupRef, glRef]);

  // Share handler
  const handleShare = useCallback(async () => {
    if (!design) {
      Alert.alert('No Design', 'Please select a design first');
      return;
    }

    const shareText = generateShareText(design, roomDimensions);
    await Share.share({
      message: shareText,
      title: design.title,
    });
  }, [design, roomDimensions]);

  // Save project handler
  const handleSaveProject = useCallback(async () => {
    if (!design) {
      Alert.alert('No Design', 'Please select a design first');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await saveProject(design, roomDimensions);
      Alert.alert('Success!', 'Project saved successfully', [
        { text: 'OK', style: 'default' }
      ]);
    } catch (err) {
      console.error('Save error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unable to save project.';
      setError(errorMessage);
      Alert.alert('Save Failed', errorMessage);
    } finally {
      setIsSaving(false);
    }
  }, [design, roomDimensions]);

  // Finalize design handler
  const handleFinalizeDesign = useCallback(() => {
    if (!design) {
      Alert.alert('No Design', 'Please select a design first');
      return;
    }

    Alert.alert(
      'Finalize Design',
      'Are you sure you want to finalize this design? This will mark it as complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize',
          style: 'destructive',
          onPress: async () => {
            setIsFinalizing(true);
            setError(null);

            try {
              await finalizeDesign(design, roomDimensions);
              Alert.alert('Success!', 'Design finalized successfully', [
                {
                  text: 'OK',
                  onPress: () => {
                    router.replace('/(tabs)');
                  },
                },
              ]);
            } catch (err) {
              console.error('Finalize error:', err);
              const errorMessage = err instanceof Error ? err.message : 'Unable to finalize design.';
              setError(errorMessage);
              Alert.alert('Finalize Failed', errorMessage);
            } finally {
              setIsFinalizing(false);
            }
          },
        },
      ]
    );
  }, [design, roomDimensions, router]);

  return {
    loading,
    isSaving,
    isFinalizing,
    error,
    handleExport,
    handleShare,
    handleSaveProject,
    handleFinalizeDesign,
    clearError,
  };
}

