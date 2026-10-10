import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { callApi } from '@/services/apiClient';
import FloorPlan2D, { FurnitureItem } from '@/components/FloorPlan2D';
import { useTheme } from '@/contexts/ThemeContext';
import RoomDetectionCard from '@/components/RoomDetectionCard';
import { projectService } from '@/services/ProjectService';
import { saveProject } from '@/utils/layout3dStorage';
import { exportAsPDF, shareExportedFile } from '@/utils/layout3dExport';
import {
  toDesignProposal,
  toARLayoutItems,
  type GeneratedLayoutResult as GeneratedLayout,
} from '@/utils/generatedLayout';
import type { DesignStyle, FinalDesign, RoomType } from '@/types/project';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CatalogItem { id: string; type: string; name: string; pricePHP: number }

// ─── Constants ─────────────────────────────────────────────────────────────────

const OBSTACLE_OPTIONS = [
  { label: '🚪 Door', value: 'door' },
  { label: '🪟 Window', value: 'window' },
  { label: '🏛️ Pillar', value: 'pillar' },
  { label: '🪜 Column', value: 'column' },
  { label: '🚿 Bathroom Fixtures', value: 'bathroom fixtures' },
  { label: '🍳 Kitchen Counter', value: 'kitchen counter' },
  { label: '🗄️ Built-in Wardrobe', value: 'built-in wardrobe' },
  { label: '🔥 Fireplace', value: 'fireplace' },
];

