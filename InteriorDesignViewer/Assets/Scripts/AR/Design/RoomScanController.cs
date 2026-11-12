using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

/// <summary>
/// Owns the room-scan phase of ARDesignScene.
///
/// PHASES
///   Idle            AR session is up but the user has not started a scan.
///   Scanning        Accumulating planes / mesh chunks. Progress ticks upward.
///   ReadyToConfirm  Coverage thresholds met. RN can offer "Done scanning".
///   Confirmed       Geometry snapshotted and frozen. Placement is unlocked.
///
/// COVERAGE MODEL
/// ARCore gives us planes and feature points, not a watertight room mesh, so
/// "coverage" is a heuristic blend of three independent signals:
///   • floor area found        — can we actually stand furniture somewhere?
///   • look-around coverage    — has the user swept the phone across the room?
///   • wall area found         — do we have vertical context for the export?
/// Walls are weighted but not gating: plenty of real rooms surface a usable
/// floor long before ARCore commits to a vertical plane.
///
/// Detection keeps running after confirmation (tracking quality degrades if you
/// disable it), but the snapshot taken at confirm time is what gets exported.
/// </summary>
[DefaultExecutionOrder(-150)]
public class RoomScanController : MonoBehaviour
{
    public enum ScanPhase
    {
        Idle,
        Scanning,
        ReadyToConfirm,
        Confirmed,
    }

    [Header("AR")]
    [SerializeField] private ARPlaneManager planeManager;
    [SerializeField] private ARPointCloudManager pointCloudManager;
    [Tooltip("Optional. AR Foundation has no meshing provider for ARCore, so this stays empty on Android.")]
    [SerializeField] private ARMeshManager meshManager;
    [SerializeField] private Camera arCamera;

    [Header("Coverage targets")]
    [Tooltip("Horizontal plane area (m²) that counts as a fully scanned floor.")]
    [SerializeField] private float targetFloorArea = 2.5f;
    [Tooltip("Vertical plane area (m²) that counts as fully scanned walls.")]
    [SerializeField] private float targetWallArea = 2f;
    [Tooltip("Fraction of the yaw circle the user must sweep before the scan is considered complete.")]
    [Range(0.1f, 1f)]
    [SerializeField] private float targetLookAroundCoverage = 0.25f;
    [Tooltip("Minimum seconds of scanning before ReadyToConfirm, so progress never snaps to 100% instantly.")]
    [SerializeField] private float minScanDuration = 2f;
    [Tooltip("Allow ReadyToConfirm once this fraction of the floor target is met (does not require 100%).")]
    [Range(0.2f, 1f)]
    [SerializeField] private float readyFloorScore = 0.45f;
    [Tooltip("Allow ReadyToConfirm once this fraction of look-around coverage is met.")]
    [Range(0.1f, 1f)]
    [SerializeField] private float readyLookScore = 0.35f;

    [Header("Memory budget")]
    [Tooltip("Hard cap on captured environment mesh chunks.")]
    [SerializeField] private int maxMeshChunks = 96;
    [Tooltip("Planes below this area (m²) are treated as noise.")]
    [SerializeField] private float minPlaneArea = 0.08f;

    [Header("Reporting")]
    [Tooltip("Seconds between scanProgress pushes to RN. Progress also fires immediately on phase change.")]
    [SerializeField] private float statusPushInterval = 0.4f;

    [Header("Corner outline")]
    [SerializeField] private ARDesignCornerRoomBuilder cornerBuilder;

    [Header("Modes")]
    [Tooltip("AR Furniture scene: skip height/width measurement and unlock placement immediately.")]
    [SerializeField] private bool furniturePlacementOnly = false;

    [Header("Standalone")]
    [Tooltip("Measurement scene: begin scanning automatically when the scene loads.")]
    [SerializeField] private bool autoStartScanOnLoad = false;

    /// <summary>Fired on every phase transition.</summary>
    public event Action<ScanPhase> PhaseChanged;

    /// <summary>Fired on the throttled status cadence and on every phase change.</summary>
    public event Action<ScanStatusPayload> StatusChanged;

    public ScanPhase Phase { get; private set; } = ScanPhase.Idle;
    public bool IsFurniturePlacementOnly => furniturePlacementOnly;
    public bool IsConfirmed => Phase == ScanPhase.Confirmed;
    public RoomGeometrySnapshot ConfirmedRoom { get; private set; }
    public ARDesignCornerRoomBuilder CornerBuilder => cornerBuilder;

