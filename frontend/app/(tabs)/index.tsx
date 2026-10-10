import { View, StyleSheet, Dimensions, ScrollView, Pressable, Animated, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/ui/Text';
import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { spacing, radii } from '@/components/ui/theme';
import { AUTH_USER_STORAGE_KEY } from '@/data/authData';
import { AnimatedButton, AnimatedCard, FadeInView, SlideInView, ScaleInView } from '@/components/interactive';
import { getHorizontalPadding } from '@/utils/responsive';
import { projectService } from '@/services/ProjectService';
import { callApi } from '@/services/apiClient';
import NotificationService from '@/services/NotificationService';
import type { Project, RoomType, ProjectStatus } from '@/types/project';

// Room types offered by Create Project; item counts come from the furniture catalog.
const ROOMS: { type: RoomType; icon: string }[] = [
  { type: 'Living Room', icon: 'tv' },
  { type: 'Bedroom', icon: 'bed' },
  { type: 'Kitchen', icon: 'cafe' },
  { type: 'Bathroom', icon: 'water' },
  { type: 'Office', icon: 'briefcase' },
  { type: 'Dining Room', icon: 'restaurant' },
  { type: 'Kids Room', icon: 'happy' },
  { type: 'Outdoor', icon: 'leaf' },
];

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Draft',
  'in-progress': 'In progress',
  completed: 'Completed',
};

const RECENT_PROJECT_LIMIT = 3;

interface CatalogRoomSummary {
  source: 'client-catalog' | 'sample-catalog';
  rooms: { roomType: string; itemCount: number }[];
}

const formatAge = (timestamp: number) => {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const { width } = Dimensions.get('window');
// Responsive card width for 2x2 grid - accounting for padding and gaps
const getCardWidth = () => {
  const horizontalPadding = getHorizontalPadding(24); // Base padding from content
  const gap = 12; // Gap between cards (spacing.sm)
  const availableWidth = width - (horizontalPadding * 2);
  const cardWidth = (availableWidth - gap) / 2; // Two cards per row with gap
  // Ensure minimum width and reasonable maximum, floor to avoid decimal widths
  return Math.max(140, Math.min(180, Math.floor(cardWidth)));
};
const CARD_W = getCardWidth();
const CARD_GAP = 12; // Gap between cards

// Interactive button with scale + opacity
const Button = ({
  children,
  onPress,
  style,
  activeOpacity = 0.7,
  activeScale = 0.96,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
  activeOpacity?: number;
  activeScale?: number;
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const animateIn = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: activeScale, useNativeDriver: true, speed: 50 }),
      Animated.timing(opacity, { toValue: activeOpacity, duration: 100, useNativeDriver: true }),
    ]).start();
  };

  const animateOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 8 }),
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  };

  return (
    <Pressable onPress={onPress} onPressIn={animateIn} onPressOut={animateOut}>
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};

