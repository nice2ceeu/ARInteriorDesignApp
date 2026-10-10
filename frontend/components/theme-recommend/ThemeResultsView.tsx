import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { RoomType, DesignMood, DesignStyle, DesignTheme } from '@/types/theme-recommendation';
import { ColorPaletteSection } from './ColorPaletteSection';
import { ImageGenerationSection } from './ImageGenerationSection';
import { AlternativeThemesSection } from './AlternativeThemesSection';

interface ThemeResultsViewProps {
  resultsData: {
    topTheme: DesignTheme;
    alternativeThemes: DesignTheme[];
    colorPalette: string[];
    materials: string[];
    decorItems: string[];
    moodScore: number;
    styleScore: number;
    roomScore: number;
    confidenceValue: number;
    [key: string]: any;
  };
  selectedRoom: RoomType | null;
  selectedMood: DesignMood | null;
  selectedStyle: DesignStyle | null;
  comparisonMode: boolean;
  selectedThemesForComparison: string[];
  refreshing: boolean;
  error: string | null;
  learningMessage: string | null;
  showThemeStats: boolean;
  favoriteColors: Set<string>;
  copiedColorFeedback: string | null;
  showColorPaletteActions: boolean;
  generatedImages: Map<string, { imageUrl: string; prompt: string; generatedAt: number }>;
  isGeneratingImage: string | null;
  imageGenerationError: string | null;
  likedThemes: Set<string>;
  onResetSelection: () => void;
  onToggleComparison: () => void;
  onEditStep: (step: 'room' | 'mood' | 'style') => void;
  onRefresh: () => void;
  onToggleStats: () => void;
  onShowPreferenceDashboard: () => void;
  onLikeTheme: (themeId: string) => void;
  onDislikeTheme: (themeId: string) => void;
  onShareTheme: (theme: DesignTheme) => void;
  onApplyTheme: (theme: DesignTheme) => void;
  onSaveToCollection: () => void;
  onExportAll: () => void;
  onColorPress: (color: string) => void;
  onColorLongPress: (color: string, name: string) => void;
  onSharePalette: (colors: string[]) => void;
  onExportPalette: (colors: string[]) => void;
  onGenerateImageWithColor: (theme: DesignTheme, color: string) => void;
  onShowColorHarmony: (colors: string[]) => void;
  onGenerateImage: (theme: DesignTheme) => void;
  onRegenerateImage: (theme: DesignTheme) => void;
  onRetryImage: (theme: DesignTheme) => void;
  onToggleColorPaletteActions: () => void;
  onToggleComparisonForTheme: (themeId: string) => void;
  getColorName: (color: string) => string;
  maxColorSwatches: number;
  isOffline: boolean;
  styles: any;
  roomEmojis: Record<RoomType, string>;
  moodEmojis: Record<DesignMood, string>;
  styleEmojis: Record<DesignStyle, string>;
}