    /// <summary>Floor outline polygon in world XZ (copied at confirm). Used to keep furniture inside the room.</summary>
    public IReadOnlyList<Vector3> FloorPolygon => floorPolygon;

    /// <summary>
    /// Wall height of the confirmed room (m), after any floor correction on confirm (0 before a
    /// confirm). The room payload uses it instead of the corner builder's own measurement.
    /// </summary>
    public float ConfirmedWallHeight { get; private set; }

    readonly List<Vector3> floorPolygon = new();

    // Yaw sweep tracking: 24 buckets of 15° each.
    const int YawBucketCount = 24;
    readonly bool[] yawBuckets = new bool[YawBucketCount];

    float scanStartTime;
    float lastStatusPush;
    float cachedProgress;
    ScanStatusPayload cachedStatus = new();

    void Awake()
    {
        if (planeManager == null) planeManager = FindFirstObjectByType<ARPlaneManager>();
        if (pointCloudManager == null) pointCloudManager = FindFirstObjectByType<ARPointCloudManager>();
        if (meshManager == null) meshManager = FindFirstObjectByType<ARMeshManager>();
        if (arCamera == null) arCamera = Camera.main;
        if (cornerBuilder == null) cornerBuilder = FindFirstObjectByType<ARDesignCornerRoomBuilder>();
    }

    void OnEnable()
    {
        if (cornerBuilder != null)
            cornerBuilder.CornersChanged += OnCornersChanged;
    }

    void OnDisable()
    {
        if (cornerBuilder != null)
            cornerBuilder.CornersChanged -= OnCornersChanged;
    }

    void Start()
    {
        if (furniturePlacementOnly)
        {
            BeginFurniturePlacementOnly();
            return;
        }

        // Design-flow "View in AR" arms the shell from RN — do not show the scan HUD.
        if (ARMeasurementRnBridge.HasPendingDesignLayout)
            return;

        if (autoStartScanOnLoad && Phase == ScanPhase.Idle)
            StartRoomScan();
    }

    /// <summary>
    /// Furniture-only mode: no height/width outline. Unlocks the catalog and
    /// live floor placement as soon as the scene loads.
    /// </summary>
    public void BeginFurniturePlacementOnly()
    {
        furniturePlacementOnly = true;

        if (cornerBuilder != null)
            cornerBuilder.enabled = false;

        ConfirmedRoom?.Dispose();
        ConfirmedRoom = null;
        floorPolygon.Clear();
        ConfirmedWallHeight = 0f;

        Array.Clear(yawBuckets, 0, yawBuckets.Length);
        scanStartTime = Time.unscaledTime;
        cachedProgress = 1f;

        // Keep floor tracking for tap-to-place, and vertical planes so furniture
        // can be pushed away from real walls (especially in furniture-only mode).
        if (planeManager != null)
        {
            planeManager.requestedDetectionMode = PlaneDetectionMode.Horizontal | PlaneDetectionMode.Vertical;
            planeManager.enabled = true;
        }

        if (pointCloudManager != null)
            pointCloudManager.enabled = false;
        if (meshManager != null)
            meshManager.enabled = false;

        var origin = arCamera != null ? arCamera.transform.position : Vector3.zero;
        var floorY = origin.y - 1.5f;
        const float half = 12f;
        var openFloor = new List<Vector3>(4)
        {
            new(origin.x - half, floorY, origin.z - half),
            new(origin.x + half, floorY, origin.z - half),
            new(origin.x + half, floorY, origin.z + half),
            new(origin.x - half, floorY, origin.z + half),
        };

        CaptureFloorPolygon(openFloor);
        ConfirmedRoom = RoomGeometryBuilder.CaptureFromFloorCorners(openFloor, 2.5f);

        Debug.Log("[RoomScanController] Furniture placement only — measurement HUD skipped.");
        SetPhase(ScanPhase.Confirmed);
        PushStatus();
    }

    void OnCornersChanged()
    {
        RecomputeStatus();
        PushStatus();

        if (Phase == ScanPhase.Scanning && cachedStatus.readyToConfirm)
            SetPhase(ScanPhase.ReadyToConfirm);
        else if (Phase == ScanPhase.ReadyToConfirm && !cachedStatus.readyToConfirm)
            SetPhase(ScanPhase.Scanning);
    }

