using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Builds bridge + API payloads for confirmed room measurements.
/// </summary>
public static class RoomMeasurementPayloadBuilder
{
    public static RoomConfirmedPayload Build(RoomScanController scanController)
    {
        if (scanController == null)
            return new RoomConfirmedPayload { phase = "confirmed", confirmed = true };

        var status = scanController.GetScanStatus();
        var room = scanController.ConfirmedRoom;
        // After the floor check on confirm; the corner builder still has the height from the floor point.
        var wallHeight = scanController.ConfirmedWallHeight > 0f
            ? scanController.ConfirmedWallHeight
            : scanController.CornerBuilder != null ? scanController.CornerBuilder.WallHeight : 0f;

        var dims = RoomMeasurementUtil.Compute(
            room,
            scanController.FloorPolygon,
            wallHeight,
            status.horizontalAreaSqm);

        var payload = new RoomConfirmedPayload
        {
            phase = "confirmed",
            progress = 1f,
            readyToConfirm = true,
            confirmed = true,
            planeCount = status.planeCount,
            horizontalPlaneCount = status.horizontalPlaneCount,
            verticalPlaneCount = status.verticalPlaneCount,
            meshChunkCount = status.meshChunkCount,
            pointCount = status.pointCount,
            horizontalAreaSqm = status.horizontalAreaSqm,
            verticalAreaSqm = status.verticalAreaSqm,
            lookAroundCoverage = status.lookAroundCoverage,
            hint = "confirmed",
            width = dims.width,
            depth = dims.depth,
            height = dims.height,
            floorAreaSqm = dims.floorAreaSqm,
            wallHeight = dims.wallHeight,
            dimensionLabel = dims.dimensionLabel,
            cornerCount = scanController.FloorPolygon?.Count ?? 0,
            furniturePlacementOnly = scanController.IsFurniturePlacementOnly,
        };

        if (dims.hasBounds)
        {
            payload.boundsMin = new ARDesignVec3(dims.boundsMin);
            payload.boundsMax = new ARDesignVec3(dims.boundsMax);
        }

        payload.floorPolygon = BuildPolygon(scanController.FloorPolygon);
        ApplyRoomModel(payload, scanController.FloorPolygon, dims.height);
        ApplyViewUp(payload);
        return payload;
    }

    /// <summary>Which way was up on the Review map (or the way the camera faced, without a map).</summary>
    static void ApplyViewUp(RoomConfirmedPayload payload)
    {
        var hud = Object.FindFirstObjectByType<ARDesignScanHUD>();
        Vector2 up;
        if (hud == null || !hud.TryGetMapUp(out up))
        {
            var cam = Camera.main;
            if (cam == null) return;
            var forward = cam.transform.forward;
            up = new Vector2(forward.x, forward.z);
        }

        if (up.sqrMagnitude < 1e-6f) return;
        up.Normalize();
        payload.hasViewUp = true;
        payload.viewUpX = up.x;
        payload.viewUpZ = up.y;
    }

    static void ApplyRoomModel(RoomConfirmedPayload payload, IReadOnlyList<Vector3> polygon, float height)
    {
        var walls = RoomPolygonUtil.BuildWalls(polygon);
        payload.walls = new RoomWallPayload[walls.Count];
        for (var i = 0; i < walls.Count; i++)
        {
            payload.walls[i] = new RoomWallPayload
            {
                index = walls[i].index,
                start = new ARDesignVec3(walls[i].start),
                end = new ARDesignVec3(walls[i].end),
                length = walls[i].length,
            };
        }

        payload.floorY = RoomPolygonUtil.ComputeFloorY(polygon);
        payload.perimeterM = RoomPolygonUtil.ComputePerimeter(polygon);
        payload.volumeM3 = payload.floorAreaSqm * height;
        var spatial = Object.FindFirstObjectByType<ARDesignSpatialMappingController>();
        payload.openings = spatial != null
            ? spatial.ToOpeningPayloads()
            : System.Array.Empty<RoomOpeningPayload>();
        payload.obstacles = spatial != null
            ? spatial.ToObstaclePayloads()
            : System.Array.Empty<RoomObstaclePayload>();

        var errors = RoomPolygonUtil.Validate(polygon);
        payload.validation = new RoomValidationPayload
        {
            isValid = errors.Count == 0,
            errors = errors.ToArray(),
        };
    }

    static RoomPolygonPayload BuildPolygon(IReadOnlyList<Vector3> polygon)
    {
        if (polygon == null || polygon.Count == 0)
            return new RoomPolygonPayload();

        var points = new ARDesignVec3[polygon.Count];
        for (var i = 0; i < polygon.Count; i++)
            points[i] = new ARDesignVec3(polygon[i]);

        return new RoomPolygonPayload { points = points };
    }
}
