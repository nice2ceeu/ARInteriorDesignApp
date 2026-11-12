#if UNITY_EDITOR
using System;
using UnityEditor;
using UnityEngine;

/// <summary>Device-independent checks for floor projection and measured furniture footprints.</summary>
public static class SpatialMappingRegressionChecks
{
    [MenuItem("AR Interior/Test Spatial Mapping Geometry")]
    public static void Run()
    {
        var origin = new Vector3(0, 1.5f, 0);
        Check(ARFurnitureCocoDetector.TryProjectToFloor(new Ray(origin, new Vector3(0, -1, 1)), 0, out var floor)
              && Vector3.Distance(floor, new Vector3(0, 0, 1.5f)) < 0.001f, "downward floor contact");
        Check(!ARFurnitureCocoDetector.TryProjectToFloor(new Ray(origin, Vector3.forward), 0, out _), "horizontal ray");
        Check(!ARFurnitureCocoDetector.TryProjectToFloor(new Ray(origin, Vector3.up), 0, out _), "upward ray");
        Check(!ARFurnitureCocoDetector.TryProjectToFloor(new Ray(origin, new Vector3(0, -0.01f, 1)), 0, out _), "far floor contact");

        var chair = new Vector3(0.5f, 0.9f, 0.5f);
        var sofa = new Vector3(2, 0.85f, 1);
        Check(Overlap(Vector3.zero, sofa, 0, new Vector3(1.1f, 0, 0), chair, 0), "large overlapping sofa");
        Check(!Overlap(Vector3.zero, chair, 0, new Vector3(0.6f, 0, 0), chair, 0), "separate adjacent chairs");
        Check(Overlap(Vector3.zero, sofa, 90, new Vector3(0, 0, 1.1f), chair, 0), "rotated sofa");
        Check(!Overlap(Vector3.zero, sofa, 90, new Vector3(1.1f, 0, 0), chair, 0), "rotation frees side space");
        Check(Overlap(Vector3.zero, chair, 30, Vector3.zero, chair, 60), "duplicate footprint");
        var hostA = new GameObject("DetectorRegressionA");
        var hostB = new GameObject("DetectorRegressionB");
        var hostC = new GameObject("DetectorRegressionC");
        try
        {
            var detector = ARFurnitureCocoDetector.EnsureOn(hostA);
            Check(ReferenceEquals(detector, ARFurnitureCocoDetector.EnsureOn(hostB))
                  && ReferenceEquals(detector, ARFurnitureCocoDetector.EnsureOn(hostC)), "one shared scene detector");
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(hostA);
            UnityEngine.Object.DestroyImmediate(hostB);
            UnityEngine.Object.DestroyImmediate(hostC);
        }
        Debug.Log("[SpatialMappingRegressionChecks] Passed 10 projection, footprint and shared detector checks.");
    }

    public static void RunAndExport()
    {
        Run();
        AutoWallGeometryChecks.Run();
        RoomOutlineCleanupChecks.Run();
        RoomBoxFitChecks.Run();
        FurnitureMatchChecks.Run();
        ScanFloorCorrectionChecks.Run();
        FurnitureFootprintChecks.Run();
        AutoOpeningChecks.Run();
        ScanUxChecks.RunFromMenu();
        AutoOpeningChecks.RunDetectorOnTestPhotos();
        RnUnityExport.ExportAndroid();
    }

    static bool Overlap(Vector3 a, Vector3 aSize, float aYaw, Vector3 b, Vector3 bSize, float bYaw)
        => ARFurniturePlaneAutoScannerOverlapsHelper.FootprintsOverlap(a, aSize, aYaw, b, bSize, bYaw);

    static void Check(bool condition, string scenario)
    {
        if (!condition) throw new InvalidOperationException($"Spatial mapping regression: {scenario}");
    }
}
#endif