    void Update()
    {
        if (Phase != ScanPhase.Scanning && Phase != ScanPhase.ReadyToConfirm)
            return;

        SampleYawBucket();
        RecomputeStatus();

        if (Phase == ScanPhase.Scanning && cachedStatus.readyToConfirm)
            SetPhase(ScanPhase.ReadyToConfirm);
        else if (Phase == ScanPhase.ReadyToConfirm && !cachedStatus.readyToConfirm)
            SetPhase(ScanPhase.Scanning);

        if (Time.unscaledTime - lastStatusPush >= statusPushInterval)
            PushStatus();
    }

    void OnDestroy()
    {
        ConfirmedRoom?.Dispose();
        ConfirmedRoom = null;
    }

    // ── Public API (driven by ARSceneBridge) ──────────────────────────────────

    /// <summary>Begins or restarts the scan phase, discarding any previously confirmed room.</summary>
    public void StartRoomScan()
    {
        // RN may call this after a furniture-only session — force real measurement mode.
        furniturePlacementOnly = false;

        ConfirmedRoom?.Dispose();
        ConfirmedRoom = null;
        floorPolygon.Clear();
        ConfirmedWallHeight = 0f;

        Array.Clear(yawBuckets, 0, yawBuckets.Length);
        scanStartTime = Time.unscaledTime;
        cachedProgress = 0f;

        SetPlaneDetectionEnabled(true);
        if (pointCloudManager != null)
            pointCloudManager.enabled = true;
        if (meshManager != null)
            meshManager.enabled = true;

        // The builder draws the height/width lines in Update, so it must be enabled to scan.
        if (cornerBuilder != null)
            cornerBuilder.enabled = true;
        cornerBuilder?.PrepareForRescan();
        FindFirstObjectByType<ARDesignSpatialMappingController>()?.ResetToOutline();

        // Every new scan gets a fresh AR map, however it was opened. A scan opened from the main
        // screen kept the old one: in a dim room it drifted from scan to scan (the floor read
        // -1.17, -0.97, -1.46, -1.62 then -1.79 m and the height 3.31 m within ten minutes).
        // The reload path resets too; the second request inside the cooldown is skipped.
        FindFirstObjectByType<ARBootstrap>()?.ResetTrackingForNewScan();

        SetPhase(ScanPhase.Scanning);
    }

    /// <summary>
    /// Tear down confirmed geometry without starting a new scan/placement session.
    /// Used when RN leaves AR so the next open/reload owns the boot.
    /// </summary>
    public void ResetToIdle()
    {
        furniturePlacementOnly = false;

        ConfirmedRoom?.Dispose();
        ConfirmedRoom = null;
        floorPolygon.Clear();
        ConfirmedWallHeight = 0f;

        Array.Clear(yawBuckets, 0, yawBuckets.Length);
        cachedProgress = 0f;

        cornerBuilder?.PrepareForRescan();
        FindFirstObjectByType<ARDesignSpatialMappingController>()?.ResetToOutline();
        if (cornerBuilder != null)
            cornerBuilder.enabled = true;

        SetPhase(ScanPhase.Idle);
        PushStatus();
    }

