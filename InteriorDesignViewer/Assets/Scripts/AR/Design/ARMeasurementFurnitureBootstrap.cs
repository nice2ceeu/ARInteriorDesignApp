using System;
using UnityEngine;

/// <summary>
/// Enables real GLB furniture placement on ARRoomMeasurement without switching to
/// ARDesignScene (UaaL LoadScene is unreliable after a measurement session).
/// </summary>
[DefaultExecutionOrder(-90)]
public class ARMeasurementFurnitureBootstrap : MonoBehaviour
{
    FurniturePlacementController placement;
    FurnitureManipulator manipulator;
    FurnitureLayoutHistory history;
    bool wired;

    public static ARMeasurementFurnitureBootstrap EnsureOn(GameObject host)
    {
        if (host == null) return null;
        var existing = host.GetComponent<ARMeasurementFurnitureBootstrap>();
        if (existing != null) return existing;
        return host.AddComponent<ARMeasurementFurnitureBootstrap>();
    }

    public FurniturePlacementController Placement => placement;
    public FurnitureLayoutHistory History => history;

    /// <summary>
    /// Furniture placement and its gestures on or off. Unity stays loaded between AR screens now
    /// (2026-11-12), so placement left on after "View in AR" kept running in the next scan: with no
    /// piece selected it switched the floor reticle off every frame, and the scan's aim dot was gone.
    /// </summary>
    public void SetPlacementActive(bool on)
    {
        if (placement == null) placement = GetComponent<FurniturePlacementController>();
        if (manipulator == null) manipulator = GetComponent<FurnitureManipulator>();
        if (placement != null) placement.enabled = on;
        if (manipulator != null) manipulator.enabled = on;
    }

    /// <summary>
    /// Adds placement / GLB / catalog components if missing, forces planner view,
    /// and wires RN events. Call while still on ARRoomMeasurement with a confirmed room.
    /// </summary>
    public void ActivateForMeasuredPlacement()
    {
        var managers = gameObject;

        if (managers.GetComponent<FurnitureCatalog>() == null)
            managers.AddComponent<FurnitureCatalog>();

        if (managers.GetComponent<RuntimeGltfLoader>() == null)
            managers.AddComponent<RuntimeGltfLoader>();

        placement = managers.GetComponent<FurniturePlacementController>()
                    ?? managers.AddComponent<FurniturePlacementController>();

        manipulator = managers.GetComponent<FurnitureManipulator>()
                      ?? managers.AddComponent<FurnitureManipulator>();

        history = managers.GetComponent<FurnitureLayoutHistory>()
                  ?? managers.AddComponent<FurnitureLayoutHistory>();
        SetPlacementActive(true);

        PlannerRnInputRouter.EnsureOn(managers)?.Rebind();

        var layout = FindFirstObjectByType<ARDesignLayoutModeController>();
        var scan = FindFirstObjectByType<RoomScanController>();
        if (scan != null && scan.IsConfirmed)
        {
            layout?.EnterLayoutMode();
            var alignment = GetComponent<ARDesignLayoutAlignmentController>();
            if (alignment != null && alignment.OwnsView)
                layout?.SetViewMode(alignment.PreferredView);
            else
                layout?.ApplyMeasurementViewPreset(topDown: false);
        }

        var exportManager = FindFirstObjectByType<RoomExportManager>(FindObjectsInactive.Include);
        if (exportManager == null)
            exportManager = managers.AddComponent<RoomExportManager>();
        exportManager.EnsurePlacementHooks();

        WireEvents();

        // Hide native Unity chrome — RN owns catalog + orbit.
        ARMainMenuBackButton.SetUiVisible(false);
        var planHud = FindFirstObjectByType<ARMeasurementPlanHUD>(FindObjectsInactive.Include);
        planHud?.HideForRnSession();

        Debug.Log("[ARMeasurementFurnitureBootstrap] Measured furniture placement armed on ARRoomMeasurement.");
    }

