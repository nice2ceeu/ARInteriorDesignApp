using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Carries a confirmed floor outline from ARRoomMeasurement into ARDesignScene
/// so furniture can be placed on the measured shell after a scene load.
/// </summary>
public static class MeasuredRoomHandoff
{
    public static bool HasData { get; private set; }
    public static float WallHeight { get; private set; } = 2.5f;
    public static string RoomName { get; private set; } = string.Empty;
    /// <summary>RN roomScanConfirmed JSON kept as fallback after scene load.</summary>
    public static string PendingRnJson { get; set; } = string.Empty;

    static Vector3[] floorCorners;

    public static void CaptureFrom(RoomScanController scan, string roomName = null)
    {
        Clear();
        if (scan == null)
        {
            Debug.LogWarning("[MeasuredRoomHandoff] CaptureFrom — RoomScanController is null.");
            return;
        }

        RoomName = roomName ?? string.Empty;

        var poly = scan.FloorPolygon;
        if (poly != null && poly.Count >= 3)
        {
            floorCorners = new Vector3[poly.Count];
            for (var i = 0; i < poly.Count; i++)
                floorCorners[i] = poly[i];
        }
        else
        {
            var room = scan.ConfirmedRoom;
            if (room == null || !room.hasBounds)
            {
                Debug.LogWarning(
                    "[MeasuredRoomHandoff] CaptureFrom — no floor polygon and no confirmed bounds.");
                return;
            }

            ApplyBounds(room.bounds, room.floorY);
        }

        WallHeight = 2.5f;
        var cornerBuilder = scan.CornerBuilder != null
            ? scan.CornerBuilder
            : UnityEngine.Object.FindFirstObjectByType<ARDesignCornerRoomBuilder>();
        // The confirmed height includes the floor check on confirm (see ScanFloorCorrection).
        if (scan.ConfirmedWallHeight >= 0.5f)
            WallHeight = scan.ConfirmedWallHeight;
        else if (cornerBuilder != null && cornerBuilder.WallHeight >= 0.5f)
            WallHeight = cornerBuilder.WallHeight;
        else if (scan.ConfirmedRoom != null && scan.ConfirmedRoom.hasBounds)
            WallHeight = Mathf.Max(0.5f, scan.ConfirmedRoom.bounds.size.y);

        HasData = floorCorners != null && floorCorners.Length >= 3;
        LogCapture("scan");
    }

    /// <summary>
    /// Fallback when the live scan controller has already been torn down — use the
    /// dimensions RN received in <c>roomScanConfirmed</c>.
    /// </summary>
    public static void CaptureFromRnPayload(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return;

        MeasuredRoomRnPayload payload;
        try
        {
            payload = JsonUtility.FromJson<MeasuredRoomRnPayload>(json);
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[MeasuredRoomHandoff] Bad RN payload: {e.Message}");
            return;
        }

        if (payload == null) return;
        ScanPlacement.SetFrame(payload);

        // Prefer explicit polygon when RN still has it.
        if (payload.floorPolygon != null && payload.floorPolygon.Length >= 3)
        {
            Clear();
            RoomName = payload.roomName ?? string.Empty;
            floorCorners = new Vector3[payload.floorPolygon.Length];
            for (var i = 0; i < payload.floorPolygon.Length; i++)
            {
                var p = payload.floorPolygon[i];
                floorCorners[i] = new Vector3(p.x, p.y, p.z);
            }

            WallHeight = payload.wallHeight >= 0.5f
                ? payload.wallHeight
                : (payload.height >= 0.5f ? payload.height : 2.5f);
            HasData = true;
            LogCapture("rn-polygon");
            return;
        }

        // Axis-aligned shell from width × depth × height (centred on origin).
        if (payload.width > 0.2f && payload.depth > 0.2f)
        {
            Clear();
            RoomName = payload.roomName ?? string.Empty;
            var halfW = payload.width * 0.5f;
            var halfD = payload.depth * 0.5f;
            var y = 0f;
            if (payload.boundsMin != null)
                y = payload.boundsMin.y;

            floorCorners = new[]
            {
                new Vector3(-halfW, y, -halfD),
                new Vector3(halfW, y, -halfD),
                new Vector3(halfW, y, halfD),
                new Vector3(-halfW, y, halfD),
            };
            WallHeight = payload.wallHeight >= 0.5f
                ? payload.wallHeight
                : (payload.height >= 0.5f ? payload.height : 2.5f);
            HasData = true;
            LogCapture("rn-dims");
            return;
        }

        if (payload.boundsMin != null && payload.boundsMax != null)
        {
            Clear();
            RoomName = payload.roomName ?? string.Empty;
            var min = new Vector3(payload.boundsMin.x, payload.boundsMin.y, payload.boundsMin.z);
            var max = new Vector3(payload.boundsMax.x, payload.boundsMax.y, payload.boundsMax.z);
            var bounds = new Bounds();
            bounds.SetMinMax(min, max);
            ApplyBounds(bounds, min.y);
            WallHeight = payload.wallHeight >= 0.5f
                ? payload.wallHeight
                : (payload.height >= 0.5f ? payload.height : Mathf.Max(0.5f, bounds.size.y));
            HasData = floorCorners != null && floorCorners.Length >= 3;
            LogCapture("rn-bounds");
        }
    }

