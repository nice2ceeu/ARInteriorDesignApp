import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Get the appropriate base URL based on platform and environment
 * 
 * Platform-specific behavior:
 * - Web: localhost works ✓
 * - iOS Simulator: localhost works ✓
 * - Android Emulator: 10.0.2.2 (special IP for host machine) ✓
 * - Physical Device (iOS/Android): Must use computer's IP address (e.g., 192.168.1.131)
 *   Set via: EXPO_PUBLIC_API_BASE_URL=http://YOUR_IP:3000/api/v1
 * 
 * To find your IP:
 * - Windows: ipconfig (look for IPv4 Address)
 * - Mac/Linux: ifconfig or ip addr
 * - Example: http://192.168.1.131:3000/api/v1
 */
const getDefaultBaseUrl = (): string => {
  // Explicit environment variable takes highest precedence
  // Use this for physical devices: EXPO_PUBLIC_API_BASE_URL=http://192.168.1.131:3000/api/v1
  if (process.env.EXPO_PUBLIC_LAYOUT_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_LAYOUT_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || '';
  }

  // Platform-specific defaults
  if (Platform.OS === 'web') {
    // Web platform - localhost works
    return 'http://localhost:3000/api/v1';
  }

  if (Platform.OS === 'android') {
    // Android emulator uses 10.0.2.2 to reach host machine's localhost
    // IMPORTANT: For physical Android devices, you MUST set EXPO_PUBLIC_API_BASE_URL
    // with your computer's IP address (not localhost!)
    // Check your IP with: ipconfig (Windows) or ifconfig (Mac/Linux)
    // Example: EXPO_PUBLIC_API_BASE_URL=http://192.168.1.131:3000/api/v1
    const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
    return isDev ? 'http://10.0.2.2:3000/api/v1' : 'https://api.example.com/api/v1';
  }

  // iOS simulator - localhost works
  // IMPORTANT: For physical iOS devices, you MUST set EXPO_PUBLIC_API_BASE_URL
  // with your computer's IP address (not localhost!)
  return 'http://localhost:3000/api/v1';
};

const DEFAULT_BASE_URL = getDefaultBaseUrl();
const API_KEY_STORAGE_KEYS = ['runtime_backend_api_key'];
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBaseUrl = (): string => {
  // Explicit environment variable takes precedence
  if (process.env.EXPO_PUBLIC_LAYOUT_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_LAYOUT_API_BASE_URL;
  }
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }
  
  // Fall back to platform-specific default
  return DEFAULT_BASE_URL;
};

const getEnvApiKey = () =>
  process.env.EXPO_PUBLIC_LAYOUT_API_KEY ||
  process.env.EXPO_PUBLIC_API_KEY;

const getEnvBearer = () =>
  process.env.EXPO_PUBLIC_LAYOUT_BEARER_TOKEN ||
  process.env.EXPO_PUBLIC_BEARER_TOKEN;

async function resolveApiKey(): Promise<string | undefined> {
  for (const key of API_KEY_STORAGE_KEYS) {
    try {
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        return stored;
      }
    } catch {
      // ignore read errors
    }
  }
  return getEnvApiKey();
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface CallApiOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
}

interface ApiErrorDetails {
  message?: string;
  error?: string;
  [key: string]: unknown;
}

class ApiError extends Error {
  status: number;
  details?: ApiErrorDetails;

  constructor(status: number, message: string, details?: ApiErrorDetails) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function callApi<T>(
  path: string,
  { method = 'GET', body, headers = {}, timeoutMs = 15000, signal, maxRetries = MAX_RETRIES }: CallApiOptions = {}
): Promise<T> {
  const baseUrl = getBaseUrl().replace(/\/+$/, '');
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  
  // Log the URL in development to help debug connection issues
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[API] ${method} ${url}`);
  }
  
  const apiKey = await resolveApiKey();
  const bearerToken = getEnvBearer();

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (apiKey) {
    baseHeaders['X-API-Key'] = apiKey;
  }
  if (bearerToken) {
    baseHeaders['Authorization'] = `Bearer ${bearerToken}`;
  }

  let attempt = 0;
  let lastError: Error | ApiError = new Error('Max retries exceeded');


  const retryLimit = Number.isFinite(maxRetries) ? Math.max(0, Math.min(MAX_RETRIES, Math.floor(maxRetries))) : MAX_RETRIES;
  while (attempt <= retryLimit) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: baseHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: signal ?? controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        if (response.status === 204) {
          return undefined as T;
        }

        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.includes('application/json')) {
          return (await response.json()) as T;
        }

        const text = await response.text();
        return text as unknown as T;
      }

      // handle retryable errors
      if ((response.status === 429 || response.status >= 500) && attempt < retryLimit) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfter = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : undefined;
        const delay = retryAfter && !Number.isNaN(retryAfter)
          ? retryAfter
          : 2 ** attempt * 500;
        await sleep(delay);
        attempt += 1;
        continue;
      }

      let errorBody: unknown = null;
      try {
        errorBody = await response.json() as ApiErrorDetails;
      } catch {
        errorBody = await response.text();
      }
      const details = typeof errorBody === 'object' && errorBody !== null
        ? errorBody as ApiErrorDetails
        : undefined;
      throw new ApiError(
        response.status,
        details?.message || details?.error || `Request failed with status ${response.status}`,
        details
      );
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));

      const isAbort = lastError instanceof Error && lastError.name === 'AbortError';
      const isNetwork = lastError instanceof Error &&
        (lastError.message?.includes('Network request failed') || 
         lastError.message === 'Failed to fetch' ||
         lastError.message?.includes('ERR_CONNECTION_REFUSED') ||
         lastError.message?.includes('ERR_CONNECTION_TIMED_OUT') ||
         lastError.message?.includes('connection refused') ||
         lastError.message?.includes('connection timed out') ||
         lastError.message?.includes('ETIMEDOUT'));

      if ((isAbort || isNetwork) && attempt < retryLimit) {
        await sleep(2 ** attempt * 500);
        attempt += 1;
        continue;
      }

      // Enhance error message for connection errors (but don't log to console - service will handle fallback)
      if (isNetwork && !isAbort) {
        const connectionError = new Error(`Connection refused: Backend server at ${baseUrl} is not available`);
        (connectionError as any).isConnectionError = true;
        throw connectionError;
      }

      throw error;
    }
  }

  throw lastError;
}

export { ApiError, type ApiErrorDetails };

