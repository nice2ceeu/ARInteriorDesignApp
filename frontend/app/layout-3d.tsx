/**
 * Layout 3D Screen
 * 3D visualization and export of room layouts
 * Refactored to use modular hooks and utilities
 */

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect } from 'react';
import { GLView } from 'expo-gl';
import { Ionicons } from '@expo/vector-icons';
import type { DesignProposal } from '@/types/ai-design';
import type { RoomDimensions, ViewMode } from '@/types/layout-3d';
import { Unity3DViewer } from '@/components/Unity3DViewer';
import { AnimatedButton, AnimatedCard, FadeInView, SlideInView, ScaleInView } from '@/components/interactive';

// Configuration
import { EXPORT_OPTIONS, DEFAULT_ROOM_DIMENSIONS } from '@/config/layout3d.config';

// Hooks
import { useLayout3DScene } from '@/hooks/useLayout3DScene';
import { useLayout3DActions } from '@/hooks/useLayout3DActions';

// Utilities
import { parseDesignFromParams } from '@/utils/layout3dStorage';
import { calculateArea } from '@/utils/layout3dExport';

// Theme
import { useTheme } from '@/contexts/ThemeContext';

// Overlay text on the 3D viewer, whose background is always dark
const VIEWER_TEXT = '#E5E7EB';

