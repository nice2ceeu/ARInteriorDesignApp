import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/ui/Text';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/contexts/ThemeContext';
import { spacing, radii } from '@/components/ui/theme';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { savedItemsService, type SavedItem } from '@/services/SavedItemsService';
import { AnimatedButton, AnimatedCard, FadeInView, SlideInView, ScaleInView } from '@/components/interactive';
import { getHorizontalPadding, isSmallScreen } from '@/utils/responsive';

// Helper function to convert hex color to rgba with opacity
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export default function SavedScreen() {
  const { colors, statusBarStyle } = useTheme();
  const router = useRouter();
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const toggleMultiSelect = () => {
    setMultiSelectMode(!multiSelectMode);
    setSelectedItems(new Set()); // Clear selection when toggling mode
  };

  const toggleItemSelection = (itemId: string) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedItems(newSelection);
  };

  const selectAll = () => {
    setSelectedItems(new Set(savedItems.map(item => item.id)));
  };

  const deselectAll = () => {
    setSelectedItems(new Set());
  };

  // Load saved items when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      const initializeAndLoad = async () => {
        try {
          // Clear sample items seeded by earlier versions
          const { removeSampleSavedItems } = await import('@/utils/initializeSavedItems');
          await removeSampleSavedItems();
        } catch (error) {
          console.warn('[SavedScreen] Failed to remove sample items:', error);
        }
        // Load saved items
        await loadSavedItems();
      };

      initializeAndLoad();
    }, [])
  );

  const loadSavedItems = async () => {
    try {
      setIsLoading(true);
      const items = await savedItemsService.getSavedItems();
      setSavedItems(items);
    } catch (error) {
      console.error('[SavedScreen] Failed to load saved items:', error);
      Alert.alert('Error', 'Failed to load saved items. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedItems.size === 0) return;
    
    Alert.alert(
      'Delete Items',
      `Are you sure you want to delete ${selectedItems.size} item(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const idsToDelete = Array.from(selectedItems);
              const deletedCount = await savedItemsService.removeSavedItems(idsToDelete);
              
              if (deletedCount > 0) {
                // Reload items
                await loadSavedItems();
                setSelectedItems(new Set());
                
                if (selectedItems.size === savedItems.length) {
                  setMultiSelectMode(false);
                }
              }
            } catch (error) {
              console.error('[SavedScreen] Failed to delete items:', error);
              Alert.alert('Error', 'Failed to delete items. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleItemPress = (item: SavedItem) => {
    if (multiSelectMode) {
      toggleItemSelection(item.id);
    } else {
      // Navigate to item details based on type
      if (item.metadata?.source === 'layout-3d' && item.metadata.design) {
        router.push({
          pathname: '/layout-3d',
          params: {
            designData: JSON.stringify(item.metadata.design),
            roomDimensions: JSON.stringify(item.metadata.roomDimensions),
          },
        });
      } else if (item.type === 'project') {
        router.push(`/create-project?id=${item.id}`);
      } else if (item.type === 'design') {
        router.push(`/ai-design?id=${item.id}`);
      } else if (item.type === 'theme') {
        router.push(`/explore?id=${item.id}`);
      } else {
        // For furniture items, could navigate to a detail screen
        // For now, show an alert
        Alert.alert(item.name, item.description || `Price: ${item.price || 'N/A'}`);
      }
    }
  };

  const handleUnsaveItem = async (itemId: string) => {
    Alert.alert(
      'Remove Item',
      'Are you sure you want to remove this item from your saved items?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await savedItemsService.removeSavedItem(itemId);
              if (success) {
                await loadSavedItems();
              }
            } catch (error) {
              console.error('[SavedScreen] Failed to unsave item:', error);
              Alert.alert('Error', 'Failed to remove item. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.surfaceSecondary }]} edges={['top']}>
        <Screen 
          contentContainerStyle={[
            styles.screenContent,
            { paddingTop: spacing.md }
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <AppText variant="h1" style={[styles.title, { color: colors.textPrimary }]}>
                Saved Items
              </AppText>
              <AnimatedButton
                style={styles.actionButton}
                onPress={toggleMultiSelect}
                hapticType="light"
              >
                <AppText variant="body" style={{ color: colors.accent }}>
                  {multiSelectMode ? 'Cancel' : 'Select'}
                </AppText>
              </AnimatedButton>
            </View>
            
            {multiSelectMode && (
              <View style={[styles.multiSelectToolbar, { borderBottomColor: colors.border }]}>
                <AppText variant="body" style={[styles.selectionCount, { color: colors.textSecondary }]}>
                  {selectedItems.size} {selectedItems.size === 1 ? 'item' : 'items'} selected
                </AppText>
                
                <View style={styles.bulkActions}>
                  {selectedItems.size > 0 && (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={deselectAll}
                      activeOpacity={0.7}
                    >
                      <AppText variant="body" style={{ color: colors.accent }}>
                        Deselect All
                      </AppText>
                    </TouchableOpacity>
                  )}
                  {selectedItems.size < savedItems.length && (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={selectAll}
                      activeOpacity={0.7}
                    >
                      <AppText variant="body" style={{ color: colors.accent }}>
                        Select All
                      </AppText>
                    </TouchableOpacity>
                  )}
                  {selectedItems.size > 0 && (
                    <AnimatedButton
                      style={[styles.actionButton, styles.deleteButton]}
                      onPress={handleDeleteSelected}
                      hapticType="warning"
                    >
                      <Ionicons name="trash-outline" size={22} color="#EF4444" />
                    </AnimatedButton>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Saved Items List */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <AppText variant="body" style={[styles.loadingText, { color: colors.textSecondary }]}>
                Loading saved items...
              </AppText>
            </View>
          ) : savedItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="bookmark-outline" size={64} color={colors.textMuted} />
              <AppText variant="subtitle" weight="600" style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                No Saved Items
              </AppText>
              <AppText variant="body" style={[styles.emptyText, { color: colors.textSecondary }]}>
                Items you save will appear here
              </AppText>
            </View>
          ) : (
            <View style={styles.itemsList}>
              {savedItems.map((item) => {
                const isSelected = selectedItems.has(item.id);
                const iconName = (item.iconName as keyof typeof Ionicons.glyphMap) || 'cube-outline';
                const iconColor = item.iconColor || colors.accent;
                return (
                  <SlideInView key={item.id} direction="right" delay={savedItems.indexOf(item) * 50}>
                    <AnimatedCard
                      style={[
                        styles.savedCard, 
                        { 
                          backgroundColor: colors.surfacePrimary, 
                          borderColor: isSelected ? colors.accent : colors.border,
                          borderWidth: isSelected ? 2 : 1,
                        }
                      ]} 
                      onPress={() => handleItemPress(item)}
                      hapticFeedback={true}
                    >
                    {multiSelectMode && (
                      <View style={[
                        styles.checkbox,
                        { 
                          backgroundColor: isSelected ? colors.accent : 'transparent',
                          borderColor: isSelected ? colors.accent : colors.border,
                        }
                      ]}>
                        {isSelected && (
                          <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                        )}
                      </View>
                    )}
                    <View style={[styles.itemIconContainer, { backgroundColor: hexToRgba(iconColor, 0.15) }]}>
                      {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={{ width: '100%', height: '100%', borderRadius: radii.md }} resizeMode="cover" />
                      ) : (
                        <Ionicons name={iconName} size={28} color={iconColor} />
                      )}
                    </View>
                    <View style={styles.itemInfo}>
                      <AppText variant="subtitle" weight="600" style={[styles.itemName, { color: colors.textPrimary }]}>
                        {item.name}
                      </AppText>
                      {item.price && (
                        <AppText variant="body" style={[styles.itemPrice, { color: colors.accent }]}>
                          {item.price}
                        </AppText>
                      )}
                      {item.description && (
                        <AppText variant="caption" color="textMuted" numberOfLines={1}>
                          {item.description}
                        </AppText>
                      )}
                    </View>
                    {!multiSelectMode && (
                      <AnimatedButton 
                        style={styles.heartButton} 
                        onPress={() => handleUnsaveItem(item.id)}
                        hapticType="light"
                      >
                        <Ionicons name="heart" size={22} color="#EC4899" />
                      </AnimatedButton>
                    )}
                    </AnimatedCard>
                  </SlideInView>
                );
              })}
            </View>
          )}
        </Screen>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  screenContent: {
    paddingHorizontal: getHorizontalPadding(spacing.xl),
    paddingBottom: spacing.xxl * 2.5,
    gap: isSmallScreen ? spacing.lg : spacing.xxl,
  },
  header: {
    marginBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
  },
  multiSelectToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bulkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  deleteButton: {
    padding: spacing.xs,
  },
  selectionCount: {
    fontSize: 14,
  },
  itemsList: {
    gap: spacing.md,
  },
  savedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIconContainer: {
    width: 64,
    height: 64,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  itemName: {
    marginBottom: spacing.xs - 2,
  },
  itemPrice: {
    fontWeight: '700',
  },
  heartButton: {
    padding: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl * 2,
  },
  loadingText: {
    marginTop: spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl * 2,
  },
  emptyTitle: {
    marginTop: spacing.md,
  },
  emptyText: {
    textAlign: 'center',
    paddingHorizontal: getHorizontalPadding(spacing.xl),
  },
});
