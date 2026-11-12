package com.azesmwayreactnativeunity;

import static com.azesmwayreactnativeunity.ReactNativeUnity.*;

import android.os.Handler;
import android.view.View;
import android.view.ViewParent;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.infer.annotation.Assertions;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.common.MapBuilder;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;
import com.facebook.react.uimanager.events.RCTEventEmitter;

import java.lang.reflect.InvocationTargetException;
import java.util.Map;

@ReactModule(name = ReactNativeUnityViewManager.NAME)
public class ReactNativeUnityViewManager extends ReactNativeUnityViewManagerSpec<ReactNativeUnityView> implements LifecycleEventListener, View.OnAttachStateChangeListener {
  ReactApplicationContext context;
  static ReactNativeUnityView view;
  static int lastUnityViewId = -1;
  static ReactApplicationContext reactApplicationContext;
  public static final String NAME = "RNUnityView";

  public ReactNativeUnityViewManager(ReactApplicationContext context) {
    super();
    this.context = context;
    reactApplicationContext = context;
    context.addLifecycleEventListener(this);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @NonNull
  @Override
  public ReactNativeUnityView createViewInstance(@NonNull ThemedReactContext context) {
    view = new ReactNativeUnityView(this.context);
    view.addOnAttachStateChangeListener(this);
    lastUnityViewId = view.getId();

    if (getPlayer() != null) {
        try {
            view.setUnityPlayer(getPlayer());
        } catch (InvocationTargetException | NoSuchMethodException | IllegalAccessException e) {}
    } else {
        try {
            createPlayer(context.getCurrentActivity(), new UnityPlayerCallback() {
              @Override
              public void onReady() throws InvocationTargetException, NoSuchMethodException, IllegalAccessException {
                view.setUnityPlayer(getPlayer());
              }

              @Override
              public void onUnload() {
                if (view == null) return;
                try {
                  WritableMap data = Arguments.createMap();
                  data.putString("message", "MyMessage");
                  ReactContext reactContext = (ReactContext) view.getContext();
                  if (reactContext != null) {
                    reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(view.getId(), "onPlayerUnload", data);
                  }
                } catch (Exception ignored) {
                }
              }

              @Override
              public void onQuit() {
                // Unity quit after destroy previously spammed Fabric events and crashed reopen.
                // Swallow — we no longer destroy the player on host destroy.
              }
            });
        } catch (InvocationTargetException | NoSuchMethodException | IllegalAccessException e) {}
    }

    return view;
  }

  @Override
  public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
    Map<String, Object> export = super.getExportedCustomDirectEventTypeConstants();

    if (export == null) {
      export = MapBuilder.newHashMap();
    }

    export.put("onUnityMessage", MapBuilder.of("registrationName", "onUnityMessage"));
    export.put("onPlayerUnload", MapBuilder.of("registrationName", "onPlayerUnload"));
    export.put("onPlayerQuit", MapBuilder.of("registrationName", "onPlayerQuit"));

    return export;
  }

  @Override
  public void receiveCommand(@NonNull ReactNativeUnityView view, String commandType, @Nullable ReadableArray args) {
    Assertions.assertNotNull(view);
    Assertions.assertNotNull(args);

    switch (commandType) {
      case "postMessage":
        assert args != null;
        postMessage(view, args.getString(0), args.getString(1), args.getString(2));
        return;
      case "unloadUnity":
        unloadUnity(view);
        return;
      case "pauseUnity":
        assert args != null;
        pauseUnity(view, args.getBoolean(0));
        return;
      case "resumeUnity":
        resumeUnity(view);
        return;
      case "windowFocusChanged":
        assert args != null;
        windowFocusChanged(view, args.getBoolean(0));
        return;
      default:
        throw new IllegalArgumentException(String.format(
          "Unsupported command %s received by %s.",
          commandType,
          getClass().getSimpleName()));
    }
  }

  @Override
  public void unloadUnity(ReactNativeUnityView view) {
    // The JS UnityView sends this from componentWillUnmount, on every AR screen that closes. Unity
    // was then unloaded while the next AR screen was already showing it, and restarted from its
    // first scene (ARDesignScene): scenes switched four times in a second, the camera restarted
    // each time and sometimes stayed black, and opening a saved design lagged (2026-11-12).
    // Unity stays loaded and is reused by the next screen; leaving AR already pauses it
    // (onDropViewInstance, and the app pauses it before it navigates away).
  }

