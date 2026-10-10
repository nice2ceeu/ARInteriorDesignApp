/**
 * Notification Service
 * Handles push notifications, permissions, and scheduling
 */

import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATION_STORAGE_KEY = 'settings_notifications';
const NOTIFICATION_TOKEN_KEY = 'notification_token';

// Type definitions
interface WebNotification extends Notification {
  data: Record<string, unknown>;
}

interface WindowWithNotification extends Window {
  Notification: typeof Notification & {
    requestPermission(): Promise<NotificationPermission>;
  };
}

interface NotificationData {
  type?: string;
  roomName?: string;
  projectName?: string;
  [key: string]: unknown;
}

interface NotificationTrigger {
  seconds?: number;
  hour?: number;
  minute?: number;
  repeats?: boolean;
  type?: 'timeInterval' | 'date' | 'calendar';
  [key: string]: unknown; // Allow additional trigger properties
}

// The package entry point registers push listeners during import. Avoid it in
// Android Expo Go, where that registration is unsupported even for local use.
let Notifications: typeof import('expo-notifications') | null = null;
let notificationsLoading: Promise<typeof import('expo-notifications') | null> | null = null;

const getNotifications = async () => {
  if (Platform.OS === 'web' ||
      (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient)) {
    return null;
  }
  if (Notifications) return Notifications;
  if (notificationsLoading) return notificationsLoading;
  notificationsLoading = (async () => {
    try {
      // Defer initialization so a component can unmount before attaching listeners.
      await Promise.resolve();
      const notifications = require('expo-notifications') as typeof import('expo-notifications');
      // Configure notification behavior only on native platforms
      notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      Notifications = notifications;
      return notifications;
    } catch (error) {
      console.warn('[NotificationService] Failed to load expo-notifications:', error);
      return null;
    }
  })();
  try {
    return await notificationsLoading;
  } finally {
    notificationsLoading = null;
  }
};

