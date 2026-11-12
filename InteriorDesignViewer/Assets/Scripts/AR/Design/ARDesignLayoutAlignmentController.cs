using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Design-flow "View in AR": lines the saved room layout up with the user's real room.
/// The user marks the two floor corners of any wall; that wall is matched to the closest
/// plan wall, the room interior is taken to be on the side the user is standing, and the
/// room shell + furniture are moved/rotated onto the real floor.
/// RN drives it (beginLayoutAlignment / markAlignmentCorner / ...) and gets layoutAlignment events.
/// </summary>
[DefaultExecutionOrder(-80)]
public class ARDesignLayoutAlignmentController : MonoBehaviour
{
    const float MinWallLength = 0.5f;
    const float InteriorProbe = 0.05f;
    const float OppositeLengthTolerance = 0.2f;

    enum State { Idle, Aligning, Aligned }

    static readonly Color MarkerColor = new(0.18f, 0.55f, 0.42f, 1f);

    RoomScanController scan;
    ARDesignLayoutModeController layoutMode;
    ARPlacementIndicator indicator;
    FurniturePlacementController placement;
    Camera arCamera;

    State state = State.Idle;
    int step;
    Vector3 cornerA;
    Vector3 lastA;
    Vector3 lastB;
    int matchedEdge = -1;
    float measuredM;
    float planM;

    Matrix4x4 sourceToWorld = Matrix4x4.identity;
    float sourceYaw;
    /// <summary>Placed where the room was scanned (same tracking session), not by marked corners.</summary>
    bool autoPlaced;

    GameObject markerA;
    LineRenderer guideLine;
    bool lastFloorDetected;
    float lastSentLive = -1f;
    float nextLiveSendTime;

    public static ARDesignLayoutAlignmentController EnsureOn(GameObject host)
    {
        if (host == null) return null;
        var existing = host.GetComponent<ARDesignLayoutAlignmentController>();
        return existing != null ? existing : host.AddComponent<ARDesignLayoutAlignmentController>();
    }

    /// <summary>True once RN started the alignment flow; the bootstrap must not force the planner.</summary>
    public bool OwnsView => state != State.Idle;

    public ARDesignLayoutModeController.ViewMode PreferredView { get; private set; } =
        ARDesignLayoutModeController.ViewMode.RealRoom;

    void ResolveReferences()
    {
        if (scan == null) scan = FindFirstObjectByType<RoomScanController>();
        if (layoutMode == null) layoutMode = FindFirstObjectByType<ARDesignLayoutModeController>();
        if (indicator == null) indicator = FindFirstObjectByType<ARPlacementIndicator>();
        if (placement == null) placement = FindFirstObjectByType<FurniturePlacementController>();
        if (arCamera == null) arCamera = Camera.main;
    }

    // ── RN entry points ───────────────────────────────────────────────────────

    public void Begin()
    {
        ResolveReferences();
        if (scan == null || !scan.IsConfirmed)
        {
            Send(error: "noRoom");
            return;
        }

        // A repeat begin (RN retries) after the layout was placed at the scan: keep it there.
        if (state == State.Aligned && autoPlaced)
        {
            Send();
            return;
        }

        // Same tracking session as the scan: the room is still where it was scanned, so put the
        // layout there. No corner marking, and no chance of matching the wrong wall.
        if (state == State.Idle && TryPlaceAtScan())
            return;

        autoPlaced = false;
        state = State.Aligning;
        step = 0;
        measuredM = 0f;
        ClearMarkers();

        if (layoutMode != null)
        {
            layoutMode.HoldRealRoom = true;
            layoutMode.SetViewMode(ARDesignLayoutModeController.ViewMode.RealRoom);
        }
        PreferredView = ARDesignLayoutModeController.ViewMode.RealRoom;

        if (placement != null)
        {
            placement.ShareSpacesAcrossViews = true;
            placement.SuppressIndicatorControl = true;
            placement.SuppressTapInput = true;
            placement.Select(null);
        }

        indicator?.StartTracking();
        lastFloorDetected = indicator != null && indicator.IsLockedOnFloor;
        Send();
    }

    public void MarkCorner()
    {
        if (state != State.Aligning) return;
        ResolveReferences();

        if (indicator == null || !indicator.IsLockedOnFloor)
        {
            Send(error: "noFloor");
            return;
        }

        var point = indicator.CurrentPose.position;
        if (step == 0)
        {
            cornerA = point;
            step = 1;
            ShowMarker(point);
            Send();
            return;
        }

        if (Flat(point - cornerA).magnitude < MinWallLength)
        {
            Send(error: "tooClose");
            return;
        }

        if (!Solve(cornerA, point, forcedEdge: -1, swapForUserSide: true))
        {
            Send(error: "noRoom");
            return;
        }

        FinishAligning();
    }