export default function Layout3DScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, statusBarStyle, isDark } = useTheme();
  
  // Debug: Log theme state and force light if needed
  useEffect(() => {
    console.log('[Layout3D] Theme:', isDark ? 'DARK' : 'LIGHT', 'Background:', colors.background);
    // If it's dark but user wants light, log a warning
    if (isDark && colors.background === '#111113') {
      console.warn('[Layout3D] WARNING: Dark mode is active. Background color:', colors.background);
    }
  }, [isDark, colors.background]);
  
  // Core state
  const [design, setDesign] = useState<DesignProposal | null>(null);
  const [roomDimensions, setRoomDimensions] = useState<RoomDimensions>(DEFAULT_ROOM_DIMENSIONS);
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');
  const [showGrid, setShowGrid] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [useUnity, setUseUnity] = useState(false);
  
  const unityBuildUrl = process.env.EXPO_PUBLIC_UNITY_BUILD_URL;

  // Initialize scene hook
  const scene = useLayout3DScene({
    roomDimensions,
    design,
    viewMode,
    showGrid,
    showMeasurements,
  });

  // Initialize actions hook
  const actions = useLayout3DActions({
    design,
    roomDimensions,
    roomGroupRef: scene.roomGroupRef,
    furnitureGroupRef: scene.furnitureGroupRef,
    glRef: scene.glRef,
  });

  // Load design from params. Depend on the param strings: the params object
  // can be a new instance on every render, which would loop setState forever.
  const designIdParam = params.designId as string | undefined;
  const designDataParam = params.designData as string | undefined;
  const roomDimensionsParam = params.roomDimensions as string | undefined;
  useEffect(() => {
    const { design: parsedDesign, dimensions: parsedDimensions } = parseDesignFromParams({
      designId: designIdParam,
      designData: designDataParam,
      roomDimensions: roomDimensionsParam,
    });

    if (parsedDesign) {
      setDesign(parsedDesign);
    }
    if (parsedDimensions) {
      setRoomDimensions(parsedDimensions);
    }
  }, [designIdParam, designDataParam, roomDimensionsParam]);

  // Handle furniture tap
  const handleFurnitureTap = (event: any) => {
    const { locationX, locationY } = event.nativeEvent;
    scene.handleFurnitureTap(locationX, locationY);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={statusBarStyle} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surfacePrimary, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)');
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButtonContainer}
        >
          <Ionicons name="arrow-back" size={20} color={colors.accent} />
          <Text style={[styles.backButton, { color: colors.accent }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">3D Layout</Text>
        <TouchableOpacity
          onPress={actions.handleShare}
          accessibilityRole="button"
          accessibilityLabel="Share design"
          style={styles.shareButtonContainer}
        >
          <Ionicons name="share-outline" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 3D Viewer */}
        <View style={styles.viewer3DContainer}>
          {useUnity && unityBuildUrl ? (
            <Unity3DViewer
              roomDimensions={roomDimensions}
              furniture={design?.layout?.furniture?.map(item => ({
                id: item.id || '',
                name: item.name,
                position: item.position,
                rotation: item.position?.rotation || 0,
                dimensions: item.dimensions,
              })) || []}
              viewMode={viewMode}
              unityBuildUrl={unityBuildUrl}
              onUnityReady={() => {}}
              onError={(error) => {
                setUseUnity(false);
              }}
            />
          ) : (
            <View
              style={styles.glViewContainer}
              {...scene.panResponder.panHandlers}
              onTouchEnd={handleFurnitureTap}
            >
              <GLView
                style={styles.glView}
                onContextCreate={scene.onGLContextCreate}
              />
            </View>
          )}

          {/* Viewer Controls Overlay */}
          <View style={styles.viewerOverlay}>
            <View style={styles.viewModeSelector}>
              {(['perspective', 'top-down', 'orthographic'] as ViewMode[]).map((mode) => (
                <AnimatedButton
                  key={mode}
                  style={[styles.viewModeButton, viewMode === mode && styles.viewModeButtonActive]}
                  onPress={() => setViewMode(mode)}
                  hapticType="light"
                >
                  <Text style={[styles.viewModeText, { color: VIEWER_TEXT }, viewMode === mode && styles.viewModeTextActive]}>
                    {mode === 'top-down' ? 'Top-Down' : mode === 'orthographic' ? 'Ortho' : 'Perspective'}
                  </Text>
                </AnimatedButton>
              ))}
              {!!unityBuildUrl && (
                <AnimatedButton
                  style={[styles.viewModeButton, useUnity && styles.viewModeButtonActive]}
                  onPress={() => setUseUnity(!useUnity)}
                  hapticType="light"
                >
                  <Ionicons 
                    name={useUnity ? 'game-controller' : 'flash'} 
                    size={14} 
                    color={VIEWER_TEXT} 
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.viewModeText, { color: VIEWER_TEXT }, useUnity && styles.viewModeTextActive]}>
                    {useUnity ? 'Unity' : 'Three.js'}
                  </Text>
                </AnimatedButton>
              )}
            </View>

            <View style={styles.controlButtons}>
              <AnimatedButton
                style={styles.controlButton}
                onPress={() => setShowGrid(!showGrid)}
                hapticType="light"
              >
                <Ionicons 
                  name={showGrid ? 'grid' : 'grid-outline'} 
                  size={16} 
                  color={VIEWER_TEXT} 
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.controlButtonText, { color: VIEWER_TEXT }]}>Grid</Text>
              </AnimatedButton>
              <AnimatedButton
                style={styles.controlButton}
                onPress={() => setShowMeasurements(!showMeasurements)}
                hapticType="light"
              >
                <Ionicons 
                  name={showMeasurements ? 'resize' : 'resize-outline'} 
                  size={16} 
                  color={VIEWER_TEXT} 
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.controlButtonText, { color: VIEWER_TEXT }]}>Measure</Text>
              </AnimatedButton>
              <AnimatedButton
                style={styles.controlButton}
                onPress={scene.resetCamera}
                hapticType="medium"
              >
                <Ionicons 
                  name="refresh" 
                  size={16} 
                  color={VIEWER_TEXT} 
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.controlButtonText, { color: VIEWER_TEXT }]}>Reset</Text>
              </AnimatedButton>
            </View>

            {/* Info Display */}
            <View style={[styles.infoOverlay, { backgroundColor: colors.surfacePrimary + 'CC' }]}>
              <Text style={[styles.infoText, { color: colors.textPrimary }]}>
                {roomDimensions.width}m × {roomDimensions.length}m × {roomDimensions.height}m
              </Text>
              {design && (
                <Text style={[styles.infoText, { color: colors.textPrimary }]}>
                  {design.layout?.furniture?.length || 0} items
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* No Design State */}
        {!design && (
          <View style={[styles.noDesignContainer, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
            <Text style={[styles.noDesignText, { color: colors.textPrimary }]}>No design loaded</Text>
            <Text style={[styles.noDesignSubtext, { color: colors.textSecondary }]}>Generate a design first to view in 3D</Text>
            <SlideInView direction="bottom" delay={200}>
              <AnimatedButton
                style={[styles.loadDesignButton, { backgroundColor: colors.accent }]}
                onPress={() => router.push('/ai-design')}
                hapticType="medium"
              >
                <Text style={styles.loadDesignButtonText}>Go to AI Design</Text>
              </AnimatedButton>
            </SlideInView>
          </View>
        )}

        {/* Room Info */}
        {design && (
          <FadeInView delay={300}>
            <View style={[styles.roomInfo, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Room Details</Text>
              <InfoRow label="Dimensions" value={`${roomDimensions.width}m × ${roomDimensions.length}m × ${roomDimensions.height}m`} colors={colors} />
              <InfoRow label="Area" value={`${calculateArea(roomDimensions)} m²`} colors={colors} />
              <InfoRow label="Furniture Items" value={`${design.layout?.furniture?.length ?? 0} pieces`} colors={colors} />
              {design.estimatedCost && (
                <InfoRow
                  label="Est. Cost"
                  value={(() => {
                    const symbol = design.currency === 'PHP' ? '₱' : '$';
                    const { low, high } = design.estimatedCost;
                    return low === high
                      ? `${symbol}${low.toLocaleString()}`
                      : `${symbol}${low.toLocaleString()} - ${symbol}${high.toLocaleString()}`;
                  })()}
                  colors={colors}
                />
              )}
              {design.performanceScore && (
                <InfoRow label="Performance Score" value={`${design.performanceScore.overall.toFixed(0)}/100`} colors={colors} />
              )}
            </View>
          </FadeInView>
        )}

        {/* Furniture List */}
        {design && design.layout.furniture.length > 0 && (
          <FadeInView delay={400}>
            <View style={[styles.furnitureSection, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Furniture Layout</Text>
              {design.layout.furniture.map((item, idx) => (
                <ScaleInView key={idx} delay={idx * 50}>
                  <View style={[styles.furnitureItem, { borderBottomColor: colors.border }]}>
                    <View style={styles.furnitureInfo}>
                      <Text style={[styles.furnitureName, { color: colors.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.furnitureDetails, { color: colors.textSecondary }]}>
                        {item.dimensions.width}m × {item.dimensions.length}m × {item.dimensions.height}m
                      </Text>
                      <Text style={[styles.furniturePosition, { color: colors.textMuted }]}>
                        Position: ({item.position.x.toFixed(1)}, {item.position.z.toFixed(1)}) | Rotation: {item.position.rotation}°
                      </Text>
                    </View>
                    <Text style={[styles.furnitureCategory, { color: colors.accent, backgroundColor: colors.accentSoft }]}>{item.category}</Text>
                  </View>
                </ScaleInView>
              ))}
            </View>
          </FadeInView>
        )}

        {/* Export Options */}
        <FadeInView delay={500}>
          <View style={styles.exportSection}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Export Options</Text>
            {EXPORT_OPTIONS.map((option, idx) => {
              const getExportIcon = (id: string): keyof typeof Ionicons.glyphMap => {
                const iconMap: Record<string, any> = {
                  'pdf': 'document-text',
                  'png': 'image',
                  'obj': 'cube',
                  'glb': 'game-controller',
                };
                return iconMap[id] || 'download';
              };
              
              return (
                <SlideInView key={option.id} direction="right" delay={idx * 100}>
                  <AnimatedCard
                    style={[styles.exportCard, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }, actions.loading && styles.exportCardDisabled]}
                    onPress={() => actions.handleExport(option.id)}
                    disabled={actions.loading || !design}
                  >
                    <View style={[styles.exportIconContainer, { backgroundColor: colors.accentSoft }]}>
                      <Ionicons 
                        name={getExportIcon(option.id)} 
                        size={28} 
                        color={colors.accent} 
                      />
                    </View>
                    <View style={styles.exportInfo}>
                      <Text style={[styles.exportName, { color: colors.textPrimary }]}>{option.name}</Text>
                      <Text style={[styles.exportDesc, { color: colors.textSecondary }]}>{option.description}</Text>
                    </View>
                    {actions.loading ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    )}
                  </AnimatedCard>
                </SlideInView>
              );
            })}
          </View>
        </FadeInView>

        {/* Error Display */}
        {actions.error && (
          <View style={[styles.errorBanner, { backgroundColor: colors.danger + '20', borderLeftColor: colors.danger }]}>
            <Ionicons name="warning" size={20} color={colors.danger} style={{ marginRight: 8 }} />
            <Text style={[styles.errorText, { color: colors.danger }]}>{actions.error}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <AnimatedButton
            style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }, actions.isSaving && styles.actionButtonDisabled]}
            onPress={actions.handleSaveProject}
            disabled={actions.isSaving || !design}
            hapticType="medium"
            accessibilityRole="button"
            accessibilityLabel="Save project"
          >
            {actions.isSaving ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <>
                <Ionicons name="save-outline" size={20} color={colors.textPrimary} style={{ marginRight: 8 }} />
                <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>Save Project</Text>
              </>
            )}
          </AnimatedButton>
          <AnimatedButton
            style={[styles.actionButton, { backgroundColor: colors.accent }, actions.isFinalizing && styles.actionButtonDisabled]}
            onPress={actions.handleFinalizeDesign}
            disabled={actions.isFinalizing || !design}
            hapticType="success"
            accessibilityRole="button"
            accessibilityLabel="Finalize design"
          >
            {actions.isFinalizing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={[styles.actionButtonText, styles.primaryButtonText]}>
                  Finalize Design
                </Text>
              </>
            )}
          </AnimatedButton>
        </View>
      </ScrollView>
    </View>
  );
}

// Helper component for info rows
function InfoRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}:</Text>
      <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
  },
  backButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backButton: {
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  shareButtonContainer: {
    padding: 4,
  },
  shareButton: {
    fontSize: 24,
  },
  viewer3DContainer: {
    width: SCREEN_WIDTH - 40,
    height: 400,
    margin: 20,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    position: 'relative',
  },
  glViewContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  glView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  viewerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none',
  },
  viewModeSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
    padding: 4,
    margin: 12,
    alignSelf: 'flex-start',
  },
  viewModeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewModeButtonActive: {
    backgroundColor: '#007AFF',
  },
  viewModeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  viewModeTextActive: {
    color: '#FFFFFF',
  },
  controlButtons: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  controlButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  controlButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  infoOverlay: {
    position: 'absolute',
    top: 60,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 8,
    borderRadius: 8,
  },
  infoText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  noDesignContainer: {
    margin: 20,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    minHeight: 200,
    justifyContent: 'center',
    borderWidth: 1,
  },
  noDesignText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  noDesignSubtext: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  loadDesignButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  loadDesignButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  roomInfo: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  furnitureSection: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  furnitureItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  furnitureInfo: {
    flex: 1,
  },
  furnitureName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  furnitureDetails: {
    fontSize: 12,
    marginBottom: 2,
  },
  furniturePosition: {
    fontSize: 11,
  },
  furnitureCategory: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  exportSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  exportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  exportCardDisabled: {
    opacity: 0.5,
  },
  exportIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  exportInfo: {
    flex: 1,
  },
  exportName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  exportDesc: {
    fontSize: 12,
  },
  exportArrow: {
    fontSize: 20,
    color: '#999',
  },
  errorBanner: {
    borderLeftWidth: 4,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },
  actionButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  primaryButton: {
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButtonText: {
    color: '#FFFFFF',
  },
});
