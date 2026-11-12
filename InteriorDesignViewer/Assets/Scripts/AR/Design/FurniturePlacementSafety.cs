using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Placement safety checks for furniture: furniture-furniture footprint overlap
/// and wall proximity / out-of-room footprint corners.
/// Footprints are the turned rectangles the pieces really cover. World-axis boxes grew with the
/// room's angle in AR (a 2.4 x 1.6 m sofa set turned 30 degrees boxed as 2.9 x 2.6 m), so lined-up
/// layouts went red with room to spare and were pushed off their planned spots (adviser, 2026-11-11).
/// </summary>
public static class FurniturePlacementSafety
{
    public const float MinFurnitureClearanceMetres = 0.02f;
    /// <summary>
    /// Pieces count as overlapping only when they cover the same floor by more than this. Layouts put
    /// pieces side by side, touching (a sofa set and an accent chair 0.4 cm apart, or 1 mm into
    /// each other), and those went red and blocked Finish (adviser, 2026-11-11). Box sizes come from
    /// the models' outer bounds, so touching boxes are not furniture inside furniture.
    /// </summary>
    public const float OverlapToleranceMetres = 0.015f;
    /// <summary>
    /// Closer than this to a wall is reported, but is not unsafe: sofas, beds and cabinets stand
    /// against walls, and layouts put them 5 cm off (they all went red at this 15 cm rule).
    /// </summary>
    public const float MinWallClearanceMetres = 0.15f;
    /// <summary>
    /// A corner counts as through the wall only past this: lining up a room by two taps is good to a
    /// few centimetres, and a piece the layout put 5 cm off the wall shouldn't block Finish for it.
    /// </summary>
    public const float WallCollisionToleranceMetres = 0.05f;

    public struct Result
    {
        public bool isSafe;
        public bool hasFurnitureCollision;
        public bool hasWallCollision;
        public bool isTooCloseToWall;
        /// <summary>Set by the placement controller while a drag is held back by another piece.</summary>
        public bool isBlocked;
        /// <summary>Model id of the first piece overlapped (or in the way when blocked).</summary>
        public string otherModelId;
        public float nearestFurnitureDistance;
        public float nearestWallDistance;
        public string reason;

        public static Result Safe()
        {
            return new Result
            {
                isSafe = true,
                nearestFurnitureDistance = float.PositiveInfinity,
                nearestWallDistance = float.PositiveInfinity,
                reason = string.Empty,
            };
        }
    }

    public static Result Evaluate(
        PlacedFurniture target,
        IReadOnlyList<PlacedFurniture> others,
        RoomScanController room)
    {
        if (target == null) return Result.Safe();
        return EvaluateAtPivot(target, target.transform.position, others, room);
    }