    public void UndoCorner()
    {
        if (state != State.Aligning || step == 0) return;
        step = 0;
        ClearMarkers();
        Send();
    }

    /// <summary>Puts the opposite plan wall on the marked wall (rotates the layout 180°).</summary>
    public void Flip()
    {
        if (state != State.Aligned || matchedEdge < 0) return;
        ResolveReferences();

        var poly = scan != null ? scan.FloorPolygon : null;
        var opposite = FindOppositeEdge(poly, matchedEdge);
        if (opposite < 0)
        {
            Send();
            return;
        }

        Solve(lastA, lastB, opposite, swapForUserSide: false);
        Send();
    }

    public void SetView(string view)
    {
        ResolveReferences();
        if (layoutMode == null) return;

        var mode = view == "plan"
            ? ARDesignLayoutModeController.ViewMode.Planner
            : ARDesignLayoutModeController.ViewMode.RealRoom;

        // Aligning needs the live camera; finish or cancel before switching.
        if (state == State.Aligning && mode == ARDesignLayoutModeController.ViewMode.Planner)
            return;

        PreferredView = mode;
        layoutMode.SetViewMode(mode);
        Send();
    }

    /// <summary>Maps a layout built in the saved-room frame onto the aligned real room.</summary>
    public void TransformRequest(ApplyLayoutRequest request)
    {
        if (request?.items == null) return;

        foreach (var item in request.items)
        {
            if (item == null || !item.hasPosition) continue;
            var p = item.position != null
                ? new Vector3(item.position.x, item.position.y, item.position.z)
                : Vector3.zero;
            item.position = new ARDesignVec3(sourceToWorld.MultiplyPoint3x4(p));
            item.rotationY += sourceYaw;
        }
    }

    /// <summary>
    /// Inverse of <see cref="TransformRequest"/>: fills each piece's pose in the frame RN used for
    /// applyLayout, so RN can rebuild the room-local layout after the user moves things.
    /// </summary>
    public void FillSourcePoses(LayoutPayload layout)
    {
        if (layout?.furniture == null) return;

        var worldToSource = sourceToWorld.inverse;
        foreach (var item in layout.furniture)
        {
            if (item?.position == null) continue;
            var p = new Vector3(item.position.x, item.position.y, item.position.z);
            item.sourcePosition = new ARDesignVec3(worldToSource.MultiplyPoint3x4(p));
            item.sourceRotationY = Mathf.Repeat(item.rotationY - sourceYaw, 360f);
            item.hasSource = true;
        }
    }

    /// <summary>Scene teardown / new handoff.</summary>
    public void ResetSession()
    {
        if (state == State.Aligning)
            ReleasePlacementControls();

        state = State.Idle;
        step = 0;
        autoPlaced = false;
        matchedEdge = -1;
        sourceToWorld = Matrix4x4.identity;
        sourceYaw = 0f;
        PreferredView = ARDesignLayoutModeController.ViewMode.RealRoom;
        ClearMarkers();

        ResolveReferences();
        if (layoutMode != null) layoutMode.HoldRealRoom = false;
        if (placement != null) placement.ShareSpacesAcrossViews = false;
    }

    // ── Frame loop ────────────────────────────────────────────────────────────

    void Update()
    {
        if (state != State.Aligning || indicator == null) return;

        // Other systems (HUD phase changes, placement commits) may stop the reticle.
        indicator.StartTracking();

        var floor = indicator.IsLockedOnFloor;
        var live = 0f;
        if (step == 1 && floor)
        {
            var p = indicator.CurrentPose.position;
            live = Flat(p - cornerA).magnitude;
            UpdateGuide(cornerA, p);
        }
        else if (guideLine != null)
        {
            guideLine.enabled = false;
        }

        var floorChanged = floor != lastFloorDetected;
        var liveChanged = step == 1 && Mathf.Abs(live - lastSentLive) >= 0.02f && Time.unscaledTime >= nextLiveSendTime;
        if (!floorChanged && !liveChanged) return;

        lastFloorDetected = floor;
        lastSentLive = live;
        nextLiveSendTime = Time.unscaledTime + 0.15f;
        measuredM = live;
        Send();
    }

    // ── Solve ─────────────────────────────────────────────────────────────────

