#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Device-independent checks for lining a saved layout up with the room: Turn reaches every wall,
/// and the floor the user marked keeps pieces down (2026-11-12).
/// </summary>
public static class LayoutAlignmentChecks
{
    public static void Run()
    {
        // 3.40 x 3.20 m room; the user marked 3.22 m along a 3.40 m wall, so length picks a 3.20 m one.
        var room = new List<Vector3>
        {
            new(0f, 0f, 0f), new(3.4f, 0f, 0f), new(3.4f, 0f, 3.2f), new(0f, 0f, 3.2f),
        };
        var order = ARDesignLayoutAlignmentController.BuildWallOrder(room, matched: 1, measured: 3.22f);
        Check(order.Count == 4, $"Turn offers all four walls of a near-square room (got {order.Count})");
        Check(order[0] == 1 && order[1] == 3, "Turn tries the opposite wall first");
        Check(order.Contains(0) && order.Contains(2), "the 3.40 m walls the user really marked can be reached");

        // A short jog in the outline is not a wall to line up on.
        var jogged = new List<Vector3>
        {
            new(0f, 0f, 0f), new(3.4f, 0f, 0f), new(3.4f, 0f, 3.0f), new(3.1f, 0f, 3.2f), new(0f, 0f, 3.2f),
        };
        var joggedOrder = ARDesignLayoutAlignmentController.BuildWallOrder(jogged, matched: 0, measured: 3.4f);
        Check(!joggedOrder.Contains(2), "a 36 cm jog is not offered as a wall");
        Check(joggedOrder[0] == 0, "the matched wall comes first");

        // The floor of a lined-up design is the floor the user marked; a newer scan takes over.
        ScanPlacement.RememberScan(new[] { new Vector3(0f, -1.30f, 0f), new Vector3(1f, -1.30f, 0f), new Vector3(1f, -1.30f, 1f) });
        ScanPlacement.RememberMarkedFloor(-1.10f);
        Check(ScanPlacement.TryGetScanFloorY(out var marked) && Mathf.Abs(marked + 1.10f) < 1e-4f,
            "pieces stay on the floor the user marked after a line-up");
        ScanPlacement.RememberScan(new[] { new Vector3(0f, -1.25f, 0f), new Vector3(1f, -1.25f, 0f), new Vector3(1f, -1.25f, 1f) });
        Check(ScanPlacement.TryGetScanFloorY(out var scanned) && Mathf.Abs(scanned + 1.25f) < 1e-4f,
            "a newer scan's floor replaces the marked one");

        Debug.Log("[LayoutAlignmentChecks] Passed wall order and marked-floor checks.");
    }

    static void Check(bool ok, string what)
    {
        if (!ok) throw new Exception("[LayoutAlignmentChecks] Failed: " + what);
    }
}
#endif
