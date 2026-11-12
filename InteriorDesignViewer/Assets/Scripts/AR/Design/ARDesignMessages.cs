using System;
using System.Collections.Generic;

/// <summary>
/// Serializable payloads exchanged between ARDesignScene and React Native.
///
/// The transport is the existing bridge convention:
///   RN → Unity   UnitySendMessage("Managers", "ReceiveMessage", "{\"method\":..,\"data\":..}")
///   Unity → RN   NativeAPI.SendMessageToRN("{\"event\":..,\"data\":..}")
///
/// "data" is always a STRING. Structured payloads are JSON-encoded into that
/// string, so RN must JSON.parse(msg.data) for the events that carry objects.
/// All types here are JsonUtility-compatible (no dictionaries, no nullables).
/// </summary>
[Serializable]
public class ARDesignInboundMessage
{
    public string method;
    public string data;
}

/// <summary>Vector payload — JsonUtility cannot serialize UnityEngine.Vector3 fields reliably across versions.</summary>
[Serializable]
public class ARDesignVec3
{
    public float x;
    public float y;
    public float z;

    public ARDesignVec3() { }

    public ARDesignVec3(UnityEngine.Vector3 v)
    {
        x = v.x;
        y = v.y;
        z = v.z;
    }
}

/// <summary>Payload for SpawnFurniture. Sent by RN as a JSON string in "data".</summary>
[Serializable]
public class SpawnFurnitureRequest
{
    /// <summary>Stable id from the RN catalog. Echoed back on every layout/export payload.</summary>
    public string modelId;

    /// <summary>Remote or local GLB/glTF to load at runtime. Requires glTFast (see RuntimeGltfLoader).</summary>
    public string glbUrl;

    /// <summary>Optional id into the built-in Unity FurnitureCatalog, used when glbUrl is empty.</summary>
    public string catalogId;

    /// <summary>Real-world size in metres. Zero means "keep the model's authored scale".</summary>
    public float width;
    public float height;
    public float depth;

    /// <summary>Exact reference label from the product sheet, e.g. L 90" × W 32" × H 32".</summary>
    public string dimensionLabel;

    /// <summary>
    /// When true, place immediately at <see cref="position"/> instead of waiting for a floor tap.
    /// Required because JsonUtility cannot distinguish a missing vector from (0,0,0).
    /// </summary>
    public bool hasPosition;

    /// <summary>World-space floor point in metres (feet of the piece). Used only when hasPosition is true.</summary>
    public ARDesignVec3 position;

    /// <summary>Y-axis rotation in degrees. Used only when hasPosition is true.</summary>
    public float rotationY;

    /// <summary>Optional "#RRGGBB" tint applied once the piece is placed.</summary>
    public string colorHex;
}

/// <summary>Payload for applyLayout — drop a full proposal on the confirmed floor.</summary>
[Serializable]
public class ApplyLayoutRequest
{
    public bool clearExisting = true;
    public SpawnFurnitureRequest[] items;
}

/// <summary>Scan coverage/quality snapshot returned by GetScanStatus and pushed on scanProgress.</summary>
[Serializable]
public class ScanStatusPayload
{
    /// <summary>"idle" | "scanning" | "readyToConfirm" | "confirmed".</summary>
    public string phase;

    /// <summary>0..1 overall coverage estimate.</summary>
    public float progress;

    public bool readyToConfirm;
    public bool confirmed;

    public int planeCount;
    public int horizontalPlaneCount;
    public int verticalPlaneCount;
    public int meshChunkCount;
    public int pointCount;

    public float horizontalAreaSqm;
    public float verticalAreaSqm;

    /// <summary>0..1 fraction of the yaw circle the user has pointed the camera at.</summary>
    public float lookAroundCoverage;

    /// <summary>Short machine-readable hint for the RN copy, e.g. "moveAround", "findFloor", "scanWalls".</summary>
    public string hint;
}

/// <summary>Floor outline vertices sent after room scan confirm.</summary>
[Serializable]
public class RoomPolygonPayload
{
    public ARDesignVec3[] points;
}