    /// <summary>
    /// Freezes the current geometry as the room layout and unlocks placement.
    /// Prefers a clean corner-to-corner outline when the user has tapped enough corners.
    /// </summary>
    public bool ConfirmRoomScan()
    {
        if (Phase == ScanPhase.Idle)
        {
            Debug.LogWarning("[RoomScanController] ConfirmRoomScan called before StartRoomScan.");
            return false;
        }

        var spatial = FindFirstObjectByType<ARDesignSpatialMappingController>();
        if (spatial != null && !spatial.CanConfirmRoom)
        {
            Debug.LogWarning("[RoomScanController] Complete spatial mapping (doors, furniture, review) before confirming.");
            return false;
        }

        RoomGeometrySnapshot snapshot = null;

        if (cornerBuilder != null && cornerBuilder.CanClose)
            cornerBuilder.CloseLoop();

        if (cornerBuilder != null && cornerBuilder.CanConfirm)
        {
            IReadOnlyList<Vector3> corners = cornerBuilder.Corners;
            var wallHeight = cornerBuilder.WallHeight;
            // The floor point can be set before AR has found the floor (on a bed or a table top):
            // a large surface now found clearly below it, under the room, is the floor.
            if (ScanFloorCorrection.TryFindLowerFloor(corners, wallHeight, HorizontalSurfaces(),
                    out var floorY, out var correctedHeight))
            {
                Debug.Log($"[RoomScanController] The floor point was {(correctedHeight - wallHeight) * 100f:F0} cm above " +
                          $"the floor AR found under the room: the room stands on {floorY:F2} " +
                          $"(height {wallHeight:F2} → {correctedHeight:F2} m).");
                corners = ScanFloorCorrection.AtFloor(corners, floorY);
                wallHeight = correctedHeight;
            }

            ConfirmedWallHeight = wallHeight;
            snapshot = RoomGeometryBuilder.CaptureFromFloorCorners(corners, wallHeight);
            CaptureFloorPolygon(corners);
            // "View in AR" later puts the layout right here when tracking hasn't been reset.
            ScanPlacement.RememberScan(corners);
        }

        if (snapshot == null || snapshot.IsEmpty)
            snapshot = RoomGeometryBuilder.Capture(planeManager, meshManager, maxMeshChunks, minPlaneArea);

        if (snapshot.IsEmpty)
        {
            snapshot.Dispose();
            Debug.LogWarning("[RoomScanController] Nothing to confirm — tap at least 3 floor corners first.");
            return false;
        }

        if (floorPolygon.Count < 3 && snapshot.hasBounds)
            CaptureFloorPolygonFromBounds(snapshot.bounds);

        ConfirmedRoom?.Dispose();
        ConfirmedRoom = snapshot;

        Debug.Log($"[RoomScanController] Room confirmed — {snapshot.planeCount} planes, " +
                  $"{snapshot.meshChunkCount} mesh chunks, {snapshot.triangleCount} triangles, " +
                  $"polygon={floorPolygon.Count}.");

        // Keep floor + wall plane tracking so live placement can avoid real walls.
        // Visualizers stay hidden via ScanVisualizationController.
        if (planeManager != null)
        {
            planeManager.requestedDetectionMode = PlaneDetectionMode.Horizontal | PlaneDetectionMode.Vertical;
            planeManager.enabled = true;
        }

        if (pointCloudManager != null)
            pointCloudManager.enabled = false;
        if (meshManager != null)
            meshManager.enabled = false;

        SetPhase(ScanPhase.Confirmed);
        return true;
    }

    /// <summary>
    /// Rebuilds the confirmed room shell from a measured floor outline (handoff from
    /// ARRoomMeasurement → ARDesignScene). Unlocks furniture placement with the planner shell.
    /// </summary>
    public bool ApplyMeasuredRoom(IReadOnlyList<Vector3> corners, float wallHeight)
    {
        if (corners == null || corners.Count < 3)
        {
            Debug.LogWarning("[RoomScanController] ApplyMeasuredRoom needs at least 3 floor corners.");
            return false;
        }

        furniturePlacementOnly = false;

        if (cornerBuilder != null)
            cornerBuilder.enabled = false;

        var height = wallHeight >= 0.5f ? wallHeight : 2.5f;
        var snapshot = RoomGeometryBuilder.CaptureFromFloorCorners(corners, height);
        if (snapshot == null || snapshot.IsEmpty)
        {
            snapshot?.Dispose();
            Debug.LogWarning("[RoomScanController] ApplyMeasuredRoom produced an empty shell.");
            return false;
        }

        CaptureFloorPolygon(corners);
        ConfirmedRoom?.Dispose();
        ConfirmedRoom = snapshot;

        if (planeManager != null)
        {
            planeManager.requestedDetectionMode = PlaneDetectionMode.Horizontal | PlaneDetectionMode.Vertical;
            planeManager.enabled = true;
        }

        if (pointCloudManager != null)
            pointCloudManager.enabled = false;
        if (meshManager != null)
            meshManager.enabled = false;

        Debug.Log(
            $"[RoomScanController] Applied measured room — {corners.Count} corners, " +
            $"wallHeight={height:F2}m, bounds={snapshot.bounds.size}.");

        if (Phase == ScanPhase.Confirmed)
        {
            // Geometry changed while already confirmed — re-notify listeners to rebuild shell.
            RecomputeStatus();
            PhaseChanged?.Invoke(ScanPhase.Confirmed);
            PushStatus();
        }
        else
        {
            SetPhase(ScanPhase.Confirmed);
        }

        return true;
    }

    /// <summary>
    /// Toggle live floor/wall planes after confirm (RealRoom on / Planner off).
    /// </summary>
    public void SetLiveFloorTracking(bool enabled)
    {
        if (planeManager == null) return;
        if (!IsConfirmed && enabled) return;

        if (enabled)
        {
            planeManager.requestedDetectionMode = PlaneDetectionMode.Horizontal | PlaneDetectionMode.Vertical;
            planeManager.enabled = true;
        }
        else
        {
            planeManager.enabled = false;
        }
    }

