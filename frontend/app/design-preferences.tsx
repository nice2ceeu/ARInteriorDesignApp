/**
 * Design-a-room preferences — room, style, ₱ budget, required furniture.
 * Dimensions come from the Unity scan (or a saved measurement).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/ui/Text';
import { AppDialog } from '@/components/ui/AppDialog';
import { useTheme } from '@/contexts/ThemeContext';
import { radii, spacing } from '@/components/ui/theme';
import { getHorizontalPadding } from '@/utils/responsive';
import { useFurnitureCatalog } from '@/hooks/useFurnitureCatalog';
import { RoomMeasurementService } from '@/services/RoomMeasurementService';
import { DesignFlowService, type RoomFitReason, type RoomFitResult } from '@/services/DesignFlowService';
import { saveDesignGeneration } from '@/utils/designFlowStorage';
import { filterRequiredFurniture, matchesRoom, matchesStyle } from '@/utils/designRequiredFurniture';
import {
  clampBudgetPhp,
  firstParam,
  formatPhp,
  parseDimensionParam,
} from '@/utils/designFlowFormat';
import {
  BUDGET_STEP_PHP,
  DEFAULT_BUDGET_PHP,
  DESIGN_ROOM_TYPES,
  DESIGN_STYLES,
  FALLBACK_REQUIRED_ITEMS,
  MAX_BUDGET_PHP,
  MIN_BUDGET_PHP,
  type DesignRequiredItem,
} from '@/types/design-flow';
import type { RoomMeasurementRecord } from '@/types/room-measurement';

const STEPS = ['Room', 'Style', 'Budget', 'Furniture'] as const;

const UNFIT_LABEL: Record<RoomFitReason, string> = {
  'too-big': 'Too big for this room',
  'too-tall': 'Taller than this room',
  'no-space': 'No free space left for it',
};

type OptionCardProps = {
  label: string;
  hint: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  selected: boolean;
  onPress: () => void;
};

function OptionCard({ label, hint, icon, selected, onPress }: OptionCardProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.optionCard,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surfacePrimary,
          borderColor: selected ? colors.accent : colors.border,
          borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.optionIcon,
          { backgroundColor: selected ? colors.accent : colors.surfaceSecondary },
        ]}
      >
        <Ionicons name={icon} size={22} color={selected ? '#FFFFFF' : colors.accent} />
      </View>
      <AppText variant="body" weight="600" numberOfLines={1} style={{ color: colors.textPrimary }}>
        {label}
      </AppText>
      <AppText variant="caption" color="textMuted" numberOfLines={1}>
        {hint}
      </AppText>
      {selected ? (
        <View style={[styles.optionCheck, { backgroundColor: colors.accent }]}>
          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}
const LAST_STEP = STEPS.length - 1;

export default function DesignPreferencesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    projectId?: string | string[];
    measurementId?: string | string[];
    width?: string | string[];
    depth?: string | string[];
    height?: string | string[];
    dimensionLabel?: string | string[];
    flow?: string | string[];
  }>();
  const { colors, statusBarStyle } = useTheme();
  const { products, loading: catalogLoading } = useFurnitureCatalog();

  const projectId = firstParam(params.projectId);
  const [measurementId, setMeasurementId] = useState(firstParam(params.measurementId));
  const [width, setWidth] = useState(parseDimensionParam(params.width));
  const [depth, setDepth] = useState(parseDimensionParam(params.depth));
  const [height, setHeight] = useState(parseDimensionParam(params.height));
  const [dimensionLabel, setDimensionLabel] = useState(firstParam(params.dimensionLabel));

  const [roomType, setRoomType] = useState('');
  const [style, setStyle] = useState('');
  const [budgetPhp, setBudgetPhp] = useState(DEFAULT_BUDGET_PHP);
  const [budgetDraft, setBudgetDraft] = useState(String(DEFAULT_BUDGET_PHP));
  const [requiredIds, setRequiredIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [measurements, setMeasurements] = useState<RoomMeasurementRecord[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(!width || !depth || !height);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [roomFit, setRoomFit] = useState<RoomFitResult | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const stepComplete = [Boolean(roomType), Boolean(style), budgetPhp > 0, true];
  const canOpenStep = (target: number) => stepComplete.slice(0, target).every(Boolean);
  const goToStep = (target: number) => {
    if (!canOpenStep(target)) return;
    if (step === 2) commitBudget(budgetDraft);
    setStep(target);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const requiredOptions: DesignRequiredItem[] = useMemo(() => {
    if (products.length > 0) {
      return products.map((product) => ({
        id: product.id,
        label: product.name,
        category: product.category,
        subtitle: product.dimensionLabel,
        pricePhp: product.pricePhp,
        styles: product.styles,
        rooms: product.rooms ?? product.roomTypes,
        thumbnailUrl: product.thumbnailUrl,
        quantity: product.quantity,
      }));
    }
    return FALLBACK_REQUIRED_ITEMS;
  }, [products]);

  // Pieces that can't fit the scanned room (with the furniture already in it) aren't recommended
  // (adviser, 2026-10-28). Only for a real scan: the default room says nothing about the user's room.
  useEffect(() => {
    setRoomFit(null);
    if (!width || !depth || !height) return;
    let cancelled = false;
    DesignFlowService.getRoomFit({ width, length: depth, height }, measurementId)
      .then((result) => {
        if (!cancelled) setRoomFit(result);
      })
      .catch(() => {
        // Without the check the list is just not narrowed by size; the layouts still drop misfits.
      });
    return () => {
      cancelled = true;
    };
  }, [measurementId, width, depth, height]);

  const unfitReasons = useMemo(
    () => new Map((roomFit?.unfit ?? []).map((entry) => [entry.id, entry.reason])),
    [roomFit],
  );
  const unfitIds = useMemo(() => new Set(unfitReasons.keys()), [unfitReasons]);

  const requiredFilter = useMemo(
    () => filterRequiredFurniture(requiredOptions, { roomType, style, budgetPhp, selectedIds: requiredIds, unfitIds }),
    [requiredOptions, roomType, style, budgetPhp, requiredIds, unfitIds],
  );

  useEffect(() => {
    setRequiredIds((prev) => {
      const next = prev.filter((id) => {
        const item = requiredOptions.find((option) => option.id === id);
        return item ? matchesRoom(item, roomType) : false;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [requiredOptions, roomType, style]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (measurementId && width && depth && height) {
        setLoadingRooms(false);
        return;
      }
      setLoadingRooms(true);
      try {
        const list = await RoomMeasurementService.getAll(projectId);
        if (cancelled) return;
        setMeasurements(list);
        if (!measurementId && list[0]) {
          applyMeasurement(list[0]);
        }
      } catch {
        if (!cancelled) setMeasurements([]);
      } finally {
        if (!cancelled) setLoadingRooms(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [height, measurementId, projectId, width, depth]);

  const applyMeasurement = (item: RoomMeasurementRecord) => {
    setMeasurementId(item.id);
    setWidth(item.width);
    setDepth(item.depth);
    setHeight(item.height);
    setDimensionLabel(item.dimensionLabel || `${item.width.toFixed(1)} × ${item.depth.toFixed(1)} × ${item.height.toFixed(1)} m`);
  };

  const usingDefaultRoom = !width || !depth || !height;
  const roomWidth = width || 4;
  const roomDepth = depth || 5;
  const roomHeight = height || 2.7;

  const commitBudget = useCallback((raw: string | number) => {
    const next = clampBudgetPhp(typeof raw === 'number' ? raw : Number(raw.replace(/[^0-9.]/g, '')), MIN_BUDGET_PHP, MAX_BUDGET_PHP);
    setBudgetPhp(next);
    setBudgetDraft(String(next));
  }, []);

  const toggleRequired = (id: string) => {
    setRequiredIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const generate = async () => {
    if (!roomType || !style) {
      setError('Choose a room type and a style first.');
      return;
    }
    if (requiredFilter.overBudget) {
      setError(
        `Your required furniture costs ${formatPhp(requiredFilter.selectedTotalPhp)}, which is over your ${formatPhp(budgetPhp)} budget. Raise the budget or remove an item.`,
      );
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      // No scan picked: the scan may still have been saved after the app stopped waiting for it
      // (slow server, 2026-11-12). Without it the layout ignores the room's shape and AR has to be
      // lined up by hand.
      let scanId = measurementId;
      if (!scanId && projectId) {
        const list = await RoomMeasurementService.getAll(projectId).catch(() => []);
        if (list[0]) {
          scanId = list[0].id;
          setMeasurementId(scanId);
        }
      }
      const selected = requiredOptions.filter((item) => requiredIds.includes(item.id));
      const result = await DesignFlowService.generateLayouts(
        {
          roomType,
          style,
          budgetPhp,
          requiredItemIds: selected.map((item) => item.id),
          requiredCategories: selected.map((item) => item.category),
          notes: notes.trim() || undefined,
        },
        { width: roomWidth, length: roomDepth, height: roomHeight },
        { measurementId: scanId, projectId },
      );
      await saveDesignGeneration(result);
      router.push({
        pathname: '/design-layouts',
        params: {
          sessionId: result.sessionId || '',
          projectId: projectId || '',
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate layouts. Check the backend and try again.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            style={[styles.backBtn, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <AppText variant="h3" style={{ color: colors.textPrimary, flex: 1 }}>
            Set preferences
          </AppText>
        </View>

        <View style={styles.stepTabs}>
          {STEPS.map((label, index) => {
            const active = index === step;
            const done = index < step && stepComplete[index];
            const enabled = canOpenStep(index);
            return (
              <TouchableOpacity
                key={label}
                onPress={() => goToStep(index)}
                disabled={!enabled}
                style={[
                  styles.stepTab,
                  {
                    backgroundColor: active ? colors.accent : colors.surfacePrimary,
                    borderColor: active ? colors.accent : colors.border,
                    opacity: enabled ? 1 : 0.5,
                  },
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active, disabled: !enabled }}
                accessibilityLabel={`Step ${index + 1}: ${label}`}
              >
                {done ? (
                  <Ionicons name="checkmark" size={14} color={colors.accent} />
                ) : (
                  <AppText variant="caption" weight="700" style={{ color: active ? '#FFFFFF' : colors.textMuted }}>
                    {index + 1}
                  </AppText>
                )}
                <AppText
                  variant="caption"
                  weight="600"
                  numberOfLines={1}
                  style={{ color: active ? '#FFFFFF' : colors.textPrimary }}
                >
                  {label}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 0 ? (
          <>
          <View style={[styles.dimCard, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
            <AppText variant="label" color="textMuted">
              Room size from scan
            </AppText>
            <AppText variant="subtitle" style={{ color: colors.textPrimary, marginTop: 4 }}>
              {dimensionLabel
                || `${roomWidth.toFixed(1)} m × ${roomDepth.toFixed(1)} m × ${roomHeight.toFixed(1)} m`}
            </AppText>
            {usingDefaultRoom ? (
              <AppText variant="caption" color="textMuted" style={{ marginTop: 6 }}>
                {loadingRooms
                  ? 'Looking up saved room scans…'
                  : 'No scan linked yet — using a default room, or pick one below.'}
              </AppText>
            ) : null}

            {!loadingRooms && measurements.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                {measurements.map((item) => {
                  const selected = item.id === measurementId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => applyMeasurement(item)}
                      style={[
                        styles.roomChip,
                        {
                          backgroundColor: selected ? colors.accentSoft : colors.surfaceSecondary,
                          borderColor: selected ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <AppText variant="caption" style={{ color: selected ? colors.accent : colors.textPrimary }}>
                        {item.name || item.dimensionLabel}
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          <AppText variant="subtitle" style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Room
          </AppText>
          <View style={styles.optionGrid}>
            {DESIGN_ROOM_TYPES.map((item) => (
              <OptionCard
                key={item.id}
                label={item.label}
                hint={item.hint}
                icon={item.icon}
                selected={roomType === item.id}
                onPress={() => setRoomType(item.id)}
              />
            ))}
          </View>
          </>
          ) : null}

          {step === 1 ? (
          <>
          <AppText variant="subtitle" style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Style
          </AppText>
          <View style={styles.optionGrid}>
            {DESIGN_STYLES.map((item) => (
              <OptionCard
                key={item.id}
                label={item.label}
                hint={item.hint}
                icon={item.icon}
                selected={style === item.id}
                onPress={() => setStyle(item.id)}
              />
            ))}
          </View>
          </>
          ) : null}

          {step === 2 ? (
          <>
          <AppText variant="subtitle" style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Budget
          </AppText>
          <View style={[styles.budgetRow, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => commitBudget(budgetPhp - BUDGET_STEP_PHP)}
              style={[styles.stepper, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Decrease budget"
            >
              <Ionicons name="remove" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.budgetField}>
              <AppText variant="caption" color="textMuted">Philippine peso</AppText>
              <TextInput
                value={budgetDraft}
                onChangeText={setBudgetDraft}
                onBlur={() => commitBudget(budgetDraft)}
                keyboardType="number-pad"
                style={[styles.budgetInput, { color: colors.textPrimary }]}
                accessibilityLabel="Budget in pesos"
              />
              <AppText variant="caption" color="textMuted">{formatPhp(budgetPhp)}</AppText>
            </View>
            <TouchableOpacity
              onPress={() => commitBudget(budgetPhp + BUDGET_STEP_PHP)}
              style={[styles.stepper, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Increase budget"
            >
              <Ionicons name="add" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          </>
          ) : null}

          {step === LAST_STEP ? (
          <>
          <AppText variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
            {roomType} · {style} · {formatPhp(budgetPhp)}
          </AppText>
          <AppText variant="subtitle" style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Required furniture
          </AppText>
          <AppText variant="caption" color="textMuted" style={{ marginBottom: spacing.sm }}>
            Optional. Showing in-stock catalog pieces for your room that fit your remaining budget and the scanned
            room (style matches sort first). The layouts place only the pieces you select; select none and we
            suggest a set for you.
          </AppText>
          {catalogLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
          ) : !roomType || !style ? (
            <AppText variant="body" color="textMuted" style={styles.emptyNote}>
              Choose a room and a style to see furniture that fits.
            </AppText>
          ) : (
            <>
            <View
              style={[
                styles.budgetSummary,
                {
                  backgroundColor: requiredFilter.overBudget ? colors.accentSoft : colors.surfacePrimary,
                  borderColor: requiredFilter.overBudget ? colors.danger : colors.border,
                },
              ]}
            >
              <AppText variant="caption" color="textMuted">
                Selected {formatPhp(requiredFilter.selectedTotalPhp)} of {formatPhp(budgetPhp)}
              </AppText>
              <AppText
                variant="body"
                weight="600"
                style={{ color: requiredFilter.overBudget ? colors.danger : colors.textPrimary }}
              >
                {requiredFilter.overBudget
                  ? `Over budget by ${formatPhp(-requiredFilter.remainingPhp)}`
                  : `${formatPhp(requiredFilter.remainingPhp)} left`}
              </AppText>
            </View>
            {requiredFilter.visible.length === 0 ? (
              <AppText variant="body" color="textMuted" style={styles.emptyNote}>
                No in-stock furniture for {roomType.toLowerCase()} fits within {formatPhp(budgetPhp)} yet. Try a
                higher budget or another room type.
              </AppText>
            ) : null}
            <View style={styles.productGrid}>
              {requiredFilter.visible.map((item) => {
                const selected = requiredIds.includes(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => toggleRequired(item.id)}
                    style={[
                      styles.productCard,
                      {
                        backgroundColor: selected ? colors.accentSoft : colors.surfacePrimary,
                        borderColor: selected ? colors.accent : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    {item.thumbnailUrl ? (
                      <Image source={{ uri: item.thumbnailUrl }} style={styles.productThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.productThumb, { backgroundColor: colors.surfaceSecondary }]} />
                    )}
                    <AppText variant="caption" weight="600" style={{ color: colors.textPrimary }} numberOfLines={2}>
                      {item.label}
                    </AppText>
                    {item.subtitle ? (
                      <AppText variant="caption" color="textMuted" numberOfLines={1}>{item.subtitle}</AppText>
                    ) : null}
                    {item.pricePhp ? (
                      <AppText variant="caption" weight="600" style={{ color: colors.accent, marginTop: 2 }}>
                        {formatPhp(item.pricePhp)}
                      </AppText>
                    ) : null}
                    {unfitReasons.has(item.id) ? (
                      <AppText variant="caption" weight="600" style={{ color: colors.danger, marginTop: 2 }}>
                        {UNFIT_LABEL[unfitReasons.get(item.id)!]}
                      </AppText>
                    ) : null}
                    {style && matchesStyle(item, style) ? (
                      <AppText variant="caption" color="textMuted" style={{ marginTop: 2 }}>
                        Matches {style}
                      </AppText>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            {requiredFilter.hiddenUnfit > 0 && roomFit ? (
              <AppText variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
                {requiredFilter.hiddenUnfit} more {requiredFilter.hiddenUnfit === 1 ? 'piece is' : 'pieces are'} hidden
                because {requiredFilter.hiddenUnfit === 1 ? "it doesn't" : "they don't"} fit your{' '}
                {roomFit.room.width.toFixed(1)} × {roomFit.room.length.toFixed(1)} m room
                {roomFit.existingCount > 0
                  ? ` with the ${roomFit.existingCount} ${roomFit.existingCount === 1 ? 'piece' : 'pieces'} already in it`
                  : ''}
                .
              </AppText>
            ) : null}
            {requiredFilter.hiddenOverBudget > 0 ? (
              <AppText variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
                {requiredFilter.hiddenOverBudget} more matching{' '}
                {requiredFilter.hiddenOverBudget === 1 ? 'piece is' : 'pieces are'} hidden because{' '}
                {requiredFilter.hiddenOverBudget === 1 ? 'it costs' : 'they cost'} more than your remaining budget.
              </AppText>
            ) : null}
            </>
          )}

          <AppText variant="subtitle" style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Notes
          </AppText>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else the layout should respect…"
            placeholderTextColor={colors.textMuted}
            multiline
            style={[
              styles.notes,
              {
                color: colors.textPrimary,
                backgroundColor: colors.surfacePrimary,
                borderColor: colors.border,
              },
            ]}
          />

          <TouchableOpacity
            onPress={() => void generate()}
            disabled={generating}
            style={[
              styles.generateBtn,
              { backgroundColor: colors.accent, opacity: generating ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Generate layouts"
          >
            {generating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <AppText variant="body" weight="600" style={{ color: '#FFFFFF' }}>
                Generate layouts
              </AppText>
            )}
          </TouchableOpacity>
          </>
          ) : null}

          {step < LAST_STEP ? (
            <View style={styles.stepNav}>
              {step > 0 ? (
                <TouchableOpacity
                  onPress={() => goToStep(step - 1)}
                  style={[styles.stepNavBtn, { backgroundColor: colors.surfacePrimary, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
                  accessibilityRole="button"
                  accessibilityLabel="Previous step"
                >
                  <AppText variant="body" weight="600" style={{ color: colors.textPrimary }}>Back</AppText>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => goToStep(step + 1)}
                disabled={!stepComplete[step]}
                style={[
                  styles.stepNavBtn,
                  { backgroundColor: colors.accent, opacity: stepComplete[step] ? 1 : 0.5 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Next step"
              >
                <AppText variant="body" weight="600" style={{ color: '#FFFFFF' }}>Next</AppText>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <AppDialog
        visible={Boolean(error)}
        title="Could not generate"
        message={error || ''}
        icon="alert-circle-outline"
        onRequestClose={() => setError(null)}
        actions={[{ label: 'OK', tone: 'primary', onPress: () => setError(null) }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: getHorizontalPadding(spacing.lg),
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: getHorizontalPadding(spacing.lg),
    paddingBottom: spacing.xxl,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  optionCard: {
    width: '48.5%',
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  optionCheck: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: getHorizontalPadding(spacing.lg),
    paddingBottom: spacing.sm,
  },
  stepTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: 4,
  },
  stepNav: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  stepNavBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  roomChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
  },
  sectionTitle: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  choice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  productCard: {
    width: '48%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  productThumb: {
    width: '100%',
    height: 88,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  stepper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetField: {
    flex: 1,
    alignItems: 'center',
  },
  budgetInput: {
    width: '100%',
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: spacing.xs,
  },
  budgetSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  emptyNote: {
    marginVertical: spacing.sm,
  },
  notes: {
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: 'top',
    fontSize: 15,
  },
  generateBtn: {
    marginTop: spacing.xl,
    minHeight: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