const ROOM_TYPES = ['Bedroom', 'Living Room', 'Dining Area', 'Office'];
const STYLE_OPTIONS = ['Minimalist', 'Modern', 'Traditional', 'Scandinavian', 'Industrial'];

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function AIDesignModule() {
  const router = useRouter();
  const { projectId, roomDimensions: scannedDimensions } = useLocalSearchParams<{
    projectId?: string;
    roomDimensions?: string;
  }>();
  const { colors, statusBarStyle } = useTheme();

  // Step: 1=Room Input, 2=Preferences, 3=Loading, 4=Results
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // ── Step 1: Room Dimensions ──
  const [widthInput, setWidthInput] = useState('');
  const [depthInput, setDepthInput] = useState('');
  const [heightInput, setHeightInput] = useState('');
  const [selectedObstacles, setSelectedObstacles] = useState<string[]>([]);

  // ── Step 2: Preferences ──
  const [roomType, setRoomType] = useState('');
  const [style, setStyle] = useState('');
  const [budgetInput, setBudgetInput] = useState('30000');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [requiredFurniture, setRequiredFurniture] = useState<string[]>([]);
  const [detectedLabels, setDetectedLabels] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setRequiredFurniture([]);
    setCatalog([]);
    setCatalogError(null);
    if (roomType) {
      callApi<{ furniture: CatalogItem[] }>(`/designs/furniture/${encodeURIComponent(roomType)}`)
        .then(response => { if (active) setCatalog(response.furniture); })
        .catch(() => { if (active) setCatalogError('Furniture options are unavailable. Check the backend connection.'); });
    }
    return () => { active = false; };
  }, [roomType]);

  // ── Prefill from a saved project ──
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    projectService.getProjectById(projectId).then(project => {
      if (!active || !project) return;
      if (project.dimensions) {
        setWidthInput(String(project.dimensions.width));
        setDepthInput(String(project.dimensions.length));
        setHeightInput(String(project.dimensions.height));
      }
      const projectRoom = project.roomType === 'Dining Room' ? 'Dining Area' : project.roomType;
      if (ROOM_TYPES.includes(projectRoom)) setRoomType(projectRoom);
      if (project.style && STYLE_OPTIONS.includes(project.style)) setStyle(project.style);
    });
    return () => { active = false; };
  }, [projectId]);

  // ── Prefill from Spatial Mapping ──
  useEffect(() => {
    if (!scannedDimensions) return;
    try {
      const { width, length, height } = JSON.parse(scannedDimensions);
      if ([width, length, height].every(value => Number.isFinite(value) && value > 0)) {
        setWidthInput(String(width));
        setDepthInput(String(length));
        setHeightInput(String(height));
      }
    } catch {
      // Ignore malformed params; the user enters measurements manually
    }
  }, [scannedDimensions]);

  // ── Step 4: Results ──
  const [layouts, setLayouts] = useState<GeneratedLayout[]>([]);
  const [activeLayoutIndex, setActiveLayoutIndex] = useState(0);

  // ── Shimmer animation ──
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    if (step === 3) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 900 }),
          withTiming(0.3, { duration: 900 })
        ),
        -1,
        true
      );
    }
  }, [step, opacity]);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // ── Computed values ──
  const roomWidth = parseFloat(widthInput) || 0;
  const roomDepth = parseFloat(depthInput) || 0;
  const roomHeight = parseFloat(heightInput) || 0;
  const availableFloorSpace = parseFloat((roomWidth * roomDepth * 0.75).toFixed(1));
  const isStep1Valid = roomWidth > 0 && roomDepth > 0 && roomHeight > 0;
  const isStep2Valid = roomType !== '' && style !== '' && Number.isFinite(Number(budgetInput)) && Number(budgetInput) > 0;

  // ── Toggle obstacle ──
  const toggleObstacle = useCallback((value: string) => {
    setSelectedObstacles(prev =>
      prev.includes(value) ? prev.filter(o => o !== value) : [...prev, value]
    );
  }, []);

  // ── Generate Layouts ──
  const handleGenerate = async () => {
    setStep(3);
    try {
      const response = await callApi<GeneratedLayout[]>('/design/generate', {
        method: 'POST',
        body: {
          roomDimensions: { width: roomWidth, height: roomHeight, depth: roomDepth },
          detectedObstacles: [...new Set([...selectedObstacles, ...detectedLabels])],
          availableFloorSpace,
          roomType,
          style,
          budgetPHP: Number(budgetInput),
          requiredFurniture,
        },
      });

      if (response && response.length > 0) {
        setLayouts(response);
        setActiveLayoutIndex(0);
        setStep(4);
        const project = projectId ? await projectService.getProjectById(projectId) : null;
        if (project?.status === 'draft') await projectService.updateProjectStatus(project.id, 'in-progress');
      } else {
        throw new Error('No layouts returned');
      }
    } catch (error) {
      console.error('Failed to generate design:', error);
      Alert.alert('Generation Failed', error instanceof Error ? error.message : 'Could not generate layouts. Check your connection and room preferences.');
      setStep(2);
    }
  };

  // ── Result actions ──
  const [isSaving, setIsSaving] = useState(false);
  const room = { width: roomWidth, length: roomDepth, height: roomHeight };

  const openInAR = (layout: GeneratedLayout) => {
    router.push({
      pathname: '/ar-furniture',
      params: { layoutItems: JSON.stringify(toARLayoutItems(layout, room)) },
    });
  };

  const openIn3D = (layout: GeneratedLayout) => {
    const design = toDesignProposal(layout, { room, roomType, style });
    router.push({
      pathname: '/layout-3d',
      params: { designId: design.id, designData: JSON.stringify(design), roomDimensions: JSON.stringify(room) },
    });
  };

  const [isExporting, setIsExporting] = useState(false);
  const exportPdf = async (layout: GeneratedLayout) => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const design = toDesignProposal(layout, { room, roomType, style });
      const uri = await exportAsPDF(design, room, Number(budgetInput));
      await shareExportedFile(uri, 'pdf', design.title);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      Alert.alert('Export Failed', error instanceof Error ? error.message : 'Could not create the PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveFinal = async (layout: GeneratedLayout) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const design = toDesignProposal(layout, { room, roomType, style });
      // Adds the design to the Saved tab, which opens it in 3D Layout
      await saveProject(design, room);

      const finalDesign: FinalDesign = {
        design,
        roomDimensions: room,
        estimatedCostPHP: layout.estimatedCostPHP,
        budgetPHP: Number(budgetInput),
        savedAt: Date.now(),
      };
      const existing = projectId ? await projectService.getProjectById(projectId) : null;
      const project = existing ?? await projectService.createProject({
        name: design.title,
        roomType: (roomType === 'Dining Area' ? 'Dining Room' : roomType) as RoomType,
        style: style as DesignStyle,
        dimensions: room,
      });
      await projectService.updateProject(project.id, { status: 'completed', finalDesign });

      Alert.alert(
        'Design saved',
        `"${project.name}" is saved with its floor plan, ${layout.furniture.length} furniture items and an estimated cost of ₱${layout.estimatedCostPHP.toLocaleString()}.`,
        [
          { text: 'Open in 3D', onPress: () => openIn3D(layout) },
          { text: 'Done', onPress: () => router.push('/(tabs)') },
        ]
      );
    } catch (error) {
      console.error('Failed to save design:', error);
      Alert.alert('Save Failed', error instanceof Error ? error.message : 'Could not save the design. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render: Step 1 — Room Measurement Input ──────────────────────────────────

  const renderStep1 = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Hero */}
      <View style={styles.heroContainer}>
        <Text style={styles.heroEmoji}>📐</Text>
        <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>Room Measurements</Text>
        <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
          Measure your room with a tape measure and enter the values below.
        </Text>
      </View>

      {/* Dimensions Card */}
      <RoomDetectionCard onDetected={setDetectedLabels} />
      <View style={[styles.card, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Room Dimensions</Text>

        <View style={styles.dimensionRow}>
          <View style={styles.dimensionField}>
            <Text style={[styles.dimensionLabel, { color: colors.textSecondary }]}>Width (m)</Text>
            <TextInput
              style={[styles.dimensionInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
              value={widthInput}
              onChangeText={setWidthInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 4.5"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <Text style={[styles.dimensionSeparator, { color: colors.textSecondary }]}>×</Text>
          <View style={styles.dimensionField}>
            <Text style={[styles.dimensionLabel, { color: colors.textSecondary }]}>Depth (m)</Text>
            <TextInput
              style={[styles.dimensionInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
              value={depthInput}
              onChangeText={setDepthInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 3.8"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <Text style={[styles.dimensionSeparator, { color: colors.textSecondary }]}>×</Text>
          <View style={styles.dimensionField}>
            <Text style={[styles.dimensionLabel, { color: colors.textSecondary }]}>Height (m)</Text>
            <TextInput
              style={[styles.dimensionInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
              value={heightInput}
              onChangeText={setHeightInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 2.7"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        {/* Auto-calculated floor space */}
        {isStep1Valid && (
          <View style={[styles.computedRow, { backgroundColor: colors.background }]}>
            <Text style={[styles.computedLabel, { color: colors.textSecondary }]}>Usable floor space</Text>
            <Text style={[styles.computedValue, { color: colors.accent }]}>{availableFloorSpace} m²</Text>
          </View>
        )}
      </View>

      {/* Obstacles Card */}
      <View style={[styles.card, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Obstacles & Fixed Features</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
          Select everything that is permanently in or on your room walls.
        </Text>
        <View style={styles.obstacleGrid}>
          {OBSTACLE_OPTIONS.map(opt => {
            const selected = selectedObstacles.includes(opt.value);
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.obstacleChip,
                  { borderColor: selected ? colors.accent : colors.border },
                  selected && { backgroundColor: colors.accent },
                ]}
                onPress={() => toggleObstacle(opt.value)}
              >
                <Text style={[styles.obstacleChipText, { color: selected ? '#fff' : colors.textPrimary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, !isStep1Valid && styles.primaryButtonDisabled]}
        disabled={!isStep1Valid}
        onPress={() => setStep(2)}
      >
        <Text style={styles.primaryButtonText}>Next: Set Preferences →</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );

  // ─── Render: Step 2 — Preferences ─────────────────────────────────────────────

  const renderStep2 = () => (
    <>
      {/* Room Summary Banner */}
      <View style={[styles.summaryBanner, { backgroundColor: colors.accent }]}>
        <Text style={styles.summaryBannerText}>
          📐 {roomWidth}m × {roomDepth}m × {roomHeight}m  ·  {availableFloorSpace} m²  ·  {selectedObstacles.length} obstacle{selectedObstacles.length !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity onPress={() => setStep(1)}>
          <Text style={styles.summaryBannerEdit}>Edit</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Design Preferences</Text>

        <Text style={[styles.label, { color: colors.textPrimary }]}>Room Type</Text>
        <View style={styles.chipRow}>
          {ROOM_TYPES.map(type => (
            <TouchableOpacity
              key={type}
              style={[
                styles.chip,
                { borderColor: roomType === type ? colors.accent : colors.border },
                roomType === type && { backgroundColor: colors.accent },
              ]}
              onPress={() => setRoomType(type)}
            >
              <Text style={[styles.chipText, { color: roomType === type ? '#fff' : colors.textPrimary }]}>
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.textPrimary }]}>Style Preference</Text>
        <View style={styles.chipRow}>
          {STYLE_OPTIONS.map(sty => (
            <TouchableOpacity
              key={sty}
              style={[
                styles.chip,
                { borderColor: style === sty ? colors.accent : colors.border },
                style === sty && { backgroundColor: colors.accent },
              ]}
              onPress={() => setStyle(sty)}
            >
              <Text style={[styles.chipText, { color: style === sty ? '#fff' : colors.textPrimary }]}>
                {sty}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.textPrimary }]}>Maximum furniture budget (PHP)</Text>
        <TextInput style={[styles.dimensionInput, { color: colors.textPrimary, borderColor: colors.border }]}
          value={budgetInput} onChangeText={setBudgetInput} keyboardType="decimal-pad" placeholder="30000" />
        <Text style={[styles.label, { color: colors.textPrimary }]}>Required furniture</Text>
        {catalogError && <Text style={{ color: colors.textSecondary }}>{catalogError}</Text>}
        <View style={styles.chipRow}>
          {catalog.map(item => (
            <TouchableOpacity key={item.id} style={[styles.chip, { borderColor: colors.border, backgroundColor: requiredFurniture.includes(item.id) ? colors.accent : colors.surfacePrimary }]}
              onPress={() => setRequiredFurniture(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])}>
              <Text style={[styles.chipText, { color: requiredFurniture.includes(item.id) ? '#fff' : colors.textPrimary }]}>{item.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, !isStep2Valid && styles.primaryButtonDisabled, { marginTop: 24 }]}
          disabled={!isStep2Valid}
          onPress={handleGenerate}
        >
          <Text style={styles.primaryButtonText}>✨ Generate Layout</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // ─── Render: Step 3 — Loading Shimmer ─────────────────────────────────────────

  const renderStep3 = () => (
    <Animated.View style={[styles.shimmerContainer, shimmerStyle]}>
      <View style={styles.shimmerOrb}>
        <Text style={{ fontSize: 48 }}>🏠</Text>
      </View>
      <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 24 }} />
      <Text style={[styles.shimmerTitle, { color: colors.textPrimary }]}>Designing your space…</Text>
      <Text style={[styles.shimmerSubtitle, { color: colors.textSecondary }]}>
        Arranging furniture within your room measurements and budget, then comparing the available layouts.
      </Text>
    </Animated.View>
  );

  // ─── Render: Step 4 — Results ──────────────────────────────────────────────────

  const renderStep4 = () => {
    if (layouts.length === 0) return null;
    const activeLayout = layouts[activeLayoutIndex];

    return (
      <View>
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surfacePrimary }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Estimated furniture cost: ₱{activeLayout.estimatedCostPHP.toLocaleString()}</Text>
          <Text style={{ color: colors.textSecondary }}>Estimated catalog prices. Confirm current supplier quotations.</Text>
        </View>
        {/* Summary Banner */}
        <View style={[styles.summaryBanner, { backgroundColor: colors.accent }]}>
          <Text style={styles.summaryBannerText}>
            {roomType}  ·  {style}  ·  {roomWidth}m × {roomDepth}m
          </Text>
          <TouchableOpacity onPress={() => { setStep(2); }}>
            <Text style={styles.summaryBannerEdit}>Change</Text>
          </TouchableOpacity>
        </View>

        {/* Layout Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {layouts.map((layout, idx) => (
            <TouchableOpacity
              key={layout.id}
              style={[styles.tab, activeLayoutIndex === idx && styles.tabActive]}
              onPress={() => setActiveLayoutIndex(idx)}
            >
              <Text style={[styles.tabText, activeLayoutIndex === idx && styles.tabTextActive]}>
                Layout {idx + 1}
              </Text>
              <View style={[styles.scoreBadge, { backgroundColor: layout.score >= 80 ? '#10b981' : layout.score >= 60 ? '#f59e0b' : '#ef4444' }]}>
                <Text style={styles.scoreBadgeText}>{layout.score}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* 2D Floor Plan */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Top-Down Floor Plan</Text>
        <FloorPlan2D
          roomDimensions={{ width: roomWidth, height: roomHeight, depth: roomDepth }}
          furniture={activeLayout.furniture}
          obstacles={selectedObstacles}
        />

        {/* Safety Warnings */}
        {activeLayout.safety_warnings && activeLayout.safety_warnings.length > 0 && (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>⚠️ Safety Warnings</Text>
            {activeLayout.safety_warnings.map((w, i) => (
              <Text key={i} style={styles.warningText}>• {w}</Text>
            ))}
          </View>
        )}

        {/* Furniture Legend */}
        <View style={[styles.card, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Furniture List</Text>
          {activeLayout.furniture.map((item, i) => (
            <View key={i} style={styles.furnitureRow}>
              <View style={[styles.furnitureColorDot, { backgroundColor: item.color }]} />
              <Text style={[styles.furnitureName, { color: colors.textPrimary }]}>{item.name}</Text>
              <Text style={[styles.furnitureDims, { color: colors.textSecondary }]}>
                {item.width}m × {item.depth}m
              </Text>
              <Text style={[styles.furniturePrice, { color: colors.textPrimary }]}>
                {item.pricePHP === undefined ? '—' : `₱${item.pricePHP.toLocaleString()}`}
              </Text>
            </View>
          ))}
          <View style={[styles.costTotalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.furnitureName, { color: colors.textPrimary, fontWeight: '700' }]}>Estimated total</Text>
            <Text style={[styles.furniturePrice, { color: colors.textPrimary, fontWeight: '700' }]}>
              ₱{activeLayout.estimatedCostPHP.toLocaleString()}
            </Text>
          </View>
          {Number(budgetInput) > 0 && (
            <View style={styles.furnitureRow}>
              <Text style={[styles.furnitureName, { color: colors.textSecondary }]}>
                {Number(budgetInput) >= activeLayout.estimatedCostPHP ? 'Remaining budget' : 'Over budget'}
              </Text>
              <Text style={[styles.furniturePrice, { color: Number(budgetInput) >= activeLayout.estimatedCostPHP ? '#10b981' : '#ef4444' }]}>
                ₱{Math.abs(Number(budgetInput) - activeLayout.estimatedCostPHP).toLocaleString()}
              </Text>
            </View>
          )}
        </View>

        {/* Next steps */}
        <View style={styles.resultActions}>
          <TouchableOpacity style={[styles.resultActionButton, { borderColor: colors.accent }]} onPress={() => openInAR(activeLayout)}>
            <Text style={[styles.resultActionText, { color: colors.accent }]}>📷 View in AR</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.resultActionButton, { borderColor: colors.accent }]} onPress={() => openIn3D(activeLayout)}>
            <Text style={[styles.resultActionText, { color: colors.accent }]}>🧊 Open in 3D</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.secondaryOutlineButton, { borderColor: colors.accent, marginBottom: 0, marginTop: 12 }, isExporting && { opacity: 0.6 }]}
          onPress={() => exportPdf(activeLayout)}
          disabled={isExporting}
        >
          <Text style={[styles.resultActionText, { color: colors.accent }]}>
            {isExporting ? 'Preparing PDF…' : '📄 Floor Plan & Cost PDF'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, { marginHorizontal: 16, marginTop: 4 }, isSaving && { opacity: 0.6 }]}
          onPress={() => handleSaveFinal(activeLayout)}
          disabled={isSaving}
        >
          <Text style={styles.primaryButtonText}>{isSaving ? 'Saving…' : '💾 Save Final Design'}</Text>
        </TouchableOpacity>

        {/* Regenerate */}
        <TouchableOpacity style={[styles.secondaryOutlineButton, { borderColor: colors.border }]} onPress={() => setStep(2)}>
          <Text style={[styles.resultActionText, { color: colors.textPrimary }]}>🔄 Regenerate</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Main Render ───────────────────────────────────────────────────────────────

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} keyboardShouldPersistTaps="handled">
      <StatusBar style={statusBarStyle} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surfacePrimary, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.backButton, { color: colors.accent }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>AI Design</Text>
        {/* Step indicator */}
        <View style={styles.stepIndicator}>
          {[1, 2, 3, 4].map(s => (
            <View
              key={s}
              style={[
                styles.stepDot,
                { backgroundColor: step >= s ? colors.accent : colors.border },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.content}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </View>
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backButton: { fontSize: 16, fontWeight: '500', minWidth: 60 },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  stepIndicator: { flexDirection: 'row', gap: 6, minWidth: 60, justifyContent: 'flex-end' },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  content: { paddingBottom: 48 },

  // Hero
  heroContainer: { alignItems: 'center', paddingTop: 32, paddingBottom: 8, paddingHorizontal: 24 },
  heroEmoji: { fontSize: 56, marginBottom: 12 },
  heroTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  heroSubtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },

  // Card
  card: {
    margin: 16,
    marginTop: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, marginBottom: 14, lineHeight: 18 },

  // Dimensions
  dimensionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12 },
  dimensionField: { flex: 1 },
  dimensionLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  dimensionInput: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  dimensionSeparator: { fontSize: 18, fontWeight: '300', marginBottom: 10 },
  computedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  computedLabel: { fontSize: 14 },
  computedValue: { fontSize: 18, fontWeight: '700' },

  // Obstacles
  obstacleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  obstacleChip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  obstacleChipText: { fontSize: 13, fontWeight: '600' },

  // Summary Banner
  summaryBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  summaryBannerText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  summaryBannerEdit: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', marginLeft: 12 },

  // Chips
  label: { fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  chipText: { fontSize: 14, fontWeight: '600' },

  // Primary Button
  primaryButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    shadowColor: '#3b82f6',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0, elevation: 0 },
  resultActions: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 8 },
  resultActionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  resultActionText: { fontSize: 15, fontWeight: '600' },
  secondaryOutlineButton: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    margin: 16,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Shimmer
  shimmerContainer: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  shimmerOrb: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shimmerTitle: { fontSize: 20, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  shimmerSubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Results Tabs
  tabsScroll: { marginTop: 16, marginBottom: 8 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    marginRight: 10,
  },
  tabActive: { backgroundColor: '#3b82f6' },
  tabText: { fontWeight: '700', color: '#475569' },
  tabTextActive: { color: '#fff' },
  scoreBadge: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
  },
  scoreBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  sectionTitle: { fontSize: 17, fontWeight: '700', marginLeft: 16, marginTop: 8, marginBottom: 4 },

  // Warning Card
  warningCard: {
    backgroundColor: '#fef2f2',
    borderColor: '#f87171',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    margin: 16,
    marginTop: 8,
  },
  warningTitle: { color: '#dc2626', fontWeight: '700', fontSize: 15, marginBottom: 8 },
  warningText: { color: '#b91c1c', fontSize: 14, marginBottom: 4, lineHeight: 20 },

  // Furniture Legend
  furnitureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  furnitureColorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  furnitureName: { flex: 1, fontSize: 14, fontWeight: '500' },
  furnitureDims: { fontSize: 13 },
  furniturePrice: { fontSize: 13, fontWeight: '600', minWidth: 78, textAlign: 'right' },
  costTotalRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, marginTop: 4, borderTopWidth: 1 },
});
