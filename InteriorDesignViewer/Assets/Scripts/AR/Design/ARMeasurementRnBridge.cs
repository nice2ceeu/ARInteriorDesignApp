using UnityEngine;
using UnityEngine.SceneManagement;
using System.Collections;

/// <summary>
/// RN bridge for ARRoomMeasurement (Managers GameObject).
/// ARDesignScene uses <see cref="ARSceneBridge"/>; this scene strips that component,
/// so measurement needs its own ReceiveMessage entry point for scene switches / close.
/// </summary>
[DefaultExecutionOrder(-100)]
public class ARMeasurementRnBridge : MonoBehaviour
{
    const string FurnitureSceneName = "ARDesignScene";
    const string MeasurementSceneName = "ARRoomMeasurement";

    Coroutine exportRoutine;
    Coroutine reloadRoutine;
    Coroutine armFurnitureRoutine;
    Coroutine wakePlannerRoutine;
    /// <summary>A repeat open this soon after a scan started is answered without restarting it.</summary>
    const float DuplicateOpenSeconds = 3f;
    float lastScanStartedAt = -100f;

    /// <summary>RN design-flow "View in AR" — room shell from saved dimensions, no scan UI.</summary>
    public static string PendingDesignLayoutPayload;

    public static bool HasPendingDesignLayout =>
        !string.IsNullOrWhiteSpace(PendingDesignLayoutPayload);