    /// <summary>The tracked upward surfaces AR has found, for the floor check on confirm.</summary>
    List<ScanFloorCorrection.Surface> HorizontalSurfaces()
    {
        var surfaces = new List<ScanFloorCorrection.Surface>();
        if (planeManager == null) return surfaces;
        foreach (var plane in planeManager.trackables)
        {
            if (plane == null || plane.alignment != PlaneAlignment.HorizontalUp) continue;
            if (plane.trackingState != TrackingState.Tracking) continue;
            surfaces.Add(new ScanFloorCorrection.Surface(plane.center, plane.size.x * plane.size.y));
        }
        return surfaces;
    }

    void CaptureFloorPolygon(IReadOnlyList<Vector3> corners)
    {
        floorPolygon.Clear();
        if (corners == null) return;
        for (var i = 0; i < corners.Count; i++)
            floorPolygon.Add(corners[i]);
    }

    void CaptureFloorPolygonFromBounds(Bounds bounds)
    {
        floorPolygon.Clear();
        var y = bounds.min.y;
        floorPolygon.Add(new Vector3(bounds.min.x, y, bounds.min.z));
        floorPolygon.Add(new Vector3(bounds.max.x, y, bounds.min.z));
        floorPolygon.Add(new Vector3(bounds.max.x, y, bounds.max.z));
        floorPolygon.Add(new Vector3(bounds.min.x, y, bounds.max.z));
    }

    /// <summary>
    /// Clamps a world point onto the confirmed floor polygon, inset from walls.
    /// Preserves the incoming Y so live-AR floor hits are not yanked to the
    /// (often slightly wrong) scan floor height.
    /// </summary>
    public Vector3 ClampToFloorPolygon(Vector3 worldPoint, float wallInset = 0.2f)
    {
        var keepY = worldPoint.y;

        if (floorPolygon.Count < 3)
        {
            if (ConfirmedRoom != null && ConfirmedRoom.hasBounds)
            {
                var b = ConfirmedRoom.bounds;
                var pad = Mathf.Max(0.05f, wallInset);
                worldPoint.x = Mathf.Clamp(worldPoint.x, b.min.x + pad, b.max.x - pad);
                worldPoint.z = Mathf.Clamp(worldPoint.z, b.min.z + pad, b.max.z - pad);
            }

            worldPoint.y = keepY;
            return worldPoint;
        }

        var point = new Vector3(worldPoint.x, 0f, worldPoint.z);

        if (!IsInsidePolygonXZ(point, floorPolygon))
        {
            point = ClosestPointOnPolygonXZ(point, floorPolygon);
            if (wallInset > 0.001f)
                point = InsetTowardCentroid(point, floorPolygon, wallInset);
        }
        else if (wallInset > 0.001f)
        {
            point = PushInsideFromEdges(point, floorPolygon, wallInset);
        }

        point.y = keepY;
        return point;
    }

    public bool IsInsideRoom(Vector3 worldPoint)
    {
        if (floorPolygon.Count < 3)
        {
            if (ConfirmedRoom == null || !ConfirmedRoom.hasBounds) return true;
            var b = ConfirmedRoom.bounds;
            return worldPoint.x >= b.min.x && worldPoint.x <= b.max.x
                   && worldPoint.z >= b.min.z && worldPoint.z <= b.max.z;
        }

        return IsInsidePolygonXZ(new Vector3(worldPoint.x, 0f, worldPoint.z), floorPolygon);
    }

    /// <summary>
    /// Horizontal distance from a world point to the nearest floor-outline edge.
    /// Returns +Infinity when no outline is available.
    /// </summary>
    public float DistanceToFloorBoundaryXZ(Vector3 worldPoint)
    {
        if (floorPolygon.Count < 3)
        {
            if (ConfirmedRoom == null || !ConfirmedRoom.hasBounds)
                return float.PositiveInfinity;

            var b = ConfirmedRoom.bounds;
            var dx = Mathf.Min(worldPoint.x - b.min.x, b.max.x - worldPoint.x);
            var dz = Mathf.Min(worldPoint.z - b.min.z, b.max.z - worldPoint.z);
            if (dx >= 0f && dz >= 0f)
                return Mathf.Min(dx, dz);
            // Outside: how far out (the placement check lets a few centimetres through).
            var outX = Mathf.Max(0f, -dx);
            var outZ = Mathf.Max(0f, -dz);
            return Mathf.Sqrt(outX * outX + outZ * outZ);
        }

        var point = new Vector3(worldPoint.x, 0f, worldPoint.z);
        var closest = ClosestPointOnPolygonXZ(point, floorPolygon);
        closest.y = 0f;
        return Vector3.Distance(point, closest);
    }