    void WireEvents()
    {
        if (wired || placement == null) return;
        wired = true;

        placement.FurniturePlaced += OnFurniturePlaced;
        placement.ModelReady += OnModelReady;
        placement.FurnitureRemoved += OnFurnitureRemoved;
        placement.SelectionChanged += OnSelectionChanged;
        placement.SpawnFailed += OnSpawnFailed;
        placement.PlacementSafetyChanged += OnPlacementSafetyChanged;

        if (manipulator != null)
            manipulator.LockedGestureBlocked += OnLockedGestureBlocked;

        if (history != null)
            history.HistoryChanged += OnHistoryChanged;
    }

    void OnDestroy()
    {
        if (placement != null)
        {
            placement.FurniturePlaced -= OnFurniturePlaced;
            placement.ModelReady -= OnModelReady;
            placement.FurnitureRemoved -= OnFurnitureRemoved;
            placement.SelectionChanged -= OnSelectionChanged;
            placement.SpawnFailed -= OnSpawnFailed;
            placement.PlacementSafetyChanged -= OnPlacementSafetyChanged;
        }

        if (manipulator != null)
            manipulator.LockedGestureBlocked -= OnLockedGestureBlocked;

        if (history != null)
            history.HistoryChanged -= OnHistoryChanged;
    }

    void OnFurniturePlaced(PlacedFurniture furniture)
    {
        if (furniture == null) return;
        UnityMessageBridge.SendToApp("furniturePlaced", JsonUtility.ToJson(furniture.ToPayload()));
        SendLayout();
    }

    void OnModelReady(string modelId)
    {
        UnityMessageBridge.SendToApp("furnitureReady", modelId ?? string.Empty);
    }

    void OnFurnitureRemoved(string instanceId)
    {
        UnityMessageBridge.SendToApp("furnitureRemoved", instanceId ?? string.Empty);
        SendLayout();
    }

    void OnSelectionChanged(PlacedFurniture furniture)
    {
        UnityMessageBridge.SendToApp(
            "furnitureSelected",
            JsonUtility.ToJson(new SelectionPayload
            {
                instanceId = furniture != null ? furniture.InstanceId : string.Empty,
                modelId = furniture != null ? furniture.ModelId : string.Empty,
                selected = furniture != null,
            }));
    }

    void OnSpawnFailed(string code, string message)
    {
        UnityMessageBridge.SendToApp(
            "error",
            JsonUtility.ToJson(new ARDesignErrorPayload
            {
                code = code ?? "spawnFailed",
                message = message ?? "Furniture spawn failed.",
            }));
    }

    void OnPlacementSafetyChanged(FurniturePlacementSafety.Result result, PlacedFurniture furniture)
    {
        UnityMessageBridge.SendToApp(
            "placementSafety",
            JsonUtility.ToJson(PlacementSafetyPayload.From(result, furniture)));
        // One piece moved off (or onto) another: the others' state changed with it.
        SendPlacementCheck();
    }

    /// <summary>Tells the app which pieces still overlap something or run through a wall.</summary>
    public void SendPlacementCheck()
    {
        if (placement == null) return;
        var errors = placement.FindPlacementErrors();
        var issues = new PlacementIssuePayload[errors.Count];
        for (var i = 0; i < errors.Count; i++)
        {
            var (piece, result) = errors[i];
            issues[i] = new PlacementIssuePayload
            {
                instanceId = piece.InstanceId,
                modelId = piece.ModelId,
                otherModelId = result.hasFurnitureCollision ? result.otherModelId ?? string.Empty : string.Empty,
                hitsWall = !result.hasFurnitureCollision && result.hasWallCollision,
                reason = result.reason ?? string.Empty,
            };
        }

        UnityMessageBridge.SendToApp(
            "placementCheck",
            JsonUtility.ToJson(new PlacementCheckPayload { hasErrors = issues.Length > 0, issues = issues }));
    }

    void OnLockedGestureBlocked(PlacedFurniture furniture)
    {
        UnityMessageBridge.SendToApp("furnitureLockBlocked", furniture != null ? furniture.InstanceId : string.Empty);
    }