    public static ARMeasurementRnBridge EnsureOn(GameObject host)
    {
        if (host == null) return null;
        var existing = host.GetComponent<ARMeasurementRnBridge>();
        if (existing != null) return existing;
        return host.AddComponent<ARMeasurementRnBridge>();
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void EnsureBridgeOnMeasurementScene()
    {
        if (SceneManager.GetActiveScene().name != MeasurementSceneName) return;
        var managers = GameObject.Find("Managers");
        EnsureOn(managers);
    }

    void Awake()
    {
        if (SceneManager.GetActiveScene().name == MeasurementSceneName)
            EnsureOn(gameObject);
    }

    void Start()
    {
        // A freshly loaded scene starts its own scan; RN's first open shouldn't restart it.
        lastScanStartedAt = Time.unscaledTime;
        UnityMessageBridge.SendToApp("unityReady", MeasurementSceneName);
        if (HasPendingDesignLayout)
            StartCoroutine(DesignLayoutAfterSceneLoadRoutine());
    }

    /// <summary>Called by the native Unity ↔ RN bridge on Managers.</summary>
    public void ReceiveMessage(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return;

        ARDesignInboundMessage message;
        try
        {
            message = JsonUtility.FromJson<ARDesignInboundMessage>(json);
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[ARMeasurementRnBridge] Bad message: {e.Message}");
            return;
        }

        if (message == null || string.IsNullOrEmpty(message.method)) return;

        // Finger moves arrive every frame while dragging: logging them flooded the phone's log.
        if (message.method != "plannerPointer")
            Debug.Log($"[ARMeasurementRnBridge] ← {message.method}");

        switch (message.method)
        {
            case "ping":
                UnityMessageBridge.SendToApp("unityReady", MeasurementSceneName);
                break;

            case "commitRoomName":
                RoomMeasurementSaveModal.CommitRoomNameFromRn(message.data ?? string.Empty);
                // RN save already confirmed the shell — arm furniture on this scene (empty handoff).
                OpenMeasuredFurnitureDesign(string.Empty);
                break;

            case "cancelRoomName":
                RoomMeasurementSaveModal.CommitRoomNameFromRn("Untitled room");
                OpenMeasuredFurnitureDesign(string.Empty);
                break;

            case "exportLayout":
                // Defer off the UnitySendMessage stack — exporting (and SendToApp)
                // synchronously inside ReceiveMessage can hang/deadlock UaaL bridges.
                if (exportRoutine != null)
                    StopCoroutine(exportRoutine);
                exportRoutine = StartCoroutine(ExportLayoutToRnRoutine());
                break;

            case "spawnFurniture":
            case "selectFurniture":
                EnsureFurnitureBootstrap()?.SpawnFurniture(message.data);
                break;

            case "applyLayout":
                EnsureFurnitureBootstrap()?.ApplyLayout(message.data);
                break;

            case "replaceSelectedFurniture":
                EnsureFurnitureBootstrap()?.ReplaceSelectedFurniture(message.data);
                break;

            case "setFurnitureColor":
                EnsureFurnitureBootstrap()?.SetFurnitureColor(message.data);
                break;

            case "setFurnitureLocked":
                EnsureFurnitureBootstrap()?.SetFurnitureLocked(message.data);
                break;

            case "removeSelectedFurniture":
                EnsureFurnitureBootstrap()?.RemoveSelectedFurniture();
                break;

            case "checkPlacement":
                // Asked before Finish: the app blocks it while any piece overlaps or hits a wall.
                EnsureFurnitureBootstrap()?.SendPlacementCheck();
                break;

            case "clearScene":
            case "clearFurniture":
                EnsureFurnitureBootstrap()?.Placement?.ClearFurniture();
                break;

            case "undo":
                EnsureFurnitureBootstrap()?.History?.Undo();
                break;

            case "redo":
                EnsureFurnitureBootstrap()?.History?.Redo();
                break;

            case "openRoomMeasurement":
            case "reloadMeasurement":
                // Already on this scene (or reopening) — soft-reload instead of LoadScene thrash.
                ScheduleReload();
                break;

            case "pauseMeasurement":
                // RN is leaving — idle teardown only (do NOT restart scan here).
                SoftClose(notifyRn: false);
                break;

            case "pauseFurniture":
                // Wrong-scene no-op: furniture pause is owned by ARSceneBridge.
                Debug.Log("[ARMeasurementRnBridge] Ignoring pauseFurniture on measurement scene.");
                break;

            case "plannerOrbit":
                FindFirstObjectByType<ARDesignLayoutModeController>()?.ApplyOrbitFromRn(message.data);
                break;

            case "plannerPointer":
                EnsureFurnitureBootstrap();
                PlannerRnInputRouter.EnsureOn(gameObject)?.Apply(message.data);
                break;

            case "wakePlanner":
                if (wakePlannerRoutine != null)
                    StopCoroutine(wakePlannerRoutine);
                wakePlannerRoutine = StartCoroutine(WakePlannerRoutine());
                break;

            case "furnitureGesture":
                FindFirstObjectByType<FurnitureManipulator>()?.ApplyGestureFromRn(message.data);
                break;

            case "openFurnitureDesign":
            case "startFurniturePlacement":
            case "beginFurniturePlacementOnly":
                OpenFurnitureDesign();
                break;

            case "openMeasuredFurnitureDesign":
                OpenMeasuredFurnitureDesign(message.data);
                break;

            case "openDesignLayoutInAr":
                BeginDesignLayoutAr(message.data);
                break;

            case "beginLayoutAlignment":
                EnsureFurnitureBootstrap();
                ARDesignLayoutAlignmentController.EnsureOn(gameObject)?.Begin();
                break;

            case "markAlignmentCorner":
                ARDesignLayoutAlignmentController.EnsureOn(gameObject)?.MarkCorner();
                break;

            case "undoAlignmentCorner":
                ARDesignLayoutAlignmentController.EnsureOn(gameObject)?.UndoCorner();
                break;

            case "flipLayoutAlignment":
                ARDesignLayoutAlignmentController.EnsureOn(gameObject)?.Flip();
                break;

            case "setLayoutView":
                ARDesignLayoutAlignmentController.EnsureOn(gameObject)?.SetView(message.data ?? string.Empty);
                break;

            case "requestClose":
            case "closeUnity":
                SoftClose(notifyRn: true);
                break;

            default:
                Debug.Log($"[ARMeasurementRnBridge] Ignoring '{message.method}' on measurement scene.");
                break;
        }
    }

    public void OpenFurnitureDesign()
    {
        // Idle teardown only — next scene Start/PendingBootAction owns furniture unlock.
        SoftClose(notifyRn: false);
        ARSceneBridge.PendingBootAction = "furniture";
        if (SceneManager.GetActiveScene().name == FurnitureSceneName)
            return;
        SceneManager.LoadScene(FurnitureSceneName);
    }

    /// <summary>
    /// Keep the confirmed measured room on ARRoomMeasurement and unlock real GLB
    /// placement here (no LoadScene to ARDesignScene — UaaL handoff was unreliable).
    /// </summary>
    public void OpenMeasuredFurnitureDesign(string rnPayloadJson = null)
    {
        if (armFurnitureRoutine != null)
            StopCoroutine(armFurnitureRoutine);
        armFurnitureRoutine = StartCoroutine(ArmMeasuredFurnitureRoutine(rnPayloadJson));
    }

    /// <summary>
    /// Design-flow handoff: build the room from RN dimensions and skip the measure scan HUD.
    /// </summary>
    public void BeginDesignLayoutAr(string rnPayloadJson)
    {
        PendingDesignLayoutPayload = rnPayloadJson ?? string.Empty;

        if (SceneManager.GetActiveScene().name != MeasurementSceneName)
        {
            SceneManager.LoadScene(MeasurementSceneName);
            return;
        }

        if (reloadRoutine != null)
            StopCoroutine(reloadRoutine);
        reloadRoutine = StartCoroutine(DesignLayoutBootRoutine());
    }

    IEnumerator DesignLayoutAfterSceneLoadRoutine()
    {
        yield return null;
        yield return new WaitForEndOfFrame();
        if (!HasPendingDesignLayout)
            yield break;
        BeginDesignLayoutAr(PendingDesignLayoutPayload);
    }

    IEnumerator DesignLayoutBootRoutine()
    {
        yield return null;

        SoftClose(notifyRn: false);

        var scan = UnityEngine.Object.FindFirstObjectByType<RoomScanController>();
        scan?.ResetToIdle();

        OpenMeasuredFurnitureDesign(PendingDesignLayoutPayload);
        ARMainMenuBackButton.SetUiVisible(false);

        yield return null;
        UnityMessageBridge.SendToApp("reloadComplete", MeasurementSceneName);
        reloadRoutine = null;
    }

    IEnumerator ArmMeasuredFurnitureRoutine(string rnPayloadJson)
    {
        // Leave the UnitySendMessage stack — sync SendToApp inside ReceiveMessage
        // often drops / deadlocks the RN unlock event on UaaL.
        yield return null;

        var scan = UnityEngine.Object.FindFirstObjectByType<RoomScanController>();

        if (scan == null || !scan.IsConfirmed || scan.ConfirmedRoom == null || scan.ConfirmedRoom.IsEmpty)
        {
            MeasuredRoomHandoff.CaptureFrom(scan);
            if (!MeasuredRoomHandoff.HasData)
                MeasuredRoomHandoff.CaptureFromRnPayload(rnPayloadJson);

            if (MeasuredRoomHandoff.TryConsume(out var corners, out var wallHeight) && scan != null)
            {
                if (!scan.ApplyMeasuredRoom(corners, wallHeight))
                {
                    UnityMessageBridge.SendToApp(
                        "error",
                        "{\"code\":\"applyMeasuredRoomFailed\",\"message\":\"Could not rebuild the measured room shell.\"}");
                    armFurnitureRoutine = null;
                    yield break;
                }
            }
            else if (scan == null || !scan.IsConfirmed)
            {
                Debug.LogWarning("[ARMeasurementRnBridge] openMeasuredFurnitureDesign — no room to place on.");
                UnityMessageBridge.SendToApp(
                    "error",
                    "{\"code\":\"noMeasuredRoom\",\"message\":\"Measure and confirm a room before placing furniture.\"}");
                armFurnitureRoutine = null;
                yield break;
            }
        }

        var bootstrap = EnsureFurnitureBootstrap();
        bootstrap?.ActivateForMeasuredPlacement();
        PlannerRnInputRouter.EnsureOn(gameObject)?.Rebind();

        // Extra frames so UaaL leaves the ReceiveMessage stack before SendToApp.
        yield return null;
        yield return new WaitForEndOfFrame();

        UnityMessageBridge.SendToApp("measuredFurnitureReady", MeasurementSceneName);
        yield return null;
        UnityMessageBridge.SendToApp("reloadComplete", MeasurementSceneName);
        PendingDesignLayoutPayload = null;
        Debug.Log("[ARMeasurementRnBridge] Measured furniture unlocked on ARRoomMeasurement.");
        armFurnitureRoutine = null;
    }

    /// <summary>
    /// RN resumed the player after overlays/modals — re-arm planner + push plan-ready again.
    /// </summary>
    IEnumerator WakePlannerRoutine()
    {
        yield return null;

        var bootstrap = EnsureFurnitureBootstrap();
        bootstrap?.ActivateForMeasuredPlacement();
        PlannerRnInputRouter.EnsureOn(gameObject)?.Rebind();

        yield return null;
        UnityMessageBridge.SendToApp("measurementPlanReady", MeasurementSceneName);
        wakePlannerRoutine = null;
    }

    ARMeasurementFurnitureBootstrap EnsureFurnitureBootstrap()
    {
        return ARMeasurementFurnitureBootstrap.EnsureOn(gameObject);
    }

    /// <summary>
    /// Unity HUD back button. Ask RN to confirm exit — do not wipe the room until RN
    /// sends pauseMeasurement after the user confirms.
    /// </summary>
    public void RequestClose()
    {
        UnityMessageBridge.SendToApp("requestClose", MeasurementSceneName);
    }

    /// <summary>
    /// Idle teardown: clear session/HUD/shell without starting a new scan.
    /// Scan starts only from ReloadMeasurement / scene Start.
    /// </summary>
    void SoftClose(bool notifyRn)
    {
        // Closed: the next open is a real reopen, however soon it comes.
        lastScanStartedAt = -100f;
        if (exportRoutine != null)
        {
            StopCoroutine(exportRoutine);
            exportRoutine = null;
        }

        if (reloadRoutine != null)
        {
            StopCoroutine(reloadRoutine);
            reloadRoutine = null;
        }

        ARMeasurementSession.Reset();
        GetComponent<ARDesignLayoutAlignmentController>()?.ResetSession();

        var furniture = GetComponent<ARMeasurementFurnitureBootstrap>();
        furniture?.Placement?.ClearFurniture();
        // Off until "View in AR" arms it again: left on, it hid the next scan's aim dot.
        furniture?.SetPlacementActive(false);

        var planHud = UnityEngine.Object.FindFirstObjectByType<ARMeasurementPlanHUD>(FindObjectsInactive.Include);
        planHud?.HideForRnSession();

        var visualizer = UnityEngine.Object.FindFirstObjectByType<RoomMeshVisualizer>(FindObjectsInactive.Include);
        visualizer?.Clear();

        var edgeVisualizer = UnityEngine.Object.FindFirstObjectByType<ARDesignEdgeVisualizer>(FindObjectsInactive.Include);
        if (edgeVisualizer != null)
            edgeVisualizer.enabled = false;

        var layoutMode = UnityEngine.Object.FindFirstObjectByType<ARDesignLayoutModeController>(FindObjectsInactive.Include);
        layoutMode?.ForceLiveArCamera();

        var scan = UnityEngine.Object.FindFirstObjectByType<RoomScanController>();
        scan?.ResetToIdle();

        ARMainMenuBackButton.SetUiVisible(false);

        if (notifyRn)
            UnityMessageBridge.SendToApp("requestClose", MeasurementSceneName);
    }

    void ScheduleReload()
    {
        // A repeat "open" right after a fresh start (RN retries, ping races) would restart the
        // scan — and reset tracking — again for nothing: answer it and keep the scan running.
        // A reload already on its way covers this open too (several opens can arrive together
        // when they were queued while Unity was busy).
        if (reloadRoutine != null && !HasPendingDesignLayout)
        {
            Debug.Log("[ARMeasurementRnBridge] A reload is already under way — ignoring a repeat open.");
            return;
        }

        // Only while that scan is still running: an open after it ended (confirmed, closed without
        // a close message) is a real reopen, however soon it comes.
        var scan = UnityEngine.Object.FindFirstObjectByType<RoomScanController>();
        if (!HasPendingDesignLayout && scan != null && scan.Phase == RoomScanController.ScanPhase.Scanning
            && Time.unscaledTime - lastScanStartedAt < DuplicateOpenSeconds)
        {
            Debug.Log("[ARMeasurementRnBridge] Scan just started — ignoring a repeat open.");
            UnityMessageBridge.SendToApp("reloadComplete", MeasurementSceneName);
            return;
        }

        if (reloadRoutine != null)
            StopCoroutine(reloadRoutine);
        reloadRoutine = StartCoroutine(ReloadMeasurementRoutine());
    }

    /// <summary>
    /// Unity stays loaded between scans, so a new scan starts clean: ARCore forgets the earlier
    /// scans' planes, and cached furniture models and unused assets are let go.
    /// </summary>
    void FreeEarlierScan()
    {
        RuntimeGltfLoader.ReleaseCachedTemplates();
        UnityEngine.Object.FindFirstObjectByType<ARBootstrap>()?.ResetTrackingForNewScan();
        Resources.UnloadUnusedAssets();
    }

    IEnumerator ReloadMeasurementRoutine()
    {
        // Leave the UnitySendMessage stack before touching AR session / scan state.
        yield return null;

        if (SceneManager.GetActiveScene().name != MeasurementSceneName)
        {
            SceneManager.LoadScene(MeasurementSceneName);
            reloadRoutine = null;
            yield break;
        }

        SoftClose(notifyRn: false);

        var scan = UnityEngine.Object.FindFirstObjectByType<RoomScanController>();
        if (HasPendingDesignLayout)
        {
            reloadRoutine = StartCoroutine(DesignLayoutBootRoutine());
            yield break;
        }

        FreeEarlierScan();
        if (scan != null)
            scan.StartRoomScan();
        lastScanStartedAt = Time.unscaledTime;

        ARMainMenuBackButton.SetUiVisible(true);
        // Distinct from cold unityReady so RN does not double-boot open/reload.
        UnityMessageBridge.SendToApp("reloadComplete", MeasurementSceneName);
        reloadRoutine = null;
    }

    IEnumerator ExportLayoutToRnRoutine()
    {
        UnityMessageBridge.SendToApp("exportStarted", MeasurementSceneName);
        yield return null;
        yield return new WaitForEndOfFrame();

        ExportResultPayload result;
        try
        {
            result = BuildExportResult();
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[ARMeasurementRnBridge] Export failed: {e}");
            result = new ExportResultPayload
            {
                success = false,
                path = string.Empty,
                fileName = string.Empty,
                error = e.Message,
            };
        }

        result ??= new ExportResultPayload
        {
            success = false,
            path = string.Empty,
            fileName = string.Empty,
            error = "Export returned no result.",
        };
        result.path = result.path ?? string.Empty;
        result.fileName = result.fileName ?? string.Empty;
        result.error = result.error ?? string.Empty;

        yield return null;
        UnityMessageBridge.SendToApp("exportComplete", JsonUtility.ToJson(result));
        exportRoutine = null;
    }

    ExportResultPayload BuildExportResult()
    {
        var exportManager = UnityEngine.Object.FindFirstObjectByType<RoomExportManager>(FindObjectsInactive.Include);
        if (exportManager == null)
        {
            var managers = GameObject.Find("Managers");
            if (managers != null)
            {
                exportManager = managers.GetComponent<RoomExportManager>();
                if (exportManager == null)
                    exportManager = managers.AddComponent<RoomExportManager>();
            }
        }

        if (exportManager == null)
        {
            return new ExportResultPayload
            {
                success = false,
                path = string.Empty,
                fileName = string.Empty,
                error = "RoomExportManager is missing from the measurement scene.",
            };
        }

        exportManager.EnsurePlacementHooks();

        if (exportManager.IsExporting)
        {
            Debug.LogWarning("[ARMeasurementRnBridge] Export flag stuck — resetting and retrying.");
            exportManager.ResetExportState();
        }

        var placement = UnityEngine.Object.FindFirstObjectByType<FurniturePlacementController>();
        var hasPlaced = placement != null && placement.CountPlacedInCurrentSpace() > 0;
        return exportManager.ExportLayoutPayload(roomShellOnly: !hasPlaced);
    }
}
