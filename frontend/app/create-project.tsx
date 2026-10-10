/**
 * Create Project Screen
 * Allows users to create a new interior design project
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { projectService } from '@/services/ProjectService';
import type { RoomType, DesignStyle, CreateProjectInput } from '@/types/project';
import { useTheme } from '@/contexts/ThemeContext';
import { AnimatedButton, AnimatedCard, FadeInView, SlideInView, ScaleInView } from '@/components/interactive';
import { getHorizontalPadding, isSmallScreen, getResponsiveFontSize, getResponsiveButtonHeight } from '@/utils/responsive';

const ROOM_TYPES: RoomType[] = [
  'Living Room',
  'Bedroom',
  'Kitchen',
  'Bathroom',
  'Office',
  'Dining Room',
  'Kids Room',
  'Outdoor',
];

const ROOM_EMOJIS: Record<RoomType, string> = {
  'Living Room': '🛋️',
  'Bedroom': '🛏️',
  'Kitchen': '🍳',
  'Bathroom': '🚿',
  'Office': '💼',
  'Dining Room': '🍽️',
  'Kids Room': '🧸',
  'Outdoor': '🌳',
};

const DESIGN_STYLES: DesignStyle[] = [
  'Modern',
  'Contemporary',
  'Minimalist',
  'Scandinavian',
  'Industrial',
  'Bohemian',
  'Traditional',
  'Rustic',
  'Mid-Century',
  'Eclectic',
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const getCardWidth = () => {
  const horizontalPadding = getHorizontalPadding(20);
  const gap = 12;
  const availableWidth = SCREEN_WIDTH - (horizontalPadding * 2);
  return Math.floor((availableWidth - gap) / 2);
};
const CARD_WIDTH = getCardWidth();

export default function CreateProjectScreen() {
  const router = useRouter();
  const { roomType: roomParam } = useLocalSearchParams<{ roomType?: string }>();
  const { colors, statusBarStyle } = useTheme();
  const [step, setStep] = useState<'name' | 'room' | 'style' | 'dimensions'>('name');
  
  // Form state
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<RoomType | null>(
    ROOM_TYPES.find(room => room === roomParam) ?? null
  );
  const [selectedStyle, setSelectedStyle] = useState<DesignStyle | null>(null);
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('2.5');
  const [isCreating, setIsCreating] = useState(false);

  const handleNextFromName = () => {
    if (!projectName.trim()) {
      Alert.alert('Required', 'Please enter a project name');
      return;
    }
    // A room chosen on the Home screen skips the room step.
    setStep(selectedRoom ? 'style' : 'room');
  };

  const handleRoomSelect = (room: RoomType) => {
    setSelectedRoom(room);
    setStep('style');
  };

  const handleStyleSelect = (style: DesignStyle) => {
    setSelectedStyle(style);
    setStep('dimensions');
  };

  const handleSkipDimensions = async () => {
    // Validate required fields before skipping
    if (!selectedRoom) {
      Alert.alert('Missing Information', 'Please select a room type first');
      setStep('room');
      return;
    }
    await createProject();
  };

  const handleCreateProject = async () => {
    // Validate required fields
    if (!selectedRoom) {
      Alert.alert('Missing Information', 'Please select a room type');
      setStep('room');
      return;
    }

    // Validate dimensions if provided
    if (length || width) {
      const lengthNum = parseFloat(length);
      const widthNum = parseFloat(width);
      const heightNum = height ? parseFloat(height) : 2.5; // Default to 2.5m if empty

      if (isNaN(lengthNum) || isNaN(widthNum) || isNaN(heightNum)) {
        Alert.alert('Invalid Dimensions', 'Please enter valid numbers');
        return;
      }

      if (lengthNum <= 0 || widthNum <= 0 || heightNum <= 0) {
        Alert.alert('Invalid Dimensions', 'Dimensions must be greater than 0');
        return;
      }

      // Validate reasonable dimensions (prevent unrealistic values)
      if (lengthNum > 100 || widthNum > 100 || heightNum > 10) {
        Alert.alert(
          'Unusual Dimensions',
          'The dimensions seem unusually large. Please verify your measurements are in meters.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue Anyway', onPress: () => createProject() },
          ]
        );
        return;
      }
    }

    await createProject();
  };

  const createProject = async () => {
    // Prevent double submission
    if (isCreating) {
      return;
    }

    // Final validation
    if (!projectName.trim()) {
      Alert.alert('Missing Information', 'Please enter a project name');
      setStep('name');
      return;
    }

    if (!selectedRoom) {
      Alert.alert('Missing Information', 'Please select a room type');
      setStep('room');
      return;
    }

    setIsCreating(true);

    try {
      const input: CreateProjectInput = {
        name: projectName.trim(),
        description: description.trim() || undefined,
        roomType: selectedRoom,
        style: selectedStyle || undefined,
        dimensions: length && width ? {
          length: parseFloat(length),
          width: parseFloat(width),
          height: height ? parseFloat(height) : 2.5, // Default height if empty
        } : undefined,
      };

      const project = await projectService.createProject(input);
      
      Alert.alert(
        '✅ Project Created!',
        `"${project.name}" has been created successfully.`,
        [
          {
            text: 'Start Designing',
            onPress: () => router.push({ pathname: '/ai-design', params: { projectId: project.id } }),
          },
          {
            text: 'Go to Home',
            onPress: () => router.push('/(tabs)'),
          },
        ]
      );
    } catch (error) {
      console.error('[CreateProject] Error creating project:', error);
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Failed to create project. Please try again.';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  // Render Name Step
  if (step === 'name') {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style={statusBarStyle} />
        <View style={[styles.header, { backgroundColor: colors.surfacePrimary, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.push('/')}>
            <Text style={[styles.backButton, { color: colors.accent }]}>← Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>New Project</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stepIndicator}>
            <View style={[styles.stepDot, { backgroundColor: colors.border }, styles.stepDotActive, { backgroundColor: colors.accent }]} />
            <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
            <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
            <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
          </View>

          <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>What&apos;s your project name?</Text>
          <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>Give your interior design project a memorable name</Text>

          <TextInput
            style={[styles.input, { backgroundColor: colors.surfacePrimary, borderColor: colors.border, color: colors.textPrimary }]}
            placeholder="e.g., Modern Living Room Makeover"
            placeholderTextColor={colors.textMuted}
            value={projectName}
            onChangeText={setProjectName}
            autoFocus
            maxLength={50}
          />

          <Text style={[styles.inputLabel, { color: colors.textPrimary }]}>Description (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: colors.surfacePrimary, borderColor: colors.border, color: colors.textPrimary }]}
            placeholder="Add a brief description of your vision..."
            placeholderTextColor={colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            maxLength={200}
          />

          <SlideInView direction="bottom" delay={300}>
            <AnimatedButton
              style={[styles.primaryButton, { backgroundColor: colors.accent }, !projectName.trim() && styles.buttonDisabled]}
              onPress={handleNextFromName}
              disabled={!projectName.trim()}
              hapticType="medium"
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </AnimatedButton>
          </SlideInView>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Render Room Type Step
  if (step === 'room') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar style={statusBarStyle} />
        <View style={[styles.header, { backgroundColor: colors.surfacePrimary, borderBottomColor: colors.border }]}>
          <AnimatedButton onPress={() => setStep('name')} hapticType="light">
            <Text style={[styles.backButton, { color: colors.accent }]}>← Back</Text>
          </AnimatedButton>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>New Project</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView style={styles.content}>
          <View style={styles.stepIndicator}>
            <View style={[styles.stepDot, { backgroundColor: colors.success }, styles.stepDotCompleted]} />
            <View style={[styles.stepDot, { backgroundColor: colors.accent }, styles.stepDotActive]} />
            <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
            <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
          </View>

          <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>Which room?</Text>
          <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>Select the type of space you&apos;re designing</Text>

          <View style={styles.optionsGrid}>
            {ROOM_TYPES.map((room, idx) => (
              <ScaleInView key={room} delay={idx * 50}>
                <AnimatedCard
                  style={[styles.optionCard, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}
                  onPress={() => handleRoomSelect(room)}
                  hapticFeedback={true}
                >
                  <Text style={styles.optionEmoji}>{ROOM_EMOJIS[room]}</Text>
                  <Text style={[styles.optionText, { color: colors.textPrimary }]}>{room}</Text>
                </AnimatedCard>
              </ScaleInView>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // Render Style Step
  if (step === 'style') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar style={statusBarStyle} />
        <View style={[styles.header, { backgroundColor: colors.surfacePrimary, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setStep('room')}>
            <Text style={[styles.backButton, { color: colors.accent }]}>← Back</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>New Project</Text>
          <TouchableOpacity 
            onPress={handleSkipDimensions}
            disabled={isCreating}
          >
            <Text style={[styles.skipButton, { color: colors.accent }, isCreating && styles.buttonDisabled]}>
              {isCreating ? 'Creating...' : 'Skip →'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <View style={styles.stepIndicator}>
            <View style={[styles.stepDot, { backgroundColor: colors.success }, styles.stepDotCompleted]} />
            <View style={[styles.stepDot, { backgroundColor: colors.success }, styles.stepDotCompleted]} />
            <View style={[styles.stepDot, { backgroundColor: colors.accent }, styles.stepDotActive]} />
            <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
          </View>

          <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>Choose a style</Text>
          <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>Pick a design style that resonates with you</Text>

          <View style={styles.styleGrid}>
            {DESIGN_STYLES.map((style, idx) => (
              <ScaleInView key={style} delay={idx * 50}>
                <AnimatedCard
                  style={[styles.styleCard, { backgroundColor: colors.surfacePrimary, borderColor: colors.border }]}
                  onPress={() => handleStyleSelect(style)}
                  hapticFeedback={true}
                >
                  <Text style={[styles.styleText, { color: colors.textPrimary }]}>{style}</Text>
                </AnimatedCard>
              </ScaleInView>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // Render Dimensions Step
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style={statusBarStyle} />
      <View style={[styles.header, { backgroundColor: colors.surfacePrimary, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => setStep('style')}>
          <Text style={[styles.backButton, { color: colors.accent }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>New Project</Text>
        <TouchableOpacity 
          onPress={handleSkipDimensions}
          disabled={isCreating}
        >
          <Text style={[styles.skipButton, { color: colors.accent }, isCreating && styles.buttonDisabled]}>
            {isCreating ? 'Creating...' : 'Skip →'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.stepIndicator}>
          <View style={[styles.stepDot, { backgroundColor: colors.success }, styles.stepDotCompleted]} />
          <View style={[styles.stepDot, { backgroundColor: colors.success }, styles.stepDotCompleted]} />
          <View style={[styles.stepDot, { backgroundColor: colors.success }, styles.stepDotCompleted]} />
          <View style={[styles.stepDot, { backgroundColor: colors.accent }, styles.stepDotActive]} />
        </View>

        <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>Room dimensions</Text>
        <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>Help us generate accurate layouts (Optional)</Text>

        <View style={styles.dimensionsContainer}>
          <View style={styles.dimensionRow}>
            <Text style={[styles.dimensionLabel, { color: colors.textPrimary }]}>Length (meters)</Text>
            <TextInput
              style={[styles.dimensionInput, { backgroundColor: colors.surfacePrimary, borderColor: colors.border, color: colors.textPrimary }]}
              placeholder="e.g., 5.5"
              placeholderTextColor={colors.textMuted}
              value={length}
              onChangeText={setLength}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.dimensionRow}>
            <Text style={[styles.dimensionLabel, { color: colors.textPrimary }]}>Width (meters)</Text>
            <TextInput
              style={[styles.dimensionInput, { backgroundColor: colors.surfacePrimary, borderColor: colors.border, color: colors.textPrimary }]}
              placeholder="e.g., 4.0"
              placeholderTextColor={colors.textMuted}
              value={width}
              onChangeText={setWidth}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.dimensionRow}>
            <Text style={[styles.dimensionLabel, { color: colors.textPrimary }]}>Height (meters)</Text>
            <TextInput
              style={[styles.dimensionInput, { backgroundColor: colors.surfacePrimary, borderColor: colors.border, color: colors.textPrimary }]}
              placeholder="e.g., 2.5"
              placeholderTextColor={colors.textMuted}
              value={height}
              onChangeText={setHeight}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View style={[styles.infoBox, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <Text style={styles.infoIcon}>💡</Text>
          <Text style={[styles.infoText, { color: colors.accentDark }]}>
            You can measure your room later using AR or skip this step for now
          </Text>
        </View>

        <SlideInView direction="bottom" delay={300}>
          <AnimatedButton
            style={[styles.primaryButton, { backgroundColor: colors.accent }, isCreating && styles.buttonDisabled]}
            onPress={handleCreateProject}
            disabled={isCreating}
            hapticType="success"
          >
            <Text style={styles.primaryButtonText}>
              {isCreating ? 'Creating...' : 'Create Project'}
            </Text>
          </AnimatedButton>
        </SlideInView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: getHorizontalPadding(20),
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  backButton: {
    fontSize: 16,
  },
  skipButton: {
    fontSize: 16,
  },
  placeholder: {
    width: 60,
  },
  content: {
    flex: 1,
    paddingHorizontal: getHorizontalPadding(20),
    paddingTop: 30,
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
    gap: 8,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stepDotActive: {
    width: 24,
  },
  stepDotCompleted: {
  },
  stepTitle: {
    fontSize: getResponsiveFontSize(isSmallScreen ? 24 : 28),
    fontWeight: 'bold',
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: getResponsiveFontSize(isSmallScreen ? 14 : 16),
    marginBottom: isSmallScreen ? 20 : 30,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: getHorizontalPadding(16),
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  optionCard: {
    width: CARD_WIDTH,
    borderRadius: 16,
    padding: isSmallScreen ? 16 : 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    minHeight: isSmallScreen ? 100 : 120,
  },
  optionEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  styleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  styleCard: {
    width: CARD_WIDTH,
    borderRadius: 12,
    padding: isSmallScreen ? 14 : 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    minHeight: isSmallScreen ? 50 : 60,
  },
  styleText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  dimensionsContainer: {
    marginBottom: 30,
  },
  dimensionRow: {
    marginBottom: 20,
  },
  dimensionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  dimensionInput: {
    borderRadius: 12,
    paddingHorizontal: getHorizontalPadding(16),
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
  },
  infoBox: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 16,
    marginBottom: 30,
    borderWidth: 1,
  },
  infoIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: isSmallScreen ? 14 : 16,
    alignItems: 'center',
    marginBottom: isSmallScreen ? 30 : 40,
    minHeight: getResponsiveButtonHeight(50),
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonDisabledText: {
    opacity: 0.7,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