/// <summary>One wall of the floor outline (edge from corner index to index + 1).</summary>
[Serializable]
public class RoomWallPayload
{
    public int index;
    public ARDesignVec3 start;
    public ARDesignVec3 end;
    public float length;
}

/// <summary>Door or window on a wall. Offsets are metres from the wall's start corner.</summary>
[Serializable]
public class RoomOpeningPayload
{
    public string id;
    /// <summary>"door" | "window".</summary>
    public string type;
    public int wallIndex;
    public float offsetAlongWall;
    public float width;
    public float height;
    public float sillHeight;
    /// <summary>"left" | "right" | "none".</summary>
    public string swing;
}

/// <summary>Existing furniture the user marked during the scan.</summary>
[Serializable]
public class RoomObstaclePayload
{
    public string id;
    public string type;
    /// <summary>The detector's label ("Coffee table", "Television"), so layouts know what the piece is; empty when added by hand.</summary>
    public string label;
    public ARDesignVec3 center;
    public ARDesignVec3 size;
    public float yaw;
}

[Serializable]
public class RoomValidationPayload
{
    public bool isValid;
    /// <summary>Codes: "tooFewCorners", "selfIntersecting", "zeroArea".</summary>
    public string[] errors;
}

/// <summary>
/// Payload for roomScanConfirmed — scan status plus computed room dimensions (metres).
/// </summary>
[Serializable]
public class RoomConfirmedPayload
{
    public string phase;
    public float progress;
    public bool readyToConfirm;
    public bool confirmed;
    public int planeCount;
    public int horizontalPlaneCount;
    public int verticalPlaneCount;
    public int meshChunkCount;
    public int pointCount;
    public float horizontalAreaSqm;
    public float verticalAreaSqm;
    public float lookAroundCoverage;
    public string hint;

    /// <summary>Room width in metres (X axis).</summary>
    public float width;
    /// <summary>Room length/depth in metres (Z axis).</summary>
    public float depth;
    /// <summary>Wall height in metres (Y axis).</summary>
    public float height;
    public float floorAreaSqm;
    public float wallHeight;
    /// <summary>Human-readable label, e.g. L 4.2m × W 3.1m × H 2.5m.</summary>
    public string dimensionLabel;
    public ARDesignVec3 boundsMin;
    public ARDesignVec3 boundsMax;
    public int cornerCount;
    public RoomPolygonPayload floorPolygon;
    /// <summary>True when the scene skipped real measurement (synthetic open floor).</summary>
    public bool furniturePlacementOnly;
    /// <summary>
    /// The world direction (x, z) that was up on the scan's Review map, so the app's floor plan can be
    /// turned the same way. Without it the plan was drawn from whichever side its longest wall gave,
    /// and looked turned against the room the user had just scanned (2026-11-12).
    /// </summary>
    public bool hasViewUp;
    public float viewUpX;
    public float viewUpZ;

    /// <summary>World-space floor height in metres.</summary>
    public float floorY;
    public float perimeterM;
    public float volumeM3;
    public RoomWallPayload[] walls;
    public RoomOpeningPayload[] openings;
    public RoomObstaclePayload[] obstacles;
    public RoomValidationPayload validation;

    public RoomMeasurementSaveRequest ToSaveRequest()
    {
        return new RoomMeasurementSaveRequest
        {
            width = width,
            depth = depth,
            height = height,
            floorAreaSqm = floorAreaSqm,
            wallHeight = wallHeight,
            dimensionLabel = dimensionLabel ?? string.Empty,
            boundsMin = boundsMin,
            boundsMax = boundsMax,
            floorPolygon = floorPolygon?.points ?? System.Array.Empty<ARDesignVec3>(),
            floorY = floorY,
            perimeterM = perimeterM,
            volumeM3 = volumeM3,
            walls = walls ?? System.Array.Empty<RoomWallPayload>(),
            openings = openings ?? System.Array.Empty<RoomOpeningPayload>(),
            obstacles = obstacles ?? System.Array.Empty<RoomObstaclePayload>(),
            scanMetadata = new RoomScanMetadataPayload
            {
                planeCount = planeCount,
                meshChunkCount = meshChunkCount,
                horizontalAreaSqm = horizontalAreaSqm,
                verticalAreaSqm = verticalAreaSqm,
                cornerCount = cornerCount,
                source = "unity-ar",
            },
        };
    }
}

