/**
 * Spatial Mapping Screen
 * Room scanning with calibration and professional reports
 * Refactored to use modular hooks and components
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Share,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { depthEstimationService } from '@/services/DepthEstimationService';

// Configuration
import { TUTORIAL_STAGES, VIEW_MODES } from '@/config/spatialMapping.config';

// Hooks
import { useSpatialMappingScan } from '@/hooks/useSpatialMappingScan';
import { useSpatialMappingCalibration } from '@/hooks/useSpatialMappingCalibration';
import { useSpatialMappingMeasurement } from '@/hooks/useSpatialMappingMeasurement';
import { useSpatialMappingUI } from '@/hooks/useSpatialMappingUI';

// Utilities
import {
  formatDimension,
  formatArea,
  formatVolume,
  getConfidenceColor,
  generateRoomInsights,
  suggestRoomType,
  getQualityLabel,
  exportScanData,
  generateSummaryText,
  getObstacleEmoji,
  getRatingColor,
} from '@/utils/spatialMappingHelpers';

// Components
import { FloorPlanVisualization, ScanProgressView, CalibrationModal } from '@/components/spatial-mapping';

export default function SpatialMappingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Initialize hooks
  const scan = useSpatialMappingScan();
  const calibration = useSpatialMappingCalibration();
  const ui = useSpatialMappingUI();
  const measurement = useSpatialMappingMeasurement({ useMetric: ui.useMetric });

  // Auto-start scan if image URI is provided
  useEffect(() => {
    if (params.imageUri && typeof params.imageUri === 'string' && !scan.isScanning && !scan.scanComplete) {
      scan.startScan(params.imageUri);
    }
  }, [params.imageUri, scan.isScanning, scan.scanComplete, scan.startScan]);

  // Export data handler
  const handleExport = async (format: 'json' | 'csv') => {
    if (!scan.roomData || !scan.scanResult) {
      Alert.alert('Error', 'No scan data available to export');
      return;
    }
    const result = await exportScanData(format, scan.roomData, scan.scanResult, scan.scanStats, ui.useMetric);
    if (result.success) {
      Alert.alert('✅ Export Successful', `Room scan data exported as ${format.toUpperCase()}!`);
    } else {
      Alert.alert('Export Failed', result.error || 'Could not export room data.');
    }
  };

  // Copy summary to share
  const handleCopySummary = async () => {
    if (!scan.roomData || !scan.scanResult) return;
    const summary = generateSummaryText(scan.roomData, scan.scanResult, ui.useMetric);
    await Share.share({ message: summary, title: 'Room Scan Summary' });
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Spatial Mapping</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => ui.setShowInteractiveHelp(!ui.showInteractiveHelp)}
          >
            <Text style={styles.headerButtonText}>❓</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => ui.setShowTutorial(true)}
          >
            <Text style={styles.headerButtonText}>📚</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={{ padding: 12, marginBottom: 12, borderRadius: 8, backgroundColor: '#FEF3C7' }}>
            <Text style={{ color: '#92400E' }}>Demo mapping: room measurements are simulated. Enter measured dimensions in AI Design.</Text>
          </View>
          {/* Scan View */}
          <TouchableOpacity
            style={styles.scanView}
            onPress={measurement.measurementMode ? measurement.handleMeasurementTap : undefined}
            activeOpacity={measurement.measurementMode ? 0.8 : 1}
            disabled={!measurement.measurementMode}
          >
            {/* Placeholder state */}
            {!scan.isScanning && !scan.scanComplete && !measurement.measurementMode && (
              <View style={styles.scanPlaceholder}>
                <Text style={styles.scanEmoji}>📐</Text>
                <Text style={styles.scanTitle}>Room Scanner</Text>
                <Text style={styles.scanSubtitle}>
                  Point your camera to scan room dimensions and detect obstacles
                </Text>
              </View>
            )}

            {/* Measurement mode */}
            {measurement.measurementMode && (
              <View style={styles.measurementView}>
                <Text style={styles.measurementEmoji}>📏</Text>
                <Text style={styles.measurementTitle}>Tap to Measure</Text>
                <Text style={styles.measurementSubtitle}>
                  {measurement.measurementPoints.length === 0
                    ? 'Tap anywhere to set the first point'
                    : 'Tap to set the second point'}
                </Text>
                {measurement.measurementPoints.length > 0 && (
                  <View style={styles.activePoint}>
                    <View style={styles.pointDot} />
                    <Text style={styles.pointText}>
                      Point 1: Depth {measurement.measurementPoints[0].depth.toFixed(2)}m
                    </Text>
                  </View>
                )}
                <View style={styles.depthGrid}>
                  <Text style={styles.depthGridText}>Depth Estimation Active</Text>
                  <View style={styles.depthBar}>
                    <View style={[styles.depthBarFill, { width: `${measurement.depthConfidence * 100}%` }]} />
                  </View>
                  <Text style={styles.depthConfidenceText}>
                    {Math.round(measurement.depthConfidence * 100)}% confidence
                  </Text>
                </View>
              </View>
            )}

            {/* Scanning progress */}
            {scan.isScanning && (
              <ScanProgressView
                currentStage={scan.currentStage}
                scanProgress={scan.scanProgress}
                scanStats={scan.scanStats}
                showRealTimeStats={ui.showRealTimeStats}
              />
            )}

            {/* Scan complete */}
            {scan.scanComplete && scan.roomData && (
              <View style={styles.completeView}>
                <Text style={styles.completeEmoji}>✅</Text>
                <Text style={styles.completeText}>Scan Complete!</Text>
                <Text style={styles.completeSubtext}>Room mapped successfully</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Scan Button */}
          {!scan.isScanning && !scan.scanComplete && (
            <>
              <TouchableOpacity style={styles.scanButton} onPress={() => scan.startScan()}>
                <Text style={styles.scanButtonText}>📷 Start Room Scan</Text>
              </TouchableOpacity>

              {/* Tools Row */}
              <View style={styles.toolsRow}>
                <TouchableOpacity
                  style={[styles.toolButton, calibration.isCalibrated && styles.toolButtonActive]}
                  onPress={calibration.startCalibration}
                >
                  <Text style={styles.toolIcon}>🎯</Text>
                  <Text style={styles.toolText}>
                    {calibration.isCalibrated ? 'Calibrated ✓' : 'Calibrate'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.toolButton, measurement.measurementMode && styles.toolButtonActive]}
                  onPress={measurement.toggleMeasurementMode}
                  disabled={measurement.isProcessingDepth}
                >
                  {measurement.isProcessingDepth ? (
                    <ActivityIndicator size="small" color="#007AFF" />
                  ) : (
                    <>
                      <Text style={styles.toolIcon}>📏</Text>
                      <Text style={styles.toolText}>
                        {measurement.measurementMode ? 'Exit Measure' : 'Measure'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.toolButton}
                  onPress={() => measurement.setShowMeasurementHistory(true)}
                >
                  <Text style={styles.toolIcon}>📋</Text>
                  <Text style={styles.toolText}>History ({measurement.measurements.length})</Text>
                </TouchableOpacity>
              </View>

              {/* Calibration Status */}
              {calibration.isCalibrated && (
                <View style={styles.calibrationStatus}>
                  <View style={styles.calibrationHeader}>
                    <Text style={styles.calibrationTitle}>✅ Calibration Active</Text>
                    <TouchableOpacity onPress={calibration.resetCalibration}>
                      <Text style={styles.calibrationReset}>Reset</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.calibrationText}>
                    Factor: {depthEstimationService.getCalibrationFactor().toFixed(3)}x
                  </Text>
                </View>
              )}

              {/* Measurement Mode Card */}
              {measurement.measurementMode && (
                <View style={styles.measurementModeCard}>
                  <View style={styles.measurementModeHeader}>
                    <Text style={styles.measurementModeTitle}>📏 Measurement Mode</Text>
                    <TouchableOpacity onPress={measurement.toggleMeasurementMode}>
                      <Text style={styles.measurementModeExit}>Exit</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.measurementInstructions}>
                    {measurement.measurementPoints.length === 0
                      ? 'Tap the first point to start measuring'
                      : 'Tap the second point to complete measurement'}
                  </Text>
                  {measurement.measurementPoints.length === 1 && (
                    <View style={styles.pointInfo}>
                      <Text style={styles.pointLabel}>First Point:</Text>
                      <Text style={styles.pointValue}>
                        Depth: {measurement.measurementPoints[0].depth.toFixed(2)}m
                      </Text>
                      <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={measurement.cancelCurrentMeasurement}
                      >
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <TextInput
                    style={styles.labelInput}
                    placeholder="Label (optional)"
                    placeholderTextColor="#999"
                    value={measurement.measurementLabel}
                    onChangeText={measurement.setMeasurementLabel}
                  />
                </View>
              )}
            </>
          )}

          {/* Error */}
          {scan.error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>⚠️ {scan.error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => scan.startScan()}>
                <Text style={styles.retryText}>🔄 Retry Scan</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Results */}
          {scan.scanComplete && scan.roomData && (
            <>
              {/* Statistics */}
              <View style={styles.statsCard}>
                <Text style={styles.cardTitle}>📊 Scan Statistics</Text>
                <View style={styles.statsGrid}>
                  <StatItem
                    label="Confidence"
                    value={`${Math.round(scan.scanStats.confidence * 100)}%`}
                    color={getConfidenceColor(scan.scanStats.confidence)}
                  />
                  <StatItem label="Planes" value={scan.scanStats.planesDetected} />
                  <StatItem label="Obstacles" value={scan.scanStats.obstaclesFound} />
                  <StatItem label="Time" value={`${(scan.scanStats.processingTime / 1000).toFixed(1)}s`} />
                </View>
              </View>

              {/* Dimensions */}
              <View style={styles.dataCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>📏 Room Dimensions</Text>
                  <TouchableOpacity onPress={ui.toggleUnit} style={styles.unitToggle}>
                    <Text style={styles.unitText}>{ui.useMetric ? 'm' : 'ft'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.dimensionsGrid}>
                  <DimensionItem label="Width" value={formatDimension(scan.roomData.dimensions.width, ui.useMetric)} />
                  <DimensionItem label="Length" value={formatDimension(scan.roomData.dimensions.length, ui.useMetric)} />
                  <DimensionItem label="Height" value={formatDimension(scan.roomData.dimensions.height, ui.useMetric)} />
                  <DimensionItem label="Floor Area" value={formatArea(scan.roomData.area, ui.useMetric)} />
                </View>
                {scan.roomData.volume && (
                  <View style={styles.volumeRow}>
                    <Text style={styles.volumeLabel}>Volume:</Text>
                    <Text style={styles.volumeValue}>{formatVolume(scan.roomData.volume, ui.useMetric)}</Text>
                  </View>
                )}
              </View>

              {/* Room Properties */}
              <View style={styles.dataCard}>
                <Text style={styles.cardTitle}>🏠 Room Properties</Text>
                <PropertyRow label="Floor Type" value={scan.roomData.floorType || 'Unknown'} />
                <PropertyRow label="Natural Light" value={scan.roomData.naturalLight || 'Unknown'} />
                <PropertyRow label="Walls Detected" value={`${scan.roomData.walls?.length || 0} walls`} />
                <PropertyRow
                  label="Mapping Quality"
                  value={getQualityLabel(scan.roomData.confidence || 0)}
                  valueColor={getConfidenceColor(scan.roomData.confidence || 0)}
                />
              </View>

              {/* View Tabs */}
              <View style={styles.viewTabs}>
                {VIEW_MODES.map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.viewTab, ui.selectedView === mode && styles.viewTabActive]}
                    onPress={() => ui.setSelectedView(mode)}
                  >
                    <Text style={[styles.viewTabText, ui.selectedView === mode && styles.viewTabTextActive]}>
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Overview Tab */}
              {ui.selectedView === 'overview' && (
                <>
                  {/* Room Insights */}
                  <View style={styles.dataCard}>
                    <Text style={styles.cardTitle}>💡 Room Insights</Text>
                    {generateRoomInsights(scan.roomData).map((insight, index) => (
                      <View key={index} style={styles.insightItem}>
                        <Text style={styles.insightText}>{insight}</Text>
                      </View>
                    ))}
                    {suggestRoomType(scan.roomData) && (
                      <View style={styles.roomTypeSuggestion}>
                        <Text style={styles.roomTypeLabel}>Suggested Room Type:</Text>
                        <Text style={styles.roomTypeValue}>{suggestRoomType(scan.roomData)}</Text>
                      </View>
                    )}
                  </View>

                  {/* Floor Plan Toggle */}
                  <View style={styles.dataCard}>
                    <TouchableOpacity
                      style={styles.floorPlanToggle}
                      onPress={() => ui.setShowFloorPlan(!ui.showFloorPlan)}
                    >
                      <Text style={styles.cardTitle}>
                        📐 {ui.showFloorPlan ? 'Hide' : 'Show'} Floor Plan
                      </Text>
                      <Text style={styles.toggleArrow}>{ui.showFloorPlan ? '▼' : '▶'}</Text>
                    </TouchableOpacity>
                    {ui.showFloorPlan && (
                      <FloorPlanVisualization roomData={scan.roomData} useMetric={ui.useMetric} />
                    )}
                  </View>

                  {/* Obstacles Preview */}
                  {scan.roomData.obstacles.length > 0 && (
                    <View style={styles.dataCard}>
                      <Text style={styles.cardTitle}>
                        🚧 Obstacles ({scan.roomData.obstacles.length})
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {scan.roomData.obstacles.slice(0, 5).map((obstacle) => (
                          <View key={obstacle.id} style={styles.obstaclePreviewItem}>
                            <Text style={styles.obstacleEmoji}>{getObstacleEmoji(obstacle.type)}</Text>
                            <Text style={styles.obstacleLabel} numberOfLines={2}>
                              {obstacle.label || obstacle.type}
                            </Text>
                          </View>
                        ))}
                        {scan.roomData.obstacles.length > 5 && (
                          <TouchableOpacity
                            style={styles.viewMoreButton}
                            onPress={() => ui.setSelectedView('obstacles')}
                          >
                            <Text style={styles.viewMoreText}>
                              +{scan.roomData.obstacles.length - 5} more
                            </Text>
                          </TouchableOpacity>
                        )}
                      </ScrollView>
                    </View>
                  )}
                </>
              )}

              {/* Walls Tab */}
              {ui.selectedView === 'walls' && scan.roomData.walls && scan.roomData.walls.length > 0 && (
                <View style={styles.dataCard}>
                  <Text style={styles.cardTitle}>🧱 Wall Measurements</Text>
                  <View style={styles.wallsGrid}>
                    {scan.roomData.walls.map((wall, index) => (
                      <View key={wall.id || index} style={styles.wallItem}>
                        <Text style={styles.wallOrientation}>{wall.orientation.toUpperCase()}</Text>
                        <Text style={styles.wallLength}>{formatDimension(wall.length, ui.useMetric)}</Text>
                        {wall.startPoint && (
                          <Text style={styles.wallDetails}>
                            From: ({wall.startPoint.x.toFixed(2)}, {wall.startPoint.y.toFixed(2)})
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Obstacles Tab */}
              {ui.selectedView === 'obstacles' && (
                <View style={styles.dataCard}>
                  <Text style={styles.cardTitle}>🚧 Detected Obstacles ({scan.roomData.obstacles.length})</Text>
                  {scan.roomData.obstacles.length === 0 ? (
                    <Text style={styles.noObstacles}>No obstacles detected in this room</Text>
                  ) : (
                    scan.roomData.obstacles.map((obstacle) => (
                      <View key={obstacle.id} style={styles.obstacleItem}>
                        <View style={styles.obstacleIcon}>
                          <Text style={styles.obstacleItemEmoji}>{getObstacleEmoji(obstacle.type)}</Text>
                        </View>
                        <View style={styles.obstacleInfo}>
                          <Text style={styles.obstacleType}>{obstacle.label || obstacle.type}</Text>
                          <Text style={styles.obstacleDetails}>
                            {obstacle.position} • {obstacle.size}
                            {obstacle.confidence && ` • ${Math.round(obstacle.confidence * 100)}% confidence`}
                          </Text>
                          {obstacle.distanceFromCamera && (
                            <Text style={styles.obstacleDistance}>
                              Distance: {formatDimension(obstacle.distanceFromCamera, ui.useMetric)}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => Alert.alert('Export Format', 'Choose format', [
                    { text: 'JSON', onPress: () => handleExport('json') },
                    { text: 'CSV', onPress: () => handleExport('csv') },
                    { text: 'Cancel', style: 'cancel' },
                  ])}
                >
                  <Text style={styles.actionButtonText}>💾 Export Data</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.actionButton, styles.infoButton]} onPress={handleCopySummary}>
                  <Text style={[styles.actionButtonText, styles.whiteText]}>📋 Copy Summary</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.secondaryButton]}
                  onPress={() => router.push({
                    pathname: '/ai-design',
                    params: {
                      roomDimensions: JSON.stringify({
                        width: scan.roomData!.dimensions.width,
                        length: scan.roomData!.dimensions.length,
                        height: scan.roomData!.dimensions.height,
                      }),
                      fromSpatialMapping: 'true',
                    },
                  })}
                >
                  <Text style={[styles.actionButtonText, styles.whiteText]}>✨ Use in AI Design</Text>
                </TouchableOpacity>

                {scan.professionalReport && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.professionalButton]}
                    onPress={() => ui.setShowProfessionalReport(!ui.showProfessionalReport)}
                  >
                    <Text style={[styles.actionButtonText, styles.whiteText]}>🏆 Professional Report</Text>
                  </TouchableOpacity>
                )}

                {scan.scanHistory.length > 0 && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.historyButton]}
                    onPress={() => ui.setShowHistory(!ui.showHistory)}
                  >
                    <Text style={[styles.actionButtonText, styles.whiteText]}>
                      📚 Scan History ({scan.scanHistory.length})
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={[styles.actionButton, styles.resetButton]} onPress={scan.resetScan}>
                  <Text style={[styles.actionButtonText, styles.resetText]}>🔄 New Scan</Text>
                </TouchableOpacity>
              </View>

              {/* Professional Report */}
              {ui.showProfessionalReport && scan.professionalReport && (
                <ProfessionalReportCard report={scan.professionalReport} />
              )}

              {/* Scan History */}
              {ui.showHistory && scan.scanHistory.length > 0 && (
                <View style={styles.dataCard}>
                  <Text style={styles.cardTitle}>📚 Recent Scans</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {scan.scanHistory.map((historyItem, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.historyItem}
                        onPress={() => {
                          scan.setRoomData(historyItem.roomData);
                          scan.setScanResult(historyItem);
                          ui.setShowHistory(false);
                        }}
                      >
                        <Text style={styles.historyDate}>
                          {new Date(historyItem.timestamp).toLocaleDateString()}
                        </Text>
                        <Text style={styles.historyDimensions}>
                          {historyItem.roomData
                            ? `${formatDimension(historyItem.roomData.dimensions.width, ui.useMetric)} × ${formatDimension(historyItem.roomData.dimensions.length, ui.useMetric)}`
                            : 'N/A'}
                        </Text>
                        <Text style={styles.historyConfidence}>
                          {Math.round(historyItem.confidence * 100)}% confidence
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Tutorial Modal */}
      {ui.showTutorial && (
        <TutorialModal
          step={ui.tutorialStep}
          onNext={ui.nextTutorialStep}
          onPrev={ui.prevTutorialStep}
          onClose={ui.closeTutorial}
        />
      )}

      {/* Interactive Help */}
      {ui.showInteractiveHelp && (
        <HelpPanel onClose={() => ui.setShowInteractiveHelp(false)} />
      )}

      {/* Calibration Modal */}
      <CalibrationModal
        visible={calibration.showCalibrationModal}
        onClose={() => calibration.setShowCalibrationModal(false)}
        calibrationStep={calibration.calibrationStep}
        selectedReference={calibration.selectedReference}
        detectedWidth={calibration.detectedWidth}
        detectedHeight={calibration.detectedHeight}
        calibrationResult={calibration.calibrationResult}
        customReferenceWidth={calibration.customReferenceWidth}
        customReferenceHeight={calibration.customReferenceHeight}
        onSelectReference={calibration.selectReferenceObject}
        onDetectedWidthChange={calibration.setDetectedWidth}
        onDetectedHeightChange={calibration.setDetectedHeight}
        onCustomWidthChange={calibration.setCustomReferenceWidth}
        onCustomHeightChange={calibration.setCustomReferenceHeight}
        onPerformCalibration={calibration.performCalibration}
        onCreateCustomReference={calibration.createCustomReference}
        onBack={calibration.startCalibration}
      />

      {/* Measurement History Modal */}
      <MeasurementHistoryModal
        visible={measurement.showMeasurementHistory}
        onClose={() => measurement.setShowMeasurementHistory(false)}
        measurements={measurement.measurements}
        useMetric={ui.useMetric}
        onDelete={measurement.deleteMeasurement}
        onClearAll={measurement.clearAllMeasurements}
        onExport={measurement.exportMeasurements}
      />
    </View>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function StatItem({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

function DimensionItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dimensionItem}>
      <Text style={styles.dimensionLabel}>{label}</Text>
      <Text style={styles.dimensionValue}>{value}</Text>
    </View>
  );
}

function PropertyRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.propertyRow}>
      <Text style={styles.propertyLabel}>{label}:</Text>
      <Text style={[styles.propertyValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

function TutorialModal({ step, onNext, onPrev, onClose }: any) {
  const stage = TUTORIAL_STAGES[step];
  return (
    <View style={styles.tutorialOverlay}>
      <View style={styles.tutorialModal}>
        <View style={styles.tutorialHeader}>
          <Text style={styles.tutorialTitle}>{stage?.emoji} {stage?.name?.replace('_', ' ').toUpperCase()}</Text>
          <TouchableOpacity onPress={onClose} style={styles.tutorialClose}>
            <Text style={styles.tutorialCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.tutorialDescription}>{stage?.message}</Text>
        <View style={styles.tutorialDots}>
          {TUTORIAL_STAGES.map((_, i) => (
            <View key={i} style={[styles.tutorialDot, i === step && styles.tutorialDotActive]} />
          ))}
        </View>
        <View style={styles.tutorialButtons}>
          {step > 0 && (
            <TouchableOpacity style={styles.tutorialNavButton} onPress={onPrev}>
              <Text style={styles.tutorialNavText}>← Previous</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tutorialNavButton, styles.tutorialNavPrimary]}
            onPress={step < TUTORIAL_STAGES.length - 1 ? onNext : onClose}
          >
            <Text style={styles.tutorialNavText}>
              {step < TUTORIAL_STAGES.length - 1 ? 'Next →' : 'Got it! ✓'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.helpPanel}>
      <View style={styles.helpHeader}>
        <Text style={styles.helpTitle}>💡 Interactive Help</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.helpClose}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.helpContent}>
        <HelpItem title="📷 Start Scanning" text="Tap 'Start Room Scan' to begin. Move your device slowly around the room." />
        <HelpItem title="📏 Understanding Results" text="View room dimensions, obstacles, and properties. Toggle between metric and imperial units." />
        <HelpItem title="🗺️ Floor Plan" text="Toggle floor plan view to see a 2D visualization of your room layout." />
        <HelpItem title="📊 Statistics" text="Monitor scan confidence, planes detected, obstacles found, and processing time." />
        <HelpItem title="💾 Save & Share" text="Save scans to history and share results. Access previous scans from the history panel." />
      </ScrollView>
    </View>
  );
}

function HelpItem({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.helpItem}>
      <Text style={styles.helpItemTitle}>{title}</Text>
      <Text style={styles.helpItemText}>{text}</Text>
    </View>
  );
}

function ProfessionalReportCard({ report }: { report: any }) {
  return (
    <View style={styles.professionalCard}>
      <Text style={styles.professionalTitle}>🏆 Professional Design Report</Text>
      <Text style={styles.professionalSubtitle}>
        Accuracy: {report.dimensions.accuracy}% (±{100 - report.dimensions.accuracy}%)
      </Text>
      
      {/* Material Calculations */}
      <View style={styles.reportSection}>
        <Text style={styles.reportSectionTitle}>📐 Material Calculations</Text>
        <View style={styles.materialGrid}>
          <MaterialItem label="Paint" value={`${report.materialCalculations.paint.paintLiters}L`} />
          <MaterialItem label="Flooring" value={`${report.materialCalculations.flooring.totalRequired.toFixed(1)}m²`} />
          <MaterialItem label="Baseboards" value={`${report.materialCalculations.baseboards.linearMeters.toFixed(1)}m`} />
        </View>
      </View>

      {/* Design Analysis */}
      <View style={styles.reportSection}>
        <Text style={styles.reportSectionTitle}>🔍 Design Analysis</Text>
        <View style={styles.analysisItem}>
          <Text style={styles.analysisLabel}>Traffic Flow:</Text>
          <Text style={[styles.analysisValue, getRatingColor(report.designAnalysis.trafficFlow.overallRating)]}>
            {report.designAnalysis.trafficFlow.overallRating.toUpperCase()}
          </Text>
        </View>
        <View style={styles.analysisItem}>
          <Text style={styles.analysisLabel}>Natural Light Score:</Text>
          <Text style={styles.analysisValue}>{report.designAnalysis.lighting.naturalLightScore}/100</Text>
        </View>
      </View>
    </View>
  );
}

function MaterialItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.materialItem}>
      <Text style={styles.materialLabel}>{label}</Text>
      <Text style={styles.materialValue}>{value}</Text>
    </View>
  );
}

function MeasurementHistoryModal({ visible, onClose, measurements, useMetric, onDelete, onClearAll, onExport }: any) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.measurementModal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📋 Measurement History</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {measurements.length === 0 ? (
            <View style={styles.emptyMeasurements}>
              <Text style={styles.emptyIcon}>📏</Text>
              <Text style={styles.emptyText}>No measurements yet</Text>
              <Text style={styles.emptyHint}>Use the Measure tool to tap two points and get the distance.</Text>
            </View>
          ) : (
            <>
              <ScrollView style={styles.measurementsList}>
                {measurements.map((m: any, i: number) => (
                  <View key={m.id} style={styles.measurementItem}>
                    <View style={styles.measurementItemHeader}>
                      <Text style={styles.measurementNumber}>#{i + 1}</Text>
                      {m.label && <Text style={styles.measurementItemLabel}>{m.label}</Text>}
                      <TouchableOpacity onPress={() => onDelete(m.id)}>
                        <Text style={styles.deleteIcon}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.measurementDistance}>{formatDimension(m.distance, useMetric)}</Text>
                    <Text style={styles.measurementTimestamp}>
                      {new Date(m.createdAt).toLocaleString()}
                    </Text>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.measurementActions}>
                <TouchableOpacity style={styles.clearButton} onPress={onClearAll}>
                  <Text style={styles.clearText}>🗑️ Clear All</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.exportButton} onPress={onExport}>
                  <Text style={styles.exportText}>📤 Export</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9F9F9' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20, backgroundColor: '#FFFFFF' },
  backButton: { fontSize: 16, color: '#007AFF', fontWeight: '600' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0, 122, 255, 0.1)', justifyContent: 'center', alignItems: 'center' },
  headerButtonText: { fontSize: 18 },
  content: { padding: 20 },
  scanView: { backgroundColor: '#1a1a1a', borderRadius: 20, minHeight: 300, alignItems: 'center', justifyContent: 'center', marginBottom: 20, padding: 40 },
  scanPlaceholder: { alignItems: 'center' },
  scanEmoji: { fontSize: 80, marginBottom: 20 },
  scanTitle: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 12 },
  scanSubtitle: { fontSize: 14, color: '#999', textAlign: 'center' },
  measurementView: { alignItems: 'center' },
  measurementEmoji: { fontSize: 60, marginBottom: 12 },
  measurementTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 8 },
  measurementSubtitle: { fontSize: 14, color: '#999', textAlign: 'center' },
  activePoint: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  pointDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#00FF00', marginRight: 8 },
  pointText: { color: '#00FF00', fontSize: 12 },
  depthGrid: { marginTop: 20, padding: 16, backgroundColor: 'rgba(0, 255, 0, 0.1)', borderRadius: 12 },
  depthGridText: { color: '#00FF00', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  depthBar: { height: 4, backgroundColor: 'rgba(0, 255, 0, 0.2)', borderRadius: 2, marginVertical: 8 },
  depthBarFill: { height: '100%', backgroundColor: '#00FF00', borderRadius: 2 },
  depthConfidenceText: { color: '#00FF00', fontSize: 11, textAlign: 'center' },
  completeView: { alignItems: 'center' },
  completeEmoji: { fontSize: 60, marginBottom: 16 },
  completeText: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 8 },
  completeSubtext: { fontSize: 14, color: '#999' },
  scanButton: { backgroundColor: '#007AFF', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  scanButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  toolsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  toolButton: { flex: 1, backgroundColor: '#F5F5F5', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  toolButtonActive: { backgroundColor: '#E0F2FE', borderWidth: 1, borderColor: '#007AFF' },
  toolIcon: { fontSize: 20, marginBottom: 4 },
  toolText: { fontSize: 12, color: '#666', fontWeight: '600' },
  calibrationStatus: { backgroundColor: '#D1FAE5', padding: 16, borderRadius: 12, marginBottom: 16 },
  calibrationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  calibrationTitle: { fontSize: 14, fontWeight: '600', color: '#065F46' },
  calibrationReset: { fontSize: 12, color: '#007AFF' },
  calibrationText: { fontSize: 12, color: '#065F46' },
  measurementModeCard: { backgroundColor: '#FEF3C7', padding: 16, borderRadius: 12, marginBottom: 16 },
  measurementModeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  measurementModeTitle: { fontSize: 16, fontWeight: '600', color: '#92400E' },
  measurementModeExit: { fontSize: 14, color: '#007AFF' },
  measurementInstructions: { fontSize: 14, color: '#92400E', marginBottom: 12 },
  pointInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pointLabel: { fontSize: 12, color: '#666' },
  pointValue: { fontSize: 12, fontWeight: '600', color: '#1a1a1a' },
  cancelButton: { marginLeft: 'auto' },
  cancelText: { fontSize: 12, color: '#EF4444' },
  labelInput: { backgroundColor: '#FFFFFF', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5' },
  errorCard: { backgroundColor: '#FEE2E2', padding: 16, borderRadius: 12, marginBottom: 16 },
  errorText: { color: '#DC2626', fontSize: 14, marginBottom: 12 },
  retryButton: { backgroundColor: '#DC2626', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  retryText: { color: '#FFFFFF', fontWeight: '600' },
  statsCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#E5E5E5' },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statItem: { width: '47%', backgroundColor: '#F8F9FA', borderRadius: 12, padding: 16, alignItems: 'center' },
  statLabel: { fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase' },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#007AFF' },
  dataCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#E5E5E5' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  unitToggle: { backgroundColor: '#F5F5F5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  unitText: { fontSize: 14, fontWeight: '600', color: '#007AFF' },
  dimensionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  dimensionItem: { width: '47%', backgroundColor: '#F8F9FA', borderRadius: 12, padding: 16, alignItems: 'center' },
  dimensionLabel: { fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase' },
  dimensionValue: { fontSize: 18, fontWeight: 'bold', color: '#007AFF' },
  volumeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E5E5E5' },
  volumeLabel: { fontSize: 14, color: '#666', fontWeight: '600' },
  volumeValue: { fontSize: 16, fontWeight: 'bold', color: '#007AFF' },
  propertyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  propertyLabel: { fontSize: 14, color: '#666' },
  propertyValue: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  viewTabs: { flexDirection: 'row', backgroundColor: '#F5F5F5', borderRadius: 12, padding: 4, marginBottom: 16 },
  viewTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  viewTabActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  viewTabText: { fontSize: 14, fontWeight: '600', color: '#666' },
  viewTabTextActive: { color: '#007AFF' },
  insightItem: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#F0F9FF', borderRadius: 8, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#007AFF' },
  insightText: { fontSize: 14, color: '#1a1a1a', lineHeight: 20 },
  roomTypeSuggestion: { marginTop: 12, padding: 12, backgroundColor: '#FEF3C7', borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roomTypeLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  roomTypeValue: { fontSize: 15, color: '#D97706', fontWeight: 'bold' },
  floorPlanToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleArrow: { fontSize: 16, color: '#007AFF' },
  obstaclePreviewItem: { width: 80, alignItems: 'center', marginRight: 12, padding: 12, backgroundColor: '#F8F9FA', borderRadius: 12 },
  obstacleEmoji: { fontSize: 28, marginBottom: 8 },
  obstacleLabel: { fontSize: 11, color: '#666', textAlign: 'center' },
  viewMoreButton: { width: 80, alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: '#E0F2FE', borderRadius: 12 },
  viewMoreText: { fontSize: 12, color: '#007AFF', fontWeight: '600' },
  wallsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wallItem: { width: '47%', backgroundColor: '#F8F9FA', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#E5E7EB' },
  wallOrientation: { fontSize: 11, color: '#666', fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  wallLength: { fontSize: 18, fontWeight: 'bold', color: '#007AFF', marginBottom: 4 },
  wallDetails: { fontSize: 10, color: '#999', marginTop: 4 },
  noObstacles: { fontSize: 14, color: '#999', fontStyle: 'italic', textAlign: 'center', paddingVertical: 20 },
  obstacleItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  obstacleIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  obstacleItemEmoji: { fontSize: 24 },
  obstacleInfo: { flex: 1 },
  obstacleType: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  obstacleDetails: { fontSize: 12, color: '#666' },
  obstacleDistance: { fontSize: 11, color: '#999', marginTop: 2 },
  actions: { marginTop: 8, gap: 12 },
  actionButton: { backgroundColor: '#F5F5F5', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  actionButtonText: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  whiteText: { color: '#FFFFFF' },
  infoButton: { backgroundColor: '#5856D6' },
  secondaryButton: { backgroundColor: '#34C759' },
  professionalButton: { backgroundColor: '#007AFF' },
  historyButton: { backgroundColor: '#AF52DE' },
  resetButton: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E5E5' },
  resetText: { color: '#666' },
  professionalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginTop: 16, borderWidth: 1, borderColor: '#007AFF' },
  professionalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 8 },
  professionalSubtitle: { fontSize: 12, color: '#666', marginBottom: 16 },
  reportSection: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E5E5E5' },
  reportSectionTitle: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  materialGrid: { flexDirection: 'row', gap: 12 },
  materialItem: { flex: 1, backgroundColor: '#F8F9FA', padding: 12, borderRadius: 8, alignItems: 'center' },
  materialLabel: { fontSize: 11, color: '#666', marginBottom: 4 },
  materialValue: { fontSize: 16, fontWeight: 'bold', color: '#007AFF' },
  analysisItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  analysisLabel: { fontSize: 13, color: '#666' },
  analysisValue: { fontSize: 13, fontWeight: '600' },
  historyItem: { width: 140, backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12, marginRight: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  historyDate: { fontSize: 11, color: '#666', marginBottom: 4 },
  historyDimensions: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  historyConfidence: { fontSize: 11, color: '#007AFF' },
  tutorialOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  tutorialModal: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  tutorialHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  tutorialTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a1a' },
  tutorialClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  tutorialCloseText: { fontSize: 18, color: '#666' },
  tutorialDescription: { fontSize: 14, color: '#666', lineHeight: 22, marginBottom: 20 },
  tutorialDots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 },
  tutorialDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5E5E5' },
  tutorialDotActive: { backgroundColor: '#007AFF' },
  tutorialButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  tutorialNavButton: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#F5F5F5' },
  tutorialNavPrimary: { backgroundColor: '#007AFF' },
  tutorialNavText: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  helpPanel: { position: 'absolute', top: 100, left: 20, right: 20, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, maxHeight: 400, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  helpHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  helpTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a1a' },
  helpClose: { fontSize: 20, color: '#666' },
  helpContent: { maxHeight: 300 },
  helpItem: { marginBottom: 16 },
  helpItemTitle: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  helpItemText: { fontSize: 13, color: '#666', lineHeight: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' },
  measurementModal: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#E5E5E5' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a' },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { fontSize: 18, color: '#666' },
  emptyMeasurements: { alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  emptyHint: { fontSize: 14, color: '#666', textAlign: 'center' },
  measurementsList: { padding: 20 },
  measurementItem: { backgroundColor: '#F8F9FA', padding: 16, borderRadius: 12, marginBottom: 12 },
  measurementItemHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  measurementNumber: { fontSize: 12, fontWeight: '600', color: '#007AFF', marginRight: 8 },
  measurementItemLabel: { flex: 1, fontSize: 14, color: '#1a1a1a' },
  deleteIcon: { fontSize: 16 },
  measurementDistance: { fontSize: 24, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 4 },
  measurementTimestamp: { fontSize: 11, color: '#999' },
  measurementActions: { flexDirection: 'row', padding: 20, gap: 12 },
  clearButton: { flex: 1, backgroundColor: '#FEE2E2', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  clearText: { color: '#DC2626', fontWeight: '600' },
  exportButton: { flex: 1, backgroundColor: '#007AFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  exportText: { color: '#FFFFFF', fontWeight: '600' },
});