export default function HomeScreen() {
  const router = useRouter();
  const { colors: t, isDark, toggleTheme, statusBarStyle } = useTheme();
  const [showTip, setShowTip] = useState(true);
  const [userName, setUserName] = useState<string>('User');


  useEffect(() => {
    AsyncStorage.getItem('hideTip').then(v => v === 'true' && setShowTip(false));

    // Load user name from storage
    const loadUserName = async () => {
      try {
        const userData = await AsyncStorage.getItem(AUTH_USER_STORAGE_KEY);
        if (userData) {
          const user = JSON.parse(userData);
          setUserName(user.name || 'User');
        }
      } catch (error) {
        console.error('[Home] Failed to load user name:', error);
      }
    };
    loadUserName();
  }, []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [roomCounts, setRoomCounts] = useState<Record<string, number> | null>(null);
  const [scheduledNotifications, setScheduledNotifications] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      projectService.getProjects()
        .then(list => { if (active) setProjects(list); })
        .catch(error => console.error('[Home] Failed to load projects:', error));
      NotificationService.getScheduledNotifications()
        .then(list => {
          if (active) setScheduledNotifications(list.map(n => n.content.title || 'Scheduled notification'));
        });
      return () => { active = false; };
    }, [])
  );

  useEffect(() => {
    let active = true;
    // Counts are shown only for the client catalog, never for the built-in sample catalog.
    callApi<CatalogRoomSummary>('/designs/rooms', { maxRetries: 0 })
      .then(summary => {
        if (!active || summary.source !== 'client-catalog') return;
        setRoomCounts(Object.fromEntries(summary.rooms.map(r => [r.roomType, r.itemCount])));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const dismissTip = useCallback(async () => {
    setShowTip(false);
    await AsyncStorage.setItem('hideTip', 'true');
  }, []);

  const showNotifications = useCallback(() => {
    Alert.alert(
      'Notifications',
      scheduledNotifications.length
        ? scheduledNotifications.map(title => `• ${title}`).join('\n')
        : 'You have no scheduled notifications.'
    );
  }, [scheduledNotifications]);

  const openProject = useCallback((project: Project) => {
    const final = project.finalDesign;
    if (final) {
      // Completed projects reopen their saved design in 3D Layout
      router.push({
        pathname: '/layout-3d',
        params: {
          designId: final.design.id,
          designData: JSON.stringify(final.design),
          roomDimensions: JSON.stringify(final.roomDimensions),
        },
      });
      return;
    }
    router.push({ pathname: '/ai-design', params: { projectId: project.id } });
  }, [router]);

  const visibleProjects = showAllProjects ? projects : projects.slice(0, RECENT_PROJECT_LIMIT);

  const actions = [
    { icon: 'sparkles', label: 'AI Design', route: '/ai-design' as Href, color: t.purple },
    { icon: 'color-wand', label: 'Themes', route: '/explore' as Href, color: t.pink },
    { icon: 'scan', label: 'AR View', route: '/ar-furniture' as Href, color: t.accent },
    { icon: 'grid', label: '3D Layout', route: '/layout-3d' as Href, color: t.orange },
  ];

  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

          {/* Header with Branding */}
          <View style={styles.header}>
            <FadeInView delay={100}>
              <View style={styles.brandingSection}>
                <View style={[styles.logoContainer, { backgroundColor: t.accent + '15' }]}>
                  <Ionicons name="cube" size={36} color={t.accent} />
                </View>
                <View style={styles.brandingText}>
                  <AppText variant="h2" weight="700" style={[styles.appName, { color: t.textPrimary }]}>
                    AR Interior Design
                  </AppText>
                  <AppText variant="caption" style={[styles.appTagline, { color: t.textSecondary }]}>
                    Design your space with AR
                  </AppText>
                </View>
                <View style={styles.headerActions}>
                  <Button onPress={toggleTheme} activeScale={0.9}>
                    <View style={[styles.headerBtn, { backgroundColor: t.surfacePrimary }]}>
                      <Ionicons name={isDark ? 'sunny' : 'moon'} size={20} color={t.textSecondary} />
                    </View>
                  </Button>
                  <Button onPress={showNotifications} activeScale={0.9}>
                    <View style={[styles.headerBtn, { backgroundColor: t.surfacePrimary }]}>
                      <Ionicons name="notifications-outline" size={20} color={t.textSecondary} />
                      {scheduledNotifications.length > 0 && (
                        <View style={[styles.dot, { backgroundColor: t.accent }]} />
                      )}
                    </View>
                  </Button>
                </View>
              </View>
            </FadeInView>
            <View style={styles.headerContentRow}>
              <View style={styles.headerTextContainer}>
                <AppText variant="body" style={[styles.greeting, { color: t.textSecondary }]}>
                  Welcome back
                </AppText>
                <AppText variant="h1" style={[styles.name, { color: t.textPrimary }]}>
                  {userName}
                </AppText>
              </View>
            </View>
          </View>

          {/* New Project */}
          <Button onPress={() => router.push('/create-project')} style={[styles.newProject, { backgroundColor: t.surfacePrimary }]}>
            <View style={[styles.newIcon, { backgroundColor: t.accentSoft }]}>
              <Ionicons name="add" size={24} color={t.accent} />
            </View>
            <View style={styles.newText}>
              <AppText variant="subtitle" weight="600" style={[styles.newTitle, { color: t.textPrimary }]}>
                New Project
              </AppText>
              <AppText variant="body" style={[styles.newSub, { color: t.textSecondary }]}>
                Start designing your space
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={t.textMuted} />
          </Button>

          {/* Quick Actions */}
          <View style={styles.quickActionsSection}>
            <AppText variant="h2" weight="700" style={[styles.sectionTitle, { color: t.textPrimary }]}>
              Quick Actions
            </AppText>
            <View style={styles.actionsGrid} removeClippedSubviews={false}>
              {actions.map((a, index) => (
                <ScaleInView key={a.label} delay={index * 100}>
                  <AnimatedCard
                    onPress={() => router.push(a.route)}
                    style={[
                      styles.actionCard,
                      { backgroundColor: t.surfacePrimary },
                      index % 2 === 0 && styles.actionCardLeft, // Left column
                      index % 2 === 1 && styles.actionCardRight, // Right column
                    ]}
                    hapticFeedback={true}
                  >
                    <View style={[styles.actionIconContainer, { backgroundColor: a.color + '15' }]}>
                      <Ionicons name={a.icon as any} size={28} color={a.color} />
                    </View>
                    <AppText variant="body" weight="600" style={[styles.actionLabel, { color: t.textPrimary }]}>
                      {a.label}
                    </AppText>
                  </AnimatedCard>
                </ScaleInView>
              ))}
            </View>
          </View>

          {/* Rooms */}
          <View style={styles.sectionRow}>
            <AppText variant="h2" weight="700" style={[styles.sectionTitle, { color: t.textPrimary }]}>
              Rooms
            </AppText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.roomsScroll}
            contentContainerStyle={styles.roomsScrollContent}
          >
            {ROOMS.map((r, i) => {
              const roomColors = [t.purple, t.pink, t.orange, t.accent];
              const color = roomColors[i % roomColors.length];
              const count = roomCounts?.[r.type];
              return (
                <SlideInView key={r.type} direction="right" delay={i * 100}>
                  <AnimatedCard
                    onPress={() => router.push({ pathname: '/create-project', params: { roomType: r.type } })}
                    style={[styles.roomCard, { backgroundColor: t.surfacePrimary }]}
                    hapticFeedback={true}
                  >
                    <View style={[styles.roomIconContainer, { backgroundColor: color + '15' }]}>
                      <Ionicons
                        name={r.icon as any}
                        size={24}
                        color={color}
                      />
                    </View>
                    <AppText variant="body" weight="600" style={[styles.roomName, { color: t.textPrimary }]}>
                      {r.type}
                    </AppText>
                    {count !== undefined && (
                      <AppText variant="caption" style={[styles.roomCount, { color: t.textSecondary }]}>
                        {count} {count === 1 ? 'item' : 'items'}
                      </AppText>
                    )}
                  </AnimatedCard>
                </SlideInView>
              );
            })}
          </ScrollView>

          {/* Recent Projects */}
          <View style={styles.sectionRow}>
            <AppText variant="h2" weight="700" style={[styles.sectionTitle, { color: t.textPrimary }]}>
              Recent Projects
            </AppText>
            {projects.length > RECENT_PROJECT_LIMIT && (
              <Button onPress={() => setShowAllProjects(v => !v)} activeScale={0.95}>
                <AppText variant="body" weight="600" style={[styles.seeAll, { color: t.accent }]}>
                  {showAllProjects ? 'Less' : 'All'}
                </AppText>
              </Button>
            )}
          </View>
          <FadeInView delay={300}>
            <View style={[styles.projectsList, { backgroundColor: t.surfacePrimary }]}>
              {visibleProjects.length === 0 && (
                <Button onPress={() => router.push('/create-project')} style={styles.projectRow}>
                  <View style={[styles.projectIcon, { backgroundColor: t.surfaceSecondary }]}>
                    <Ionicons name="folder-open-outline" size={20} color={t.textSecondary} />
                  </View>
                  <View style={styles.projectInfo}>
                    <AppText variant="subtitle" weight="600" style={[styles.projectName, { color: t.textPrimary }]}>
                      No projects yet
                    </AppText>
                    <AppText variant="caption" style={[styles.projectTime, { color: t.textSecondary }]}>
                      Create a project to see it here
                    </AppText>
                  </View>
                </Button>
              )}
              {visibleProjects.map((p, i) => (
                <ScaleInView key={p.id} delay={i * 100}>
                  <AnimatedCard
                    onPress={() => openProject(p)}
                    style={[
                      styles.projectRow,
                      i < visibleProjects.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }
                    ]}
                    hapticFeedback={true}
                  >
                    <View style={[styles.projectIcon, { backgroundColor: t.surfaceSecondary }]}>
                      <Ionicons name="folder-outline" size={20} color={t.textSecondary} />
                    </View>
                    <View style={styles.projectInfo}>
                      <AppText variant="subtitle" weight="600" style={[styles.projectName, { color: t.textPrimary }]}>
                        {p.name}
                      </AppText>
                      <AppText variant="caption" style={[styles.projectTime, { color: t.textSecondary }]}>
                        {p.roomType}{p.style ? ` · ${p.style}` : ''}
                        {p.finalDesign ? ` · ₱${p.finalDesign.estimatedCostPHP.toLocaleString()}` : ''} · {formatAge(p.updatedAt)}
                      </AppText>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: t.surfaceSecondary }]}>
                      <AppText variant="caption" weight="600" style={[styles.progressText, { color: t.textSecondary }]}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </AppText>
                    </View>
                  </AnimatedCard>
                </ScaleInView>
              ))}
            </View>
          </FadeInView>

          {/* Pro Tip - Dismissable */}
          {showTip && (
            <SlideInView direction="bottom" delay={400}>
              <View style={[styles.tip, { backgroundColor: t.surfacePrimary }]}>
                <View style={[styles.tipIconContainer, { backgroundColor: t.accentSoft }]}>
                  <Ionicons name="bulb-outline" size={22} color={t.accent} />
                </View>
                <View style={styles.tipText}>
                  <AppText variant="subtitle" weight="600" style={[styles.tipTitle, { color: t.textPrimary }]}>
                    Pro Tip
                  </AppText>
                  <AppText variant="body" style={[styles.tipDesc, { color: t.textSecondary }]}>
                    Use AR View for real-time preview of your designs
                  </AppText>
                </View>
                <AnimatedButton onPress={dismissTip} hapticType="light">
                  <View style={[styles.tipClose, { backgroundColor: t.surfaceSecondary }]}>
                    <Ionicons name="close" size={16} color={t.textSecondary} />
                  </View>
                </AnimatedButton>
              </View>
            </SlideInView>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  content: {
    paddingHorizontal: getHorizontalPadding(spacing.lg),
    paddingBottom: spacing.xxl * 3.5, // Extra padding for tab bar + safe area
    paddingTop: spacing.md,
  },

  // Header
  header: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  brandingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  logoContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandingText: {
    flex: 1,
  },
  appName: {
    fontSize: 20,
    letterSpacing: 0.3,
    marginBottom: spacing.xs / 2,
  },
  appTagline: {
    fontSize: 12,
  },
  headerContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerTextContainer: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  name: {
    fontSize: 28,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // New Project
  newProject: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radii.lg,
    marginBottom: spacing.xl,
    gap: spacing.md,
    minHeight: 80,
  },
  newIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newText: {
    flex: 1,
    gap: spacing.xs,
  },
  newTitle: {
    marginBottom: spacing.xs,
  },
  newSub: {
    fontSize: 13,
  },

  // Sections
  sectionTitle: {
    marginBottom: spacing.md,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  seeAll: {
    fontSize: 14,
  },

  // Quick Actions Section
  quickActionsSection: {
    marginBottom: spacing.xl,
    width: '100%',
  },

  // Actions Grid - 2x2 layout
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    width: '100%',
    marginTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  actionCard: {
    width: CARD_W, // Use calculated width for consistent 2-column layout
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    minHeight: 120,
  },
  actionCardLeft: {
    marginRight: CARD_GAP, // Add gap between left and right columns
  },
  actionCardRight: {
    marginRight: 0, // No right margin for right column
  },
  actionIconContainer: {
    marginBottom: spacing.sm,
    width: 56,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: '100%',
  },

  // Rooms
  roomsScroll: {
    marginBottom: spacing.xl,
  },
  roomsScrollContent: {
    paddingRight: spacing.lg,
  },
  roomCard: {
    width: 100,
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    marginRight: spacing.md,
    gap: spacing.sm,
    minHeight: 110,
  },
  roomIconContainer: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  roomName: {
    fontSize: 14,
    textAlign: 'center',
  },
  roomCount: {
    fontSize: 12,
    textAlign: 'center',
  },

  // Projects
  projectsList: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  projectIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  projectName: {
    marginBottom: spacing.xs,
  },
  projectTime: {
    fontSize: 12,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  progressText: {
    fontSize: 12,
  },

  // Tip
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  tipIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: {
    flex: 1,
    gap: spacing.xs,
  },
  tipTitle: {
    marginBottom: spacing.xs,
  },
  tipDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  tipClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