    static void ApplyBounds(Bounds b, float floorY)
    {
        var y = float.IsFinite(floorY) ? floorY : b.min.y;
        floorCorners = new[]
        {
            new Vector3(b.min.x, y, b.min.z),
            new Vector3(b.max.x, y, b.min.z),
            new Vector3(b.max.x, y, b.max.z),
            new Vector3(b.min.x, y, b.max.z),
        };
    }

    public static bool TryConsume(out Vector3[] corners, out float wallHeight)
    {
        corners = floorCorners;
        wallHeight = WallHeight;
        var ok = HasData && corners != null && corners.Length >= 3;
        // Keep the array reference in `corners`; only clear static ownership.
        floorCorners = null;
        HasData = false;
        RoomName = string.Empty;
        WallHeight = 2.5f;
        return ok;
    }

    public static void Clear()
    {
        HasData = false;
        floorCorners = null;
        WallHeight = 2.5f;
        RoomName = string.Empty;
    }

    static void LogCapture(string source)
    {
        if (!HasData)
        {
            Debug.LogWarning($"[MeasuredRoomHandoff] Capture ({source}) failed.");
            return;
        }

        Debug.Log(
            $"[MeasuredRoomHandoff] Captured via {source}: {floorCorners.Length} corners, " +
            $"wallHeight={WallHeight:F2}m.");
    }

    [Serializable]
    public class MeasuredRoomRnPayload
    {
        public string roomName;
        public float width;
        public float depth;
        public float height;
        public float wallHeight;
        public ARDesignVec3 boundsMin;
        public ARDesignVec3 boundsMax;
        public ARDesignVec3[] floorPolygon;
        /// <summary>Design flow: how the planner frame sits on the scan (see <see cref="ScanPlacement"/>).</summary>
        public bool hasScanFrame;
        public float frameAngle;
        public float frameMinX;
        public float frameMinZ;
    }
}

/// <summary>
/// Puts a generated layout back where its room was scanned, without the user lining it up.
/// Unity stays loaded through the design flow (scan → preferences → layouts → View in AR) and
/// ARCore keeps the same world frame unless tracking is reset, so the scanned corners are still
/// where they were. The planner's frame is the scan turned by <c>frameAngle</c> and shifted by
/// (<c>frameMinX</c>, <c>frameMinZ</c>); the AR shell is that frame centred on the room. When the
/// last scan is from the current tracking session and its corners match the shell, the shell
/// (and every layout piece) maps straight onto the real room. Otherwise the user lines it up.
/// </summary>
public static class ScanPlacement
{
    /// <summary>A shell corner may be this far from the scanned corner it should land on (m).</summary>
    public const float MatchTolerance = 0.2f;

    static Vector3[] lastScanCorners;
    static int lastScanEpoch = -1;