  @Override
  public void pauseUnity(ReactNativeUnityView view, boolean pause) {
    if (isUnityReady()) {
      assert getPlayer() != null;
      getPlayer().pause();
    }
  }

  @Override
  public void resumeUnity(ReactNativeUnityView view) {
    if (isUnityReady()) {
      assert getPlayer() != null;
      getPlayer().resume();
    }
  }

  @Override
  public void windowFocusChanged(ReactNativeUnityView view, boolean hasFocus) {
    if (isUnityReady()) {
      assert getPlayer() != null;
      getPlayer().windowFocusChanged(hasFocus);
    }
  }

  public static void sendMessageToMobileApp(String message) {
    final ReactNativeUnityView target = view;
    final int viewId = target != null ? target.getId() : lastUnityViewId;
    if (viewId < 0) {
      return;
    }
    Runnable deliver = () -> {
      try {
        ReactContext reactContext = reactApplicationContext != null
            ? reactApplicationContext
            : (target != null ? (ReactContext) target.getContext() : null);
        if (reactContext == null) {
          return;
        }
        WritableMap data = Arguments.createMap();
        data.putString("message", message);
        reactContext
            .getJSModule(RCTEventEmitter.class)
            .receiveEvent(viewId, "onUnityMessage", data);
      } catch (Exception ignored) {
      }
    };
    UiThreadUtil.runOnUiThread(deliver);
  }

  @Override
  public void onDropViewInstance(ReactNativeUnityView dropped) {
    dropped.removeOnAttachStateChangeListener(this);
    // Park Unity in a tiny background host so the player survives screen unmounts.
    // Destroying UnityPlayer on Android UaaL cannot be restarted in-process.
    // Only when the dropped view still owns the player: reopening an AR screen mounts the new
    // view first and drops the old one a moment later, and pausing then froze the new screen
    // (ARCore paused while the camera opened → black camera on the second scan).
    if (isUnityReady() && ownsPlayer(dropped)) {
      try {
        addUnityViewToBackground();
        getPlayer().pause();
      } catch (Exception ignored) {
      }
    }
    super.onDropViewInstance(dropped);
  }

  /** False when a newer RN view has already taken the Unity player (its frame sits in that view). */
  private static boolean ownsPlayer(ReactNativeUnityView candidate) {
    if (candidate != view) return false;
    try {
      FrameLayout frame = getPlayer().requestFrame();
      ViewParent parent = frame.getParent();
      return parent == null || parent == candidate;
    } catch (Exception ignored) {
      return true;
    }
  }

  @Override
  public void onHostResume() {
    if (isUnityReady()) {
      assert getPlayer() != null;
      getPlayer().resume();
      restoreUnityUserState();
    }
  }

  @Override
  public void onHostPause() {
    if (isUnityReady()) {
      assert getPlayer() != null;
      getPlayer().pause();
    }
  }

  @Override
  public void onHostDestroy() {
    // Do NOT call UnityPlayer.destroy() — Android UaaL cannot recreate the player
    // in the same process. Pause only; the OS reclaims Unity when the process dies.
    if (isUnityReady()) {
      try {
        assert getPlayer() != null;
        getPlayer().pause();
      } catch (Exception ignored) {
      }
    }
  }

  private void restoreUnityUserState() {
    // Reattach / host resume should run the player (old logic re-paused after 300ms and
    // left planner input dead until the user switched apps).
    if (!isUnityReady() || getPlayer() == null) {
      return;
    }
    try {
      getPlayer().resume();
      getPlayer().windowFocusChanged(true);
    } catch (Exception ignored) {
    }
  }

  @Override
  public void onViewAttachedToWindow(View v) {
    restoreUnityUserState();
  }

  @Override
  public void onViewDetachedFromWindow(View v) {}

  @ReactProp(name = "androidKeepPlayerMounted", defaultBoolean = false)
  public void setAndroidKeepPlayerMounted(ReactNativeUnityView view, boolean keepPlayerMounted) {
    view.keepPlayerMounted = keepPlayerMounted;
  }

  @ReactProp(name = "fullScreen", defaultBoolean = true)
  public void setFullScreen(ReactNativeUnityView view, boolean fullScreen) {
    _fullScreen = fullScreen;
  }

  @Override
  public void postMessage(ReactNativeUnityView view, String gameObject, String methodName, String message) {
    if (isUnityReady()) {
      assert getPlayer() != null;
      UPlayer.UnitySendMessage(gameObject, methodName, message);
    }
  }
}
