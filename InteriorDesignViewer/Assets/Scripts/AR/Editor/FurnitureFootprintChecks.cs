#if UNITY_EDITOR
using System;
using UnityEngine;

/// <summary>
/// Device-independent checks for the footprint overlap test: pieces turned with the room are
/// compared by the floor they really cover, not world-axis boxes (adviser, 2026-11-11).
/// </summary>
public static class FurnitureFootprintChecks
{
    public static void Run()
    {
        // A 2.4 x 1.6 m sofa set with a coffee table 45 cm in front, the room lined up at any angle.
        foreach (var yaw in new[] { 0f, 30f, 45f, 73f })
        {
            var r = yaw * Mathf.Deg2Rad;
            var forward = new Vector2(Mathf.Sin(r), Mathf.Cos(r));
            var sofa = Box(Vector2.zero, 2.4f, 1.6f, yaw);
            var table = Box(forward * (0.8f + 0.45f + 0.3f), 1.0f, 0.6f, yaw);
            var gap = FurniturePlacementSafety.GapXZ(sofa, table, out _);
            Check(Mathf.Abs(gap - 0.45f) < 0.01f, $"a coffee table 45 cm in front stays 45 cm away at {yaw} degrees (got {gap:F3})");
        }

        var a = Box(Vector2.zero, 1f, 1f, 0f);
        var b = Box(new Vector2(0.9f, 0f), 1f, 1f, 0f);
        var overlap = FurniturePlacementSafety.GapXZ(b, a, out var away);
        Check(Mathf.Abs(overlap + 0.1f) < 1e-3f, "a 10 cm overlap reads as -10 cm");
        Check(away.x > 0.99f, "the push points away from the other piece");

        var sofa2 = Box(Vector2.zero, 2f, 0.9f, 0f);
        var halfDiagonal = 0.5f * Mathf.Sqrt(2f) * 0.6f;
        var chair = Box(new Vector2(0f, 0.45f + halfDiagonal - 0.05f), 0.6f, 0.6f, 45f);
        var turned = FurniturePlacementSafety.GapXZ(chair, sofa2, out var awayTurned);
        Check(turned < 0f && turned > -0.06f, "a turned chair 5 cm into a sofa overlaps by about 5 cm");
        Check(awayTurned.y > 0.5f, "the turned chair is pushed out the front");

        // Layouts put pieces side by side, touching: that is not an overlap; 5 cm into each other is.
        var sofaSet = Box(Vector2.zero, 2.41f, 1.64f, 30f);
        var r30 = 30f * Mathf.Deg2Rad;
        var front = new Vector2(Mathf.Sin(r30), Mathf.Cos(r30));
        foreach (var (into, overlaps) in new[] { (-0.004f, false), (0.001f, false), (0.05f, true) })
        {
            var accent = Box(front * (0.82f + 0.605f - into), 1.46f, 1.21f, 30f);
            var g = FurniturePlacementSafety.GapXZ(sofaSet, accent, out _);
            Check(FurniturePlacementSafety.CountsAsOverlap(g) == overlaps,
                $"an accent chair {into * 100f:F1} cm into a sofa set {(overlaps ? "overlaps" : "is only touching")}");
        }

        var diagonal = FurniturePlacementSafety.GapXZ(
            Box(Vector2.zero, 1f, 1f, 0f), Box(new Vector2(1.5f, 1.5f), 1f, 1f, 0f), out _);
        Check(diagonal > 0f && diagonal <= Mathf.Sqrt(0.5f) + 1e-3f, "corner to corner never claims more room than there is");
    }

    static Vector2[] Box(Vector2 centre, float width, float depth, float yawDeg)
    {
        var r = yawDeg * Mathf.Deg2Rad;
        var ax = new Vector2(Mathf.Cos(r), -Mathf.Sin(r)) * (width / 2f);
        var az = new Vector2(Mathf.Sin(r), Mathf.Cos(r)) * (depth / 2f);
        return new[] { centre - ax - az, centre + ax - az, centre + ax + az, centre - ax + az };
    }

    static void Check(bool ok, string what)
    {
        if (!ok) throw new Exception("[FurnitureFootprintChecks] Failed: " + what);
    }
}
#endif
