using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.EnhancedTouch;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Touch = UnityEngine.InputSystem.EnhancedTouch.Touch;
using TouchPhase = UnityEngine.InputSystem.TouchPhase;

/// <summary>
/// Tap-to-place for ARDesignScene, supporting many simultaneous furniture
/// instances plus a selection system so gestures know what to act on.
///
/// TAP RESOLUTION ORDER
///   1. Physics raycast against already-placed furniture → select it.
///   2. AR raycast against planes (and the environment mesh where a provider
///      supports it) → place the pending model, or deselect if nothing pending.
///
/// Placement is gated on the room scan being confirmed, which is what keeps the
/// scan → confirm → place flow honest.
///
/// A pending model is armed by SpawnFurniture: RN says "the user picked this
/// chair", we resolve the asset, then the next floor tap drops it. If
/// <see cref="placeImmediatelyOnSpawn"/> is set the model lands in front of the
/// camera right away instead, which is the friendlier default for a catalog UI.
/// </summary>
[DefaultExecutionOrder(-120)]
public class FurniturePlacementController : MonoBehaviour
{
    [Header("AR")]
    [SerializeField] private ARRaycastManager raycastManager;
    [SerializeField] private ARPlaneManager planeManager;
    [SerializeField] private ARAnchorManager anchorManager;
    [SerializeField] private ARPlacementIndicator placementIndicator;
    [SerializeField] private Camera arCamera;
    [SerializeField] private Transform furnitureParent;
    [SerializeField] private ARDesignLayoutModeController layoutMode;

    [Header("Scan gating")]
    [SerializeField] private RoomScanController scanController;
    [Tooltip("Block placement until the user has confirmed their room scan.")]
    [SerializeField] private bool requireConfirmedRoom = true;

    [Header("Content sources")]
    [SerializeField] private FurnitureCatalog catalog;
    [SerializeField] private RuntimeGltfLoader gltfLoader;
    [Tooltip("Used when neither a GLB URL nor a catalog prefab resolves. Validates the placement pipeline on its own.")]
    [SerializeField] private GameObject placeholderPrefab;
    [Tooltip("When remote-catalog-only is active, allow falling back to bundled Resources prefabs if GLB download fails.")]
    [SerializeField] private bool allowLocalPrefabFallback = false;

    [Header("Placement behaviour")]
    [Tooltip("Show the white floor reticle while a model is armed. Off = tap the floor directly to place.")]
    [SerializeField] private bool usePlacementIndicator = true;
    [Tooltip("After room confirm, allow floor taps on the right portion of the screen even when Unity UI is under the finger (catalog is on the left).")]
    [SerializeField] private float floorTapScreenXMin = 0.34f;
    [Tooltip("In Planner mode, drop the model as soon as the catalog selects it. Live AR always waits for a floor tap.")]
    [SerializeField] private bool placeImmediatelyOnSpawn = true;
    [Tooltip("Metres in front of the camera used by immediate placement (live AR only).")]
    [SerializeField] private float placeDistanceInFront = 1.6f;
    [Tooltip("Horizontal spacing when stacking would otherwise overlap in planner view.")]
    [SerializeField] private float spawnClearance = 0.55f;
    [Tooltip("Furniture is never dropped closer than this to the camera (metres, horizontal).")]
    [SerializeField] private float minPlacementDistance = 0.5f;
    [Tooltip("Plane must be at least this far below the camera to count as floor (rejects desks and tables).")]
    [SerializeField] private float minDepthBelowCamera = 0.9f;
    [Tooltip("Minimum plane area (m²) accepted for placement.")]
    [SerializeField] private float minFloorArea = 0.25f;
    [Tooltip("Push mesh feet slightly into the floor so they visually touch.")]
    [SerializeField] private float floorContactInset = 0.006f;
    [Tooltip("Extra sink in live AR so feet meet the detected plane (not the scan mesh).")]
    [SerializeField] private float liveArFloorSink = 0.022f;
    [Tooltip("In the scanned room, a floor reading further than this from the scanned floor is a raised " +
             "surface the reticle rested on, and the scanned floor is used instead (m).")]
    [SerializeField] private float maxLiveFloorOffset = 0.12f;
    [Tooltip("Keep furniture this far inside the room outline (metres from walls).")]
    [SerializeField] private float roomWallInset = 0.22f;
    [Tooltip("Clamp spawn/drag positions to the confirmed floor polygon.")]
    [SerializeField] private bool clampToRoomBounds = true;

    [Header("Budget")]
    [Tooltip("Guards mobile GPU/memory. Additional spawns are rejected with an error event.")]
    [SerializeField] private int maxInstances = 16;

    [Header("Defaults")]
    [Tooltip("Fallback real-world size (metres) when RN sends zeroes.")]
    [SerializeField] private Vector3 defaultDimensions = new(0.6f, 0.6f, 0.6f);

    /// <summary>Fired after an instance is added to the scene.</summary>
    public event Action<PlacedFurniture> FurniturePlaced;

    /// <summary>Fired after an instance is destroyed. Carries the removed instance id.</summary>
    public event Action<string> FurnitureRemoved;

    /// <summary>Fired when the selection changes. Null means "nothing selected".</summary>
    public event Action<PlacedFurniture> SelectionChanged;

    /// <summary>Fired when a spawn request cannot be fulfilled.</summary>
    public event Action<string, string> SpawnFailed;

    /// <summary>Fired when a model finished loading and is armed (or placed).</summary>
    public event Action<string> ModelReady;

    /// <summary>Fired when selected furniture placement safety changes.</summary>
    public event Action<FurniturePlacementSafety.Result, PlacedFurniture> PlacementSafetyChanged;

    /// <summary>Fired after a piece is locked or unlocked.</summary>
    public event Action<PlacedFurniture> FurnitureLockChanged;

    public IReadOnlyList<PlacedFurniture> Instances => instances;
    public PlacedFurniture Selected { get; private set; }

    /// <summary>Raised by FurnitureManipulator while a gesture owns the touch stream.</summary>
    public bool SuppressTapInput { get; set; }

    /// <summary>Another controller drives the placement reticle (e.g. layout alignment).</summary>
    public bool SuppressIndicatorControl { get; set; }

    /// <summary>Real room and Plan show the same pieces instead of separate workspaces.</summary>
    public bool ShareSpacesAcrossViews { get; set; }

    /// <summary>True while a catalog item is armed and waiting for a floor tap.</summary>
    public bool HasPendingPlacement => pending != null;

    readonly List<PlacedFurniture> instances = new();
    readonly List<ARRaycastHit> hits = new();

    PendingModel pending;
    int nextInstanceIndex = 1;
    int activeGlbLoads;
    Vector2? deferredPlacementTap;
    string lastSafetyKey = string.Empty;

    void Awake()
    {
        if (raycastManager == null) raycastManager = FindFirstObjectByType<ARRaycastManager>();
        if (planeManager == null) planeManager = FindFirstObjectByType<ARPlaneManager>();
        if (anchorManager == null) anchorManager = FindFirstObjectByType<ARAnchorManager>();
        if (placementIndicator == null) placementIndicator = FindFirstObjectByType<ARPlacementIndicator>();
        if (scanController == null) scanController = FindFirstObjectByType<RoomScanController>();
        if (catalog == null) catalog = FindFirstObjectByType<FurnitureCatalog>();
        if (gltfLoader == null) gltfLoader = FindFirstObjectByType<RuntimeGltfLoader>();
        if (layoutMode == null) layoutMode = FindFirstObjectByType<ARDesignLayoutModeController>();
        if (arCamera == null) arCamera = Camera.main;

        EnsureFurnitureParentInSessionSpace();

        if (placementIndicator != null)
            placementIndicator.gameObject.SetActive(usePlacementIndicator);
    }

    void OnEnable()
    {
        EnhancedTouchSupport.Enable();
        if (layoutMode != null)
            layoutMode.ViewModeChanged += OnViewModeChanged;
    }

    void OnDisable()
    {
        if (layoutMode != null)
            layoutMode.ViewModeChanged -= OnViewModeChanged;
    }

    void OnViewModeChanged(ARDesignLayoutModeController.ViewMode mode)
    {
        DiscardPending();
        if (ShareSpacesAcrossViews)
        {
            var shared = CurrentPlacementSpace;
            for (var i = 0; i < instances.Count; i++)
                instances[i]?.SetPlacementSpace(shared);
        }

        if (Selected != null && !IsInCurrentSpace(Selected))
            Select(null);

        ApplySpaceVisibility();

        if (mode == ARDesignLayoutModeController.ViewMode.RealRoom)
        {
            for (var i = 0; i < instances.Count; i++)
            {
                if (IsInCurrentSpace(instances[i]))
                    PinFurnitureToWorld(instances[i]);
            }
        }
        else
        {
            for (var i = 0; i < instances.Count; i++)
                DetachFurnitureFromWorld(instances[i]);
        }
    }

    public ARDesignLayoutModeController.ViewMode CurrentPlacementSpace =>
        layoutMode != null && layoutMode.IsPlannerOrbitActive
            ? ARDesignLayoutModeController.ViewMode.Planner
            : ARDesignLayoutModeController.ViewMode.RealRoom;

    bool IsInCurrentSpace(PlacedFurniture furniture)
    {
        return furniture != null && furniture.PlacementSpace == CurrentPlacementSpace;
    }

    int CountInCurrentSpace()
    {
        var count = 0;
        for (var i = 0; i < instances.Count; i++)
        {
            if (IsInCurrentSpace(instances[i]))
                count++;
        }

        return count;
    }

    /// <summary>Placed pieces in the active planner / AR workspace (for export).</summary>
    public int CountPlacedInCurrentSpace() => CountInCurrentSpace();

    void ApplySpaceVisibility()
    {
        var space = CurrentPlacementSpace;
        for (var i = 0; i < instances.Count; i++)
        {
            var furniture = instances[i];
            if (furniture == null) continue;
            furniture.gameObject.SetActive(furniture.PlacementSpace == space);
        }
    }