    bool Solve(Vector3 a, Vector3 b, int forcedEdge, bool swapForUserSide)
    {
        var poly = scan != null ? scan.FloorPolygon : null;
        if (poly == null || poly.Count < 3) return false;

        var dirW = Flat(b - a);
        var measured = dirW.magnitude;
        if (measured < 1e-3f) return false;
        dirW /= measured;

        if (swapForUserSide && arCamera != null)
        {
            // Interior must be on the side the user is standing.
            var toUser = Flat(arCamera.transform.position - a);
            if (Vector3.Dot(toUser, Perp(dirW)) < 0f)
            {
                (a, b) = (b, a);
                dirW = -dirW;
            }
        }

        var edge = forcedEdge >= 0 ? forcedEdge : FindClosestEdge(poly, measured);
        if (edge < 0) return false;
        if (!TryGetInteriorEdge(poly, edge, out var l0, out var l1)) return false;

        var dirL = Flat(l1 - l0);
        var planLen = dirL.magnitude;
        if (planLen < 1e-3f) return false;
        dirL /= planLen;

        var yawDelta = YawOf(dirW) - YawOf(dirL);
        var rotation = Quaternion.Euler(0f, yawDelta, 0f);
        // Middle on middle: the plan wall and the marked wall are rarely the same length (3.40 m
        // planned, 3.22 m marked on the Redmi, 2026-11-12), and pinning the plan's corner on the
        // first mark put all of the difference at the far end.
        var midW = (a + b) * 0.5f;
        midW.y = a.y;
        var midL = (l0 + l1) * 0.5f;
        midL.y = l0.y;
        var m = Matrix4x4.TRS(midW, rotation, Vector3.one) * Matrix4x4.Translate(-midL);

        var corners = new Vector3[poly.Count];
        for (var i = 0; i < poly.Count; i++)
            corners[i] = m.MultiplyPoint3x4(poly[i]);

        var wallHeight = scan.ConfirmedRoom != null && scan.ConfirmedRoom.hasBounds
            ? Mathf.Max(0.5f, scan.ConfirmedRoom.bounds.size.y)
            : 2.5f;

        if (!scan.ApplyMeasuredRoom(corners, wallHeight))
            return false;

        placement?.TransformAllInstances(m, yawDelta);
        FindFirstObjectByType<FurnitureLayoutHistory>()?.Clear();

        sourceToWorld = m * sourceToWorld;
        sourceYaw += yawDelta;
        lastA = a;
        lastB = b;
        matchedEdge = edge;
        measuredM = measured;
        planM = planLen;

        // ApplyMeasuredRoom re-fires Confirmed; keep the user's chosen view.
        layoutMode?.SetViewMode(PreferredView);

        Debug.Log(
            $"[ARDesignLayoutAlignment] Aligned to plan wall {edge} (plan {planLen:F2} m, " +
            $"measured {measured:F2} m, yaw {yawDelta:F1}°).");
        return true;
    }

    bool TryPlaceAtScan()
    {
        var poly = scan != null ? scan.FloorPolygon : null;
        if (poly == null || poly.Count < 3) return false;
        if (!ScanPlacement.TryGetShellToWorld(poly, out var m, out var yaw)) return false;

        var corners = new Vector3[poly.Count];
        for (var i = 0; i < poly.Count; i++)
            corners[i] = m.MultiplyPoint3x4(poly[i]);

        var wallHeight = scan.ConfirmedRoom != null && scan.ConfirmedRoom.hasBounds
            ? Mathf.Max(0.5f, scan.ConfirmedRoom.bounds.size.y)
            : 2.5f;
        if (!scan.ApplyMeasuredRoom(corners, wallHeight)) return false;

        placement?.TransformAllInstances(m, yaw);
        FindFirstObjectByType<FurnitureLayoutHistory>()?.Clear();
        sourceToWorld = m;
        sourceYaw = yaw;
        matchedEdge = -1;
        measuredM = 0f;
        planM = 0f;
        autoPlaced = true;

        if (layoutMode != null)
        {
            layoutMode.HoldRealRoom = true;
            layoutMode.SetViewMode(ARDesignLayoutModeController.ViewMode.RealRoom);
        }
        PreferredView = ARDesignLayoutModeController.ViewMode.RealRoom;
        if (placement != null) placement.ShareSpacesAcrossViews = true;

        state = State.Aligned;
        step = 0;
        Send();
        return true;
    }

    void FinishAligning()
    {
        state = State.Aligned;
        step = 0;
        ClearMarkers();
        ReleasePlacementControls();
        Send();
    }

    void ReleasePlacementControls()
    {
        if (placement != null)
        {
            placement.SuppressIndicatorControl = false;
            placement.SuppressTapInput = false;
        }

        indicator?.StopTracking();
    }

    static int FindClosestEdge(IReadOnlyList<Vector3> poly, float length)
    {
        var best = -1;
        var bestDiff = float.MaxValue;
        for (var i = 0; i < poly.Count; i++)
        {
            var len = Flat(poly[(i + 1) % poly.Count] - poly[i]).magnitude;
            var diff = Mathf.Abs(len - length);
            if (diff < bestDiff)
            {
                bestDiff = diff;
                best = i;
            }
        }

        return best;
    }

