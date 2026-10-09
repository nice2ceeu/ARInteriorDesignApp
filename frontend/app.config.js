import 'dotenv/config';

const existingConfig = {
  expo: {
    name: 'AR Interior Design',
    slug: 'ARInteriorDesinApp',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'arinteriordesinapp',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#ffffff',
      },
    },
    web: {
      output: 'static',
      favicon: './assets/images/splash.png',
    },
    plugins: [
      'expo-router',
      'expo-dev-client',
      [
        'expo-camera',
        {
          cameraPermission:
            'Allow $(PRODUCT_NAME) to access your camera for room scanning and AR features.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/splash.png',
          color: '#3B82F6',
          sounds: [],
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};

const ensureExpoPublicVar = (publicKey, value) => {
  if (value && !process.env[publicKey]) {
    process.env[publicKey] = value;
  }
};

export default () => {
  // Load .env file if it exists (dotenv/config is already imported at top)
  // Environment variables are now available via process.env
  
  // API Base URL - prioritize explicit env var, fallback to default
  // For physical devices, set EXPO_PUBLIC_API_BASE_URL=http://YOUR_IP:3000/api/v1
  ensureExpoPublicVar('EXPO_PUBLIC_API_BASE_URL', process.env.EXPO_PUBLIC_API_BASE_URL || process.env.API_BASE_URL);
  ensureExpoPublicVar('EXPO_PUBLIC_LAYOUT_API_BASE_URL', process.env.EXPO_PUBLIC_LAYOUT_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || process.env.API_BASE_URL);
  
  ensureExpoPublicVar('EXPO_PUBLIC_LAYOUT_API_KEY', process.env.LAYOUT_API_KEY);
  ensureExpoPublicVar('EXPO_PUBLIC_LAYOUT_BEARER_TOKEN', process.env.LAYOUT_BEARER_TOKEN);

  return {
    ...existingConfig,
    extra: {
      ...existingConfig.expo.extra,
      API_BASE_URL: process.env.API_BASE_URL,
    },
  };
};