    void OnHistoryChanged()
    {
        if (history == null) return;
        UnityMessageBridge.SendToApp("historyChanged", JsonUtility.ToJson(history.BuildState()));
        // History changes on every committed move/rotate/undo/redo — keep RN's layout copy current.
        SendLayout();
    }

    void SendLayout()
    {
        if (placement == null) return;
        var layout = placement.BuildLayout();
        GetComponent<ARDesignLayoutAlignmentController>()?.FillSourcePoses(layout);
        UnityMessageBridge.SendToApp("layoutChanged", JsonUtility.ToJson(layout));
        SendPlacementCheck();
    }

    public void ReplaceSelectedFurniture(string data)
    {
        if (placement == null)
        {
            OnSpawnFailed("notConfigured", "Furniture placement is not ready yet.");
            return;
        }

        SpawnFurnitureRequest request;
        try
        {
            request = JsonUtility.FromJson<SpawnFurnitureRequest>(data ?? string.Empty);
        }
        catch (Exception e)
        {
            OnSpawnFailed("badRequest", e.Message);
            return;
        }

        if (placement.Selected != null && placement.Selected.IsLocked)
        {
            OnSpawnFailed("furnitureLocked", "Unlock this piece before replacing it.");
            return;
        }

        if (!placement.ReplaceSelected(request))
            OnSpawnFailed("nothingSelected", "Select a piece of furniture to replace.");
    }

    public void RemoveSelectedFurniture()
    {
        if (placement == null) return;

        if (placement.Selected != null && placement.Selected.IsLocked)
        {
            OnSpawnFailed("furnitureLocked", "Unlock this piece before deleting it.");
            return;
        }

        placement.RemoveSelectedFurniture();
    }

    public void SetFurnitureLocked(string data)
    {
        if (placement == null) return;

        FurnitureLockRequest request;
        try
        {
            request = JsonUtility.FromJson<FurnitureLockRequest>(data ?? string.Empty);
        }
        catch (Exception e)
        {
            OnSpawnFailed("badRequest", e.Message);
            return;
        }

        if (request == null || !placement.SetFurnitureLocked(request.instanceId, request.locked))
        {
            OnSpawnFailed("nothingSelected", "Select a piece of furniture to lock.");
            return;
        }

        SendLayout();
    }

    public void SetFurnitureColor(string data)
    {
        if (placement == null) return;

        FurnitureColorRequest request;
        try
        {
            request = JsonUtility.FromJson<FurnitureColorRequest>(data ?? string.Empty);
        }
        catch (Exception e)
        {
            OnSpawnFailed("badRequest", e.Message);
            return;
        }

        if (request == null || !placement.SetFurnitureColor(request.instanceId, request.colorHex))
        {
            OnSpawnFailed("nothingSelected", "Select a piece of furniture to recolour.");
            return;
        }

        SendLayout();
    }

    public void SpawnFurniture(string data)
    {
        if (placement == null)
        {
            OnSpawnFailed("notConfigured", "Furniture placement is not ready yet.");
            return;
        }

        SpawnFurnitureRequest request = null;
        if (!string.IsNullOrWhiteSpace(data))
        {
            try
            {
                request = JsonUtility.FromJson<SpawnFurnitureRequest>(data);
            }
            catch (Exception e)
            {
                OnSpawnFailed("badRequest", e.Message);
                return;
            }
        }

        placement.SpawnFurniture(request);
    }

    public void ApplyLayout(string data)
    {
        if (placement == null)
            ActivateForMeasuredPlacement();

        if (placement == null)
        {
            OnSpawnFailed("notConfigured", "Furniture placement is not ready yet.");
            return;
        }

        ApplyLayoutRequest request = null;
        if (!string.IsNullOrWhiteSpace(data))
        {
            try
            {
                request = JsonUtility.FromJson<ApplyLayoutRequest>(data);
            }
            catch (Exception e)
            {
                OnSpawnFailed("badRequest", e.Message);
                return;
            }
        }

        GetComponent<ARDesignLayoutAlignmentController>()?.TransformRequest(request);
        placement.ApplyLayout(request);
    }
}
