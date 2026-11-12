import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { radii, spacing } from '@/components/ui/theme';
import type { LayoutAlignmentError, LayoutAlignmentPayload } from '@/types/unity-bridge';

interface LayoutAlignmentPanelProps {
  alignment: LayoutAlignmentPayload;
  planWidth?: number;
  planLength?: number;
  onMarkCorner: () => void;
  onUndo: () => void;
  onBack: () => void;
  /** Opens the guide to View in AR. */
  onHelp?: () => void;
}

const ERROR_COPY: Record<Exclude<LayoutAlignmentError, ''>, string> = {
  noFloor: 'No floor under the dot yet. Move your phone slowly over the floor.',
  tooClose: 'Those corners are too close. Pick the far end of the same wall.',
  noRoom: 'The room is still loading. Try again in a moment.',
};

function formatMeters(value?: number): string {
  return value && value > 0 ? `${value.toFixed(2)} m` : '—';
}

export function LayoutAlignmentPanel({
  alignment,
  planWidth,
  planLength,
  onMarkCorner,
  onUndo,
  onBack,
  onHelp,
}: LayoutAlignmentPanelProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const secondCorner = alignment.step === 1;
  const canMark = alignment.floorDetected;
  const errorText = alignment.error ? ERROR_COPY[alignment.error] : null;

  const title = secondCorner ? 'Now the other end of that wall' : 'Mark one end of any wall';
  const body = secondCorner
    ? 'Same wall, where it meets the floor.'
    : 'Stand inside the room. Aim the dot at a corner, where the wall meets the floor.';
  // One line for what matters now, and short: the aim dot is 65% down the screen, and a taller card
  // hid it (2026-11-04).
  const lookingForFloor = !alignment.floorDetected;
  const message = errorText ?? (lookingForFloor ? 'Looking for the floor. Move your phone slowly.' : body);
  const sizeNote = secondCorner && alignment.floorDetected
    ? `Wall so far ${formatMeters(alignment.measuredM)}`
    : planWidth && planLength
      ? `Plan ${planWidth.toFixed(1)} × ${planLength.toFixed(1)} m`
      : '';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + spacing.md, backgroundColor: colors.surfacePrimary }]}
        onPress={onBack}
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>

      {onHelp ? (
        <TouchableOpacity
          style={[styles.helpButton, { top: insets.top + spacing.md, backgroundColor: colors.surfacePrimary }]}
          onPress={onHelp}
          accessibilityLabel="How View in AR works"
        >
          <Ionicons name="help-circle-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      ) : null}

      <View
        style={[
          styles.card,
          { bottom: insets.bottom + spacing.lg, backgroundColor: colors.surfacePrimary },
        ]}
      >
        <View style={styles.stepRow}>
          {[0, 1].map((index) => (
            <View
              key={index}
              style={[
                styles.stepDot,
                { backgroundColor: index <= alignment.step ? colors.accent : colors.border },
              ]}
            />
          ))}
          <Text style={[styles.stepLabel, { color: colors.textSecondary }]}>
            Corner {alignment.step + 1} of 2
          </Text>
          {sizeNote ? (
            <Text style={[styles.sizeNote, { color: colors.textPrimary }]}>{sizeNote}</Text>
          ) : null}
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <View style={styles.messageRow}>
          {lookingForFloor && !errorText ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          <Text
            style={[styles.body, { color: errorText ? colors.danger : colors.textPrimary }]}
            numberOfLines={2}
          >
            {message}
          </Text>
        </View>

        <View style={styles.actions}>
          {secondCorner ? (
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.outline }]}
              onPress={onUndo}
              accessibilityLabel="Undo first corner"
            >
              <Ionicons name="arrow-undo-outline" size={18} color={colors.textPrimary} />
              <Text style={[styles.secondaryText, { color: colors.textPrimary }]}>Undo</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.accent, opacity: canMark ? 1 : 0.45 },
            ]}
            onPress={onMarkCorner}
            disabled={!canMark}
            accessibilityLabel={secondCorner ? 'Mark second corner' : 'Mark first corner'}
          >
            <Ionicons name="locate-outline" size={18} color={colors.background} />
            <Text style={[styles.primaryText, { color: colors.background }]}>Mark corner</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpButton: {
    position: 'absolute',
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  stepLabel: {
    marginLeft: spacing.xs,
    fontSize: 14,
    fontWeight: '600',
  },
  sizeNote: {
    marginLeft: 'auto',
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  body: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    marginRight: spacing.sm,
  },
  secondaryText: {
    marginLeft: spacing.xs,
    fontSize: 15,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    minHeight: 44,
  },
  primaryText: {
    marginLeft: spacing.xs,
    fontSize: 15,
    fontWeight: '700',
  },
});
