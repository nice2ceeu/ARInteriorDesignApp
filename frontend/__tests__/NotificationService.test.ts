const mockModuleLoaded = jest.fn();
const mockRemoveReceived = jest.fn();
const mockRemoveResponse = jest.fn();
const mockReceivedListener = jest.fn(() => ({ remove: mockRemoveReceived }));
const mockResponseListener = jest.fn(() => ({ remove: mockRemoveResponse }));
const mockHandler = jest.fn();

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'storeClient' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { setItem: jest.fn(), getItem: jest.fn(async () => 'true') },
}));
jest.mock('expo-notifications', () => {
  mockModuleLoaded();
  return {
    setNotificationHandler: mockHandler,
    getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    getExpoPushTokenAsync: jest.fn(async () => ({ data: 'test-token' })),
    addNotificationReceivedListener: mockReceivedListener,
    addNotificationResponseReceivedListener: mockResponseListener,
  };
});

describe('Android notification startup', () => {
  // Expo installs a lazy native fetch getter; these tests do not use networking.
  beforeAll(() => {
    Object.defineProperty(globalThis, 'fetch', {
      value: jest.fn(), configurable: true, writable: true,
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function loadService(environment = 'storeClient') {
    let service!: typeof import('../services/NotificationService').NotificationService;
    jest.isolateModules(() => {
      require('expo-constants').default.executionEnvironment = environment;
      service = require('../services/NotificationService').NotificationService;
    });
    return service;
  }

  it('never imports the native package in Android Expo Go', async () => {
    const service = loadService();
    const cleanup = service.setupListeners();
    expect(await service.requestPermissions()).toBe(false);
    expect(await service.hasPermission()).toBe(false);
    expect(await service.scheduleNotification('Title', 'Body')).toBeNull();
    expect(await service.getScheduledNotifications()).toEqual([]);
    await service.cancelAllNotifications();
    cleanup();
    expect(mockModuleLoaded).not.toHaveBeenCalled();
  });

  it('initializes notifications once for concurrent development-build calls', async () => {
    const service = loadService('bare');
    expect(await Promise.all([service.hasPermission(), service.hasPermission()])).toEqual([true, true]);
    expect(mockModuleLoaded).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it('removes native listeners on cleanup', async () => {
    const service = loadService('bare');
    const cleanup = service.setupListeners();
    await service.hasPermission();
    expect(mockReceivedListener).toHaveBeenCalledTimes(1);
    expect(mockResponseListener).toHaveBeenCalledTimes(1);
    cleanup();
    expect(mockRemoveReceived).toHaveBeenCalledTimes(1);
    expect(mockRemoveResponse).toHaveBeenCalledTimes(1);
  });

  it('does not attach listeners if unmounted before the import completes', async () => {
    const service = loadService('bare');
    const cleanup = service.setupListeners();
    cleanup();
    await service.hasPermission();
    expect(mockReceivedListener).not.toHaveBeenCalled();
    expect(mockResponseListener).not.toHaveBeenCalled();
  });
});