    /// <summary>
    /// Evaluates safety as if <paramref name="target"/> were moved to <paramref name="worldPivot"/>
    /// (XZ only; Y is ignored for footprint checks).
    /// </summary>
    public static Result EvaluateAtPivot(
        PlacedFurniture target,
        Vector3 worldPivot,
        IReadOnlyList<PlacedFurniture> others,
        RoomScanController room)
    {
        var result = Result.Safe();
        if (target == null) return result;

        var targetQuad = FootprintQuadXZ(target, worldPivot);

        var nearestFurniture = float.PositiveInfinity;
        if (others != null)
        {
            for (var i = 0; i < others.Count; i++)
            {
                var other = others[i];
                if (other == null || other == target) continue;
                if (other.InstanceId == target.InstanceId) continue;
                if (!other.gameObject.activeInHierarchy) continue;

                var gap = GapXZ(targetQuad, FootprintQuadXZ(other, other.transform.position), out _);
                nearestFurniture = Mathf.Min(nearestFurniture, Mathf.Max(0f, gap));

                if (CountsAsOverlap(gap))
                {
                    if (!result.hasFurnitureCollision)
                        result.otherModelId = other.ModelId;
                    result.hasFurnitureCollision = true;
                }
            }
        }

        result.nearestFurnitureDistance = nearestFurniture;

        var nearestWall = float.PositiveInfinity;
        var outside = false;
        var roomReady = room != null && room.IsConfirmed;
        if (roomReady)
        {
            foreach (var corner in GetWorldFootprintCornersAt(target, worldPivot))
            {
                var edgeDist = room.DistanceToFloorBoundaryXZ(corner);
                if (!room.IsInsideRoom(corner))
                {
                    if (edgeDist > WallCollisionToleranceMetres)
                        outside = true;
                    edgeDist = 0f;
                }

                if (edgeDist < nearestWall)
                    nearestWall = edgeDist;
            }
        }

        result.nearestWallDistance = nearestWall;
        result.hasWallCollision = outside;
        result.isTooCloseToWall = !outside
                                  && nearestWall < MinWallClearanceMetres
                                  && float.IsFinite(nearestWall);

        if (result.hasFurnitureCollision)
        {
            result.isSafe = false;
            result.reason = "Overlaps another furniture piece";
        }
        else if (result.hasWallCollision)
        {
            result.isSafe = false;
            result.reason = "Collides with the wall";
        }
        else if (result.isTooCloseToWall)
        {
            // Reported only: see MinWallClearanceMetres.
            result.reason = "Close to the wall";
        }

        return result;
    }

    /// <summary>
    /// Pushes <paramref name="desiredPivot"/> away from overlapping furniture until clear,
    /// or returns the original pivot of the piece if a clear spot cannot be found nearby.
    /// </summary>
    public static Vector3 ResolveAwayFromFurnitureOverlaps(
        PlacedFurniture target,
        Vector3 desiredPivot,
        IReadOnlyList<PlacedFurniture> others,
        Vector3 fallbackPivot,
        int maxIterations = 14)
    {
        if (target == null) return desiredPivot;
        if (others == null || others.Count == 0) return desiredPivot;

        var resolved = desiredPivot;
        resolved.y = desiredPivot.y;

        for (var iter = 0; iter < maxIterations; iter++)
        {
            var result = EvaluateAtPivot(target, resolved, others, null);
            if (!result.hasFurnitureCollision)
                return resolved;

            var push = Vector3.zero;
            var myQuad = FootprintQuadXZ(target, resolved);

            for (var i = 0; i < others.Count; i++)
            {
                var other = others[i];
                if (other == null || other == target) continue;
                if (other.InstanceId == target.InstanceId) continue;
                if (!other.gameObject.activeInHierarchy) continue;

                var gap = GapXZ(myQuad, FootprintQuadXZ(other, other.transform.position), out var away);
                if (!TooCloseXZ(gap))
                    continue;

                // Out along the side they overlap least on.
                var penetration = Mathf.Max(0f, -gap);
                push += new Vector3(away.x, 0f, away.y) * (penetration + MinFurnitureClearanceMetres + 0.02f);
            }

            if (push.sqrMagnitude < 1e-8f)
                break;

            resolved += push;
            resolved.y = desiredPivot.y;
        }

        var finalCheck = EvaluateAtPivot(target, resolved, others, null);
        if (finalCheck.hasFurnitureCollision)
            return fallbackPivot;

        return resolved;
    }

    public static Rect GetFootprintRectXZ(PlacedFurniture furniture)
    {
        return GetFootprintRectXZAt(furniture, furniture.transform.position);
    }

    public static Rect GetFootprintRectXZAt(PlacedFurniture furniture, Vector3 worldPivot)
    {
        var corners = GetWorldFootprintCornersAt(furniture, worldPivot);
        var minX = float.PositiveInfinity;
        var maxX = float.NegativeInfinity;
        var minZ = float.PositiveInfinity;
        var maxZ = float.NegativeInfinity;

        for (var i = 0; i < corners.Length; i++)
        {
            var c = corners[i];
            if (c.x < minX) minX = c.x;
            if (c.x > maxX) maxX = c.x;
            if (c.z < minZ) minZ = c.z;
            if (c.z > maxZ) maxZ = c.z;
        }

        return Rect.MinMaxRect(minX, minZ, maxX, maxZ);
    }