export const ThemeResultsView: React.FC<ThemeResultsViewProps> = ({
  resultsData,
  selectedRoom,
  selectedMood,
  selectedStyle,
  comparisonMode,
  selectedThemesForComparison,
  refreshing,
  error,
  learningMessage,
  showThemeStats,
  favoriteColors,
  copiedColorFeedback,
  showColorPaletteActions,
  generatedImages,
  isGeneratingImage,
  imageGenerationError,
  likedThemes,
  onResetSelection,
  onToggleComparison,
  onEditStep,
  onRefresh,
  onToggleStats,
  onShowPreferenceDashboard,
  onLikeTheme,
  onDislikeTheme,
  onShareTheme,
  onApplyTheme,
  onSaveToCollection,
  onExportAll,
  onColorPress,
  onColorLongPress,
  onSharePalette,
  onExportPalette,
  onGenerateImageWithColor,
  onShowColorHarmony,
  onGenerateImage,
  onRegenerateImage,
  onRetryImage,
  onToggleColorPaletteActions,
  onToggleComparisonForTheme,
  getColorName,
  maxColorSwatches,
  isOffline,
  styles: parentStyles,
  roomEmojis,
  moodEmojis,
  styleEmojis,
}) => {
  const { topTheme, alternativeThemes, colorPalette } = resultsData;

  return (
    <View style={parentStyles.container} accessibilityLabel="Theme recommendations results">
      <StatusBar style="dark" />
      {isOffline && (
        <View style={parentStyles.offlineBanner}>
          <Text style={parentStyles.offlineText}>📥 Offline Mode - Using Cached Data</Text>
        </View>
      )}
      <View style={parentStyles.header}>
        <TouchableOpacity 
          onPress={onResetSelection}
          accessibilityRole="button"
          accessibilityLabel="Start over"
        >
          <Text style={parentStyles.backButton}>← Start Over</Text>
        </TouchableOpacity>
        <Text style={parentStyles.title} accessibilityRole="header">Your Themes</Text>
        <TouchableOpacity
          style={[parentStyles.headerButton, comparisonMode && parentStyles.comparisonButtonActive]}
          onPress={onToggleComparison}
          accessibilityRole="button"
          accessibilityLabel={comparisonMode ? 'Exit comparison mode' : 'Enter comparison mode'}
          accessibilityState={{ selected: comparisonMode }}
        >
          <Text style={parentStyles.headerButtonText}>👑</Text>
        </TouchableOpacity>
      </View>

      {/* Breadcrumb Navigation */}
      <View style={parentStyles.breadcrumbContainer}>
        <TouchableOpacity
          style={parentStyles.breadcrumbItem}
          onPress={() => onEditStep('room')}
          accessibilityRole="button"
          accessibilityLabel="Edit room selection"
        >
          <Text style={parentStyles.breadcrumbText}>Room</Text>
        </TouchableOpacity>
        <Text style={parentStyles.breadcrumbSeparator}>→</Text>
        <TouchableOpacity
          style={parentStyles.breadcrumbItem}
          onPress={() => onEditStep('mood')}
          accessibilityRole="button"
          accessibilityLabel="Edit mood selection"
        >
          <Text style={parentStyles.breadcrumbText}>Mood</Text>
        </TouchableOpacity>
        <Text style={parentStyles.breadcrumbSeparator}>→</Text>
        <TouchableOpacity
          style={parentStyles.breadcrumbItem}
          onPress={() => onEditStep('style')}
          accessibilityRole="button"
          accessibilityLabel="Edit style selection"
        >
          <Text style={parentStyles.breadcrumbText}>Style</Text>
        </TouchableOpacity>
        <Text style={parentStyles.breadcrumbSeparator}>→</Text>
        <Text style={[parentStyles.breadcrumbText, parentStyles.breadcrumbActive]}>Results</Text>
      </View>

      {error && (
        <View style={parentStyles.errorBanner}>
          <Text style={parentStyles.errorText}>{error}</Text>
        </View>
      )}

      <ScrollView 
        showsVerticalScrollIndicator={false} 
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            tintColor="#007AFF"
          />
        }
        accessibilityLabel="Theme recommendations scroll view"
      >
        <View style={parentStyles.content}>
          {/* Learning Message */}
          {!!learningMessage && (
            <View style={parentStyles.learningBanner}>
              <Text style={parentStyles.learningText}>💡 {learningMessage}</Text>
              <TouchableOpacity
                style={parentStyles.preferenceDashboardButton}
                onPress={onShowPreferenceDashboard}
                accessibilityRole="button"
                accessibilityLabel="View preferences dashboard"
              >
                <Text style={parentStyles.preferenceDashboardButtonText}>View</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Top Theme Card */}
          <View style={parentStyles.topThemeCard}>
            <View style={parentStyles.bestBadge}>
              <Text style={parentStyles.bestBadgeText}>⭐ BEST MATCH</Text>
            </View>
            
            <Text style={parentStyles.topThemeTitle}>{topTheme?.name ?? 'Unknown Theme'}</Text>
            <Text style={parentStyles.topThemeDescription}>{topTheme?.description ?? 'No description available.'}</Text>

            {/* Image Generation Section */}
            {topTheme && (
              <ImageGenerationSection
                theme={topTheme}
                generatedImages={generatedImages}
                isGeneratingImage={isGeneratingImage}
                imageGenerationError={imageGenerationError}
                onGenerate={onGenerateImage}
                onRegenerate={onRegenerateImage}
                onRetry={onRetryImage}
                styles={parentStyles}
              />
            )}

            {/* Color Palette Section */}
            <ColorPaletteSection
              colorPalette={colorPalette}
              topTheme={topTheme}
              favoriteColors={favoriteColors}
              copiedColorFeedback={copiedColorFeedback}
              showColorPaletteActions={showColorPaletteActions}
              onToggleActions={onToggleColorPaletteActions}
              onColorPress={onColorPress}
              onColorLongPress={onColorLongPress}
              onSharePalette={onSharePalette}
              onExportPalette={onExportPalette}
              onGenerateImageWithColor={onGenerateImageWithColor}
              onShowColorHarmony={onShowColorHarmony}
              getColorName={getColorName}
              maxColorSwatches={maxColorSwatches}
              styles={parentStyles}
            />

            {/* Action Buttons */}
            <View style={parentStyles.actionButtonsRow}>
              <TouchableOpacity
                style={parentStyles.likeButton}
                onPress={() => topTheme?.id && onLikeTheme(topTheme.id)}
                accessibilityRole="button"
                accessibilityLabel={likedThemes.has(topTheme?.id || '') ? 'Unlike this theme' : 'Like this theme'}
                accessibilityState={{ selected: likedThemes.has(topTheme?.id || '') }}
              >
                <Text style={parentStyles.likeButtonText}>❤️ Like</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={parentStyles.shareButton}
                onPress={() => topTheme?.id && onDislikeTheme(topTheme.id)}
                accessibilityRole="button"
                accessibilityLabel="Dislike this theme"
              >
                <Text style={parentStyles.shareButtonText}>👎 Dislike</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={parentStyles.shareButton}
                onPress={onSaveToCollection}
                accessibilityRole="button"
                accessibilityLabel="Save to collection"
              >
                <Text style={parentStyles.shareButtonText}>📁 Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={parentStyles.shareButton}
                onPress={() => topTheme && onShareTheme(topTheme)}
                accessibilityRole="button"
                accessibilityLabel="Share this theme"
              >
                <Text style={parentStyles.shareButtonText}>📤 Share</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={parentStyles.applyButton}
              onPress={() => topTheme && onApplyTheme(topTheme)}
              accessibilityRole="button"
              accessibilityLabel="Apply this theme to design builder"
            >
              <Text style={parentStyles.applyButtonText}>✨ Apply This Theme</Text>
            </TouchableOpacity>
          </View>

          {/* Alternative Themes Section */}
          <AlternativeThemesSection
            alternativeThemes={alternativeThemes}
            comparisonMode={comparisonMode}
            selectedThemesForComparison={selectedThemesForComparison}
            onThemePress={onApplyTheme}
            onToggleComparison={onToggleComparisonForTheme}
            onApplyTheme={onApplyTheme}
            styles={parentStyles}
            itemHeight={150}
          />
        </View>
      </ScrollView>
    </View>
  );
};


