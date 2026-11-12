/**
 * Design flow step 7 — final summary: floor plan, furniture list, total cost, save to backend.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/ui/Text';
import { useTheme } from '@/contexts/ThemeContext';
import { radii, spacing } from '@/components/ui/theme';
import { FloorPlanPreview } from '@/components/design-flow/FloorPlanPreview';
import { UNITY_AR_EMBED_ENABLED } from '@/config/unity-ar.config';
import { DesignFlowService } from '@/services/DesignFlowService';
import { getHorizontalPadding } from '@/utils/responsive';
import {
  loadCustomizedLayout,
  loadDesignGeneration,
  saveDesignGeneration,
  loadFinalizedDesign,
  saveFinalizedDesign,
} from '@/utils/designFlowStorage';
import { firstParam, formatPhp } from '@/utils/designFlowFormat';
import { exportFloorPlanPdf } from '@/utils/floorPlanExport';
import { resolveAvailableColorHex } from '@/utils/furnitureCatalogHelpers';
import { generationForSavedLayout, layoutEdited } from '@/utils/savedDesignAr';
import type {
  CustomizedDesignLayout,
  CustomizedLayoutItem,
  DesignFlowGenerationResult,
  DesignProposalV2,
} from '@/types/design-flow';

function layoutFromProposal(
  proposal: DesignProposalV2,
  generation: DesignFlowGenerationResult,
): CustomizedDesignLayout {
  return {
    proposalId: proposal.id,
    sessionId: generation.sessionId,
    measurementId: generation.measurementId,
    projectId: generation.projectId,
    room: generation.room,
    items: proposal.items.map((item) => ({ ...item })),
    totalPhp: proposal.totalPhp,
    updatedAt: Date.now(),
  };
}

function resolveDraftLayout(
  generation: DesignFlowGenerationResult,
  customized: CustomizedDesignLayout | null,
  proposalIdParam?: string,
): { layout: CustomizedDesignLayout; proposalTitle: string } | null {
  if (customized?.items?.length
      && customized.sessionId === generation.sessionId
      && customized.measurementId === generation.measurementId
      && customized.projectId === generation.projectId
      && generation.proposals.some((entry) => entry.id === customized.proposalId)) {
    const proposal =
      generation.proposals.find((entry) => entry.id === customized.proposalId)
      ?? generation.proposals[0];
    return {
      layout: customized,
      proposalTitle: proposal?.title || 'My design',
    };
  }
  const proposal =
    generation.proposals.find((entry) => entry.id === proposalIdParam)
    ?? generation.proposals[0];
  if (!proposal?.items?.length) return null;
  return { layout: layoutFromProposal(proposal, generation), proposalTitle: proposal.title || 'My design' };
}

export default function DesignFinalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    projectId?: string | string[];
    proposalId?: string | string[];
    fromAr?: string | string[];
  }>();
  const { colors, statusBarStyle } = useTheme();
  const sessionIdParam = firstParam(params.sessionId);
  /** AR's Finish opened this screen, so that AR screen is still underneath. */
  const fromAr = firstParam(params.fromAr) === '1';
  const proposalIdParam = firstParam(params.proposalId);

  const [generation, setGeneration] = useState<DesignFlowGenerationResult | null>(null);
  const [layout, setLayout] = useState<CustomizedDesignLayout | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [openingAr, setOpeningAr] = useState(false);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  /** This session already has a saved design (the button then says "Save changes"). */
  const [hasSavedVersion, setHasSavedVersion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (sessionIdParam) {
        const remote = await DesignFlowService.getSession(sessionIdParam);
        const remoteFinal = remote.finalLayout;
        const customized = await loadCustomizedLayout();
        if (remoteFinal?.items?.length) {
          const proposal = remote.proposals.find((entry) => entry.id === remoteFinal.proposalId);
          // Back from AR with changes to the saved design: show them, ready to save again.
          const edited = fromAr && customized?.items?.length
            && customized.sessionId === sessionIdParam
            && customized.proposalId === remoteFinal.proposalId
            && layoutEdited(remoteFinal, customized);
          setLayout(edited ? customized : remoteFinal);
          setTitle(remoteFinal.title || proposal?.title || 'My design');
          setGeneration(remote);
          setSavedSessionId(edited ? null : sessionIdParam);
          setHasSavedVersion(true);
          return;
        }
        const draft = resolveDraftLayout(remote, customized, proposalIdParam);
        if (!draft) {
          setError('No furniture in this layout.');
          return;
        }
        setGeneration(remote);
        setLayout(draft.layout);
        setTitle(draft.proposalTitle);
        setSavedSessionId(null);
        return;
      }

      const localFinal = await loadFinalizedDesign();
      if (localFinal?.finalLayout?.items?.length) {
        setLayout(localFinal.finalLayout);
        setTitle(localFinal.finalLayout.title || 'My design');
        setSavedSessionId(localFinal.sessionId);
        if (localFinal.preferences) {
          setGeneration({
            sessionId: localFinal.sessionId,
            projectId: localFinal.projectId,
            measurementId: localFinal.measurementId,
            room: localFinal.finalLayout.room,
            preferences: localFinal.preferences,
            proposals: [],
          });
        }
        return;
      }

      const stored = await loadDesignGeneration();
      if (!stored) {
        setError('No design to finalize. Generate a layout and customize it in AR first.');
        return;
      }
      const customized = await loadCustomizedLayout();
      const draft = resolveDraftLayout(stored, customized, proposalIdParam || customized?.proposalId);
      if (!draft) {
        setError('No furniture in this layout.');
        return;
      }
      setGeneration(stored);
      setLayout(draft.layout);
      setTitle(draft.proposalTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your design.');
    } finally {
      setLoading(false);
    }
  }, [fromAr, proposalIdParam, sessionIdParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const canViewAr =
    UNITY_AR_EMBED_ENABLED && (Platform.OS === 'ios' || Platform.OS === 'android');
  const budgetPhp = generation?.preferences.budgetPhp ?? 0;
  const overBudget = budgetPhp > 0 && (layout?.totalPhp ?? 0) > budgetPhp;
  const pieceCount = layout?.items.filter((item) => item.role !== 'rug').length ?? 0;

  const prefsLine = useMemo(() => {
    if (!generation?.preferences) return '';
    const { roomType, style, budgetPhp: budget } = generation.preferences;
    return `${roomType} · ${style} · budget ${formatPhp(budget)}`;
  }, [generation]);

  const handleSave = useCallback(async () => {
    if (!layout || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await DesignFlowService.saveFinalDesign(layout, {
        title: title.trim() || 'My design',
        preferences: generation?.preferences,
      });
      await saveFinalizedDesign(result);
      setSavedSessionId(result.sessionId);
      Alert.alert(
        'Design saved',
        'Your final layout is saved. You can return to it from this project anytime.',
        [
          {
            text: 'Home',
            onPress: () => router.replace('/(tabs)'),
          },
          { text: 'Stay here', style: 'cancel' },
        ],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your design.';
      setError(message);
      Alert.alert('Save failed', message);
    } finally {
      setSaving(false);
    }
  }, [generation?.preferences, layout, router, saving, title]);

  /**
   * Opens this design in AR as saved (client request, 2026-11-04), where pieces can be moved again
   * (adviser, 2026-11-11). Finish brings the changes back here to save.
   */
  const handleViewAr = useCallback(async () => {
    if (!layout || !generation || openingAr) return;
    if (fromAr && router.canGoBack()) {
      // The AR screen this came from is still open underneath, with the same pieces.
      router.back();
      return;
    }
    setOpeningAr(true);
    try {
      await saveDesignGeneration(generationForSavedLayout(generation, layout, title.trim() || 'My design'));
      router.push({
        pathname: '/ar-view',
        params: {
          projectId: generation.projectId || firstParam(params.projectId) || '',
          flow: 'design',
          applyLayout: '1',
          proposalId: layout.proposalId,
          measurementId: generation.measurementId || '',
        },
      });
    } catch (err) {
      Alert.alert('Could not open AR', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setOpeningAr(false);
    }
  }, [fromAr, generation, layout, openingAr, params.projectId, router, title]);

  const handleExportPdf = useCallback(async () => {
    if (!layout || exporting) return;
    setExporting(true);
    try {
      const result = await exportFloorPlanPdf({
        title: title.trim() || 'My design',
        room: layout.room,
        items: layout.items,
        totalPhp: layout.totalPhp,
        budgetPhp,
        roomType: generation?.preferences.roomType,
        style: generation?.preferences.style,
      });
      if (result.saved) Alert.alert('Floor plan saved', 'Your floor plan PDF is ready to open or share.');
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Could not create the floor plan PDF.');
    } finally {
      setExporting(false);
    }
  }, [budgetPhp, exporting, generation?.preferences, layout, title]);

  const renderLine = (line: CustomizedLayoutItem) => {
    const tint = line.tintHex ? resolveAvailableColorHex(line.tintHex, line.tintHex) : null;
    return (
      <View key={line.instanceId} style={styles.priceRow}>
        {tint ? (
          <View style={[styles.tintDot, { backgroundColor: tint, borderColor: colors.border }]} />
        ) : (
          <View style={[styles.tintDot, { backgroundColor: colors.surfaceTertiary }]} />
        )}
        <AppText variant="caption" style={{ color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
          {line.displayName}
        </AppText>
        <AppText variant="caption" weight="600" style={{ color: colors.textPrimary }}>
          {formatPhp(line.pricePhp || 0)}
        </AppText>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/design-layouts'))}
            style={[styles.backBtn, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <AppText variant="h3" style={{ color: colors.textPrimary, flex: 1 }}>
            Final design
          </AppText>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && !layout ? (
          <View style={styles.centered}>
            <AppText variant="body" color="textMuted" style={{ textAlign: 'center' }}>
              {error}
            </AppText>
          </View>
        ) : layout ? (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {savedSessionId ? (
              <View style={[styles.savedBanner, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                <AppText variant="caption" style={{ color: colors.accent, flex: 1 }}>
                  Saved · session {savedSessionId.slice(-6)}
                </AppText>
              </View>
            ) : null}

            {prefsLine ? (
              <AppText variant="caption" color="textMuted" style={{ marginBottom: spacing.md }}>
                {prefsLine}
              </AppText>
            ) : null}

            <View style={[styles.card, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}>
              <AppText variant="caption" color="textMuted" style={{ marginBottom: spacing.xs }}>
                Design name
              </AppText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="My design"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.titleInput,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceSecondary,
                  },
                ]}
                editable={!savedSessionId}
              />

              <FloorPlanPreview
                widthM={layout.room.width}
                lengthM={layout.room.length}
                items={layout.items}
                scannedRoom={generation?.scannedRoom}
                maxHeight={200}
              />

              <View style={styles.totalRow}>
                <AppText variant="subtitle" style={{ color: colors.textPrimary }}>
                  Estimated total
                </AppText>
                <AppText variant="subtitle" style={{ color: overBudget ? colors.danger : colors.textPrimary }}>
                  {formatPhp(layout.totalPhp)}
                </AppText>
              </View>
              <AppText variant="caption" color="textMuted">
                {pieceCount} pieces
                {budgetPhp > 0 ? ` · budget ${formatPhp(budgetPhp)}` : ''}
                {overBudget ? ' · over budget' : ''}
              </AppText>

              <View style={styles.priceList}>
                {layout.items.map(renderLine)}
              </View>
            </View>

            {error ? (
              <AppText variant="caption" style={{ color: colors.danger, marginTop: spacing.sm }}>
                {error}
              </AppText>
            ) : null}

            <TouchableOpacity
              onPress={() => void handleSave()}
              disabled={saving || Boolean(savedSessionId)}
              style={[
                styles.saveBtn,
                {
                  backgroundColor: savedSessionId ? colors.surfaceTertiary : colors.accent,
                  opacity: saving ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save final design"
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" />
                  <AppText variant="body" weight="600" style={{ color: '#FFFFFF' }}>
                    {savedSessionId ? 'Already saved' : hasSavedVersion ? 'Save changes' : 'Save final design'}
                  </AppText>
                </>
              )}
            </TouchableOpacity>

            {canViewAr && generation ? (
              <TouchableOpacity
                onPress={() => void handleViewAr()}
                disabled={openingAr}
                style={[styles.secondaryBtn, styles.exportBtn, { borderColor: colors.accent, opacity: openingAr ? 0.7 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="View and change this design in AR"
              >
                {openingAr ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <>
                    <Ionicons name="cube-outline" size={20} color={colors.accent} />
                    <AppText variant="body" weight="600" style={{ color: colors.accent }}>
                      View in AR
                    </AppText>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              onPress={() => void handleExportPdf()}
              disabled={exporting}
              style={[styles.secondaryBtn, styles.exportBtn, { borderColor: colors.border, opacity: exporting ? 0.7 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Export floor plan as PDF"
            >
              {exporting ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={20} color={colors.textPrimary} />
                  <AppText variant="body" style={{ color: colors.textPrimary }}>
                    Export floor plan (PDF)
                  </AppText>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.replace('/(tabs)')}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <AppText variant="body" style={{ color: colors.textPrimary }}>
                Back to home
              </AppText>
            </TouchableOpacity>
          </ScrollView>
        ) : null}
      </SafeAreaView>
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  titleInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  priceList: {
    marginTop: spacing.md,
    gap: 6,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tintDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    minHeight: 48,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  exportBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