    void Update()
    {
        if (arCamera == null) return;

        var canPlace = CanPlace();
        var awaitingPlacement = pending != null || activeGlbLoads > 0;

        var ownsIndicator = !SuppressIndicatorControl;

        if (ownsIndicator && usePlacementIndicator && canPlace && (awaitingPlacement || Selected != null))
        {
            placementIndicator?.SetMinDepthBelowCamera(IsRoomConfirmed() ? 0.22f : minDepthBelowCamera);
            if (Touch.activeTouches.Count >= 1)
                placementIndicator?.StartTracking(Touch.activeTouches[0].screenPosition);
            else if (Selected != null && arCamera != null)
            {
                var screen = arCamera.WorldToScreenPoint(Selected.transform.position);
                if (screen.z > 0.05f)
                    placementIndicator?.StartTracking(new Vector2(screen.x, screen.y));
                else
                    placementIndicator?.StartTracking();
            }
            else
                placementIndicator?.StartTracking();
        }
        else if (ownsIndicator && (!usePlacementIndicator || (!awaitingPlacement && Selected == null)))
            placementIndicator?.StopTracking();

        if (SuppressTapInput) return;
        if (!TryGetPlacementTap(out var tapPoint)) return;

        if (TrySelectAtScreenPoint(tapPoint)) return;

        if (!canPlace)
        {
            Select(null);
            return;
        }

        if (activeGlbLoads > 0 && pending == null)
        {
            deferredPlacementTap = tapPoint;
            Debug.Log("[FurniturePlacementController] Model loading — tap will place when the download finishes.");
            return;
        }

        if (pending == null)
        {
            Select(null);
            return;
        }

        if (!TryGetPlacementPose(tapPoint, out var pose))
        {
            Debug.Log("[FurniturePlacementController] No floor under tap — wait for the white reticle, then tap the floor.");
            return;
        }

        CommitPending(pose);
    }

    // ── Public API (driven by ARSceneBridge) ──────────────────────────────────

    /// <summary>
    /// Resolves the requested model and either places it immediately or arms it
    /// for the next floor tap. Asynchronous when a GLB URL is supplied.
    /// </summary>
    public void SpawnFurniture(SpawnFurnitureRequest request)
    {
        if (request == null)
        {
            SpawnFailed?.Invoke("badRequest", "SpawnFurniture received no payload.");
            return;
        }

        if (requireConfirmedRoom && !IsRoomConfirmed())
        {
            SpawnFailed?.Invoke("roomNotConfirmed", "Confirm the room scan before placing furniture.");
            return;
        }

        deferredPlacementTap = null;

        if (CountInCurrentSpace() >= maxInstances)
        {
            SpawnFailed?.Invoke("instanceLimit", $"Scene already holds the maximum of {maxInstances} items.");
            return;
        }

        var dimensions = ResolveDimensions(request);
        EnsureGlbUrlFromCatalog(request);

        if (!string.IsNullOrWhiteSpace(request.glbUrl))
        {
            if (gltfLoader == null || !RuntimeGltfLoader.IsSupported)
            {
                Debug.LogWarning("[FurniturePlacementController] glTFast unavailable — falling back to catalog/placeholder.");
                if (catalog != null && catalog.RemoteCatalogOnly && !allowLocalPrefabFallback)
                {
                    SpawnFailed?.Invoke("remoteOnly",
                        "Remote furniture requires glTFast. Rebuild with glTFast enabled or disable remote-catalog-only mode.");
                    return;
                }
                ArmFromPrefab(request, dimensions);
                return;
            }

            activeGlbLoads++;
            gltfLoader.Load(request.glbUrl, (model, error) =>
            {
                activeGlbLoads = Mathf.Max(0, activeGlbLoads - 1);

                if (model == null)
                {
                    Debug.LogWarning($"[FurniturePlacementController] GLB load failed: {error}");
                    if (catalog != null && catalog.RemoteCatalogOnly && !allowLocalPrefabFallback)
                    {
                        var detail = string.IsNullOrWhiteSpace(error) ? "Check Wi‑Fi and the GCS URL." : error;
                        SpawnFailed?.Invoke("glbLoadFailed",
                            $"Could not load '{ResolveModelId(request)}'. {detail}");
                        return;
                    }
                    ArmFromPrefab(request, dimensions);
                    return;
                }

                model.SetActive(false);
                Arm(BuildPending(request, dimensions, prefab: null, instanceTemplate: model));
                TryConsumeDeferredPlacementTap();
            });
            return;
        }

        ArmFromPrefab(request, dimensions);
    }

    /// <summary>
    /// Swaps the selected piece for another catalog item at the same floor spot and facing.
    /// Returns false when nothing is selected or the selection is locked.
    /// </summary>
    public bool ReplaceSelected(SpawnFurnitureRequest request)
    {
        if (request == null || Selected == null || Selected.IsLocked) return false;

        var old = Selected;
        var position = old.transform.position;
        var yaw = old.transform.eulerAngles.y;
        if (!RemoveFurniture(old.InstanceId)) return false;

        request.hasPosition = true;
        request.position = new ARDesignVec3(position);
        request.rotationY = yaw;
        SpawnFurniture(request);
        return true;
    }

    /// <summary>Tints one piece (empty id = selected). Returns false when the piece is not found.</summary>
    public bool SetFurnitureColor(string instanceId, string colorHex)
    {
        var target = string.IsNullOrEmpty(instanceId)
            ? Selected
            : instances.Find(item => item != null && item.InstanceId == instanceId);
        if (target == null) return false;
        target.ApplyColor(colorHex);
        return true;
    }

    /// <summary>Locks or unlocks one piece (empty id = selected). Returns false when the piece is not found.</summary>
    public bool SetFurnitureLocked(string instanceId, bool locked)
    {
        var target = string.IsNullOrEmpty(instanceId)
            ? Selected
            : instances.Find(item => item != null && item.InstanceId == instanceId);
        if (target == null) return false;
        if (target.IsLocked == locked) return true;

        target.SetLocked(locked);
        FurnitureLockChanged?.Invoke(target);
        return true;
    }

    /// <summary>Last furniture removed — read by <see cref="FurnitureLayoutHistory"/> for undo.</summary>
    public TransformSnapshot LastRemovedSnapshot { get; private set; }

    /// <summary>Destroys the selected instance. Returns the id that was removed, or null (also when locked).</summary>
    public string RemoveSelectedFurniture()
    {
        if (Selected == null || Selected.IsLocked) return null;
        return RemoveFurniture(Selected.InstanceId) ? LastRemovedSnapshot?.instanceId : null;
    }

    /// <summary>Destroys a specific instance by id.</summary>
    public bool RemoveFurniture(string instanceId)
    {
        if (string.IsNullOrEmpty(instanceId)) return false;

        PlacedFurniture target = null;
        foreach (var instance in instances)
        {
            if (instance != null && instance.InstanceId == instanceId)
            {
                target = instance;
                break;
            }
        }

        if (target == null) return false;

        LastRemovedSnapshot = CaptureSnapshot(target);
        var go = target.gameObject;

        if (Selected == target)
            Select(null);

        instances.Remove(target);
        DestroyInstance(go);
        FurnitureRemoved?.Invoke(instanceId);
        return true;
    }

    /// <summary>Re-spawns furniture from an undo/redo snapshot at its saved pose.</summary>
    public PlacedFurniture RestoreFurniture(TransformSnapshot snapshot)
    {
        if (snapshot == null || string.IsNullOrEmpty(snapshot.modelId)) return null;

        var request = new SpawnFurnitureRequest
        {
            modelId = snapshot.modelId,
            catalogId = string.IsNullOrEmpty(snapshot.catalogId) ? snapshot.modelId : snapshot.catalogId,
            width = snapshot.width,
            height = snapshot.height,
            depth = snapshot.depth,
        };

        var dimensions = ResolveDimensions(request);
        var prefab = ResolvePrefab(request);
        if (prefab == null)
        {
            SpawnFailed?.Invoke("modelNotFound", $"Cannot restore '{snapshot.modelId}'.");
            return null;
        }

        // Bypass the pending/tap flow — drop straight at the saved pose.
        pending = new PendingModel
        {
            modelId = ResolveModelId(request),
            dimensions = dimensions,
            catalogDimensions = ResolveCatalogDimensions(request),
            dimensionLabel = ResolveDimensionLabel(request),
            prefab = prefab,
            forcedInstanceId = snapshot.instanceId,
            forcedPose = new Pose(snapshot.position, Quaternion.Euler(0f, snapshot.rotationY, 0f)),
            forcedScaleMultiplier = snapshot.scaleMultiplier > 0f ? snapshot.scaleMultiplier : 1f,
            hasForcedPose = true,
            hasForcedSpace = true,
            forcedSpace = snapshot.placementSpace,
        };

        CommitPending(pending.forcedPose);
        return Selected;
    }

    /// <summary>Applies a saved pose / scale to an existing instance.</summary>
    public bool ApplyTransformSnapshot(TransformSnapshot snapshot)
    {
        if (snapshot == null) return false;

        PlacedFurniture target = null;
        foreach (var instance in instances)
        {
            if (instance != null && instance.InstanceId == snapshot.instanceId)
            {
                target = instance;
                break;
            }
        }

        if (target == null) return false;

        target.transform.localScale = target.TrueScale.sqrMagnitude > 0f ? target.TrueScale : Vector3.one;
        target.transform.SetPositionAndRotation(
            snapshot.position,
            Quaternion.Euler(0f, snapshot.rotationY, 0f));
        GroundInstance(target);
        return true;
    }

    static TransformSnapshot CaptureSnapshot(PlacedFurniture furniture)
    {
        return new TransformSnapshot
        {
            instanceId = furniture.InstanceId,
            modelId = furniture.ModelId,
            catalogId = furniture.ModelId,
            width = furniture.RequestedDimensions.x,
            height = furniture.RequestedDimensions.y,
            depth = furniture.RequestedDimensions.z,
            position = furniture.transform.position,
            rotationY = furniture.transform.eulerAngles.y,
            scaleMultiplier = furniture.ScaleMultiplier,
            placementSpace = furniture.PlacementSpace,
        };
    }

    /// <summary>Destroys placed furniture in the current AR or Plan workspace only.</summary>
    public void ClearFurniture()
    {
        Select(null);
        DiscardPending();

        var space = CurrentPlacementSpace;
        for (var i = instances.Count - 1; i >= 0; i--)
        {
            var instance = instances[i];
            if (instance == null)
            {
                instances.RemoveAt(i);
                continue;
            }

            if (instance.PlacementSpace != space) continue;
            DestroyInstance(instance.gameObject);
            instances.RemoveAt(i);
        }

        LastRemovedSnapshot = null;
    }

