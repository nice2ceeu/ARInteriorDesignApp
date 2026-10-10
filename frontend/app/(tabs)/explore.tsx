import { View, StyleSheet, TouchableOpacity, TextInput, ScrollView, Image, ActivityIndicator, FlatList, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/ui/Text';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/contexts/ThemeContext';
import { spacing, radii } from '@/components/ui/theme';
import { useRouter, useFocusEffect } from 'expo-router';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { AnimatedCard, FadeInView, SlideInView, AnimatedButton } from '@/components/interactive';
import { usePexelsSearch, type PexelsPhoto } from '@/hooks/usePexelsSearch';
import { getHorizontalPadding, isSmallScreen } from '@/utils/responsive';
import { savedItemsService } from '@/services/SavedItemsService';
import { DESIGN_STYLES, STYLE_ICONS } from '@/constants/design';

// Helper function to convert hex color to rgba with opacity
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type Category = {
  id: string;
  name: string;
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  count: string;
  route?: string;
};

// Main categories (with navigation routes)
const mainCategories: Category[] = [
  { id: 'furniture', name: 'Furniture', iconName: 'bed-outline', iconColor: '#6366F1', count: '500+ items', route: '/explore/furniture' },
  { id: 'decor', name: 'Decor', iconName: 'color-palette-outline', iconColor: '#8B5CF6', count: '300+ items', route: '/explore/decor' },
  { id: 'lighting', name: 'Lighting', iconName: 'bulb-outline', iconColor: '#F59E0B', count: '200+ items', route: '/explore/lighting' },
];

// Quick search categories (randomized, no navigation)
const STYLE_COLORS = ['#10B981', '#6366F1', '#3B82F6', '#06B6D4', '#78716C', '#EC4899', '#92400E', '#16A34A', '#F59E0B', '#EF4444'];
const quickSearchCategories: Category[] = DESIGN_STYLES.map((style, index) => ({
  id: style.toLowerCase(), name: style, iconName: STYLE_ICONS[style] as Category['iconName'], iconColor: STYLE_COLORS[index % STYLE_COLORS.length], count: 'Designs',
}));

// Helper function to shuffle array (Fisher-Yates shuffle)
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HORIZONTAL_PADDING = getHorizontalPadding(spacing.xl);
const IMAGE_SIZE = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - spacing.md) / 2;

