import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { radii, spacing } from '@/components/ui/theme';

/** Set once a guide has been seen: it then opens only from the help buttons. */
export const VIEW_AR_GUIDE_SEEN_KEY = 'arViewGuideSeen';
export const VIEW_ONLY_GUIDE_SEEN_KEY = 'arViewOnlyGuideSeen';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Step = { icon: IoniconName; title: string; body: string };

const LINE_UP: Step = {
  icon: 'locate-outline',
  title: 'Line up your room',
  body: 'If asked, stand inside the room and pick any wall. North, south, east or west makes no difference, and a long wall works best. Aim the dot at one end, where the wall meets the floor, and tap Mark corner. Then do the other end of the same wall. Either end can go first.',
};

const WALK: Step = {
  icon: 'walk-outline',
  title: 'Walk around',
  body: 'Your furniture appears at its real size. Compare it with your floor plan: if it is on the opposite side of the room, tap Turn. Move slowly so it stays in place.',
};

const VIEW_ONLY_STEPS: Step[] = [
  LINE_UP,
  WALK,
  {
    icon: 'eye-outline',
    title: 'Just looking',
    body: 'This shows your saved design as it is. Nothing here changes it. Tap back when you are done.',
  },
];

const EDIT_STEPS: Step[] = [
  LINE_UP,
  WALK,
  {
    icon: 'hand-left-outline',
    title: 'Change a piece',
    body: 'Tap a piece to select it. Drag with one finger to move it, or use two fingers on it to turn it. The panel lets you recolour, swap or lock it.',
  },
  {
    icon: 'checkmark-done-outline',
    title: 'Finish',
    body: 'Tap Finish to see the result and save your changes. If a piece hits a wall or other furniture, the button says Fix first.',
  },
];

interface ViewArGuideProps {
  /** Looking at a saved design: nothing about changing pieces or Finish. */
  viewOnly: boolean;
  onClose: () => void;
}

/**
 * How View in AR works (client request, 2026-11-04). Drawn over the AR view, not as a native
 * Modal: those take window focus, which pauses AR.
 */
export function ViewArGuide({ viewOnly, onClose }: ViewArGuideProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.backdrop, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}
      accessibilityViewIsModal
    >
      <View style={[styles.card, { backgroundColor: colors.surfacePrimary }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          How View in AR works
        </Text>
        <ScrollView style={styles.steps} showsVerticalScrollIndicator={false}>
          {(viewOnly ? VIEW_ONLY_STEPS : EDIT_STEPS).map((step, index) => (
            <View key={step.title} style={styles.step}>
              <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name={step.icon} size={22} color={colors.accent} />
              </View>
              <View style={styles.stepText}>
                <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                  {index + 1}. {step.title}
                </Text>
                <Text style={[styles.stepBody, { color: colors.textPrimary }]}>{step.body}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.accent }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Got it, close the guide"
        >
          <Text style={styles.buttonText}>Got it</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1100,
    elevation: 1100,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  card: {
    maxHeight: '100%',
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  steps: {
    flexGrow: 0,
  },
  step: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepBody: {
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    minHeight: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