    /// <summary>
    /// Moves every placed piece by a rigid floor transform (yaw-only rotation), e.g.
    /// after the design layout is re-aligned to the real room.
    /// </summary>
    public void TransformAllInstances(Matrix4x4 floorTransform, float yawDeltaDegrees)
    {
        Select(null);
        DiscardPending();

        for (var i = 0; i < instances.Count; i++)
        {
            var furniture = instances[i];
            if (furniture == null) continue;

            DetachFurnitureFromWorld(furniture);
            var t = furniture.transform;
            var position = floorTransform.MultiplyPoint3x4(t.position);
            var yaw = t.eulerAngles.y + yawDeltaDegrees;
            t.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            FlattenUpright(t);
            Physics.SyncTransforms();
            GroundInstance(furniture);

            if (ShouldUseWorldAnchors() && IsInCurrentSpace(furniture))
                PinFurnitureToWorld(furniture);
        }
    }

    public void Select(PlacedFurniture furniture)
    {
        if (Selected == furniture) return;

        if (Selected != null)
            Selected.SetSelected(false);

        Selected = furniture;

        if (Selected != null)
            Selected.SetSelected(true);

        SelectionChanged?.Invoke(Selected);
        RefreshPlacementSafety(Selected);
    }

    public LayoutPayload BuildLayout()
    {
        var payload = new LayoutPayload
        {
            phase = scanController != null
                ? RoomScanController.PhaseToString(scanController.Phase)
                : "idle",
            roomConfirmed = IsRoomConfirmed(),
            roomMeshCount = scanController?.ConfirmedRoom?.surfaces.Count ?? 0,
            count = CountInCurrentSpace(),
        };

        foreach (var instance in instances)
        {
            if (instance != null && IsInCurrentSpace(instance))
                payload.furniture.Add(instance.ToPayload());
        }

        return payload;
    }

    /// <summary>Re-grounds an instance onto the live AR floor (same plane as the reticle).</summary>
    public void GroundInstance(PlacedFurniture furniture)
    {
        if (furniture == null) return;
        if (!IsInCurrentSpace(furniture)) return;

        var clamped = ClampFurnitureInsideRoom(furniture, furniture.transform.position);
        furniture.transform.position = new Vector3(clamped.x, furniture.transform.position.y, clamped.z);

        var floorSample = new Vector3(clamped.x, furniture.transform.position.y, clamped.z);
        if (!TrySampleLiveFloorY(floorSample, out var floorY))
            floorY = ResolveFloorHeight(floorSample).y;
        else
            floorY = ResolveFloorHeight(new Vector3(clamped.x, floorY, clamped.z)).y;

        SeatOnFloor(furniture.gameObject, furniture.LocalBounds.min.y, new Vector3(clamped.x, floorY, clamped.z));

        clamped = ClampFurnitureInsideRoom(furniture, furniture.transform.position);
        furniture.transform.position = new Vector3(clamped.x, furniture.transform.position.y, clamped.z);
        FlattenUpright(furniture.transform);
    }

    Vector3 ResolveFloorHeight(Vector3 position)
    {
        if (usePlacementIndicator && ShouldUseLiveFloorHits()
            && placementIndicator != null && placementIndicator.IsLockedOnFloor)
        {
            position.y = placementIndicator.WorldPosition.y;
            return position;
        }

        if (ShouldUseLiveFloorHits() && TryGetHorizontalPlaneYUnderPoint(position, out var liveY))
        {
            position.y = liveY;
            return position;
        }

        if (ShouldUseLiveFloorHits() && TrySampleLiveFloorY(position, out liveY))
        {
            position.y = liveY;
            return position;
        }

        if (TryGetStableFloorY(position, out var stableY))
            position.y = stableY;

        return position;
    }

    /// <summary>
    /// Live AR floor height at a world XZ point — AR planes first, scan floor last.
    /// </summary>
    bool TrySampleLiveFloorY(Vector3 worldPoint, out float floorY)
    {
        floorY = 0f;
        if (!ShouldUseLiveFloorHits())
            return TryGetStableFloorY(worldPoint, out floorY);

        if (TryGetHorizontalPlaneYUnderPoint(worldPoint, out floorY))
            return true;

        if (TryGetArFloorHeightAtWorldPoint(worldPoint, out floorY))
            return true;

        if (TryGetFloorHeightAtWorldPoint(worldPoint, out floorY))
            return true;

        return TryGetConfirmedFloorY(out floorY);
    }

    Vector3 WithIndicatorFloorY(Vector3 position) => ResolveFloorHeight(position);

    void SeatOnFloor(GameObject instance, float localFootY, Vector3 floorPoint)
    {
        if (instance == null) return;
        floorPoint.y = NearScanFloor(floorPoint.y);
        var inset = EffectiveFloorInset();
        Physics.SyncTransforms();

        // Mesh-accurate grounding (handles legs/feet below the bounds pivot).
        ARFurnitureGrounding.SnapToFloorPoint(instance, floorPoint, inset);

        // Fallback if renderers are not ready on the first frame.
        if (float.IsPositiveInfinity(ARFurnitureGrounding.GetSupportContactY(instance)))
            ARFurnitureGrounding.SnapLocalFootToFloor(instance.transform, localFootY, floorPoint, inset);
    }

    /// <summary>
    /// Detach from AR anchors before a drag so tracking updates don't fight the gesture.
    /// </summary>
    public void BeginFurnitureManipulation(PlacedFurniture furniture)
    {
        DetachFurnitureFromWorld(furniture);
    }

    /// <summary>Re-pin to a fresh world anchor after drag/scale ends (live AR only).</summary>
    public void EndFurnitureManipulation(PlacedFurniture furniture)
    {
        if (furniture != null)
        {
            var safe = ResolveCollisionFreePivot(
                furniture, furniture.transform.position, furniture.transform.position);
            furniture.transform.position = new Vector3(safe.x, furniture.transform.position.y, safe.z);
        }

        GroundInstance(furniture);
        if (ShouldUseWorldAnchors())
            PinFurnitureToWorld(furniture);
        StartCoroutine(ReGroundAfterRender(furniture));
        RefreshPlacementSafety(furniture);
    }

    /// <summary>
    /// Evaluates furniture/wall collisions for the selected (or given) piece and
    /// turns the floor outline red when placement is unsafe.
    /// <paramref name="blockedPivot"/> is where a drag wanted to go before overlap resolution
    /// held it back; when that spot overlaps another piece the result is flagged as blocked.
    /// </summary>
    public FurniturePlacementSafety.Result RefreshPlacementSafety(
        PlacedFurniture furniture = null,
        Vector3? blockedPivot = null)
    {
        var target = furniture != null ? furniture : Selected;
        if (target == null)
            return FurniturePlacementSafety.Result.Safe();

        // Planner hard-clamps footprints inside the walls, so only furniture overlap is unsafe there.
        var plannerActive = layoutMode != null && layoutMode.IsPlannerOrbitActive;
        var result = FurniturePlacementSafety.Evaluate(
            target, instances, plannerActive ? null : scanController);

        if (blockedPivot.HasValue && !result.hasFurnitureCollision)
        {
            var attempted = FurniturePlacementSafety.EvaluateAtPivot(target, blockedPivot.Value, instances, null);
            if (attempted.hasFurnitureCollision)
            {
                result.isSafe = false;
                result.isBlocked = true;
                result.otherModelId = attempted.otherModelId;
                result.reason = "Blocked by another furniture piece";
            }
        }

        target.ApplyPlacementSafety(result.isSafe);

        var key =
            $"{target.InstanceId}|{result.isSafe}|{result.hasFurnitureCollision}|{result.hasWallCollision}|{result.isTooCloseToWall}|{result.isBlocked}|{result.otherModelId}|{result.reason}";
        if (key != lastSafetyKey)
        {
            lastSafetyKey = key;
            PlacementSafetyChanged?.Invoke(result, target);
        }

        return result;
    }

    /// <summary>
    /// Every piece in this space that overlaps another piece or runs out through a wall (standing
    /// close to a wall is fine). Finishing a design is blocked while any are left (adviser,
    /// 2026-10-28); <see cref="RefreshPlacementSafety"/> only ever looks at one piece.
    /// </summary>
    public List<(PlacedFurniture piece, FurniturePlacementSafety.Result result)> FindPlacementErrors()
    {
        var errors = new List<(PlacedFurniture, FurniturePlacementSafety.Result)>();
        var plannerActive = layoutMode != null && layoutMode.IsPlannerOrbitActive;
        foreach (var piece in instances)
        {
            if (piece == null || !IsInCurrentSpace(piece)) continue;
            var result = FurniturePlacementSafety.Evaluate(piece, instances, plannerActive ? null : scanController);
            if (result.hasFurnitureCollision || result.hasWallCollision) errors.Add((piece, result));
        }

        return errors;
    }

    /// <summary>Raycasts the floor under a screen point. Used by the manipulator's drag-to-reposition.</summary>
    public bool TryGetFloorPositionAtScreenPoint(Vector2 screenPoint, out Vector3 position)
    {
        position = default;
        if (!TryGetFloorPose(screenPoint, out var pose)) return false;
        position = pose.position;
        return true;
    }

    /// <summary>
    /// Planner-friendly floor hit: mesh first, then infinite floor plane at the
    /// confirmed room height so dragging never "dies" when the finger leaves the mesh.
    /// Always clamped inside the room outline.
    /// </summary>
    public bool TryGetDragFloorPosition(Vector2 screenPoint, out Vector3 position)
    {
        if (TryGetFloorPositionAtScreenPoint(screenPoint, out position))
        {
            position = ClampToRoom(position);
            if (ShouldUseLiveFloorHits())
                FinalizeLiveFloorPoint(ref position);
            return true;
        }

        if (ShouldUseLiveFloorHits())
        {
            if (TryGetLowestFloorPlaneY(out var liveY)
                && TryProjectScreenPointOntoFloorHeight(screenPoint, liveY, out position))
            {
                position = ClampToRoom(position);
                return true;
            }

            return false;
        }

        if (TryProjectOntoConfirmedFloorPlane(screenPoint, out position))
        {
            position = ClampToRoom(position);
            return true;
        }

        return false;
    }

