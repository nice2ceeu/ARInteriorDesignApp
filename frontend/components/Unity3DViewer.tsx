/**
 * Unity3DViewer Component
 * Embeds Unity WebGL build for 3D visualization
 * 
 * Note: Requires Unity WebGL build to be hosted or embedded
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';

// Import WebView only on native platforms to avoid Metro bundling issues on web
let WebView: any = null;
if (Platform.OS !== 'web') {
  try {
    // Only require on native - this prevents Metro from trying to bundle it on web
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webviewModule = require('react-native-webview');
    WebView = webviewModule.WebView || webviewModule.default;
  } catch {
    // WebView not available - will show installation instructions
    console.warn('react-native-webview not available');
  }
}

interface Unity3DViewerProps {
  roomDimensions?: {
    width: number;
    length: number;
    height: number;
  };
  furniture?: {
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    rotation: number;
    dimensions: { width: number; length: number; height: number };
  }[];
  viewMode?: 'perspective' | 'top-down' | 'orthographic';
  unityBuildUrl?: string; // URL to Unity WebGL build
  onUnityReady?: () => void;
  onError?: (error: string) => void;
}

export const Unity3DViewer: React.FC<Unity3DViewerProps> = ({
  roomDimensions,
  furniture = [],
  viewMode = 'perspective',
  unityBuildUrl = 'https://your-cdn.com/unity-build/index.html', // Replace with your Unity build URL
  onUnityReady,
  onError,
}) => {
  const webViewRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unityReady, setUnityReady] = useState(false);

  // Inject JavaScript for Unity communication
  const injectedJavaScript = `
    (function() {
      // Unity Bridge - receives messages from React Native
      window.ReactNativeWebView = {
        postMessage: function(data) {
          window.ReactNative.postMessage(data);
        }
      };

      // Wait for Unity to be ready
      function waitForUnity() {
        if (typeof window.SendMessageToUnity !== 'undefined') {
          window.dispatchEvent(new Event('unityReady'));
        } else {
          setTimeout(waitForUnity, 100);
        }
      }
      waitForUnity();

      // Listen for Unity ready event
      window.addEventListener('unityReady', function() {
        window.ReactNative.postMessage(JSON.stringify({
          type: 'unityReady',
          ready: true
        }));
      });

      // Handle messages from Unity
      window.addEventListener('unityMessage', function(event) {
        window.ReactNative.postMessage(JSON.stringify({
          type: 'unityMessage',
          data: event.detail
        }));
      });

      true; // Required for iOS
    })();
  `;

  // Send message to Unity
  const sendMessageToUnity = useCallback((method: string, data: any) => {
    if (!unityReady || !webViewRef.current) return;

    const message = JSON.stringify({
      method,
      data,
    });

    webViewRef.current.injectJavaScript(`
      if (typeof window.SendMessageToUnity !== 'undefined') {
        window.SendMessageToUnity(${JSON.stringify(message)});
      }
    `);
  }, [unityReady]);

  // Handle messages from Unity WebView
  const handleMessage = useCallback((event: any) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      switch (message.type) {
        case 'unityReady':
          setUnityReady(true);
          setIsLoading(false);
          onUnityReady?.();

          // Send initial room data
          if (roomDimensions) {
            sendMessageToUnity('updateRoom', roomDimensions);
          }
          break;

        case 'unityMessage':
          // Handle messages from Unity
          console.log('Unity message:', message.data);
          break;

        case 'error':
          onError?.(message.error || 'Unity error occurred');
          break;
      }
    } catch (error) {
      console.error('Error parsing Unity message:', error);
    }
  }, [roomDimensions, onUnityReady, onError, sendMessageToUnity]);

  // Update room when dimensions change
  useEffect(() => {
    if (unityReady && roomDimensions) {
      sendMessageToUnity('updateRoom', roomDimensions);
    }
  }, [roomDimensions, unityReady, sendMessageToUnity]);

  // Update furniture when it changes
  useEffect(() => {
    if (unityReady && furniture.length > 0) {
      sendMessageToUnity('updateFurniture', furniture);
    }
  }, [furniture, unityReady, sendMessageToUnity]);

  // Update view mode
  useEffect(() => {
    if (unityReady) {
      sendMessageToUnity('setViewMode', { mode: viewMode });
    }
  }, [viewMode, unityReady, sendMessageToUnity]);

  // Handle WebView errors
  const handleError = useCallback((syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error('WebView error:', nativeEvent);
    setIsLoading(false);
    onError?.(nativeEvent.description || 'Failed to load Unity viewer');
  }, [onError]);

  // Web platform: show message (WebView not available on web)
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <UnitySetupInstructions 
            missingWebView={false}
            unityBuildUrl={unityBuildUrl}
            isWeb={true}
          />
        </View>
      </View>
    );
  }

  // Native platforms: use WebView
  // WebView is loaded at module level (will be null on web due to stub)
  // Check if WebView is available
  if (!WebView) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <UnitySetupInstructions 
            missingWebView={true}
            unityBuildUrl={unityBuildUrl}
          />
        </View>
      </View>
    );
  }

  if (!unityBuildUrl || unityBuildUrl === 'https://your-cdn.com/unity-build/index.html') {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <UnitySetupInstructions 
            missingWebView={false}
            unityBuildUrl={unityBuildUrl}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.loadingText}>Loading Unity 3D Viewer...</Text>
        </View>
      )}

      <WebView
        ref={webViewRef}
        source={{ uri: unityBuildUrl }}
        style={styles.webview}
        injectedJavaScript={injectedJavaScript}
        onMessage={handleMessage}
        onError={handleError}
        onHttpError={handleError}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}
      />
    </View>
  );
};

// Placeholder component with setup instructions
interface UnitySetupInstructionsProps {
  missingWebView?: boolean;
  unityBuildUrl?: string;
  isWeb?: boolean;
}

const UnitySetupInstructions: React.FC<UnitySetupInstructionsProps> = ({
  missingWebView = false,
  unityBuildUrl,
  isWeb = false,
}) => {
  return (
    <View style={styles.instructions}>
      <Text style={styles.instructionsTitle}>🎮 Unity 3D Viewer</Text>
      {isWeb ? (
        <>
          <Text style={styles.instructionsText}>
            Unity 3D Viewer is not available on web platform.
          </Text>
          <Text style={styles.instructionsSubtext}>
            Please use the native app (iOS/Android) to view Unity 3D visualizations.
          </Text>
          <Text style={styles.instructionsSubtext}>
            The Three.js viewer is available as an alternative.
          </Text>
        </>
      ) : missingWebView ? (
        <>
          <Text style={styles.instructionsText}>
            React Native WebView is required for Unity integration.
          </Text>
          <Text style={styles.instructionsSubtext}>
            Install it by running:
          </Text>
          <Text style={styles.instructionsCode}>
            npx expo install react-native-webview
          </Text>
          <Text style={styles.instructionsSubtext}>
            Then restart your development server.
          </Text>
        </>
      ) : !unityBuildUrl ? (
        <>
          <Text style={styles.instructionsText}>
            To use Unity 3D visualization:
          </Text>
          <Text style={styles.instructionsSubtext}>
            1. Install react-native-webview: npx expo install react-native-webview
          </Text>
          <Text style={styles.instructionsSubtext}>
            2. Create Unity project and build as WebGL
          </Text>
          <Text style={styles.instructionsSubtext}>
            3. Host the build on a CDN or server
          </Text>
          <Text style={styles.instructionsSubtext}>
            4. Set EXPO_PUBLIC_UNITY_BUILD_URL in .env file
          </Text>
          <Text style={styles.instructionsSubtext}>
            5. See docs/UNITY_SETUP.md for detailed instructions
          </Text>
        </>
      ) : (
        <Text style={styles.instructionsText}>
          Unity build URL is set. Loading...
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingText: {
    color: '#FFFFFF',
    marginTop: 16,
    fontSize: 14,
    fontWeight: '600',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#1a1a1a',
  },
  instructions: {
    marginTop: 20,
    padding: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    maxWidth: 400,
  },
  instructionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  instructionsText: {
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 8,
    lineHeight: 20,
    textAlign: 'center',
    fontWeight: '500',
  },
  instructionsSubtext: {
    fontSize: 12,
    color: '#CCCCCC',
    marginBottom: 6,
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  instructionsCode: {
    fontSize: 12,
    color: '#007AFF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginVertical: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
});