export class NotificationService {
  /**
   * Request notification permissions
   */
  static async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') {
      // Web notifications use browser API
      if (typeof window !== 'undefined' && 'Notification' in window) {
        const permission = await (window as unknown as WindowWithNotification).Notification.requestPermission();
        return permission === 'granted';
      }
      return false;
    }

    try {
      const notifications = await getNotifications();
      if (!notifications) return false;

      const { status: existingStatus } = await notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('[NotificationService] Permission not granted');
        return false;
      }

      // Get and store the push token (only for native platforms)
      try {
        // Try to get push token, but don't fail if projectId is not configured
        const token = await notifications.getExpoPushTokenAsync();
        await AsyncStorage.setItem(NOTIFICATION_TOKEN_KEY, token.data);
        console.log('[NotificationService] Push token:', token.data);
      } catch (error) {
        // Push token might not be available (e.g., projectId not configured)
        // This is okay for local notifications
        console.log('[NotificationService] Push token not available (local notifications will still work):', error);
      }

      return true;
    } catch (error) {
      console.error('[NotificationService] Error requesting permissions:', error);
      return false;
    }
  }

  /**
   * Check if notifications are enabled in settings
   */
  static async isEnabled(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY);
      return value === 'true';
    } catch (error) {
      console.error('[NotificationService] Error checking notification status:', error);
      return false;
    }
  }

  /**
   * Check if permissions are granted
   */
  static async hasPermission(): Promise<boolean> {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        return (window as unknown as WindowWithNotification).Notification.permission === 'granted';
      }
      return false;
    }

    try {
      const notifications = await getNotifications();
      if (!notifications) return false;

      const { status } = await notifications.getPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('[NotificationService] Error checking permissions:', error);
      return false;
    }
  }

  /**
   * Schedule a local notification
   */
  static async scheduleNotification(
    title: string,
    body: string,
    data?: NotificationData,
    trigger?: NotificationTrigger
  ): Promise<string | null> {
    if (Platform.OS === 'web') {
      // Web notifications use browser API
      if (typeof window !== 'undefined' && 'Notification' in window && (window as unknown as WindowWithNotification).Notification.permission === 'granted') {
        const enabled = await this.isEnabled();
        if (!enabled) {
          console.log('[NotificationService] Notifications disabled in settings');
          return null;
        }

        const delay = trigger?.seconds ? trigger.seconds * 1000 : 2000;
        setTimeout(() => {
          new (window as unknown as WindowWithNotification).Notification(title, {
            body,
            icon: '/favicon.ico',
            tag: data?.type || 'default',
            data: data || {},
          });
        }, delay);
        return 'web-notification';
      }
      return null;
    }

    try {
      const notifications = await getNotifications();
      if (!notifications) return null;

      const enabled = await this.isEnabled();
      if (!enabled) {
        console.log('[NotificationService] Notifications disabled in settings');
        return null;
      }

      const hasPermission = await this.hasPermission();
      if (!hasPermission) {
        console.log('[NotificationService] No notification permission');
        return null;
      }

      const notificationId = await notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: data || {},
          sound: true,
        },
        trigger: (trigger || { seconds: 2 }) as import('expo-notifications').NotificationTriggerInput, // Default: show in 2 seconds", "StartLine">202
      });

      return notificationId;
    } catch (error) {
      console.error('[NotificationService] Error scheduling notification:', error);
      return null;
    }
  }

  /**
   * Send a design recommendation notification
   */
  static async sendDesignRecommendation(roomName?: string): Promise<void> {
    await this.scheduleNotification(
      'Design Recommendation',
      `New design ideas available for ${roomName || 'your room'}. Tap to explore!`,
      { type: 'design_recommendation', roomName },
      { seconds: 5 }
    );
  }

  /**
   * Send a project update notification
   */
  static async sendProjectUpdate(projectName: string): Promise<void> {
    await this.scheduleNotification(
      'Project Update',
      `Your project "${projectName}" has been updated.`,
      { type: 'project_update', projectName },
      { seconds: 5 }
    );
  }

  /**
   * Send a daily inspiration notification
   */
  static async scheduleDailyInspiration(): Promise<void> {
    // Cancel any existing daily notifications
    await this.cancelAllNotifications();

    if (Platform.OS === 'web') {
      // Web doesn't support scheduled notifications, skip
      console.log('[NotificationService] Daily notifications not supported on web');
      return;
    }

    // Schedule daily notification at 9 AM (native only)
    await this.scheduleNotification(
      'Daily Design Inspiration',
      'Check out today\'s interior design trends and ideas!',
      { type: 'daily_inspiration' },
      {
        hour: 9,
        minute: 0,
        repeats: true,
      }
    );
  }

  /**
   * Cancel all scheduled notifications
   */
  static async cancelAllNotifications(): Promise<void> {
    if (Platform.OS === 'web') {
      // Web doesn't support canceling scheduled notifications
      return;
    }

    try {
      const notifications = await getNotifications();
      if (!notifications) return;

      await notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('[NotificationService] Error canceling notifications:', error);
    }
  }

  /**
   * Cancel a specific notification
   */
  static async cancelNotification(notificationId: string): Promise<void> {
    if (Platform.OS === 'web') {
      // Web doesn't support canceling scheduled notifications
      return;
    }

    try {
      const notifications = await getNotifications();
      if (!notifications) return;

      await notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      console.error('[NotificationService] Error canceling notification:', error);
    }
  }

  /**
   * Get all scheduled notifications
   */
  static async getScheduledNotifications(): Promise<Array<import('expo-notifications').NotificationRequest>> {
    if (Platform.OS === 'web') {
      return [];
    }

    try {
      const notifications = await getNotifications();
      if (!notifications) return [];

      return await notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('[NotificationService] Error getting scheduled notifications:', error);
      return [];
    }
  }

  /**
   * Set up notification listeners
   */
  static setupListeners(
    onNotificationReceived?: (notification: import('expo-notifications').Notification) => void,
    onNotificationTapped?: (response: import('expo-notifications').NotificationResponse) => void
  ): () => void {
    if (Platform.OS === 'web') {
      // Web notifications use browser events
      const handleNotificationClick = (event: Event) => {
        console.log('[NotificationService] Notification clicked:', event);
        const notificationEvent = event as unknown as { notification: { data: Record<string, unknown>; close: () => void } };
        onNotificationTapped?.({
          notification: {
            request: {
              content: { data: notificationEvent.notification.data }
            }
          }
        } as unknown as import('expo-notifications').NotificationResponse);
        notificationEvent.notification.close();
      };

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'notification') {
            onNotificationReceived?.(event.data);
          }
        });
      }

      // Return cleanup function
      return () => {
        // Cleanup if needed
      };
    }

    // Native platforms
    let disposed = false;
    let receivedListener: { remove(): void } | undefined;
    let responseListener: { remove(): void } | undefined;
    getNotifications().then((notifications) => {
      if (!notifications || disposed) return;

      // Listener for notifications received while app is foregrounded
      receivedListener = notifications.addNotificationReceivedListener((notification) => {
        console.log('[NotificationService] Notification received:', notification);
        onNotificationReceived?.(notification);
      });

      // Listener for when user taps on a notification
      responseListener = notifications.addNotificationResponseReceivedListener((response) => {
        console.log('[NotificationService] Notification tapped:', response);
        onNotificationTapped?.(response);
      });

    });

    // Return cleanup function
    return () => {
      disposed = true;
      receivedListener?.remove();
      responseListener?.remove();
    };
  }
}

export default NotificationService;