    /// <summary>
    /// Drag target for a specific piece — keeps the whole footprint inside the walls,
    /// not just the pivot point.
    /// </summary>
    public bool TryGetDragFloorPositionFor(PlacedFurniture furniture, Vector2 screenPoint, out Vector3 position)
    {
        if (TryGetDragFloorPosition(screenPoint, out position))
        {
            if (furniture != null)
                position = ClampToRoom(position);
            return true;
        }

        // Finger on the mesh: slide on the live floor plane under the piece instead of scan mesh height.
        if (furniture != null && ShouldUseLiveFloorHits()
            && TrySampleLiveFloorY(furniture.transform.position, out var floorY)
            && TryProjectScreenPointOntoFloorHeight(screenPoint, floorY, out position))
        {
            position = ClampToRoom(position);
            return true;
        }

        return false;
    }

    /// <summary>
    /// Keeps a furniture pivot clear of other furniture footprints.
    /// Wall hard-blocking is disabled — room edges are warn-only via placement safety.
    /// If no clear spot is found near <paramref name="desiredPivot"/>, returns
    /// <paramref name="fallbackPivot"/> (typically the last known safe position).
    /// </summary>
    public Vector3 ResolveCollisionFreePivot(
        PlacedFurniture furniture,
        Vector3 desiredPivot,
        Vector3 fallbackPivot)
    {
        if (furniture == null)
            return desiredPivot;

        var resolved = FurniturePlacementSafety.ResolveAwayFromFurnitureOverlaps(
            furniture, desiredPivot, instances, fallbackPivot);

        var check = FurniturePlacementSafety.EvaluateAtPivot(furniture, resolved, instances, null);
        if (check.hasFurnitureCollision)
            return fallbackPivot;

        return resolved;
    }

    /// <summary>True when the pose is clear of other furniture (walls are not hard-blocked).</summary>
    public bool IsPlacementClear(PlacedFurniture furniture)
    {
        if (furniture == null) return true;
        var check = FurniturePlacementSafety.Evaluate(furniture, instances, null);
        return !check.hasFurnitureCollision;
    }

    /// <summary>Keeps a world point inside the confirmed room floor (inset from walls).</summary>
    public Vector3 ClampToRoom(Vector3 worldPoint)
    {
        if (!clampToRoomBounds || scanController == null || !IsRoomConfirmed())
            return worldPoint;

        return scanController.ClampToFloorPolygon(worldPoint, roomWallInset);
    }

    /// <summary>
    /// Soft room clamp for the furniture pivot (does not hard-block drag against walls).
    /// </summary>
    public Vector3 ClampFurnitureInsideRoom(PlacedFurniture furniture, Vector3 desiredPivot)
    {
        // Wall hard-blocking reverted — only a light pivot clamp to the room outline.
        var pivot = ClampToRoom(desiredPivot);

        // Generated-layout planner: the room is exact, so keep the whole footprint inside the walls.
        if (furniture != null && layoutMode != null && layoutMode.IsPlannerOrbitActive
            && clampToRoomBounds && scanController != null && IsRoomConfirmed())
            pivot = PushFootprintInsideRoom(furniture, pivot);

        return pivot;
    }

    const float PlannerWallMargin = 0.02f;

    /// <summary>
    /// Shifts <paramref name="pivot"/> until every footprint corner lies on the floor outline.
    /// Works per axis so corners pressed against two walls resolve in one pass.
    /// </summary>
    Vector3 PushFootprintInsideRoom(PlacedFurniture furniture, Vector3 pivot)
    {
        var locals = GetFootprintLocalCorners(furniture);
        var current = furniture.transform.position;

        for (var pass = 0; pass < 4; pass++)
        {
            float minDx = 0f, maxDx = 0f, minDz = 0f, maxDz = 0f;
            var delta = pivot - current;
            delta.y = 0f;

            foreach (var local in locals)
            {
                var world = furniture.transform.TransformPoint(local) + delta;
                if (scanController.IsInsideRoom(world)) continue;

                var inside = scanController.ClampToFloorPolygon(world, PlannerWallMargin);
                var fix = inside - world;
                minDx = Mathf.Min(minDx, fix.x);
                maxDx = Mathf.Max(maxDx, fix.x);
                minDz = Mathf.Min(minDz, fix.z);
                maxDz = Mathf.Max(maxDz, fix.z);
            }

            var shift = new Vector3(minDx + maxDx, 0f, minDz + maxDz);
            if (shift.sqrMagnitude < 1e-8f) break;
            pivot += shift;
        }

        return pivot;
    }

    static float EstimateFootprintInset(PlacedFurniture furniture)
    {
        var dims = furniture.CurrentDimensions;
        // Half of the larger horizontal size — conservative circle containing the footprint.
        return 0.5f * Mathf.Max(dims.x, dims.z);
    }

    bool AreFootprintCornersInside(PlacedFurniture furniture, Vector3 pivot)
    {
        if (scanController == null) return true;

        var delta = pivot - furniture.transform.position;
        delta.y = 0f;

        foreach (var local in GetFootprintLocalCorners(furniture))
        {
            var world = furniture.transform.TransformPoint(local) + delta;
            if (!scanController.IsInsideRoom(world))
                return false;
        }

        return true;
    }

    static Vector3[] GetFootprintLocalCorners(PlacedFurniture furniture)
    {
        var b = furniture.LocalBounds;
        if (b.size.sqrMagnitude < 1e-6f)
        {
            var d = furniture.CurrentDimensions;
            var hx = d.x * 0.5f;
            var hz = d.z * 0.5f;
            return new[]
            {
                new Vector3(-hx, 0f, -hz),
                new Vector3(hx, 0f, -hz),
                new Vector3(hx, 0f, hz),
                new Vector3(-hx, 0f, hz),
            };
        }

        var min = b.min;
        var max = b.max;
        // Bottom rectangle corners in local space.
        return new[]
        {
            new Vector3(min.x, min.y, min.z),
            new Vector3(max.x, min.y, min.z),
            new Vector3(max.x, min.y, max.z),
            new Vector3(min.x, min.y, max.z),
        };
    }

    // ── Spawn plumbing ────────────────────────────────────────────────────────

    void EnsureGlbUrlFromCatalog(SpawnFurnitureRequest request)
    {
        if (request == null || !string.IsNullOrWhiteSpace(request.glbUrl) || catalog == null)
            return;

        var url = catalog.GetGlbUrl(ResolveModelId(request));
        if (!string.IsNullOrWhiteSpace(url))
            request.glbUrl = url;
    }

    void ArmFromPrefab(SpawnFurnitureRequest request, Vector3 dimensions)
    {
        if (catalog != null && catalog.RemoteCatalogOnly && !allowLocalPrefabFallback)
        {
            var url = catalog.GetGlbUrl(ResolveModelId(request));
            if (!string.IsNullOrWhiteSpace(url))
            {
                SpawnFailed?.Invoke("remoteOnly",
                    "This item streams from the cloud. Wait for the catalog to finish loading, then try again.");
                return;
            }

            // No local Resources/Furniture meshes anymore — never fall back to the
            // green placeholder cube when remote catalog URLs are missing.
            SpawnFailed?.Invoke("missingGlbUrl",
                $"No cloud model URL for '{ResolveModelId(request)}'. " +
                "Check that the backend is reachable and RemoteFurnitureCatalogLoader.catalogUrl is correct.");
            return;
        }

        var prefab = ResolvePrefab(request);
        if (prefab == null)
        {
            SpawnFailed?.Invoke("modelNotFound",
                $"No GLB, catalog entry or placeholder available for '{ResolveModelId(request)}'.");
            return;
        }

        Arm(BuildPending(request, dimensions, prefab, instanceTemplate: null));
    }

    /// <summary>
    /// Places every item at its supplied pose. Used by the design-flow AR overlay.
    /// Items without <c>hasPosition</c> still arm for a floor tap.
    /// </summary>
    public void ApplyLayout(ApplyLayoutRequest request)
    {
        if (request?.items == null || request.items.Length == 0)
        {
            SpawnFailed?.Invoke("badRequest", "applyLayout received no furniture items.");
            return;
        }

        if (request.clearExisting)
            ClearFurniture();

        foreach (var item in request.items)
            SpawnFurniture(item);
    }

    PendingModel BuildPending(
        SpawnFurnitureRequest request,
        Vector3 dimensions,
        GameObject prefab,
        GameObject instanceTemplate)
    {
        var model = new PendingModel
        {
            modelId = ResolveModelId(request),
            dimensions = dimensions,
            catalogDimensions = ResolveCatalogDimensions(request),
            dimensionLabel = ResolveDimensionLabel(request),
            prefab = prefab,
            instanceTemplate = instanceTemplate,
            colorHex = request.colorHex,
        };
        ApplySpawnPose(model, request);
        return model;
    }

    static void ApplySpawnPose(PendingModel model, SpawnFurnitureRequest request)
    {
        if (model == null || request == null || !request.hasPosition) return;

        var p = request.position != null
            ? new Vector3(request.position.x, request.position.y, request.position.z)
            : Vector3.zero;
        model.hasForcedPose = true;
        model.forcedPose = new Pose(p, Quaternion.Euler(0f, request.rotationY, 0f));
    }

    void Arm(PendingModel model)
    {
        DiscardPending();
        pending = model;
        Select(null);
        if (model != null && !string.IsNullOrEmpty(model.modelId))
            ModelReady?.Invoke(model.modelId);

        // Design-flow / undo poses land immediately — do not wait for a tap.
        if (model != null && model.hasForcedPose)
        {
            CommitPending(model.forcedPose);
            return;
        }

        // Live AR: wait for a floor tap so feet land on the real surface.
        // Planner: drop immediately on the stylized room floor.
        if (!ShouldPlaceImmediately())
        {
            TryConsumeDeferredPlacementTap();
            return;
        }
        if (!TryGetImmediatePlacementPose(out var pose)) return;

        CommitPending(pose);
    }

    void TryConsumeDeferredPlacementTap()
    {
        if (pending == null || !deferredPlacementTap.HasValue) return;

        var tapPoint = deferredPlacementTap.Value;
        deferredPlacementTap = null;

        if (!TryGetPlacementPose(tapPoint, out var pose)) return;

        CommitPending(pose);
    }