[Serializable]
public class RoomScanMetadataPayload
{
    public int planeCount;
    public int meshChunkCount;
    public float horizontalAreaSqm;
    public float verticalAreaSqm;
    public int cornerCount;
    public string source;
}

/// <summary>Body for POST /api/v1/room-measurements.</summary>
[Serializable]
public class RoomMeasurementSaveRequest
{
    public string projectId;
    public string name;
    public float width;
    public float depth;
    public float height;
    public float floorAreaSqm;
    public float wallHeight;
    public string dimensionLabel;
    public ARDesignVec3 boundsMin;
    public ARDesignVec3 boundsMax;
    public ARDesignVec3[] floorPolygon;
    public float floorY;
    public float perimeterM;
    public float volumeM3;
    public RoomWallPayload[] walls;
    public RoomOpeningPayload[] openings;
    public RoomObstaclePayload[] obstacles;
    public RoomScanMetadataPayload scanMetadata;
}

/// <summary>One placed furniture instance.</summary>
[Serializable]
public class PlacedFurniturePayload
{
    public string instanceId;
    public string modelId;
    public ARDesignVec3 position;

    /// <summary>Y-axis rotation in degrees. Furniture never tilts.</summary>
    public float rotationY;

    /// <summary>Uniform scale multiplier relative to the model's real-world size (1 = true scale).</summary>
    public float scale;

    /// <summary>Real-world bounding size in metres at the current scale.</summary>
    public ARDesignVec3 dimensions;

    public bool selected;

    /// <summary>"#RRGGBB" tint chosen by the user, empty for the model's own colours.</summary>
    public string colorHex;

    /// <summary>True while the user has locked this piece in place.</summary>
    public bool locked;

    /// <summary>
    /// True when <see cref="sourcePosition"/> is valid: the pose in the frame RN sent with
    /// applyLayout (room-centred metres), i.e. with the two-corner wall alignment undone.
    /// </summary>
    public bool hasSource;
    public ARDesignVec3 sourcePosition;
    public float sourceRotationY;
}

/// <summary>Payload for setFurnitureColor. Empty instanceId targets the selected piece.</summary>
[Serializable]
public class FurnitureColorRequest
{
    public string instanceId;
    /// <summary>"#RRGGBB", or empty to restore the model's own colours.</summary>
    public string colorHex;
}

/// <summary>Payload for setFurnitureLocked. Empty instanceId targets the selected piece.</summary>
[Serializable]
public class FurnitureLockRequest
{
    public string instanceId;
    public bool locked;
}

/// <summary>
/// Every piece that overlaps another piece or runs through a wall (event "placementCheck"). Sent
/// with each layout change and on request; the app blocks Finish while <see cref="hasErrors"/>.
/// </summary>
[Serializable]
public class PlacementCheckPayload
{
    public bool hasErrors;
    public PlacementIssuePayload[] issues;
}

[Serializable]
public class PlacementIssuePayload
{
    public string instanceId;
    public string modelId;
    /// <summary>The piece it overlaps; empty when the problem is a wall.</summary>
    public string otherModelId;
    public bool hitsWall;
    public string reason;
}

/// <summary>Placement safety feedback for the selected furniture piece.</summary>
[Serializable]
public class PlacementSafetyPayload
{
    public string instanceId;
    public string modelId;
    public bool isSafe;
    public bool hasFurnitureCollision;
    public bool hasWallCollision;
    public bool isTooCloseToWall;
    /// <summary>True while a drag is being held back by another piece.</summary>
    public bool isBlocked;
    /// <summary>Model id of the piece overlapped or in the way; empty when none.</summary>
    public string otherModelId;
    public float nearestFurnitureDistance;
    public float nearestWallDistance;
    public string reason;

