/**
 * Live Scan Screen
 * Real-time room scanning with camera
 * Refactored to use modular hooks and utilities
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView } from 'expo-camera';
import { useRouter } from 'expo-router';
import type { Obstacle } from '@/types/spatial-mapping';

// Hooks
import { useLiveScanCamera, useScanAnimations } from '@/hooks/useLiveScanCamera';
import { useLiveScanProcessing } from '@/hooks/useLiveScanProcessing';

// Utilities
import {
  getQualityColor,
  calculateProgressWidth,
  formatScanDuration,
  getAccuracyMetrics,
  calculateTrendBarHeight,
} from '@/utils/liveScanHelpers';

// Configuration
import { UI_CONSTANTS } from '@/config/liveScan.config';

export default function LiveScanScreen() {
  const router = useRouter();

  // Camera hook
  const camera = useLiveScanCamera();

  // Processing hook
  const scan = useLiveScanProcessing({
    cameraRef: camera.cameraRef,
    cameraProfileRef: camera.cameraProfileRef,
    isCameraReady: camera.isCameraReady,
    permissionGranted: camera.permission?.granted ?? false,
    cameraProfile: camera.cameraProfile,
  });

  // Animations
  useScanAnimations(scan.isScanning, camera.pulseAnim, camera.fadeAnim);

  // Loading state
  if (!camera.permission) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <Text style={styles.loadingText}>Loading camera...</Text>
      </View>
    );
  }

  // Permission not granted
  if (!camera.permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Camera Permission Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to scan your room in real-time
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={camera.requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      <CameraView
        ref={camera.cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={() => camera.setIsCameraReady(true)}
        onMountError={(error) => console.error('Camera mount error:', error)}
      >
        {/* Top Controls - Modernized */}
        <View style={{ position: 'absolute', top: 110, left: 16, right: 16, padding: 10, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.75)' }}>
          <Text style={{ color: '#fff', fontSize: 12 }}>Demo mapping: dimensions and distances are simulated. Use measured values in AI Design.</Text>
        </View>
        <View style={styles.topControls}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonIcon}>←</Text>
            <Text style={styles.backButtonText}>Close</Text>
          </TouchableOpacity>
          
          {scan.isScanning && (
            <View style={styles.scanningCluster}>
              <View style={styles.scanningBadge}>
                <Animated.View style={[styles.scanningDot, { transform: [{ scale: camera.pulseAnim }] }]} />
                <Text style={styles.scanningText}>
                  {scan.calibrationStatus === 'calibrating' ? 'CALIBRATING' : 'SCANNING'}
                </Text>
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.recalibrateButton} onPress={scan.handleRecalibrate}>
            <Text style={styles.recalibrateIcon}>↻</Text>
          </TouchableOpacity>
        </View>

        {/* Minimal Status Pill - Top Center */}
        {scan.isScanning && (
          <View style={styles.statusPill}>
            <View style={styles.statusPillContent}>
              <Text style={styles.statusPillCoverage}>{(scan.coverage * 100).toFixed(0)}%</Text>
              <View style={styles.statusPillDivider} />
              <Text style={styles.statusPillTimer}>{formatScanDuration(scan.scanDurationMs)}</Text>
            </View>
            <View style={styles.statusPillProgress}>
              <Animated.View 
                style={[
                  styles.statusPillProgressFill, 
                  { width: `${calculateProgressWidth(scan.coverage)}%` }
                ]} 
              />
            </View>
          </View>
        )}

        {/* Modern Scanning Reticle */}
        <View style={styles.reticleContainer}>
          <Animated.View style={[styles.reticleOuter, { opacity: camera.fadeAnim }]}>
            <View style={styles.reticleInner}>
              <View style={styles.reticleCrosshair} />
            </View>
          </Animated.View>
          <View style={[styles.reticleCorner, styles.cornerTL]} />
          <View style={[styles.reticleCorner, styles.cornerTR]} />
          <View style={[styles.reticleCorner, styles.cornerBL]} />
          <View style={[styles.reticleCorner, styles.cornerBR]} />
        </View>
        
        {/* Instruction Text - Bottom of reticle */}
        <View style={styles.instructionContainer}>
          <Text style={styles.instructionText}>Point camera at room surfaces</Text>
        </View>

        {/* Demo Mode Chip - Minimal */}
        <View style={styles.demoBadge}>
          <View style={styles.demoDot} />
          <Text style={styles.demoText}>Demo Mode</Text>
        </View>

        {/* Waiting State - Minimal */}
        {!scan.roomData && scan.isScanning && (
          <View style={styles.waitingPill}>
            <View style={styles.waitingSpinner} />
            <Text style={styles.waitingText}>Detecting surfaces...</Text>
          </View>
        )}

        {/* Room Dimensions Card - Modern Glass */}
        {scan.roomData && (
          <Animated.View style={[styles.dimensionsCard, { opacity: camera.fadeAnim }]}>
            <View style={styles.dimensionsHeader}>
              <Text style={styles.dimensionsTitle}>Room Size</Text>
              <View style={styles.confidenceChip}>
                <View style={[styles.confidenceDot, { backgroundColor: scan.confidence > 0.7 ? '#22c55e' : '#f59e0b' }]} />
                <Text style={styles.confidenceValue}>{Math.round(scan.confidence * 100)}%</Text>
              </View>
            </View>
            
            <View style={styles.dimensionsGrid}>
              <View style={styles.dimensionItem}>
                <Text style={styles.dimensionValue}>{scan.roomData.dimensions.width.toFixed(1)}</Text>
                <Text style={styles.dimensionUnit}>m width</Text>
              </View>
              <View style={styles.dimensionItem}>
                <Text style={styles.dimensionValue}>{scan.roomData.dimensions.length.toFixed(1)}</Text>
                <Text style={styles.dimensionUnit}>m length</Text>
              </View>
              <View style={styles.dimensionItem}>
                <Text style={styles.dimensionValue}>{scan.roomData.dimensions.height.toFixed(1)}</Text>
                <Text style={styles.dimensionUnit}>m height</Text>
              </View>
              <View style={[styles.dimensionItem, styles.dimensionItemHighlight]}>
                <Text style={styles.dimensionValueLarge}>{scan.roomData.area.toFixed(0)}</Text>
                <Text style={styles.dimensionUnitLarge}>m² area</Text>
              </View>
            </View>
            
            <AccuracyIndicator />
          </Animated.View>
        )}

        {/* Detected Objects - Bottom Sheet Style */}
        {scan.roomData && scan.roomData.obstacles.length > 0 && (
          <Animated.View style={[styles.objectsSheet, { opacity: camera.fadeAnim }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.objectsHeader}>
              <Text style={styles.objectsTitle}>Detected Objects</Text>
              <View style={styles.objectsCount}>
                <Text style={styles.objectsCountText}>{scan.roomData.obstacles.length}</Text>
              </View>
              <ObstacleStatusBadge />
            </View>
            <View style={styles.objectsList}>
              {scan.roomData.obstacles.slice(0, UI_CONSTANTS.MAX_VISIBLE_OBSTACLES).map((obstacle: Obstacle) => (
                <View key={obstacle.id} style={styles.objectChip}>
                  <Text style={styles.objectChipLabel}>{obstacle.label}</Text>
                  <Text style={styles.objectChipDistance}>{obstacle.distanceFromCamera.toFixed(1)}m</Text>
                </View>
              ))}
              {scan.roomData.obstacles.length > UI_CONSTANTS.MAX_VISIBLE_OBSTACLES && (
                <View style={styles.objectChipMore}>
                  <Text style={styles.objectChipMoreText}>
                    +{scan.roomData.obstacles.length - UI_CONSTANTS.MAX_VISIBLE_OBSTACLES}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Signal Quality - Minimal Side Indicator */}
        {scan.recentSnapshots.length > 0 && (
          <View style={styles.signalIndicator}>
            <View style={styles.signalBars}>
              {scan.recentSnapshots.slice(-5).map((snapshot, index) => (
                <View
                  key={`${snapshot.timestamp}-${index}`}
                  style={[
                    styles.signalBar,
                    {
                      height: calculateTrendBarHeight(snapshot.coverage),
                      backgroundColor: getQualityColor(snapshot.confidence),
                      opacity: 0.4 + (index * 0.15),
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.signalLabel}>Signal</Text>
          </View>
        )}

        {/* Bottom Actions - Modern */}
        <View style={styles.bottomBar}>
          <View style={styles.bottomBarContent}>
            <View style={styles.scanStats}>
              <Text style={styles.scanStatsLabel}>Frames</Text>
              <Text style={styles.scanStatsValue}>{scan.framesProcessed}</Text>
            </View>
            <TouchableOpacity
              style={[styles.saveButton, !scan.roomData && styles.saveButtonDisabled]}
              onPress={scan.handleSaveScan}
              disabled={!scan.roomData}
            >
              <Text style={styles.saveButtonText}>Save Scan</Text>
              <Text style={styles.saveButtonIcon}>→</Text>
            </TouchableOpacity>
            <View style={styles.scanStats}>
              <Text style={styles.scanStatsLabel}>FPS</Text>
              <Text style={styles.scanStatsValue}>{scan.fps.toFixed(0)}</Text>
            </View>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

// Helper Components
function AccuracyIndicator() {
  const metrics = getAccuracyMetrics();
  return (
    <View style={styles.accuracyIndicator}>
      <Text style={[
        styles.accuracyText,
        metrics.isStabilized ? styles.accuracyStabilized : styles.accuracyCalibrating
      ]}>
        {metrics.isStabilized ? '✓ Stabilized' : `Stabilizing... ${metrics.stabilizationProgress}%`}
      </Text>
    </View>
  );
}

function ObstacleStatusBadge() {
  const metrics = getAccuracyMetrics();
  return (
    <Text style={[
      styles.obstacleStabilizedBadge,
      metrics.obstaclesStabilized ? styles.stabilizedBadge : styles.calibratingBadge
    ]}>
      {metrics.obstaclesStabilized ? '✓ Locked' : 'Scanning...'}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  camera: {
    flex: 1,
  },
  loadingText: {
    color: '#FFF',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 100,
  },
  
  // Permission Screen - Modern
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    backgroundColor: '#0a0a0f',
  },
  permissionIcon: {
    fontSize: 72,
    marginBottom: 24,
  },
  permissionTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  permissionText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  permissionButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 16,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  permissionButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Top Controls - Clean Minimal
  topControls: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(10px)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 6,
  },
  backButtonIcon: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  backButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  scanningCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scanningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  scanningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFF',
  },
  scanningText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  recalibrateButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recalibrateIcon: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '600',
  },

  // Status Pill - Minimal Top Center
  statusPill: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 140,
  },
  statusPillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusPillCoverage: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  statusPillDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  statusPillTimer: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  statusPillProgress: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  statusPillProgressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 2,
  },

  // Modern Scanning Reticle
  reticleContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 220,
    height: 220,
    marginTop: -110,
    marginLeft: -110,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: 'rgba(99, 102, 241, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleCrosshair: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6366f1',
  },
  reticleCorner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    borderWidth: 2,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 12,
  },

  // Instruction Text
  instructionContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: 130,
    alignItems: 'center',
  },
  instructionText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  // Demo Badge - Minimal
  demoBadge: {
    position: 'absolute',
    top: 175,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  demoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#f59e0b',
  },
  demoText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Waiting State - Minimal
  waitingPill: {
    position: 'absolute',
    top: '50%',
    alignSelf: 'center',
    marginTop: -20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 12,
  },
  waitingSpinner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderTopColor: '#6366f1',
  },
  waitingText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    fontWeight: '500',
  },

  // Dimensions Card - Modern Glass
  dimensionsCard: {
    position: 'absolute',
    top: 210,
    right: 16,
    backgroundColor: 'rgba(15, 15, 25, 0.85)',
    borderRadius: 20,
    padding: 16,
    width: 165,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  dimensionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  dimensionsTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  confidenceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  confidenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  confidenceValue: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  dimensionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dimensionItem: {
    width: '47%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  dimensionItemHighlight: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  dimensionValue: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
  },
  dimensionValueLarge: {
    color: '#a5b4fc',
    fontSize: 22,
    fontWeight: '700',
  },
  dimensionUnit: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  dimensionUnitLarge: {
    color: 'rgba(165, 180, 252, 0.7)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  accuracyIndicator: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  accuracyText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  accuracyStabilized: {
    color: '#22c55e',
  },
  accuracyCalibrating: {
    color: '#f59e0b',
  },

  // Objects Sheet - Bottom Card
  objectsSheet: {
    position: 'absolute',
    bottom: 110,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15, 15, 25, 0.9)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  objectsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  objectsTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  objectsCount: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  objectsCountText: {
    color: '#a5b4fc',
    fontSize: 13,
    fontWeight: '700',
  },
  obstacleStabilizedBadge: {
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  stabilizedBadge: {
    color: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  calibratingBadge: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  objectsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  objectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  objectChipLabel: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  objectChipDistance: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '500',
  },
  objectChipMore: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  objectChipMoreText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '600',
  },

  // Signal Indicator - Side Panel
  signalIndicator: {
    position: 'absolute',
    top: 210,
    left: 16,
    alignItems: 'center',
    gap: 8,
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 12,
  },
  signalBar: {
    width: 6,
    minHeight: 8,
    borderRadius: 3,
  },
  signalLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Bottom Bar - Modern
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingTop: 16,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(10, 10, 15, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bottomBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanStats: {
    alignItems: 'center',
    minWidth: 60,
  },
  scanStatsLabel: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  scanStatsValue: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 16,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  saveButtonDisabled: {
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
    shadowOpacity: 0,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  saveButtonIcon: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },

  // Legacy styles kept for compatibility
  dimensionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dimensionLabel: {
    color: '#AAA',
    fontSize: 13,
  },
  confidenceBadge: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  confidenceText: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  moreText: {
    color: '#AAA',
    fontSize: 11,
    alignSelf: 'center',
  },
});