    static bool hasFrame;
    static float frameAngle;
    static float frameMinX;
    static float frameMinZ;
    static float shellWidth;
    static float shellDepth;

    /// <summary>A room scan was confirmed from real corners (world space, this tracking session).</summary>
    public static void RememberScan(IReadOnlyList<Vector3> worldCorners)
    {
        if (worldCorners == null || worldCorners.Count < 3) return;
        lastScanCorners = new Vector3[worldCorners.Count];
        for (var i = 0; i < worldCorners.Count; i++) lastScanCorners[i] = worldCorners[i];
        lastScanEpoch = ARBootstrap.TrackingEpoch;
        scanFloorOrder = ++floorOrder;
    }

    /// <summary>The design flow sent the planner frame with the room (or not).</summary>
    public static void SetFrame(MeasuredRoomHandoff.MeasuredRoomRnPayload payload)
    {
        hasFrame = payload != null && payload.hasScanFrame && payload.width > 0.2f && payload.depth > 0.2f;
        if (!hasFrame) return;
        frameAngle = payload.frameAngle;
        frameMinX = payload.frameMinX;
        frameMinZ = payload.frameMinZ;
        shellWidth = payload.width;
        shellDepth = payload.depth;
    }

    public static void ClearFrame() => hasFrame = false;

    /// <summary>
    /// The transform from the AR shell (centred planner frame) onto the scanned room, when the
    /// scan is from this tracking session and its corners match <paramref name="shellCorners"/>.
    /// </summary>
    public static bool TryGetShellToWorld(IReadOnlyList<Vector3> shellCorners, out Matrix4x4 shellToWorld, out float yawDegrees)
    {
        shellToWorld = Matrix4x4.identity;
        yawDegrees = 0f;
        if (!hasFrame || lastScanCorners == null || shellCorners == null) return false;
        if (lastScanEpoch != ARBootstrap.TrackingEpoch)
        {
            Debug.Log("[ScanPlacement] Tracking was reset since the scan — the user lines the layout up.");
            return false;
        }

        if (shellCorners.Count != lastScanCorners.Length) return false;

        if (!ScanFrameMath.TryBuild(frameAngle, frameMinX, frameMinZ, shellWidth, shellDepth, lastScanCorners,
                shellCorners, MatchTolerance, out shellToWorld, out yawDegrees))
        {
            Debug.Log("[ScanPlacement] Shell doesn't match the last scan — the user lines the layout up.");
            return false;
        }

        Debug.Log($"[ScanPlacement] Layout placed where the room was scanned (yaw {yawDegrees:F1}°).");
        return true;
    }

    /// <summary>
    /// The user marked two floor corners to line a saved layout up (this tracking session). That
    /// floor counts like a scanned one: without it a lined-up design had no floor to keep pieces
    /// on, and a piece took the height of whatever AR found under it, even a bed or table top.
    /// </summary>
    public static void RememberMarkedFloor(float floorY)
    {
        markedFloorY = floorY;
        markedFloorEpoch = ARBootstrap.TrackingEpoch;
        markedFloorOrder = ++floorOrder;
    }

    static float markedFloorY;
    static int markedFloorEpoch = -1;
    static int markedFloorOrder;
    static int scanFloorOrder;
    static int floorOrder;

    /// <summary>
    /// The measured floor of this tracking session: where the last room was scanned, or the corners
    /// the user marked to line a layout up, whichever came last. Only ever a measured floor: false
    /// before either, or after a tracking reset moved everything.
    /// </summary>
    public static bool TryGetScanFloorY(out float floorY)
    {
        floorY = 0f;
        var scanValid = lastScanCorners != null && lastScanEpoch == ARBootstrap.TrackingEpoch;
        var markedValid = markedFloorEpoch == ARBootstrap.TrackingEpoch;
        if (markedValid && (!scanValid || markedFloorOrder > scanFloorOrder))
        {
            floorY = markedFloorY;
            return true;
        }

        if (!scanValid) return false;
        floorY = float.PositiveInfinity;
        foreach (var c in lastScanCorners) floorY = Mathf.Min(floorY, c.y);
        return !float.IsInfinity(floorY);
    }
}