    /// <summary>
    /// XZ translation that moves <paramref name="worldPoint"/> inside the room
    /// with at least <paramref name="minClearance"/> from every edge.
    /// Returns zero when already clear (or when no outline exists).
    /// </summary>
    public Vector3 GetWallClearancePushXZ(Vector3 worldPoint, float minClearance)
    {
        minClearance = Mathf.Max(0f, minClearance);
        var point = new Vector3(worldPoint.x, 0f, worldPoint.z);

        if (floorPolygon.Count < 3)
        {
            if (ConfirmedRoom == null || !ConfirmedRoom.hasBounds)
                return Vector3.zero;

            var b = ConfirmedRoom.bounds;
            var pad = Mathf.Max(0.05f, minClearance);
            var target = point;
            target.x = Mathf.Clamp(point.x, b.min.x + pad, b.max.x - pad);
            target.z = Mathf.Clamp(point.z, b.min.z + pad, b.max.z - pad);
            return new Vector3(target.x - point.x, 0f, target.z - point.z);
        }

        var centroid = PolygonCentroidXZ(floorPolygon);
        Vector3 targetPoint;

        if (!IsInsidePolygonXZ(point, floorPolygon))
        {
            var closest = ClosestPointOnPolygonXZ(point, floorPolygon);
            var inward = centroid - closest;
            inward.y = 0f;
            if (inward.sqrMagnitude < 1e-8f)
                return Vector3.zero;
            targetPoint = closest + inward.normalized * Mathf.Max(minClearance, 0.02f);
        }
        else
        {
            var closest = ClosestPointOnPolygonXZ(point, floorPolygon);
            var offset = point - closest;
            offset.y = 0f;
            var dist = offset.magnitude;
            if (dist >= minClearance - 1e-4f)
                return Vector3.zero;

            var inward = offset.sqrMagnitude > 1e-8f
                ? offset.normalized
                : (centroid - closest).normalized;
            inward.y = 0f;
            if (inward.sqrMagnitude < 1e-8f)
                return Vector3.zero;
            targetPoint = closest + inward.normalized * minClearance;
        }

        if (!IsInsidePolygonXZ(targetPoint, floorPolygon))
            targetPoint = InsetTowardCentroid(ClosestPointOnPolygonXZ(targetPoint, floorPolygon), floorPolygon, minClearance);

        return new Vector3(targetPoint.x - point.x, 0f, targetPoint.z - point.z);
    }

    /// <summary>XZ centroid of the confirmed floor polygon (or room bounds center).</summary>
    public Vector3 FloorPolygonCentroid
    {
        get
        {
            if (floorPolygon.Count >= 3)
                return PolygonCentroidXZ(floorPolygon);

            if (ConfirmedRoom != null && ConfirmedRoom.hasBounds)
            {
                var c = ConfirmedRoom.bounds.center;
                c.y = 0f;
                return c;
            }

            return Vector3.zero;
        }
    }

    static bool IsInsidePolygonXZ(Vector3 point, IReadOnlyList<Vector3> polygon)
    {
        var inside = false;
        for (int i = 0, j = polygon.Count - 1; i < polygon.Count; j = i++)
        {
            var pi = polygon[i];
            var pj = polygon[j];
            var intersect = ((pi.z > point.z) != (pj.z > point.z))
                            && (point.x < (pj.x - pi.x) * (point.z - pi.z) / ((pj.z - pi.z) + 1e-8f) + pi.x);
            if (intersect) inside = !inside;
        }

        return inside;
    }

    static Vector3 ClosestPointOnPolygonXZ(Vector3 point, IReadOnlyList<Vector3> polygon)
    {
        var best = polygon[0];
        best.y = 0f;
        var bestDist = float.PositiveInfinity;

        for (var i = 0; i < polygon.Count; i++)
        {
            var a = polygon[i];
            var b = polygon[(i + 1) % polygon.Count];
            a.y = 0f;
            b.y = 0f;
            var closest = ClosestPointOnSegmentXZ(point, a, b);
            var d = (closest - point).sqrMagnitude;
            if (d < bestDist)
            {
                bestDist = d;
                best = closest;
            }
        }

        return best;
    }

