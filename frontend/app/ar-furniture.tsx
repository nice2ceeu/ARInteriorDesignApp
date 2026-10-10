/**
 * AR Furniture Placement Screen
 * Main screen for placing and viewing 3D furniture in AR
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { ARFurniturePlacement, ARFurniturePlacementHandle, type ARLayoutItem } from '@/components/ARFurniturePlacement';
import { AppText } from '@/components/ui/Text';
import { colors, spacing, radii } from '@/components/ui/theme';
import type { ARFurnitureItem } from '@/components/ARFurnitureRenderer';

// Updated catalog with procedural items
const FURNITURE_CATALOG: ARFurnitureItem[] = [
  {
    id: 'sofa-modern',
    name: 'Modern Sofa',
    dimensions: { width: 2.0, height: 0.9, depth: 0.9 },
    color: 0x8b4513,
  },
  {
    id: 'coffee-table',
    name: 'Coffee Table',
    dimensions: { width: 1.2, height: 0.4, depth: 0.6 },
    color: 0x654321,
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    dimensions: { width: 1.0, height: 2.0, depth: 0.4 },
    color: 0x4a4a4a,
  },
];

export default function ARFurnitureScreen() {
  const router = useRouter();
  const { layoutItems: layoutParam } = useLocalSearchParams<{ layoutItems?: string }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // A generated layout from AI Design, shown as one arrangement
  const layoutItems = useMemo<ARLayoutItem[] | null>(() => {
    if (!layoutParam) return null;
    try {
      const parsed = JSON.parse(layoutParam);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }, [layoutParam]);
  const isLayoutMode = Boolean(layoutItems?.length);

  const [selectedFurniture, setSelectedFurniture] = useState<ARFurnitureItem | null>(null);
  const [isARReady, setIsARReady] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  
  const arPlacementRef = useRef<ARFurniturePlacementHandle>(null);

  // Request camera permission
  useEffect(() => {
    if (!cameraPermission?.granted) {
      requestCameraPermission();
    }
  }, [cameraPermission]);

  if (!cameraPermission?.granted) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <AppText variant="h3" style={{ marginBottom: 10 }}>Camera Access Required</AppText>
        <AppText variant="body" style={{ textAlign: 'center', marginBottom: 20 }}>
          AR preview needs camera access to show furniture in your space.
        </AppText>
        <TouchableOpacity style={styles.primaryButton} onPress={requestCameraPermission}>
          <AppText variant="body" style={{ color: 'white', fontWeight: 'bold' }}>Grant Permission</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
          <AppText variant="body">Go Back</AppText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Background Camera Feed */}
      <CameraView
        style={styles.camera}
        facing="back"
        onCameraReady={() => setIsARReady(true)}
      />

      {/* 3D GLView Overlay */}
      {isARReady && (
        <ARFurniturePlacement
          ref={arPlacementRef}
          furnitureItem={selectedFurniture}
          layoutItems={layoutItems}
          onLoadingStateChange={setIsLoadingModel}
          onError={(error) => Alert.alert('Error', error)}
        />
      )}

      {/* Subtle Back Button */}
      <View style={styles.topNav}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Loading Indicator */}
      {isLoadingModel && (
        <View style={styles.instructionsContainer}>
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#FFF" size="small" />
            <AppText variant="caption" style={{ color: '#FFF', marginLeft: 8 }}>Loading 3D Model...</AppText>
          </View>
        </View>
      )}

      {/* Slide-up Catalog */}
      {showCatalog && (
        <View style={styles.catalogOverlay}>
          <View style={styles.catalogHeader}>
            <AppText variant="subtitle" style={{ fontWeight: 'bold' }}>Furniture Library</AppText>
            <TouchableOpacity onPress={() => setShowCatalog(false)}>
              <Ionicons name="close-circle" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.catalogScroll}>
            {FURNITURE_CATALOG.map((item) => {
              const isSelected = selectedFurniture?.id === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.catalogItem, isSelected && styles.catalogItemSelected]}
                  onPress={() => {
                    setSelectedFurniture(item);
                    setShowCatalog(false);
                  }}
                >
                  <AppText 
                    variant="caption" 
                    style={{ 
                      color: isSelected ? colors.surfacePrimary : colors.textPrimary,
                      fontWeight: isSelected ? 'bold' : 'normal'
                    }}
                  >
                    {item.name}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Floating Action Bar */}
      <View style={styles.floatingActionBar}>
        <TouchableOpacity 
          style={styles.floatingButton} 
          onPress={() => {
            if (layoutItems?.length) {
              Alert.alert(
                'Proposed layout',
                `${layoutItems.map(item => `• ${item.name}`).join('\n')}\n\nDrag to move the arrangement. It follows the camera view and is not anchored to the floor yet.`
              );
            } else if (selectedFurniture) {
              Alert.alert(selectedFurniture.name, `Dimensions: ${selectedFurniture.dimensions.width}m x ${selectedFurniture.dimensions.height}m x ${selectedFurniture.dimensions.depth}m`);
            } else {
              Alert.alert('No Item', 'Please add a furniture item first.');
            }
          }}
        >
          <Ionicons name="information" size={24} color="#FFF" />
        </TouchableOpacity>

        {!isLayoutMode && (
          <TouchableOpacity
            style={[styles.floatingButton, styles.mainFloatingButton]}
            onPress={() => setShowCatalog(true)}
          >
            <Ionicons name="add" size={32} color="#FFF" />
          </TouchableOpacity>
        )}
        
        <TouchableOpacity 
          style={styles.floatingButton} 
          onPress={() => Alert.alert('Capture', 'Scene captured! (Placeholder)')}
        >
          <Ionicons name="camera" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  topNav: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 100,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  instructionsContainer: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  loadingBox: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  floatingActionBar: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-end',
    paddingHorizontal: 40,
    zIndex: 100,
  },
  floatingButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  mainFloatingButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  catalogOverlay: {
    position: 'absolute',
    bottom: 150,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: radii.xl,
    padding: 16,
    zIndex: 90,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  catalogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  catalogScroll: {
    flexDirection: 'row',
    gap: 12,
  },
  catalogItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  catalogItemSelected: {
    backgroundColor: colors.accent,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radii.md,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radii.md,
    width: '100%',
    alignItems: 'center',
  },
});