    bool TryGetPlacementPose(Vector2 screenPoint, out Pose pose)
    {
        pose = default;

        if (TryGetFloorPose(screenPoint, out pose))
        {
            SnapPoseToIndicatorFloor(ref pose, screenPoint);
            return true;
        }

        if (usePlacementIndicator && placementIndicator != null && placementIndicator.IsLockedOnFloor)
        {
            if (TryProjectScreenPointOntoFloorHeight(screenPoint, placementIndicator.WorldPosition.y, out var projected))
            {
                pose = new Pose(projected, Quaternion.identity);
                return true;
            }

            pose = placementIndicator.CurrentPose;
            pose.position = ClampToRoom(pose.position);
            return true;
        }

        return false;
    }

    void SnapPoseToIndicatorFloor(ref Pose pose, Vector2 screenPoint)
    {
        if (!usePlacementIndicator || placementIndicator == null || !placementIndicator.IsLockedOnFloor)
            return;

        if (TryProjectScreenPointOntoFloorHeight(screenPoint, placementIndicator.WorldPosition.y, out var snapped))
            pose.position = snapped;
        else
            pose.position.y = placementIndicator.WorldPosition.y;
    }

    bool TryProjectScreenPointOntoFloorHeight(Vector2 screenPoint, float floorY, out Vector3 position)
    {
        position = default;
        if (arCamera == null) return false;

        var ray = arCamera.ScreenPointToRay(screenPoint);
        if (Mathf.Abs(ray.direction.y) < 0.02f) return false;

        var t = (floorY - ray.origin.y) / ray.direction.y;
        if (t < 0.02f || t > 120f) return false;

        position = ray.GetPoint(t);
        position.y = floorY;
        position = ClampToRoom(position);
        return true;
    }

    bool ShouldPlaceImmediately()
    {
        if (!placeImmediatelyOnSpawn) return false;
        return layoutMode != null && layoutMode.IsPlannerOrbitActive;
    }

    void CommitPending(Pose pose)
    {
        if (pending == null) return;

        var model = pending;
        pending = null;

        var instance = model.instanceTemplate != null
            ? model.instanceTemplate
            : Instantiate(model.prefab);

        instance.SetActive(true);
        instance.name = $"{model.modelId}_{nextInstanceIndex}";

        ARFurniturePrefabCleanup.HideEmbeddedBaseMeshes(instance);
        if (model.instanceTemplate != null)
            GltfUrpMaterialFixer.Apply(instance);

        // Reset to identity before measuring, so the bounds we read are the
        // model's authored size and not whatever the prefab happened to be scaled to.
        instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
        instance.transform.localScale = Vector3.one;
        Physics.SyncTransforms();

        if (!ARFurnitureGrounding.TryGetLocalFurnitureBounds(instance, out var localBounds))
            localBounds = new Bounds(Vector3.zero, Vector3.one);

        // Keep the model's authored size. Catalog dimensions are display-only
        // and must not shrink sofas/chairs to fit a box.
        var trueScale = Vector3.one;
        instance.transform.localScale = trueScale;

        Vector3 position;
        float yaw;
        if (model.hasForcedPose)
        {
            position = ClampToRoom(model.forcedPose.position);
            yaw = model.forcedPose.rotation.eulerAngles.y;
        }
        else
        {
            position = ClampToRoom(FindClearSpawnPosition(EnforceMinDistance(pose.position)));
            yaw = 0f;
        }

        position = WithIndicatorFloorY(position);
        instance.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
        FlattenUpright(instance.transform);

        if (furnitureParent != null)
            instance.transform.SetParent(furnitureParent, true);

        Physics.SyncTransforms();
        SeatOnFloor(instance, localBounds.min.y, position);
        EnsureCollider(instance, localBounds);

        var instanceId = !string.IsNullOrEmpty(model.forcedInstanceId)
            ? model.forcedInstanceId
            : $"fur-{nextInstanceIndex}";
        nextInstanceIndex++;

        var placed = instance.GetComponent<PlacedFurniture>() ?? instance.AddComponent<PlacedFurniture>();
        var authoredSize = localBounds.size;
        if (authoredSize.x < 0.01f) authoredSize = model.dimensions;
        var space = model.hasForcedSpace ? model.forcedSpace : CurrentPlacementSpace;

        var catalogDims = model.catalogDimensions;
        if (catalogDims.x <= 0.01f && catalog != null)
            catalogDims = catalog.GetCatalogDimensions(model.modelId);
        if (catalogDims.x <= 0.01f)
            catalogDims = model.dimensions;

        var dimensionLabel = model.dimensionLabel;
        if (string.IsNullOrWhiteSpace(dimensionLabel) && catalog != null)
            dimensionLabel = catalog.GetDimensionLabel(model.modelId);

        placed.Initialize(instanceId, model.modelId, authoredSize, trueScale, localBounds, space, catalogDims, dimensionLabel);
        if (!string.IsNullOrWhiteSpace(model.colorHex))
            placed.ApplyColor(model.colorHex);
        placed.gameObject.SetActive(space == CurrentPlacementSpace);

        // Footprint-aware clamp after we know real dimensions.
        var safe = ClampFurnitureInsideRoom(placed, instance.transform.position);
        var floorY = ResolveFloorHeight(safe).y;
        if (TryGetStableFloorY(safe, out var stableY) && !ShouldUseLiveFloorHits())
            floorY = stableY;

        SeatOnFloor(instance, localBounds.min.y, new Vector3(safe.x, floorY, safe.z));
        FlattenUpright(instance.transform);

        instances.Add(placed);

        // Push clear of any existing furniture (large sofas need footprint checks, not point clearance alone).
        // Not a layout or undo pose: that spot was chosen, and a piece pushed off it sat out of line with
        // the plan, sometimes half through a wall (adviser, 2026-11-11). An overlap there shows red instead.
        var clearPivot = model.hasForcedPose
            ? placed.transform.position
            : ResolveCollisionFreePivot(placed, placed.transform.position, FindClearSpawnPosition(placed.transform.position));
        if ((clearPivot - placed.transform.position).sqrMagnitude > 1e-6f)
        {
            var clearFloorY = ResolveFloorHeight(clearPivot).y;
            SeatOnFloor(instance, localBounds.min.y, new Vector3(clearPivot.x, clearFloorY, clearPivot.z));
            FlattenUpright(instance.transform);
        }

        Select(placed);

        GroundInstance(placed);

        placementIndicator?.StopTracking();

        if (ShouldUseWorldAnchors())
            PinFurnitureToWorld(placed);

        StartCoroutine(ReGroundAfterRender(placed));

        Debug.Log($"[FurniturePlacementController] Placed '{placed.InstanceId}' ({placed.ModelId}) " +
                  $"at {placed.transform.position} sized {placed.CurrentDimensions}.");

        FurniturePlaced?.Invoke(placed);
    }

    IEnumerator ReGroundAfterRender(PlacedFurniture placed)
    {
        for (var frame = 0; frame < 5; frame++)
        {
            yield return null;
            if (placed == null) yield break;
            Physics.SyncTransforms();
            GroundInstance(placed);
        }
    }

    void DiscardPending()
    {
        if (pending?.instanceTemplate != null)
            Destroy(pending.instanceTemplate);

        pending = null;
        deferredPlacementTap = null;
    }

    Vector3 ResolveDimensions(SpawnFurnitureRequest request)
    {
        var dimensions = new Vector3(request.width, request.height, request.depth);
        if (dimensions.x > 0f && dimensions.y > 0f && dimensions.z > 0f)
            return dimensions;

        if (catalog != null)
        {
            var catalogDims = catalog.GetCatalogDimensions(ResolveModelId(request));
            if (catalogDims.x > 0f && catalogDims.y > 0f && catalogDims.z > 0f)
                return catalogDims;
        }

        Debug.LogWarning($"[FurniturePlacementController] '{ResolveModelId(request)}' arrived without real-world " +
                         "dimensions — falling back to defaults. Pass width/height/depth from the RN catalog.");
        return defaultDimensions;
    }

    Vector3 ResolveCatalogDimensions(SpawnFurnitureRequest request)
    {
        if (catalog != null)
        {
            var catalogDims = catalog.GetCatalogDimensions(ResolveModelId(request));
            if (catalogDims.x > 0f && catalogDims.y > 0f && catalogDims.z > 0f)
                return catalogDims;
        }

        return ResolveDimensions(request);
    }