    static Vector3 ClosestPointOnSegmentXZ(Vector3 p, Vector3 a, Vector3 b)
    {
        var ab = b - a;
        ab.y = 0f;
        var lenSq = ab.sqrMagnitude;
        if (lenSq < 1e-8f) return a;
        var t = Mathf.Clamp01(Vector3.Dot(p - a, ab) / lenSq);
        return a + ab * t;
    }

    static Vector3 InsetTowardCentroid(Vector3 point, IReadOnlyList<Vector3> polygon, float inset)
    {
        var centroid = PolygonCentroidXZ(polygon);
        var toCenter = centroid - point;
        toCenter.y = 0f;
        if (toCenter.sqrMagnitude < 1e-6f) return point;

        var candidate = point + toCenter.normalized * inset;
        return IsInsidePolygonXZ(candidate, polygon) ? candidate : point;
    }

    /// <summary>If closer than inset to any edge, push inward to maintain clearance.</summary>
    static Vector3 PushInsideFromEdges(Vector3 point, IReadOnlyList<Vector3> polygon, float inset)
    {
        var insetSq = inset * inset;
        var closest = ClosestPointOnPolygonXZ(point, polygon);
        var offset = point - closest;
        offset.y = 0f;
        if (offset.sqrMagnitude >= insetSq)
            return point;

        var centroid = PolygonCentroidXZ(polygon);
        var inward = centroid - closest;
        inward.y = 0f;
        if (inward.sqrMagnitude < 1e-6f) return point;

        var candidate = closest + inward.normalized * inset;
        return IsInsidePolygonXZ(candidate, polygon) ? candidate : point;
    }

    static Vector3 PolygonCentroidXZ(IReadOnlyList<Vector3> polygon)
    {
        var centroid = Vector3.zero;
        for (var i = 0; i < polygon.Count; i++)
        {
            centroid.x += polygon[i].x;
            centroid.z += polygon[i].z;
        }

        centroid /= polygon.Count;
        centroid.y = 0f;
        return centroid;
    }

    /// <summary>Latest coverage snapshot. Recomputed on demand so RN always gets fresh numbers.</summary>
    public ScanStatusPayload GetScanStatus()
    {
        RecomputeStatus();
        return cachedStatus;
    }

    // ── Coverage heuristics ───────────────────────────────────────────────────

    void SampleYawBucket()
    {
        if (arCamera == null) return;

        var forward = arCamera.transform.forward;
        forward.y = 0f;
        if (forward.sqrMagnitude < 1e-4f) return;

        var yaw = Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg;
        if (yaw < 0f) yaw += 360f;

        var bucket = Mathf.Clamp(Mathf.FloorToInt(yaw / (360f / YawBucketCount)), 0, YawBucketCount - 1);
        yawBuckets[bucket] = true;
    }