    public static Vector3[] GetWorldFootprintCorners(PlacedFurniture furniture)
    {
        return GetWorldFootprintCornersAt(furniture, furniture.transform.position);
    }

    public static Vector3[] GetWorldFootprintCornersAt(PlacedFurniture furniture, Vector3 worldPivot)
    {
        var local = GetLocalFootprintCorners(furniture);
        var delta = worldPivot - furniture.transform.position;
        delta.y = 0f;
        var world = new Vector3[local.Length];
        for (var i = 0; i < local.Length; i++)
        {
            var p = furniture.transform.TransformPoint(local[i]);
            world[i] = new Vector3(p.x + delta.x, p.y, p.z + delta.z);
        }
        return world;
    }

    static Vector3[] GetLocalFootprintCorners(PlacedFurniture furniture)
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
        return new[]
        {
            new Vector3(min.x, min.y, min.z),
            new Vector3(max.x, min.y, min.z),
            new Vector3(max.x, min.y, max.z),
            new Vector3(min.x, min.y, max.z),
        };
    }

    /// <summary>Within the furniture clearance (or overlapping), given a <see cref="GapXZ"/>.</summary>
    static bool TooCloseXZ(float gap) => gap < MinFurnitureClearanceMetres * 0.5f;

    /// <summary>Unsafe overlap, given a <see cref="GapXZ"/> (see <see cref="OverlapToleranceMetres"/>).
    /// Dragging still keeps pieces a centimetre apart (<see cref="TooCloseXZ"/>).</summary>
    public static bool CountsAsOverlap(float gap) => gap < -OverlapToleranceMetres;

    /// <summary>The footprint's four corners on the floor (x, z), in order around it.</summary>
    static Vector2[] FootprintQuadXZ(PlacedFurniture furniture, Vector3 worldPivot)
    {
        var corners = GetWorldFootprintCornersAt(furniture, worldPivot);
        var quad = new Vector2[corners.Length];
        for (var i = 0; i < corners.Length; i++)
            quad[i] = new Vector2(corners[i].x, corners[i].z);
        return quad;
    }

    /// <summary>
    /// Gap between two convex footprints (separating axis test): positive when apart (never more
    /// than the true distance), negative when overlapping, by how far. <paramref name="away"/> is the
    /// axis that separates them best, pointing from <paramref name="b"/> towards <paramref name="a"/>.
    /// </summary>
    public static float GapXZ(Vector2[] a, Vector2[] b, out Vector2 away)
    {
        var best = float.NegativeInfinity;
        away = Vector2.right;
        var found = false;
        for (var pass = 0; pass < 2; pass++)
        {
            var poly = pass == 0 ? a : b;
            for (var i = 0; i < poly.Length; i++)
            {
                var edge = poly[(i + 1) % poly.Length] - poly[i];
                if (edge.sqrMagnitude < 1e-10f) continue;
                var axis = new Vector2(-edge.y, edge.x).normalized;

                Project(a, axis, out var minA, out var maxA);
                Project(b, axis, out var minB, out var maxB);
                var gapAhead = minA - maxB;  // a beyond b along +axis
                var gapBehind = minB - maxA; // a before b
                var gap = Mathf.Max(gapAhead, gapBehind);
                if (found && gap <= best) continue;

                best = gap;
                found = true;
                away = gapAhead >= gapBehind ? axis : -axis;
            }
        }

        return found ? best : float.PositiveInfinity;
    }

    static void Project(Vector2[] poly, Vector2 axis, out float min, out float max)
    {
        min = float.PositiveInfinity;
        max = float.NegativeInfinity;
        for (var i = 0; i < poly.Length; i++)
        {
            var d = Vector2.Dot(poly[i], axis);
            if (d < min) min = d;
            if (d > max) max = d;
        }
    }
}