    public static PlacementSafetyPayload From(FurniturePlacementSafety.Result result, PlacedFurniture furniture)
    {
        return new PlacementSafetyPayload
        {
            instanceId = furniture != null ? furniture.InstanceId : string.Empty,
            modelId = furniture != null ? furniture.ModelId : string.Empty,
            isSafe = result.isSafe,
            hasFurnitureCollision = result.hasFurnitureCollision,
            hasWallCollision = result.hasWallCollision,
            isTooCloseToWall = result.isTooCloseToWall,
            isBlocked = result.isBlocked,
            otherModelId = result.otherModelId ?? string.Empty,
            nearestFurnitureDistance = float.IsFinite(result.nearestFurnitureDistance)
                ? result.nearestFurnitureDistance
                : -1f,
            nearestWallDistance = float.IsFinite(result.nearestWallDistance)
                ? result.nearestWallDistance
                : -1f,
            reason = result.reason ?? string.Empty,
        };
    }
}

/// <summary>Full in-session layout returned by GetCurrentLayout.</summary>
[Serializable]
public class LayoutPayload
{
    public string phase;
    public bool roomConfirmed;
    public int roomMeshCount;
    public int count;
    public List<PlacedFurniturePayload> furniture = new();
}

/// <summary>Result of ExportLayout. The GLB is written to disk; RN reads it by path.</summary>
[Serializable]
public class ExportResultPayload
{
    public bool success;

    /// <summary>Absolute path under Application.persistentDataPath. Empty on failure.</summary>
    public string path;

    public string fileName;
    public long byteLength;
    public int furnitureCount;
    public int roomMeshCount;
    public string error;
}

/// <summary>
/// Result of an AR Furniture photo capture. The PNG is written to disk (and optionally
/// the device gallery); RN reads bytes by path — same pattern as exportComplete.
/// </summary>
[Serializable]
public class ARPhotoCapturedPayload
{
    public bool success;

    /// <summary>Absolute path under Application.persistentDataPath.</summary>
    public string path;

    public string fileName;
    public long byteLength;
    public string mimeType;
    public bool gallerySaved;
    public string error;
}

/// <summary>Emitted whenever the selection changes (instanceId empty means "nothing selected").</summary>
[Serializable]
public class SelectionPayload
{
    public string instanceId;
    public string modelId;
    public bool selected;
}

/// <summary>Emitted when a spawn request cannot be fulfilled.</summary>
[Serializable]
public class ARDesignErrorPayload
{
    public string code;
    public string message;
}

/// <summary>Undo / redo availability pushed after layout history changes.</summary>
[Serializable]
public class HistoryStatePayload
{
    public bool canUndo;
    public bool canRedo;
    public int undoCount;
    public int redoCount;
}

/// <summary>Design-flow AR: progress of lining the saved layout up with the real room.</summary>
[Serializable]
public class LayoutAlignmentPayload
{
    /// <summary>"idle" | "aligning" | "aligned".</summary>
    public string state;

    /// <summary>Aligned by itself: placed where the room was scanned (same AR session), no corners marked.</summary>
    public bool autoPlaced;

    /// <summary>Lined up by hand and another plan wall fits the marked one: the layout can be turned 180°.</summary>
    public bool canTurn;

    /// <summary>Corners marked so far while aligning (0 or 1).</summary>
    public int step;

    /// <summary>True while the reticle is locked on a real floor plane.</summary>
    public bool floorDetected;

    /// <summary>Distance between the two marked corners, metres.</summary>
    public float measuredM;

    /// <summary>Length of the plan wall the marked wall was matched to, metres.</summary>
    public float planM;

    /// <summary>"real" | "plan".</summary>
    public string view;

    /// <summary>"" | "noFloor" | "tooClose" | "noRoom".</summary>
    public string error;
}