    static int FindOppositeEdge(IReadOnlyList<Vector3> poly, int edge)
    {
        if (poly == null || poly.Count < 3 || edge < 0 || edge >= poly.Count) return -1;

        var n = poly.Count;
        var refLen = Flat(poly[(edge + 1) % n] - poly[edge]).magnitude;
        var refMid = (poly[edge] + poly[(edge + 1) % n]) * 0.5f;

        var best = -1;
        var bestDist = 0f;
        for (var i = 0; i < n; i++)
        {
            if (i == edge) continue;
            var len = Flat(poly[(i + 1) % n] - poly[i]).magnitude;
            if (Mathf.Abs(len - refLen) > Mathf.Max(0.3f, refLen * OppositeLengthTolerance)) continue;

            var mid = (poly[i] + poly[(i + 1) % n]) * 0.5f;
            var dist = Flat(mid - refMid).magnitude;
            if (dist > bestDist)
            {
                bestDist = dist;
                best = i;
            }
        }

        return best;
    }

    /// <summary>Returns the edge ordered so the room interior lies on its <see cref="Perp"/> side.</summary>
    static bool TryGetInteriorEdge(IReadOnlyList<Vector3> poly, int edge, out Vector3 l0, out Vector3 l1)
    {
        l0 = poly[edge];
        l1 = poly[(edge + 1) % poly.Count];
        var dir = Flat(l1 - l0);
        if (dir.sqrMagnitude < 1e-6f) return false;

        var mid = (l0 + l1) * 0.5f;
        var probe = mid + Perp(dir.normalized) * InteriorProbe;
        if (!RoomPolygonUtil.PointInsidePolygonXZ(probe, poly))
            (l0, l1) = (l1, l0);
        return true;
    }

    static Vector3 Flat(Vector3 v) => new(v.x, 0f, v.z);

    static Vector3 Perp(Vector3 dir) => new(-dir.z, 0f, dir.x);

    static float YawOf(Vector3 dir) => Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;

    // ── Visuals ───────────────────────────────────────────────────────────────

    void ShowMarker(Vector3 point)
    {
        ClearMarkers();
        markerA = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        markerA.name = "AlignmentCornerA";
        var collider = markerA.GetComponent<Collider>();
        if (collider != null) Destroy(collider);
        markerA.transform.position = point + Vector3.up * 0.005f;
        markerA.transform.localScale = new Vector3(0.12f, 0.005f, 0.12f);
        markerA.GetComponent<MeshRenderer>().sharedMaterial = CreateUnlit(MarkerColor);
    }

    void UpdateGuide(Vector3 from, Vector3 to)
    {
        if (guideLine == null)
        {
            var go = new GameObject("AlignmentGuide");
            guideLine = go.AddComponent<LineRenderer>();
            guideLine.positionCount = 2;
            guideLine.useWorldSpace = true;
            guideLine.startWidth = 0.015f;
            guideLine.endWidth = 0.015f;
            guideLine.sharedMaterial = CreateUnlit(MarkerColor);
        }

        guideLine.enabled = true;
        guideLine.SetPosition(0, from + Vector3.up * 0.01f);
        guideLine.SetPosition(1, to + Vector3.up * 0.01f);
    }

    void ClearMarkers()
    {
        if (markerA != null) Destroy(markerA);
        markerA = null;
        if (guideLine != null) Destroy(guideLine.gameObject);
        guideLine = null;
        lastSentLive = -1f;
    }

    static Material CreateUnlit(Color color) => ARLineMaterialUtil.Create(color);

    // ── Outbound ──────────────────────────────────────────────────────────────

    void Send(string error = "")
    {
        var payload = new LayoutAlignmentPayload
        {
            state = state switch
            {
                State.Aligning => "aligning",
                State.Aligned => "aligned",
                _ => "idle",
            },
            step = step,
            floorDetected = indicator != null && indicator.IsLockedOnFloor,
            measuredM = measuredM,
            planM = planM,
            view = layoutMode != null && layoutMode.CurrentViewMode == ARDesignLayoutModeController.ViewMode.Planner
                ? "plan"
                : "real",
            error = error ?? string.Empty,
            autoPlaced = autoPlaced,
            canTurn = state == State.Aligned && !autoPlaced && scan != null
                      && FindOppositeEdge(scan.FloorPolygon, matchedEdge) >= 0,
        };
        UnityMessageBridge.SendToApp("layoutAlignment", JsonUtility.ToJson(payload));
    }

    void OnDestroy()
    {
        ClearMarkers();
    }
}