    string ResolveDimensionLabel(SpawnFurnitureRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.dimensionLabel))
            return request.dimensionLabel.Trim();

        if (catalog != null)
        {
            var label = catalog.GetDimensionLabel(ResolveModelId(request));
            if (!string.IsNullOrWhiteSpace(label))
                return label;
        }

        return null;
    }

    GameObject ResolvePrefab(SpawnFurnitureRequest request)
    {
        if (catalog != null)
        {
            var byCatalogId = catalog.GetPrefab(request.catalogId);
            if (byCatalogId != null) return byCatalogId;

            var byModelId = catalog.GetPrefab(request.modelId);
            if (byModelId != null) return byModelId;
        }

        return placeholderPrefab;
    }

    static string ResolveModelId(SpawnFurnitureRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.modelId)) return request.modelId;
        if (!string.IsNullOrWhiteSpace(request.catalogId)) return request.catalogId;
        return "furniture";
    }

    static void EnsureCollider(GameObject instance, Bounds localBounds)
    {
        var existing = instance.GetComponentInChildren<Collider>();
        if (existing != null)
        {
            // Inflate tiny authored colliders so finger picks are forgiving.
            if (existing is BoxCollider box)
            {
                var size = box.size;
                box.size = new Vector3(
                    Mathf.Max(size.x, localBounds.size.x) * 1.15f,
                    Mathf.Max(size.y, localBounds.size.y) * 1.05f,
                    Mathf.Max(size.z, localBounds.size.z) * 1.15f);
            }

            return;
        }

        var added = instance.AddComponent<BoxCollider>();
        added.center = localBounds.center;
        added.size = new Vector3(
            Mathf.Max(localBounds.size.x, 0.25f) * 1.2f,
            Mathf.Max(localBounds.size.y, 0.2f),
            Mathf.Max(localBounds.size.z, 0.25f) * 1.2f);
    }

    void DestroyInstance(GameObject go)
    {
        if (go == null) return;
        var placed = go.GetComponent<PlacedFurniture>();
        placed?.UnbindWorldAnchor(furnitureParent, destroyAnchor: true);
        Destroy(go);
    }

    void EnsureFurnitureParentInSessionSpace()
    {
        if (furnitureParent == null)
        {
            var existing = GameObject.Find("FurnitureRoot");
            furnitureParent = existing != null
                ? existing.transform
                : new GameObject("FurnitureRoot").transform;
        }

        Transform sessionRoot = null;
        if (raycastManager != null)
            sessionRoot = raycastManager.transform;
        else
        {
            var origin = FindFirstObjectByType<Unity.XR.CoreUtils.XROrigin>();
            if (origin != null)
                sessionRoot = origin.transform;
        }

        if (sessionRoot != null && furnitureParent.parent != sessionRoot)
            furnitureParent.SetParent(sessionRoot, true);
    }

    bool ShouldUseWorldAnchors()
    {
        // Anchors only in live AR. In planner the camera is script-locked; live
        // anchor updates would make furniture tremble against the frozen orbit view.
        if (layoutMode != null)
            return layoutMode.IsLayoutActive && !layoutMode.IsPlannerOrbitActive;
        return IsRoomConfirmed();
    }

    void DetachFurnitureFromWorld(PlacedFurniture furniture)
    {
        if (furniture == null) return;
        // A pin still waiting for tracking gives up: the piece is about to move (drag, planner view).
        pinRequests.Remove(furniture);
        furniture.UnbindWorldAnchor(furnitureParent, destroyAnchor: true);
    }

    /// <summary>Latest pin request per piece: a newer one, or a detach, makes older retries give up.</summary>
    readonly Dictionary<PlacedFurniture, int> pinRequests = new();
    int nextPinRequest;
    const float PinWaitForTrackingSeconds = 15f;
    const int PinAttempts = 6;
    const float PinRetrySeconds = 0.5f;

    /// <summary>
    /// Locks a piece to the real room with an ARCore anchor. ARCore refuses anchors until it is
    /// tracking: a layout applied while the camera was still starting failed once ("UnknownError")
    /// and the piece stayed unpinned for the whole session, sliding with every tracking correction.
    /// So this waits for tracking, then retries a few times.
    /// </summary>
    async void PinFurnitureToWorld(PlacedFurniture furniture)
    {
        if (furniture == null || anchorManager == null || !anchorManager.isActiveAndEnabled)
            return;
        if (!ShouldUseWorldAnchors())
            return;

        DetachFurnitureFromWorld(furniture);
        var request = ++nextPinRequest;
        pinRequests[furniture] = request;
        bool StillWanted() =>
            furniture != null && pinRequests.TryGetValue(furniture, out var latest) && latest == request
            && ShouldUseWorldAnchors();

        var waited = 0f;
        while (ARSession.state != ARSessionState.SessionTracking && waited < PinWaitForTrackingSeconds)
        {
            await Awaitable.WaitForSecondsAsync(PinRetrySeconds);
            waited += PinRetrySeconds;
            if (!StillWanted()) return;
        }

        for (var attempt = 1; attempt <= PinAttempts; attempt++)
        {
            // Read the pose each try: the piece may have been grounded or nudged meanwhile.
            var yaw = furniture.transform.eulerAngles.y;
            var pose = new Pose(furniture.transform.position, Quaternion.Euler(0f, yaw, 0f));
            try
            {
                var result = await anchorManager.TryAddAnchorAsync(pose);
                var anchor = result.status.IsSuccess() ? result.value : null;
                if (!StillWanted())
                {
                    if (anchor != null) Destroy(anchor.gameObject);
                    return;
                }

                if (anchor != null)
                {
                    pinRequests.Remove(furniture);
                    furniture.transform.SetParent(anchor.transform, true);
                    furniture.BindWorldAnchor(anchor);
                    GroundInstance(furniture);
                    if (attempt > 1 || waited > 0f)
                        Debug.Log($"[FurniturePlacementController] '{furniture.InstanceId}' pinned on try {attempt} " +
                                  $"after waiting {waited:F1}s for tracking.");
                    return;
                }

                Debug.LogWarning($"[FurniturePlacementController] Anchor failed for '{furniture.InstanceId}': " +
                                 $"{result.status} (try {attempt} of {PinAttempts}, tracking {ARSession.state})");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[FurniturePlacementController] Anchor exception: {e.Message}");
            }

            if (attempt == PinAttempts) break;
            await Awaitable.WaitForSecondsAsync(PinRetrySeconds);
            if (!StillWanted()) return;
        }

        pinRequests.Remove(furniture);
        if (furniture != null && furnitureParent != null)
            furniture.transform.SetParent(furnitureParent, true);
    }

    void EnsureSpawnVisibleInRealRoom(PlacedFurniture furniture)
    {
        if (furniture == null || arCamera == null || !ShouldUseWorldAnchors())
            return;

        var viewport = arCamera.WorldToViewportPoint(furniture.transform.position);
        var onScreen = viewport.z > 0.35f
                       && viewport.x > 0.08f && viewport.x < 0.92f
                       && viewport.y > 0.08f && viewport.y < 0.92f;
        if (onScreen) return;

        if (!TryGetConfirmedFloorY(out var floorY))
            floorY = furniture.transform.position.y;

        var seed = arCamera.transform.position + FlatForward() * placeDistanceInFront;
        seed.y = floorY;
        seed = FindClearSpawnPosition(ClampFurnitureInsideRoom(furniture, seed));
        furniture.transform.position = new Vector3(seed.x, furniture.transform.position.y, seed.z);
        GroundInstance(furniture);
    }

    /// <summary>
    /// The live floor reading, unless it's far from the floor this room was scanned on: the reticle
    /// rests on any flat surface, so it's a bed, table or sofa top, and the scanned floor is used.
    /// The same chair landed 23 cm apart on the phone (2026-10-24). Without a scanned floor from this
    /// tracking session (no scan yet, or tracking was reset) the reading is kept: no made-up height.
    /// </summary>
    float NearScanFloor(float liveY)
    {
        if (!ShouldUseLiveFloorHits() || !ScanPlacement.TryGetScanFloorY(out var scanY)) return liveY;
        if (Mathf.Abs(liveY - scanY) <= maxLiveFloorOffset) return liveY;
        // Below the scanned floor on a large surface: that is the floor, and the scan's floor point
        // was set too high (a bed floated 27 cm up, 2026-10-30). Nothing stands below the floor, so
        // only a lower reading overrules the scan; a higher one may be the top of other furniture.
        // Only a little lower, though: a scanned floor that was too high was 27 cm out. A surface 56 cm
        // below it sank a sofa into the floor (Redmi, 2026-11-12): ARCore's planes from before the
        // planner don't always line up again.
        var lowerFloor = liveY < scanY && scanY - liveY <= MaxLowerFloorDrop && IsLargeFloorAt(liveY);
        // Seating runs every frame of a drag: one line now and then is enough.
        if (Time.unscaledTime >= nextFloorNoteAt)
        {
            nextFloorNoteAt = Time.unscaledTime + 2f;
            Debug.Log($"[FurniturePlacementController] Floor reading {liveY:F2} is {(liveY - scanY) * 100f:F0} cm " +
                      $"from the scanned floor {scanY:F2}: " +
                      (lowerFloor ? "seated on the floor AR found (the scanned floor is too high)." : "seated on the scanned floor."));
        }
        return lowerFloor ? liveY : scanY;
    }

    /// <summary>Smallest surface (m²) that counts as the floor when it is below the scanned floor.</summary>
    const float LargeFloorArea = 0.5f;
    /// <summary>Furthest (m) a surface below the scanned floor can be and still be taken as the floor.</summary>
    const float MaxLowerFloorDrop = 0.35f;

    /// <summary>A large tracked upward surface lies at <paramref name="y"/> (within 5 cm).</summary>
    bool IsLargeFloorAt(float y)
    {
        if (planeManager == null) return false;
        foreach (var plane in planeManager.trackables)
        {
            if (plane == null || plane.alignment != PlaneAlignment.HorizontalUp) continue;
            if (plane.trackingState != TrackingState.Tracking) continue;
            if (Mathf.Abs(plane.transform.position.y - y) > 0.05f) continue;
            if (plane.size.x * plane.size.y >= LargeFloorArea) return true;
        }
        return false;
    }

    float nextFloorNoteAt;

    float EffectiveFloorInset()
    {
        var inset = Mathf.Max(0f, floorContactInset);
        if (ShouldUseLiveFloorHits())
            inset += Mathf.Max(0f, liveArFloorSink);
        return inset;
    }

    bool TryGetStableFloorY(Vector3 worldPoint, out float floorY)
    {
        // Live AR: prefer real plane height so furniture does not float on the
        // (often drifted) corner-scan floorY.
        if (ShouldUseLiveFloorHits())
        {
            if (TryGetArFloorHeightAtWorldPoint(worldPoint, out floorY))
                return true;
            if (TryGetFloorHeightAtWorldPoint(worldPoint, out floorY))
                return true;
        }

        if (TryGetConfirmedFloorY(out floorY))
            return true;
        return TryGetFloorHeightAtWorldPoint(worldPoint, out floorY);
    }

    bool ShouldUseLiveFloorHits()
    {
        // Real room + pre-confirm scanning. Planner uses the baked room mesh.
        if (layoutMode != null && layoutMode.IsPlannerOrbitActive)
            return false;
        return true;
    }

    // ── Raycasting ────────────────────────────────────────────────────────────

    bool CanPlace()
    {
        if (!requireConfirmedRoom) return true;
        return IsRoomConfirmed();
    }

    bool IsRoomConfirmed() => scanController == null || scanController.IsConfirmed;

    bool TrySelectAtScreenPoint(Vector2 screenPoint)
    {
        if (arCamera == null || instances.Count == 0) return false;

        var ray = arCamera.ScreenPointToRay(screenPoint);
        var hits3d = Physics.RaycastAll(ray, 50f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
        if (hits3d != null && hits3d.Length > 0)
        {
            System.Array.Sort(hits3d, (a, b) => a.distance.CompareTo(b.distance));
            foreach (var hit in hits3d)
            {
                var furniture = hit.transform.GetComponentInParent<PlacedFurniture>();
                if (furniture == null || !IsInCurrentSpace(furniture)) continue;
                Select(furniture);
                return true;
            }
        }

        // Soft pick — helps when orbiting from a shallow angle where the mesh is thin on screen.
        PlacedFurniture best = null;
        var bestDist = 110f;
        foreach (var furniture in instances)
        {
            if (furniture == null || !IsInCurrentSpace(furniture)) continue;
            var screen = arCamera.WorldToScreenPoint(furniture.transform.position);
            if (screen.z < 0.05f) continue;
            var dist = Vector2.Distance(screenPoint, new Vector2(screen.x, screen.y));
            if (dist >= bestDist) continue;
            bestDist = dist;
            best = furniture;
        }

        if (best != null && bestDist <= 96f)
        {
            Select(best);
            return true;
        }

        return false;
    }

    /// <summary>
    /// Lowest valid floor hit under a screen point.
    /// Live AR prefers AR plane / depth hits so furniture sits on the real floor.
    /// Planner prefers the confirmed room mesh.
    /// </summary>
    bool TryGetFloorPose(Vector2 screenPoint, out Pose pose)
    {
        pose = default;
        if (arCamera == null) return false;

        var live = ShouldUseLiveFloorHits();

        // Direct tap placement — raycast at the finger first (no reticle required).
        if (live && raycastManager != null && TryRaycastPlanes(screenPoint, out pose))
        {
            SnapPoseToIndicatorFloor(ref pose, screenPoint);
            pose.position = ClampToRoom(pose.position);
            FinalizeLiveFloorPoint(ref pose.position);
            return true;
        }

        if (live && raycastManager != null &&
            raycastManager.Raycast(screenPoint, hits, TrackableType.Depth | TrackableType.FeaturePoint))
        {
            var cameraY = arCamera.transform.position.y;
            foreach (var hit in hits)
            {
                if (hit.pose.position.y > cameraY - minDepthBelowCamera) continue;
                pose = hit.pose;
                pose.position = ClampToRoom(pose.position);
                FinalizeLiveFloorPoint(ref pose.position);
                return true;
            }
        }

        if (IsRoomConfirmed() && TryRaycastConfirmedRoom(screenPoint, out pose))
        {
            pose.position = ClampToRoom(pose.position);
            if (live)
                FinalizeLiveFloorPoint(ref pose.position);
            return true;
        }

        if (IsRoomConfirmed() && TryProjectOntoConfirmedFloorPlane(screenPoint, out var projected))
        {
            projected = ClampToRoom(projected);
            if (live)
                FinalizeLiveFloorPoint(ref projected);
            pose = new Pose(projected, Quaternion.identity);
            return true;
        }

        if (!live && raycastManager != null && TryRaycastPlanes(screenPoint, out pose))
        {
            pose.position = ClampToRoom(pose.position);
            return true;
        }

        if (usePlacementIndicator && live && placementIndicator != null && placementIndicator.IsLockedOnFloor)
        {
            pose = placementIndicator.CurrentPose;
            pose.position = ClampToRoom(pose.position);
            FinalizeLiveFloorPoint(ref pose.position);
            return true;
        }

        return false;
    }

    void FinalizeLiveFloorPoint(ref Vector3 position)
    {
        if (!ShouldUseLiveFloorHits())
            return;

        if (TrySampleLiveFloorY(position, out var liveY))
            position.y = liveY;
        else if (placementIndicator != null && placementIndicator.IsLockedOnFloor)
            position.y = placementIndicator.WorldPosition.y;
    }

    bool TryGetArFloorHeightAtWorldPoint(Vector3 worldPoint, out float floorY)
    {
        floorY = 0f;

        // Never use physics against the scanned room mesh / AR mesh chunks —
        // those colliders often sit higher than the live AR plane the reticle uses,
        // which is what made sofas hover above the white floor outline.
        // Match the white reticle plane so furniture never floats above the floor outline.
        if (placementIndicator != null && placementIndicator.IsLockedOnFloor)
        {
            floorY = placementIndicator.WorldPosition.y;
            return true;
        }

        if (TryGetHorizontalPlaneYUnderPoint(worldPoint, out floorY))
            return true;

        if (arCamera == null || raycastManager == null) return false;

        var sample = worldPoint + Vector3.up * 0.05f;
        var screen = arCamera.WorldToScreenPoint(sample);
        if (screen.z > 0.15f
            && screen.x >= 0f && screen.x <= Screen.width
            && screen.y >= 0f && screen.y <= Screen.height
            && TryRaycastPlanes(new Vector2(screen.x, screen.y), out var pose))
        {
            floorY = pose.position.y;
            return true;
        }

        return false;
    }

    bool TryGetHorizontalPlaneYUnderPoint(Vector3 worldPoint, out float floorY)
    {
        floorY = 0f;
        if (planeManager == null || arCamera == null) return false;

        var cameraY = arCamera.transform.position.y;
        var minDepth = IsRoomConfirmed() ? 0.2f : minDepthBelowCamera;
        var bestY = float.PositiveInfinity;
        var found = false;

        foreach (var plane in planeManager.trackables)
        {
            if (plane == null) continue;
            if (plane.alignment != PlaneAlignment.HorizontalUp) continue;
            if (plane.trackingState != TrackingState.Tracking) continue;
            if (plane.size.x * plane.size.y < minFloorArea) continue;

            var y = plane.transform.position.y;
            if (y > cameraY - minDepth) continue;
            if (!PlaneContainsXZ(plane, worldPoint)) continue;
            if (y >= bestY) continue;

            bestY = y;
            found = true;
        }

        if (!found) return false;
        floorY = bestY;

        if (IsRoomConfirmed() && TryGetConfirmedFloorY(out var confirmedY))
        {
            // Planner / baked mesh: pick the plane closest to the scanned floor.
            // Live AR: keep the lowest plane — scan floorY is often above the real tiles.
            if (ShouldUseLiveFloorHits())
                return true;

            var bestDelta = float.PositiveInfinity;
            var bestPlaneY = floorY;
            foreach (var plane in planeManager.trackables)
            {
                if (plane == null) continue;
                if (plane.alignment != PlaneAlignment.HorizontalUp) continue;
                if (plane.trackingState != TrackingState.Tracking) continue;
                if (plane.size.x * plane.size.y < minFloorArea) continue;
                var y = plane.transform.position.y;
                if (y > cameraY - minDepth) continue;
                if (!PlaneContainsXZ(plane, worldPoint)) continue;
                var delta = Mathf.Abs(y - confirmedY);
                if (delta >= bestDelta) continue;
                bestDelta = delta;
                bestPlaneY = y;
            }

            if (bestDelta < float.PositiveInfinity)
                floorY = bestPlaneY;
        }

        return true;
    }

    static bool PlaneContainsXZ(ARPlane plane, Vector3 worldPoint)
    {
        var local = plane.transform.InverseTransformPoint(worldPoint);
        var boundary = plane.boundary;
        if (boundary.IsCreated && boundary.Length >= 3)
        {
            return PointInBoundary(boundary, new Vector2(local.x, local.z));
        }

        var half = plane.size * 0.5f;
        return Mathf.Abs(local.x) <= half.x + 0.08f && Mathf.Abs(local.z) <= half.y + 0.08f;
    }

    static bool PointInBoundary(Unity.Collections.NativeArray<Vector2> boundary, Vector2 point)
    {
        var inside = false;
        var j = boundary.Length - 1;
        for (var i = 0; i < boundary.Length; i++)
        {
            var a = boundary[i];
            var b = boundary[j];
            if (((a.y > point.y) != (b.y > point.y)) &&
                (point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) + 1e-6f) + a.x))
            {
                inside = !inside;
            }

            j = i;
        }

        return inside;
    }

    bool TryRaycastConfirmedRoom(Vector2 screenPoint, out Pose pose)
    {
        pose = default;
        if (arCamera == null) return false;

        var ray = arCamera.ScreenPointToRay(screenPoint);
        var hits3d = Physics.RaycastAll(ray, 80f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
        if (hits3d != null && hits3d.Length > 0)
        {
            System.Array.Sort(hits3d, (a, b) => a.distance.CompareTo(b.distance));

            // Prefer floor, but accept any mostly-upward room surface near floor height.
            RaycastHit? floorHit = null;
            RaycastHit? softHit = null;
            TryGetConfirmedFloorY(out var floorY);

            foreach (var hit in hits3d)
            {
                if (hit.collider.GetComponentInParent<PlacedFurniture>() != null)
                    continue;

                var tag = hit.collider.GetComponentInParent<RoomSurfaceTag>();
                if (tag == null) continue;

                if (tag.kind == RoomGeometrySnapshot.SurfaceKind.Floor && hit.normal.y >= 0.45f)
                {
                    floorHit = hit;
                    break;
                }

                if (!softHit.HasValue && hit.normal.y >= 0.7f &&
                    Mathf.Abs(hit.point.y - floorY) < 0.35f)
                {
                    softHit = hit;
                }
            }

            var chosen = floorHit ?? softHit;
            if (chosen.HasValue)
            {
                pose = new Pose(chosen.Value.point, Quaternion.identity);
                return true;
            }
        }

        return TryProjectOntoConfirmedFloorPlane(screenPoint, out var projected)
               && SetPose(projected, out pose);
    }

    static bool SetPose(Vector3 position, out Pose pose)
    {
        pose = new Pose(position, Quaternion.identity);
        return true;
    }

    bool TryGetConfirmedFloorY(out float floorY)
    {
        floorY = 0f;
        if (scanController?.ConfirmedRoom == null) return false;
        floorY = scanController.ConfirmedRoom.floorY;
        return !float.IsInfinity(floorY) && !float.IsNaN(floorY);
    }

    bool TryProjectOntoConfirmedFloorPlane(Vector2 screenPoint, out Vector3 position)
    {
        position = default;
        if (arCamera == null || !TryGetConfirmedFloorY(out var floorY))
            return false;

        var ray = arCamera.ScreenPointToRay(screenPoint);
        // Allow shallow orbit angles — only reject rays essentially parallel to the floor.
        if (Mathf.Abs(ray.direction.y) < 0.02f) return false;

        var t = (floorY - ray.origin.y) / ray.direction.y;
        if (t < 0.02f || t > 120f) return false;

        position = ray.GetPoint(t);
        position.y = floorY;
        position = ClampToRoom(position);
        return true;
    }

    bool TryRaycastPlanes(Vector2 screenPoint, out Pose pose)
    {
        pose = default;
        if (!raycastManager.Raycast(screenPoint, hits, TrackableType.PlaneWithinPolygon))
            return false;

        var cameraY = arCamera.transform.position.y;
        // After room confirm, allow floor hits closer to the camera (phone held low).
        var minDepth = IsRoomConfirmed() ? Mathf.Min(minDepthBelowCamera, 0.25f) : minDepthBelowCamera;
        var bestY = float.PositiveInfinity;
        var found = false;

        foreach (var hit in hits)
        {
            if (hit.trackable is not ARPlane plane) continue;
            if (plane.alignment != PlaneAlignment.HorizontalUp) continue;
            if (plane.trackingState != TrackingState.Tracking) continue;
            if (Vector3.Dot(hit.pose.up, Vector3.up) < 0.85f) continue;
            if (hit.pose.position.y > cameraY - minDepth) continue;
            if (plane.size.x * plane.size.y < minFloorArea) continue;
            if (hit.pose.position.y >= bestY) continue;

            bestY = hit.pose.position.y;
            pose = hit.pose;
            found = true;
        }

        return found;
    }

    bool TryGetImmediatePlacementPose(out Pose pose)
    {
        pose = default;

        // Planner / orbit mode: spawn on the room floor with clearance, not under
        // the screen center (that always stacks pieces on the room focus).
        if (IsRoomConfirmed() && TryGetConfirmedFloorY(out var floorY))
        {
            var layout = FindFirstObjectByType<ARDesignLayoutModeController>();
            Vector3 seed;
            if (layout != null && layout.IsPlannerOrbitActive)
            {
                seed = layout.FocusPoint;
                seed.y = floorY;
            }
            else if (arCamera != null)
            {
                seed = arCamera.transform.position + FlatForward() * placeDistanceInFront;
                seed.y = floorY;
            }
            else
            {
                seed = new Vector3(0f, floorY, 0f);
            }

            seed = FindClearSpawnPosition(ClampToRoom(seed));
            pose = new Pose(seed, Quaternion.identity);
            return true;
        }

        if (arCamera == null) return false;

        var center = new Vector2(Screen.width * 0.5f, Screen.height * 0.35f);
        if (TryGetFloorPose(center, out pose))
        {
            pose = new Pose(FindClearSpawnPosition(pose.position), pose.rotation);
            return true;
        }

        if (!TryGetLowestFloorPlaneY(out floorY)) return false;

        var position = arCamera.transform.position + FlatForward() * placeDistanceInFront;
        position.y = floorY;
        position = FindClearSpawnPosition(position);
        pose = new Pose(position, Quaternion.identity);
        return true;
    }

    /// <summary>
    /// Picks a free floor spot near <paramref name="preferred"/> so catalog clicks
    /// do not stack every piece on the same point.
    /// </summary>
    Vector3 FindClearSpawnPosition(Vector3 preferred)
    {
        preferred = ClampToRoom(preferred);
        if (!OverlapsExistingFurniture(preferred, spawnClearance * 0.85f))
            return preferred;

        var floorY = preferred.y;
        if (ShouldUseLiveFloorHits())
        {
            if (TryGetArFloorHeightAtWorldPoint(preferred, out var liveY))
                floorY = liveY;
        }
        else if (TryGetConfirmedFloorY(out var confirmedY))
        {
            floorY = confirmedY;
        }

        for (var i = 0; i < 16; i++)
        {
            var angle = (i * 137.5f) * Mathf.Deg2Rad;
            var radius = spawnClearance * (1f + i * 0.35f);
            var candidate = preferred + new Vector3(Mathf.Cos(angle) * radius, 0f, Mathf.Sin(angle) * radius);
            candidate.y = floorY;
            candidate = ClampToRoom(candidate);
            if (!OverlapsExistingFurniture(candidate, spawnClearance * 0.8f))
                return candidate;
        }

        return preferred;
    }

    bool OverlapsExistingFurniture(Vector3 worldPoint, float minDistance)
    {
        var minSq = minDistance * minDistance;
        foreach (var furniture in instances)
        {
            if (furniture == null || !IsInCurrentSpace(furniture)) continue;
            var delta = furniture.transform.position - worldPoint;
            delta.y = 0f;
            if (delta.sqrMagnitude < minSq)
                return true;
        }

        return false;
    }

    /// <summary>Strip accidental pitch/roll so pieces sit flat after spawn or restore.</summary>
    static void FlattenUpright(Transform t)
    {
        if (t == null) return;
        var euler = t.eulerAngles;
        t.rotation = Quaternion.Euler(0f, euler.y, 0f);
    }

    bool TryGetLowestFloorPlaneY(out float floorY)
    {
        if (ShouldUseLiveFloorHits() && TryGetArFloorHeightAtWorldPoint(
                arCamera != null ? arCamera.transform.position : Vector3.zero, out floorY))
            return true;

        if (!ShouldUseLiveFloorHits() && IsRoomConfirmed() && TryGetConfirmedFloorY(out floorY))
            return true;

        floorY = 0f;
        if (planeManager == null || arCamera == null) return false;

        var cameraY = arCamera.transform.position.y;
        var bestY = float.PositiveInfinity;

        foreach (var plane in planeManager.trackables)
        {
            if (plane == null) continue;
            if (plane.alignment != PlaneAlignment.HorizontalUp) continue;
            if (plane.trackingState != TrackingState.Tracking) continue;

            var y = plane.transform.position.y;
            if (y > cameraY - minDepthBelowCamera) continue;
            if (plane.size.x * plane.size.y < minFloorArea) continue;
            if (y < bestY) bestY = y;
        }

        if (float.IsPositiveInfinity(bestY))
        {
            if (TryGetConfirmedFloorY(out floorY))
                return true;
            return false;
        }

        floorY = bestY;
        return true;
    }

    bool TryGetFloorHeightAtWorldPoint(Vector3 worldPoint, out float floorY)
    {
        floorY = 0f;

        // Downward physics probe — only accept tagged floor surfaces so invisible
        // wall/ceiling colliders cannot chatter Y in live AR.
        var origin = worldPoint + Vector3.up * 2.5f;
        if (Physics.Raycast(origin, Vector3.down, out var hit, 6f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
        {
            var tag = hit.collider.GetComponentInParent<RoomSurfaceTag>();
            if (tag != null && tag.kind == RoomGeometrySnapshot.SurfaceKind.Floor)
            {
                floorY = hit.point.y;
                return true;
            }
        }

        if (TryGetConfirmedFloorY(out floorY))
            return true;

        if (arCamera == null) return false;

        var screenPoint = (Vector2)arCamera.WorldToScreenPoint(worldPoint + Vector3.up * 0.35f);
        if (screenPoint.x < 0f || screenPoint.y < 0f ||
            screenPoint.x > Screen.width || screenPoint.y > Screen.height)
            return false;

        if (!TryGetFloorPose(screenPoint, out var pose)) return false;

        floorY = pose.position.y;
        return true;
    }

    Vector3 EnforceMinDistance(Vector3 position)
    {
        if (arCamera == null) return position;

        var cameraPosition = arCamera.transform.position;
        var offset = position - cameraPosition;
        offset.y = 0f;

        if (offset.sqrMagnitude >= minPlacementDistance * minPlacementDistance)
            return position;

        var direction = offset.sqrMagnitude > 0.01f ? offset.normalized : FlatForward();
        var adjusted = cameraPosition + direction * minPlacementDistance;
        adjusted.y = position.y;
        return adjusted;
    }

    Vector3 FlatForward()
    {
        if (arCamera == null) return Vector3.forward;

        var forward = arCamera.transform.forward;
        forward.y = 0f;
        return forward.sqrMagnitude < 0.001f ? Vector3.forward : forward.normalized;
    }

    // ── Input ─────────────────────────────────────────────────────────────────

    bool TryGetPlacementTap(out Vector2 screenPoint)
    {
        screenPoint = default;

        if (Touch.activeTouches.Count == 1)
        {
            var touch = Touch.activeTouches[0];
            if (touch.phase != TouchPhase.Began) return false;
            if (ShouldAcceptPlacementTap(touch.screenPosition, touch.touchId))
            {
                screenPoint = touch.screenPosition;
                return true;
            }
        }

#if UNITY_EDITOR
        if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame)
        {
            var point = Mouse.current.position.ReadValue();
            if (ShouldAcceptPlacementTap(point, -1))
            {
                screenPoint = point;
                return true;
            }
        }
#endif

        return false;
    }

    bool ShouldAcceptPlacementTap(Vector2 screenPoint, int pointerId)
    {
        if (!IsPointerOverUI(pointerId)) return true;

        // Catalog/tools sit on the left — still allow placing on the visible floor.
        if ((pending != null || activeGlbLoads > 0) && IsRoomConfirmed()
            && screenPoint.x >= Screen.width * Mathf.Clamp01(floorTapScreenXMin))
            return true;

        return false;
    }

    static bool TryGetTapPosition(out Vector2 screenPoint)
    {
        screenPoint = default;

        if (Touch.activeTouches.Count == 1)
        {
            var touch = Touch.activeTouches[0];
            if (touch.phase == TouchPhase.Began && !IsPointerOverUI(touch.touchId))
            {
                screenPoint = touch.screenPosition;
                return true;
            }
        }

#if UNITY_EDITOR
        if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame && !IsPointerOverUI())
        {
            screenPoint = Mouse.current.position.ReadValue();
            return true;
        }
#endif

        return false;
    }

    static bool IsPointerOverUI(int pointerId = -1)
    {
        if (EventSystem.current == null) return false;

        return pointerId >= 0
            ? EventSystem.current.IsPointerOverGameObject(pointerId)
            : EventSystem.current.IsPointerOverGameObject();
    }

    sealed class PendingModel
    {
        public string modelId;
        public Vector3 dimensions;
        public Vector3 catalogDimensions;
        public string dimensionLabel;
        public GameObject prefab;

        /// <summary>Already-instantiated GLB root. Consumed directly rather than cloned.</summary>
        public GameObject instanceTemplate;

        public bool hasForcedPose;
        public Pose forcedPose;
        public float forcedScaleMultiplier = 1f;
        public string forcedInstanceId;
        public bool hasForcedSpace;
        public ARDesignLayoutModeController.ViewMode forcedSpace;
        public string colorHex;
    }
}
