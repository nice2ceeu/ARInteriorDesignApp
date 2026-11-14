#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

/// <summary>
/// Exports the enabled scenes as an Android Gradle project (unityLibrary + launcher) into
/// frontend/unity/builds/android, where @azesmway/react-native-unity and plugins/withUnity.js
/// expect it. Run from the menu, or headless:
///   Unity.exe -batchmode -quit -projectPath InteriorDesignViewer -buildTarget Android
///     -executeMethod RnUnityExport.ExportAndroid -logFile -
/// </summary>
public static class RnUnityExport
{
    const string OutputFolder = "frontend/unity/builds/android";
    /// <summary>Unity starts on this scene (the first one in the export).</summary>
    public const string StartupScenePath = "Assets/Scenes/ARRoomMeasurement.unity";

    [MenuItem("AR Interior/Export Android Library for React Native", false, 29)]
    public static void ExportAndroidMenu()
    {
        var ok = Export();
        EditorUtility.DisplayDialog(
            "AR Interior",
            ok ? $"Exported to {OutputFolder}.\n\nNext: run `npm run android` in frontend." : "Export failed — see the Console.",
            "OK");
    }

    /// <summary>Batch-mode entry point; exits with code 1 on failure.</summary>
    public static void ExportAndroid()
    {
        if (!Export())
            EditorApplication.Exit(1);
    }

    static bool Export()
    {
        if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android)
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android);

        // The app opens every AR screen on the measuring scene. Starting Unity on ARDesignScene made
        // each first open after launch load a second scene: a 3.4-5.6 s freeze, then the AR camera
        // restarted and sat "stuck in Ready" until it was reset (Realme and Redmi, 2026-11-11/12).
        var scenes = EditorBuildSettings.scenes
            .Where(s => s.enabled && !string.IsNullOrEmpty(s.path))
            .Select(s => s.path)
            .OrderBy(path => path == StartupScenePath ? 0 : 1)
            .ToArray();
        if (scenes.Length == 0)
        {
            Debug.LogError("[RnUnityExport] No scenes are enabled in Build Profiles.");
            return false;
        }

        var projectRoot = Directory.GetParent(Application.dataPath)!.FullName;
        var outputDir = Path.Combine(Directory.GetParent(projectRoot)!.FullName, OutputFolder.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(outputDir);

        EditorUserBuildSettings.exportAsGoogleAndroidProject = true;
        PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

        Debug.Log($"[RnUnityExport] Exporting {string.Join(", ", scenes)} to {outputDir}");
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = scenes,
            locationPathName = outputDir,
            target = BuildTarget.Android,
            targetGroup = BuildTargetGroup.Android,
            options = BuildOptions.None,
        });

        if (report.summary.result != BuildResult.Succeeded)
        {
            Debug.LogError($"[RnUnityExport] Export failed: {report.summary.result}, {report.summary.totalErrors} error(s).");
            return false;
        }

        var library = Path.Combine(outputDir, "unityLibrary", "build.gradle");
        if (!File.Exists(library))
        {
            Debug.LogError($"[RnUnityExport] Export finished but {library} is missing.");
            return false;
        }
        Debug.Log($"[RnUnityExport] Export succeeded in {report.summary.totalTime}.");
        return true;
    }
}
#endif
