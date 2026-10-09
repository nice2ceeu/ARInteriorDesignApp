/**
 * useThemeCollections Hook
 * Manages theme collections (mood boards)
 */

import { useState, useCallback, useEffect } from 'react';
import { Alert, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { DesignTheme, ThemeCollection } from '@/types/theme-recommendation';
import { STORAGE_KEYS, ERROR_MESSAGES } from '@/config/themeRecommend.config';
import { generateCollectionHTML, showErrorAlert } from '@/utils/themeRecommendHelpers';

interface UseThemeCollectionsReturn {
  collections: ThemeCollection[];
  showCollectionsModal: boolean;
  showCreateCollectionModal: boolean;
  newCollectionName: string;
  newCollectionDescription: string;
  isSavingCollection: boolean;
  setShowCollectionsModal: (show: boolean) => void;
  setShowCreateCollectionModal: (show: boolean) => void;
  setNewCollectionName: (name: string) => void;
  setNewCollectionDescription: (desc: string) => void;
  createCollection: () => Promise<void>;
  addThemeToCollection: (theme: DesignTheme, collectionId: string) => void;
  removeThemeFromCollection: (themeId: string, collectionId: string) => void;
  deleteCollection: (collectionId: string) => void;
  exportCollectionAsPDF: (collection: ThemeCollection) => Promise<void>;
}

export function useThemeCollections(): UseThemeCollectionsReturn {
  const [collections, setCollections] = useState<ThemeCollection[]>([]);
  const [showCollectionsModal, setShowCollectionsModal] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [isSavingCollection, setIsSavingCollection] = useState(false);

  // Load collections on mount
  useEffect(() => {
    const loadCollections = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEYS.COLLECTIONS);
        if (stored) {
          const parsed = JSON.parse(stored) as ThemeCollection[];
          if (Array.isArray(parsed)) {
            setCollections(parsed);
          }
        }
      } catch (error) {
        console.error('[ThemeRecommend] Failed to load collections:', error);
      }
    };
    void loadCollections();
  }, []);

  // Save collections when they change
  useEffect(() => {
    if (collections.length > 0 || showCollectionsModal) {
      const saveCollections = async () => {
        try {
          await AsyncStorage.setItem(STORAGE_KEYS.COLLECTIONS, JSON.stringify(collections));
        } catch (error) {
          console.error('[ThemeRecommend] Failed to save collections:', error);
        }
      };
      void saveCollections();
    }
  }, [collections, showCollectionsModal]);

  // Create collection
  const createCollection = useCallback(async () => {
    if (!newCollectionName.trim()) {
      Alert.alert('Error', ERROR_MESSAGES.INVALID_COLLECTION_NAME);
      return;
    }

    setIsSavingCollection(true);
    try {
      const newCollection: ThemeCollection = {
        id: `collection_${Date.now()}`,
        name: newCollectionName.trim(),
        description: newCollectionDescription.trim() || undefined,
        themes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setCollections(prev => [...prev, newCollection]);
      setNewCollectionName('');
      setNewCollectionDescription('');
      setShowCreateCollectionModal(false);
      Alert.alert('Success', `Collection "${newCollection.name}" created!`);
    } catch (error) {
      showErrorAlert(error, 'Failed to create collection', ERROR_MESSAGES.SAVE_ERROR);
    } finally {
      setIsSavingCollection(false);
    }
  }, [newCollectionName, newCollectionDescription]);

  // Add theme to collection
  const addThemeToCollection = useCallback((theme: DesignTheme, collectionId: string) => {
    setCollections(prev => prev.map(collection => {
      if (collection.id === collectionId) {
        if (collection.themes.some(t => t?.id === theme?.id)) {
          Alert.alert('Already Added', 'This theme is already in the collection');
          return collection;
        }
        return {
          ...collection,
          themes: [...collection.themes, theme],
          updatedAt: Date.now(),
        };
      }
      return collection;
    }));
    Alert.alert('Success', 'Theme added to collection!');
  }, []);

  // Remove theme from collection
  const removeThemeFromCollection = useCallback((themeId: string, collectionId: string) => {
    setCollections(prev => prev.map(collection => {
      if (collection.id === collectionId) {
        return {
          ...collection,
          themes: collection.themes.filter(t => t.id !== themeId),
          updatedAt: Date.now(),
        };
      }
      return collection;
    }));
  }, []);

  // Delete collection
  const deleteCollection = useCallback((collectionId: string) => {
    Alert.alert(
      'Delete Collection',
      'Are you sure you want to delete this collection?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setCollections(prev => prev.filter(c => c.id !== collectionId));
            Alert.alert('Success', 'Collection deleted');
          },
        },
      ]
    );
  }, []);

  // Export collection as PDF/HTML
  const exportCollectionAsPDF = useCallback(async (collection: ThemeCollection) => {
    try {
      const htmlContent = generateCollectionHTML(collection);
      const filename = `${collection.name.replace(/[^a-z0-9\-]+/gi, '_')}_collection.html`;
      const documentDir = FileSystem.documentDirectory;
      
      if (!documentDir) {
        throw new Error('Document directory not available');
      }
      
      const uri = documentDir + filename;
      await FileSystem.writeAsStringAsync(uri, htmlContent);

      Alert.alert(
        'Collection Exported',
        'Your collection has been exported as HTML. You can print it to PDF or share it.',
        [
          {
            text: 'Share',
            onPress: () => Share.share({
              url: uri,
              title: `${collection.name} - Theme Collection`,
              message: `Check out my theme collection: ${collection.name}`,
            }),
          },
          { text: 'OK' },
        ]
      );
    } catch (error) {
      console.error('[ThemeRecommend] PDF export error:', error);
      Alert.alert('Export Failed', 'Unable to export collection. Please try again.');
    }
  }, []);

  return {
    collections,
    showCollectionsModal,
    showCreateCollectionModal,
    newCollectionName,
    newCollectionDescription,
    isSavingCollection,
    setShowCollectionsModal,
    setShowCreateCollectionModal,
    setNewCollectionName,
    setNewCollectionDescription,
    createCollection,
    addThemeToCollection,
    removeThemeFromCollection,
    deleteCollection,
    exportCollectionAsPDF,
  };
}