    void RecomputeStatus()
    {
        var horizontalArea = 0f;
        var verticalArea = 0f;
        var horizontalCount = 0;
        var verticalCount = 0;
        var planeCount = 0;

        if (planeManager != null)
        {
            foreach (var plane in planeManager.trackables)
            {
                if (plane == null) continue;
                if (plane.trackingState != TrackingState.Tracking) continue;
                if (plane.subsumedBy != null) continue;

                var area = plane.size.x * plane.size.y;
                if (area < minPlaneArea) continue;

                planeCount++;

                switch (plane.alignment)
                {
                    case PlaneAlignment.HorizontalUp:
                        horizontalArea += area;
                        horizontalCount++;
                        break;
                    case PlaneAlignment.Vertical:
                        verticalArea += area;
                        verticalCount++;
                        break;
                }
            }
        }

        var pointCount = 0;
        if (pointCloudManager != null)
        {
            foreach (var cloud in pointCloudManager.trackables)
            {
                if (cloud == null || !cloud.positions.HasValue) continue;
                pointCount += cloud.positions.Value.Length;
            }
        }

        var meshChunkCount = 0;
        if (meshManager != null)
        {
            foreach (var filter in meshManager.GetComponentsInChildren<MeshFilter>())
            {
                if (filter != null && filter.sharedMesh != null)
                    meshChunkCount++;
            }
        }

        var seenBuckets = 0;
        foreach (var seen in yawBuckets)
        {
            if (seen) seenBuckets++;
        }

        var lookAround = seenBuckets / (float)YawBucketCount;

        var floorScore = Mathf.Clamp01(horizontalArea / Mathf.Max(0.01f, targetFloorArea));
        var wallScore = Mathf.Clamp01(verticalArea / Mathf.Max(0.01f, targetWallArea));
        var lookScore = Mathf.Clamp01(lookAround / Mathf.Max(0.01f, targetLookAroundCoverage));

        var cornerCount = cornerBuilder != null ? cornerBuilder.CornerCount : 0;
        var cornerProgress = Mathf.Clamp01(cornerCount / 4f);
        var progress = cornerCount > 0
            ? Mathf.Max(0.15f, cornerProgress)
            : 0.45f * floorScore + 0.30f * lookScore + 0.25f * wallScore;

        // Progress only ever climbs — planes get merged and re-fitted constantly,
        // and a bar that jumps backwards reads as a bug to the user.
        cachedProgress = Mathf.Max(cachedProgress, progress);

        // Corner-to-corner is ready with 3+ taps. Plane heuristics remain a fallback.
        var ready = Phase != ScanPhase.Idle && (
            (cornerBuilder != null && (cornerBuilder.CanConfirm || cornerBuilder.CanClose)) ||
            (Time.unscaledTime - scanStartTime >= minScanDuration
             && horizontalCount > 0
             && floorScore >= readyFloorScore
             && lookScore >= readyLookScore));

        cachedStatus.phase = PhaseToString(Phase);
        cachedStatus.progress = Phase == ScanPhase.Confirmed ? 1f : cachedProgress;
        cachedStatus.readyToConfirm = ready || Phase == ScanPhase.Confirmed;
        cachedStatus.confirmed = Phase == ScanPhase.Confirmed;
        cachedStatus.planeCount = Mathf.Max(planeCount, cornerCount);
        cachedStatus.horizontalPlaneCount = horizontalCount;
        cachedStatus.verticalPlaneCount = verticalCount;
        cachedStatus.meshChunkCount = meshChunkCount;
        cachedStatus.pointCount = pointCount;
        cachedStatus.horizontalAreaSqm = horizontalArea;
        cachedStatus.verticalAreaSqm = verticalArea;
        cachedStatus.lookAroundCoverage = lookAround;
        cachedStatus.hint = BuildHint(floorScore, lookScore, wallScore, cornerCount);
    }

    string BuildHint(float floorScore, float lookScore, float wallScore, int cornerCount)
    {
        if (Phase == ScanPhase.Confirmed) return "confirmed";
        if (Phase == ScanPhase.Idle) return "idle";
        if (cornerBuilder != null)
        {
            if (cornerBuilder.IsInHeightPhase)
            {
                if (!cornerBuilder.HasHeightBase) return "tapFloorHeight";
                return "extrudeHeight";
            }

            if (cornerBuilder.CanConfirm) return "readyToConfirm";
            if (cornerBuilder.IsOutlineSelfIntersecting) return "outlineCrosses";
            if (cornerBuilder.CanClose) return "closeOutline";
            if (cornerCount == 0) return "tapFirstCorner";
            if (cornerCount == 1) return "tapNextCorner";
            if (cornerCount == 2) return "tapThirdCorner";
            return "tapMoreCorners";
        }

        if (cachedStatus.readyToConfirm) return "readyToConfirm";
        if (floorScore < 0.35f) return "findFloor";
        if (lookScore < 1f) return "moveAround";
        if (wallScore < 0.5f) return "scanWalls";
        return "keepScanning";
    }

    // ── Plumbing ──────────────────────────────────────────────────────────────

    void SetPhase(ScanPhase phase)
    {
        if (Phase == phase) return;

        Debug.Log($"[RoomScanController] Phase {Phase} → {phase}");
        Phase = phase;
        // Before anyone hears of the new phase: the room plan turns plane detection off as it opens.
        ARDepthSnapshot.SetDepthRunning(phase is ScanPhase.Scanning or ScanPhase.ReadyToConfirm);
        RecomputeStatus();
        PhaseChanged?.Invoke(phase);
        PushStatus();
    }

    void PushStatus()
    {
        lastStatusPush = Time.unscaledTime;
        StatusChanged?.Invoke(cachedStatus);
    }

    void SetPlaneDetectionEnabled(bool enabled)
    {
        if (planeManager != null)
            planeManager.enabled = enabled;
    }

    public static string PhaseToString(ScanPhase phase) => phase switch
    {
        ScanPhase.Scanning => "scanning",
        ScanPhase.ReadyToConfirm => "readyToConfirm",
        ScanPhase.Confirmed => "confirmed",
        _ => "idle",
    };
}