export default function ExploreScreen() {
  const { colors, statusBarStyle } = useTheme();
  const router = useRouter();
  const pexelsSearch = usePexelsSearch();

  const [savedItemIds, setSavedItemIds] = useState<Set<string>>(new Set());

  // Load saved items to initialize heart icons
  useFocusEffect(
    useCallback(() => {
      const loadSaved = async () => {
        const items = await savedItemsService.getSavedItemsByType('design');
        setSavedItemIds(new Set(items.map(i => i.id)));
      };
      loadSaved();
    }, [])
  );

  const toggleSave = async (photo: PexelsPhoto) => {
    const idStr = photo.id.toString();
    const isSaved = savedItemIds.has(idStr);
    
    if (isSaved) {
      await savedItemsService.removeSavedItem(idStr);
      setSavedItemIds(prev => {
        const next = new Set(prev);
        next.delete(idStr);
        return next;
      });
    } else {
      await savedItemsService.saveItem({
        id: idStr,
        name: `Design by ${photo.photographer}`,
        type: 'design',
        iconName: 'image-outline',
        iconColor: '#EC4899',
        imageUrl: photo.src.large || photo.src.medium,
        description: pexelsSearch.searchQuery || 'Interior Design',
      });
      setSavedItemIds(prev => {
        const next = new Set(prev);
        next.add(idStr);
        return next;
      });
    }
  };

  // Randomize quick search categories on component mount
  // This gives a different selection each time user visits Explore
  const randomizedQuickSearch = useMemo(() => {
    return shuffleArray(quickSearchCategories).slice(0, 6); // Show 6 random categories
  }, []); // Only randomize once on mount

  const handleCategoryPress = async (category: Category) => {
    // If category has a route (Furniture, Decor, Lighting), navigate to detail page
    if (category.route) {
      router.push({
        pathname: '/explore/[category]' as any,
        params: { category: category.id },
      });
      return;
    }
    
    // For quick search buttons, search for images
    // Don't navigate away - stay on Explore screen and show results
    const searchQuery = `${category.name} interior design`;
    await pexelsSearch.searchPhotos(searchQuery);
  };

  const handleSearch = async () => {
    if (pexelsSearch.searchQuery.trim()) {
      await pexelsSearch.searchPhotos(pexelsSearch.searchQuery);
    }
  };

  const renderPhoto = ({ item }: { item: PexelsPhoto }) => {
    const isSaved = savedItemIds.has(item.id.toString());
    return (
      <View style={styles.photoContainer}>
        <Image
          source={{ uri: item.src.large || item.src.medium }}
          style={styles.photo}
          resizeMode="cover"
        />
        <View style={styles.photoOverlay}>
          <AppText variant="caption" style={styles.photoAttribution}>
            Photo by {item.photographer}
          </AppText>
        </View>
        <TouchableOpacity 
          style={styles.saveButton} 
          onPress={() => toggleSave(item)}
        >
          <Ionicons name={isSaved ? "heart" : "heart-outline"} size={20} color={isSaved ? "#EC4899" : "#FFFFFF"} />
        </TouchableOpacity>
      </View>
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
            <AppText variant="h1" style={[styles.title, { color: colors.textPrimary }]}>
              Explore Designs
            </AppText>
            <AppText variant="caption" color="textMuted" style={styles.subtitle}>
              Search for interior design inspiration
            </AppText>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={[styles.searchBar, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search designs (e.g., modern living room, cozy bedroom...)"
                placeholderTextColor={colors.textMuted}
                value={pexelsSearch.searchQuery}
                onChangeText={pexelsSearch.setSearchQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
              />
              {pexelsSearch.searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    pexelsSearch.setSearchQuery('');
                    pexelsSearch.clearResults();
                  }}
                  style={styles.clearButton}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <AnimatedButton
              style={[styles.searchButton, { backgroundColor: colors.accent }]}
              onPress={handleSearch}
              disabled={pexelsSearch.isLoading || !pexelsSearch.searchQuery.trim()}
              hapticType="medium"
            >
              {pexelsSearch.isLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="search" size={20} color="#FFFFFF" />
              )}
            </AnimatedButton>
          </View>

          {/* Quick Search Buttons */}
          <View style={styles.sectionContainer}>
            <AppText variant="subtitle" weight="700" style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Quick Search
            </AppText>
            
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickSearchContainer}
            >
              {randomizedQuickSearch.map((category, idx) => (
                <SlideInView key={category.id} direction="right" delay={idx * 50}>
                  <AnimatedButton
                    style={[
                      styles.quickSearchButton,
                      { backgroundColor: colors.surfacePrimary, borderColor: colors.border }
                    ]}
                    onPress={() => handleCategoryPress(category)}
                    disabled={pexelsSearch.isLoading}
                    hapticType="light"
                  >
                    <View style={[styles.quickSearchIconContainer, { backgroundColor: hexToRgba(category.iconColor, 0.15) }]}>
                      <Ionicons name={category.iconName} size={24} color={category.iconColor} />
                    </View>
                    <AppText variant="caption" weight="600" style={[styles.quickSearchText, { color: colors.textPrimary }]}>
                      {category.name}
                    </AppText>
                  </AnimatedButton>
                </SlideInView>
              ))}
            </ScrollView>
          </View>

          {/* Search Results */}
          {pexelsSearch.error && (
            <View style={[styles.errorContainer, { backgroundColor: colors.danger + '20' }]}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <View style={styles.errorContent}>
                <AppText variant="caption" weight="600" style={[styles.errorText, { color: colors.danger }]}>
                  {pexelsSearch.error.includes('not available') || pexelsSearch.error.includes('timed out')
                    ? 'Backend Server Not Available'
                    : 'Search Error'}
                </AppText>
                <AppText variant="caption" style={[styles.errorText, { color: colors.danger, marginTop: spacing.xs }]}>
                  {pexelsSearch.error.includes('not available') || pexelsSearch.error.includes('timed out')
                    ? 'Please make sure the backend server is running on port 3000. Run "npm start" in the backend folder.'
                    : pexelsSearch.error}
                </AppText>
              </View>
            </View>
          )}

          {pexelsSearch.photos.length > 0 && (
            <View style={styles.resultsContainer}>
              <View style={styles.resultsHeader}>
                <AppText variant="subtitle" weight="700" style={[styles.resultsTitle, { color: colors.textPrimary }]}>
                  Search Results
                </AppText>
                <TouchableOpacity onPress={pexelsSearch.clearResults}>
                  <AppText variant="caption" style={{ color: colors.accent }}>
                    Clear
                  </AppText>
                </TouchableOpacity>
              </View>
              
              <FlatList
                data={pexelsSearch.photos}
                renderItem={renderPhoto}
                keyExtractor={(item) => item.id.toString()}
                numColumns={2}
                columnWrapperStyle={styles.photoRow}
                scrollEnabled={false}
                contentContainerStyle={styles.photosGrid}
              />
            </View>
          )}

          {/* Loading State */}
          {pexelsSearch.isLoading && pexelsSearch.photos.length === 0 && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <AppText variant="caption" color="textMuted" style={styles.loadingText}>
                Searching for images...
              </AppText>
            </View>
          )}

          {/* Empty State */}
          {!pexelsSearch.isLoading && pexelsSearch.photos.length === 0 && !pexelsSearch.error && (
            <View style={styles.emptyContainer}>
              <Ionicons name="image-outline" size={48} color={colors.textMuted} />
              <AppText variant="subtitle" style={[styles.emptyText, { color: colors.textMuted }]}>
                Search for design inspiration
              </AppText>
              <AppText variant="caption" color="textMuted" style={styles.emptySubtext}>
                Try searching for "modern living room" or tap a quick search button above
              </AppText>
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
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: spacing.xxl * 2.5, // Extra space for tab bar
    gap: isSmallScreen ? spacing.lg : spacing.xxl,
  },
  header: {
    marginBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  title: {
    marginBottom: spacing.xs,
  },
  sectionContainer: {
    gap: spacing.lg,
  },
  sectionTitle: {
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  categoriesList: {
    gap: spacing.md,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    gap: spacing.md,
  },
  categoryIconContainer: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  categoryName: {
    marginBottom: spacing.xs - 2,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  searchContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: spacing.sm,
    padding: spacing.xs,
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSearchContainer: {
    gap: spacing.md,
    paddingRight: spacing.xl,
  },
  quickSearchButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    minWidth: 100,
    gap: spacing.xs,
  },
  quickSearchIconContainer: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSearchText: {
    marginTop: spacing.xs,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.lg,
  },
  errorContent: {
    flex: 1,
  },
  errorText: {
    lineHeight: 20,
  },
  resultsContainer: {
    marginTop: spacing.lg,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  resultsTitle: {
    fontSize: 18,
  },
  photosGrid: {
    gap: spacing.md,
  },
  photoRow: {
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  photoContainer: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: radii.md,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  photoAttribution: {
    color: '#FFFFFF',
    fontSize: 10,
  },
  saveButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 20,
    padding: spacing.xs + 2,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.md,
  },
  loadingText: {
    marginTop: spacing.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.md,
  },
  emptyText: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptySubtext: {
    textAlign: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
  },
});
