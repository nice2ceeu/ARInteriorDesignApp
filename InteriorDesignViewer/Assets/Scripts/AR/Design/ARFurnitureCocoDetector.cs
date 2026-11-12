using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Unity.InferenceEngine;

/// <summary>
/// Object detector for the room scan (Inference Engine). Prefers Resources/ML/RoomDetector:
/// YOLOv8s pretrained on Open Images V7 (601 classes, Ultralytics, AGPL-3.0), which knows doors,
/// windows and far more furniture (wardrobes, cabinets, shelves, desks, nightstands, …). Falls back
/// to Resources/ML/FurnitureDetector: YOLO11n pretrained on COCO, from
/// huggingface.co/unity/inference-engine-yolo (GPL-3.0). See Editor ▸ AR Interior ▸ Setup Furniture Detector.
/// Furniture comes back as suggestions from <see cref="TryDetect"/>; doors and windows are kept as
/// <see cref="AutoOpeningResolver.Sighting"/>s for <see cref="TakeOpeningSightings"/>.
/// </summary>
[DisallowMultipleComponent]
public class ARFurnitureCocoDetector : MonoBehaviour
{
    static ARFurnitureCocoDetector instance;

    public static ARFurnitureCocoDetector EnsureOn(GameObject host)
    {
        if (instance != null && instance.isActiveAndEnabled) return instance;
        if (instance != null) instance.ReleaseModel();
        instance = null;
        var detector = FindAnyObjectByType<ARFurnitureCocoDetector>();
        if (detector != null && !detector.isActiveAndEnabled) detector = null;
        if (detector == null) detector = host.AddComponent<ARFurnitureCocoDetector>();
        instance = detector;
        return detector;
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetSharedDetector()
    {
        if (instance != null) instance.ReleaseModel();
        instance = null;
    }
    const string RoomModelResourcePath = "ML/RoomDetector";
    const string ModelResourcePath = "ML/FurnitureDetector";
    const int InputSize = 640;
    const float IouThreshold = 0.5f;
    const int MaxOpeningSightings = 120;

    static bool? hasRoomModel;

    /// <summary>True when the Open Images model (doors and windows) ships with this build.</summary>
    public static bool HasRoomModel
    {
        get
        {
            hasRoomModel ??= Resources.Load<ModelAsset>(RoomModelResourcePath) != null;
            return hasRoomModel.Value;
        }
    }

    // Turns YOLO's (centre x, centre y, width, height) rows into (x1, y1, x2, y2) for NMS.
    static readonly float[] CentersToCorners =
    {
        1, 0, 1, 0,
        0, 1, 0, 1,
        -0.5f, 0, 0.5f, 0,
        0, -0.5f, 0, 0.5f,
    };

    [SerializeField] private Camera arCamera;
    [SerializeField] private ARCameraManager cameraManager;
    [SerializeField] private float minConfidence = 0.45f;
    [Tooltip("Open Images scores run lower than COCO's; repeat sightings make up for it.")]
    [SerializeField] private float openImagesScoreThreshold = 0.2f;
    [SerializeField] private float openImagesFurnitureConfidence = 0.25f;
    [Tooltip("Pause after a detection before the next one. Each detection runs a few layers a frame, slowing " +
             "down when frames get slow, so the walk stays smooth. 4 s missed chairs walked past (client, 2026-10-29); " +
             "2.5 s still felt slow (client, 2026-11-12): the camera held 30 fps between detections.")]
    [SerializeField] private float scanIntervalSeconds = 1f;
    [Tooltip("Without depth, furniture further than this (m) isn't placed: the floor ray is too unsure there.")]
    [SerializeField] private float maxFloorRayDistance = 3.5f;
    [Tooltip("A new frame is only captured while the phone turns slower than this (degrees per second).")]
    [SerializeField] private float maxTurnDegreesPerSecond = 35f;
    [Tooltip("…and moves slower than this (metres per second). Steady frames are sharper too.")]
    [SerializeField] private float maxMoveMetresPerSecond = 0.4f;
    [Tooltip("Most model layers sent to the GPU per frame. Fewer spreads a detection over more frames, so the camera " +
             "doesn't stutter; the budget backs off by itself when frames get slow (LayersThisFrame). At 4 a detection " +
             "took 2-3 s on the Realme with frames still at 30 fps (2026-11-12).")]
    [SerializeField] private int maxLayersPerFrame = 8;

    // Padding colour around the letterboxed frame, as in YOLO training (114/255 grey).
    static readonly Color LetterboxGrey = new Color(0.447f, 0.447f, 0.447f, 1f);

    float nextScanTime;
    float lastCaptureMs;
    float lastBeginMs;
    float lastReadMs;
    ARCameraBackground cameraBackground;
    float layerBudget = 2f;
    float usualFrameSeconds = 1f / 30f;
    bool loggedMissingModel;
    int nextSuggestionId;
    bool openImages;
    float scoreThreshold;
    readonly List<AutoOpeningResolver.Sighting> openingSightings = new();

    ModelAsset modelAsset;
    Worker worker;
    Tensor<float> inputTensor;
    RenderTexture frameRt;
    RenderTexture contentRt;
    RenderTexture inputRt;
    // Where the frame sits inside the square model input (normalized): the whole frame,
    // scaled to fit, centred between grey bars.
    Vector2 contentScale = Vector2.one;
    Vector2 contentOffset = Vector2.zero;
    // Depth taken with the captured frame, to place detections at their real position and size.
    AROcclusionManager occlusion;
    Matrix4x4? latestDisplayMatrix;
    readonly ARDepthSnapshot captureDepth = new ARDepthSnapshot();
    bool ready;
    bool loadAttempted;
    IEnumerator schedule;
    Tensor<float> boxOutput;
    Tensor<int> classOutput;
    Tensor<float> scoreOutput;
    List<RawDet> completedDetections;
    float inferenceStarted;
    int inferenceFrames;
    bool discardInFlight;
    bool hasLastPose;
    Vector3 lastCameraPosition;
    Quaternion lastCameraRotation;
    float turnSpeed;
    float moveSpeed;
    Vector3 captureOrigin, captureBottomLeft, captureBottomRight, captureTopLeft;

    public bool IsAvailable => ready;

    /// <summary>Loads the model ahead of time (a short pause), e.g. while the user holds still for the floor.</summary>
    public void Preload()
    {
        if (!ready) TryLoadModel();
    }

    /// <summary>True while the phone turns or moves too fast for a sharp, cheap-to-skip frame.</summary>
    public bool IsMovingFast => turnSpeed > maxTurnDegreesPerSecond || moveSpeed > maxMoveMetresPerSecond;
    /// <summary>The loaded model knows doors and windows.</summary>
    public bool DetectsOpenings => ready && openImages;

    /// <summary>Door/window sightings since the last call (rays from where the camera was).</summary>
    public List<AutoOpeningResolver.Sighting> TakeOpeningSightings()
    {
        var taken = new List<AutoOpeningResolver.Sighting>(openingSightings);
        openingSightings.Clear();
        return taken;
    }
    public bool IsScanning => schedule != null || boxOutput != null;
    public bool HasResults => completedDetections != null;

    void Awake()
    {
        if (instance != null && instance != this)
        {
            enabled = false;
            Destroy(this);
            return;
        }
        instance = this;
        if (arCamera == null) arCamera = Camera.main;
        if (cameraManager == null) cameraManager = FindFirstObjectByType<ARCameraManager>();
        // Allocate the worker only when furniture scanning is requested.
    }

    void OnEnable()
    {
        if (cameraManager != null) cameraManager.frameReceived += OnCameraFrame;
    }

    void OnDisable()
    {
        if (cameraManager != null) cameraManager.frameReceived -= OnCameraFrame;
    }

    void OnCameraFrame(ARCameraFrameEventArgs args)
    {
        if (args.displayMatrix.HasValue) latestDisplayMatrix = args.displayMatrix;
    }

    // Explicit ADB opt-in for a bounded device smoke test, independent of room mapping.
    IEnumerator Start()
    {
#if UNITY_ANDROID && DEVELOPMENT_BUILD && !UNITY_EDITOR
        using var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
        using var activity = player.GetStatic<AndroidJavaObject>("currentActivity");
        using var intent = activity.Call<AndroidJavaObject>("getIntent");
        if (!intent.Call<bool>("getBooleanExtra", "yoloSmokeTest", false)) yield break;
        TryLoadModel();
        for (var sample = 0; sample < 3 && ready; sample++)
        {
            yield return new WaitForSecondsRealtime(8f);
            if (!TryCaptureFrame()) continue;
            BeginInference();
            while (IsScanning) yield return null;
            Debug.Log($"[ARFurnitureCocoDetector] Device smoke test {sample + 1}/3: {completedDetections?.Count ?? 0} detections.");
            completedDetections = null;
        }
#else
        yield break;
#endif
    }

    /// <summary>The model is loaded and has run once (its GPU programs are compiled).</summary>
    public bool IsWarm { get; private set; }

    /// <summary>0–1 while <see cref="WarmUpRoutine"/> runs: how much of the first run is done.</summary>
    public float WarmUpProgress { get; private set; }

    bool warming;
    int layerCount;

    /// <summary>Layers run per frame during the warm-up while frames stay quick (one when they're slow).</summary>
    const int WarmUpLayersPerQuickFrame = 4;
    const float WarmUpQuickFrameSeconds = 0.05f;
    const float WarmUpTimeoutSeconds = 120f;

    /// <summary>
    /// Loads the model and runs it once on a blank frame, a few layers per frame. The first run
    /// compiles every GPU program; done in one go it froze the phone for 11–35 s on the first scan
    /// after an install (Realme, 2026-10-24). Layer by layer, each program compiles in its own frame:
    /// the camera keeps moving and <see cref="WarmUpProgress"/> can be shown. The total time is
    /// about the same. Started by the scanner when it opens, before the walk.
    /// </summary>
    public IEnumerator WarmUpRoutine()
    {
        if (IsWarm || warming || IsScanning) yield break;
        warming = true;
        WarmUpProgress = 0f;
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var loadMs = 0.0;
        var frames = 0;
        var slowestFrame = 0f;
        // Which layers the slowest frame ran (one GPU program still took 8 s after an install,
        // 2026-10-30): the next fresh-install log says where.
        var slowestAt = "load";
        var steps = 0;
        try
        {
            // The asset is read in the background; building the model from it is the one pause left.
            if (!ready && !loadAttempted)
            {
                var request = Resources.LoadAsync<ModelAsset>(RoomModelResourcePath);
                yield return request;
            }
            var loadWatch = System.Diagnostics.Stopwatch.StartNew();
            TryLoadModel();
            loadMs = loadWatch.Elapsed.TotalMilliseconds;
            if (!ready) yield break;
            yield return null;

            var run = StartWarmUpRun();
            if (run == null) yield break;
            var more = true;
            while (more)
            {
                var perFrame = Time.unscaledDeltaTime < WarmUpQuickFrameSeconds ? WarmUpLayersPerQuickFrame : 1;
                var firstStep = steps;
                for (var i = 0; i < perFrame && more; i++)
                {
                    if (!TryStepWarmUp(run, out more)) yield break;
                    if (more) steps++;
                }
                WarmUpProgress = Mathf.Min(0.95f, steps / (float)Mathf.Max(1, layerCount));
                if (watch.Elapsed.TotalSeconds > WarmUpTimeoutSeconds)
                {
                    Debug.LogWarning("[ARFurnitureCocoDetector] Warm-up timed out; detections will finish the compiling.");
                    (run as IDisposable)?.Dispose();
                    yield break;
                }
                yield return null;
                frames++;
                if (Time.unscaledDeltaTime > slowestFrame)
                {
                    slowestFrame = Time.unscaledDeltaTime;
                    slowestAt = $"steps {firstStep}-{steps}";
                }
            }
            (run as IDisposable)?.Dispose();

            // Wait for the result without blocking, so the last programs finish compiling too.
            var output = RequestWarmUpReadback();
            while (output != null && output.count > 0 && !output.IsReadbackRequestDone()
                   && watch.Elapsed.TotalSeconds < WarmUpTimeoutSeconds)
            {
                yield return null;
                frames++;
                if (Time.unscaledDeltaTime > slowestFrame)
                {
                    slowestFrame = Time.unscaledDeltaTime;
                    slowestAt = "readback";
                }
            }
        }
        finally
        {
            warming = false;
            IsWarm = true;
            WarmUpProgress = 1f;
            Debug.Log($"[Perf] Detector warm-up took {watch.Elapsed.TotalMilliseconds:F0} ms over {frames} frames " +
                      $"(model load {loadMs:F0} ms, slowest frame {slowestFrame * 1000f:F0} ms at {slowestAt}, {layerCount} layers).");
        }
    }

    IEnumerator StartWarmUpRun()
    {
        try
        {
            TextureConverter.ToTensor(inputRt, inputTensor, default);
            return worker.ScheduleIterable(inputTensor);
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[ARFurnitureCocoDetector] Warm-up failed: {e.Message}");
            return null;
        }
    }

    static bool TryStepWarmUp(IEnumerator run, out bool more)
    {
        try
        {
            more = run.MoveNext();
            return true;
        }
        catch (Exception e)
        {
            more = false;
            Debug.LogWarning($"[ARFurnitureCocoDetector] Warm-up failed: {e.Message}");
            (run as IDisposable)?.Dispose();
            return false;
        }
    }

    Tensor<float> RequestWarmUpReadback()
    {
        try
        {
            var output = worker.PeekOutput(0) as Tensor<float>;
            if (output != null && output.count > 0) output.ReadbackRequest();
            return output;
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[ARFurnitureCocoDetector] Warm-up readback failed: {e.Message}");
            return null;
        }
    }

    void TryLoadModel()
    {
        if (ready || loadAttempted || (instance != null && instance != this)) return;
        loadAttempted = true;
        modelAsset = Resources.Load<ModelAsset>(RoomModelResourcePath);
        openImages = modelAsset != null;
        if (modelAsset == null)
            modelAsset = Resources.Load<ModelAsset>(ModelResourcePath);
        if (modelAsset == null)
            return;
        scoreThreshold = openImages ? openImagesScoreThreshold : minConfidence;

        try
        {
            var model = ModelLoader.Load(modelAsset);

            // YOLO outputs (1, 4 + classes, 8400): box centre x, centre y, width, height in input pixels,
            // then the class scores (80 for COCO, 601 for Open Images). Pick the best class per box and
            // run non-max suppression in the graph, so the worker returns only the kept boxes, their
            // class ids and their scores.
            var graph = new FunctionalGraph();
            var inputs = graph.AddInputs(model);
            var output = Functional.Forward(model, inputs)[0];
            var boxes = output[0, 0..4, ..].Transpose(0, 1);
            var classScores = output[0, 4.., ..];
            // Open Images has catch-alls ("Furniture", "House", "Building") whose big boxes would win
            // the suppression over the door or sofa inside them, so only room classes compete.
            if (openImages)
                classScores = classScores * Functional.Constant(
                    new TensorShape(RoomDetectorLabels.OpenImagesClassCount, 1), RoomDetectorLabels.OpenImagesRoomMask());
            var scores = Functional.ReduceMax(classScores, 0);
            var classIds = Functional.ArgMax(classScores, 0);
            var boxCorners = Functional.MatMul(boxes, Functional.Constant(new TensorShape(4, 4), CentersToCorners));
            var keep = Functional.NMS(boxCorners, scores, IouThreshold, scoreThreshold);

            var backend = SystemInfo.supportsComputeShaders ? BackendType.GPUCompute : BackendType.CPU;
            var compiled = graph.Compile(
                Functional.IndexSelect(boxes, 0, keep),
                Functional.IndexSelect(classIds, 0, keep),
                Functional.IndexSelect(scores, 0, keep));
            layerCount = compiled.layers.Count;
            worker = new Worker(compiled, backend);
            inputTensor = new Tensor<float>(new TensorShape(1, 3, InputSize, InputSize));
            inputRt = new RenderTexture(InputSize, InputSize, 0, RenderTextureFormat.ARGB32);
            ready = true;
            Debug.Log($"[ARFurnitureCocoDetector] {(openImages ? "Open Images room" : "COCO")} detector ready ({backend}).");
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[ARFurnitureCocoDetector] Model load failed: {e.Message}");
            ReleaseModel();
            loadAttempted = true;
        }
    }

    void OnDestroy()
    {
        ReleaseModel();
        if (instance == this) instance = null;
    }

    /// <summary>Frees the model and its textures (called on destroy; call it yourself in edit mode).</summary>
    public void ReleaseModel()
    {
        (schedule as IDisposable)?.Dispose();
        schedule = null;
        boxOutput = null;
        classOutput = null;
        scoreOutput = null;
        completedDetections = null;
        worker?.Dispose();
        worker = null;
        inputTensor?.Dispose();
        inputTensor = null;
        ReleaseTexture(frameRt);
        frameRt = null;
        ReleaseTexture(contentRt);
        contentRt = null;
        ReleaseTexture(inputRt);
        inputRt = null;
        ready = false;
        loadAttempted = false;
    }

    static void ReleaseTexture(RenderTexture rt)
    {
        if (rt == null) return;
        rt.Release();
        if (Application.isPlaying) Destroy(rt);
        else DestroyImmediate(rt);
    }

    /// <summary>
    /// Detects COCO objects in an image framed like the screen, loading the model if needed.
    /// Boxes are normalized with y down. Used by the editor photo test.
    /// </summary>
    public List<(string label, float confidence, Rect normalizedBox)> DetectInImage(Texture image)
    {
        var results = new List<(string, float, Rect)>();
        if (!ready) TryLoadModel();
        if (!ready || IsScanning || image == null) return results;

        PrepareInput(image);
        foreach (var det in RunModel())
            results.Add((det.label, det.confidence, det.normalizedBox));
        return results;
    }

    /// <summary>
    /// Run detection if model is loaded and interval elapsed. With <paramref name="requireInsideRoom"/>
    /// false (while the outline is still open) detections are kept wherever they land on the floor.
    /// Objects already in <paramref name="existing"/> are skipped; merging repeat sightings of the
    /// same object is up to the caller.
    /// </summary>
    public List<FurnitureAutoSuggestion> TryDetect(
        IReadOnlyList<Vector3> corners,
        float floorY,
        ARRaycastManager raycast,
        IReadOnlyList<RoomObstaclePayload> existing,
        bool requireInsideRoom = true)
    {
        var empty = new List<FurnitureAutoSuggestion>();
        if (instance != null && instance != this) return empty;
        if (warming) return empty;
        if (!ready) TryLoadModel();
        if (arCamera == null) arCamera = Camera.main;
        if (!ready || arCamera == null || (requireInsideRoom && (corners == null || corners.Count < 3)))
        {
            if (!ready && !loggedMissingModel)
            {
                loggedMissingModel = true;
                Debug.Log(
                    "[ARFurnitureCocoDetector] No model at Resources/ML/FurnitureDetector — " +
                    "using AR plane suggestions only. Run AR Interior ▸ Setup Furniture Detector.");
            }
            return empty;
        }

        if (completedDetections == null)
        {
            if (!IsScanning && Time.unscaledTime >= nextScanTime && !IsMovingFast)
            {
                var watch = System.Diagnostics.Stopwatch.StartNew();
                var captured = TryCaptureFrame();
                lastCaptureMs = (float)watch.Elapsed.TotalMilliseconds;
                if (captured)
                {
                    watch.Restart();
                    BeginInference();
                    lastBeginMs = (float)watch.Elapsed.TotalMilliseconds;
                }
            }
            return empty;
        }
        var placeWatch = System.Diagnostics.Stopwatch.StartNew();
        var detections = completedDetections;
        completedDetections = null;

        var results = new List<FurnitureAutoSuggestion>();
        // One note per detection saying what happened to it, so a scan log explains itself.
        var notes = new List<string>();
        var furnitureConfidence = openImages ? openImagesFurnitureConfidence : minConfidence;
        foreach (var det in detections)
        {
            var what = $"{det.label} {det.confidence:F2}";
            var opening = RoomDetectorLabels.MapOpening(det.label);
            if (opening != null)
            {
                notes.Add($"{what} {RecordOpeningSighting(det, opening)}");
                continue;
            }

            var mapped = RoomDetectorLabels.MapFurniture(det.label);
            if (mapped == null)
            {
                notes.Add($"{what} ignored (not furniture)");
                continue;
            }
            if (det.confidence < furnitureConfidence)
            {
                notes.Add($"{what} ignored (low confidence)");
                continue;
            }

            var defaultSize = RoomDetectorLabels.DefaultSize(det.label, mapped);
            Vector3 center, size;
            float yaw;
            string method;
            if (TryPlaceWithDepth(det.normalizedBox, floorY, defaultSize, out center, out size, out yaw))
            {
                method = "depth";
            }
            else if (TryPlaceOnFloor(det.normalizedBox, floorY, defaultSize.z, out center))
            {
                // Far away the ray meets the floor at a shallow angle: a little error is metres
                // (a bed landed 4.5 m from where it was). Leave it for a closer look.
                var flat = center - captureOrigin;
                flat.y = 0f;
                if (flat.magnitude > maxFloorRayDistance)
                {
                    notes.Add($"{what} dropped (too far to place without depth, {flat.magnitude:F1} m)");
                    continue;
                }

                size = defaultSize;
                yaw = FacingYaw(CaptureFlatForward());
                method = "floor ray, default size";
            }
            else
            {
                notes.Add($"{what} dropped (couldn't find where it stands)");
                continue;
            }

            if (requireInsideRoom && !RoomPolygonUtil.PointInsidePolygonXZ(center, corners))
            {
                notes.Add($"{what} dropped (outside the room)");
                continue;
            }
            // Only the same object counts: a chair under a marked table's edge is a piece of its own.
            if (ARFurniturePlaneAutoScannerOverlapsHelper.SameAsAny(center, size, yaw, existing, null))
            {
                notes.Add($"{what} dropped (already marked)");
                continue;
            }
            if (ARFurniturePlaneAutoScannerOverlapsHelper.SameAsAny(center, size, yaw, null, results))
            {
                notes.Add($"{what} dropped (same object twice in this frame)");
                continue;
            }

            nextSuggestionId += 1;
            results.Add(new FurnitureAutoSuggestion
            {
                id = $"coco-{nextSuggestionId}-{det.label}",
                type = mapped,
                label = det.label,
                center = center,
                size = size,
                yaw = yaw,
                confidence = det.confidence,
                source = "coco",
            });
            notes.Add($"{what} kept as {mapped} at ({center.x:F2}, {center.z:F2}), " +
                $"{size.x:F2} x {size.z:F2} x {size.y:F2} m, via {method}");
        }

        Debug.Log($"[ARFurnitureCocoDetector] AR scan: {detections.Count} detections, {results.Count} furniture suggestions" +
            (notes.Count > 0 ? ": " + string.Join("; ", notes) : "."));
        // Which step of a detection costs the frame it runs in (a long one is a visible freeze).
        Debug.Log($"[Perf] Detection steps: capture {lastCaptureMs:F0} ms, start {lastBeginMs:F0} ms, " +
                  $"read {lastReadMs:F0} ms, place {placeWatch.Elapsed.TotalMilliseconds:F0} ms.");
        return results;
    }

    /// <summary>
    /// Keeps a door/window as rays through its box from the captured camera pose, so it can be put
    /// on a wall once the room outline is known (even if that happens later).
    /// </summary>
    string RecordOpeningSighting(RawDet det, string kind)
    {
        if (det.confidence < RoomDetectorLabels.MinOpeningConfidence(det.label))
            return "ignored (low confidence)";
        var box = det.normalizedBox;
        // Cut off at the side: its width isn't the opening's. It'll be seen whole from elsewhere.
        if (box.xMin < 0.02f || box.xMax > 0.98f)
            return "skipped (cut off at the side of the view)";

        openingSightings.Add(new AutoOpeningResolver.Sighting
        {
            kind = kind,
            confidence = det.confidence,
            origin = captureOrigin,
            bottomLeft = CaptureRay(box.xMin, box.yMax),
            bottomRight = CaptureRay(box.xMax, box.yMax),
            bottomCenter = CaptureRay(box.center.x, box.yMax),
            topCenter = CaptureRay(box.center.x, box.yMin),
            topCut = box.yMin < 0.02f,
            bottomCut = box.yMax > 0.98f,
        });
        if (openingSightings.Count > MaxOpeningSightings)
            openingSightings.RemoveAt(0);
        return $"kept as a {kind} sighting";
    }

    /// <summary>Ray direction through a point of the captured frame (normalized, y down).</summary>
    Vector3 CaptureRay(float nx, float ny)
    {
        var vx = Mathf.Clamp01(nx);
        var vy = 1f - Mathf.Clamp01(ny);
        var point = captureBottomLeft
            + (captureBottomRight - captureBottomLeft) * vx
            + (captureTopLeft - captureBottomLeft) * vy;
        return point - captureOrigin;
    }

    /// <summary>
    /// Locates the object from the depth captured with its frame: samples points inside the box,
    /// keeps those at the object's distance (not the wall or floor around it), and measures its
    /// width and height. Only the front is visible, so depth front-to-back is at least the usual size.
    /// </summary>
    bool TryPlaceWithDepth(Rect box, float floorY, Vector3 defaultSize, out Vector3 center, out Vector3 size, out float yaw)
    {
        center = default;
        size = default;
        yaw = 0f;
        if (!captureDepth.IsValid) return false;

        const int Grid = 9;
        var points = new List<Vector3>(Grid * Grid);
        for (var gy = 0; gy < Grid; gy++)
        {
            for (var gx = 0; gx < Grid; gx++)
            {
                var nx = Mathf.Lerp(box.xMin, box.xMax, (gx + 0.5f) / Grid);
                var ny = Mathf.Lerp(box.yMin, box.yMax, (gy + 0.5f) / Grid);
                var viewport = new Vector2(Mathf.Clamp01(nx), 1f - Mathf.Clamp01(ny));
                if (captureDepth.TryWorldPoint(viewport, out var point) && point.y > floorY + 0.05f)
                    points.Add(point);
            }
        }
        if (points.Count < 15) return false;

        var origin = captureDepth.Origin;
        var forward = captureDepth.FlatForward;
        var right = Vector3.Cross(Vector3.up, forward);

        // Keep points near the median distance: the object itself, not what is behind it.
        var along = points.ConvertAll(p => Vector3.Dot(p - origin, forward));
        var medianAlong = Percentile(along, 0.5f);
        var tolerance = Mathf.Max(0.35f, 0.6f * defaultSize.z);
        var kept = points.FindAll(p => Mathf.Abs(Vector3.Dot(p - origin, forward) - medianAlong) <= tolerance);
        if (kept.Count < 10) return false;

        var across = kept.ConvertAll(p => Vector3.Dot(p - origin, right));
        var keptAlong = kept.ConvertAll(p => Vector3.Dot(p - origin, forward));
        var heights = kept.ConvertAll(p => p.y - floorY);

        var left = Percentile(across, 0.1f);
        var rightEdge = Percentile(across, 0.9f);
        var front = Percentile(keptAlong, 0.1f);
        var back = Percentile(keptAlong, 0.9f);
        var top = Percentile(heights, 0.9f);
        // A real piece of furniture rests on the floor and is a plausible height; anything else
        // means the depth didn't line up with the object, so let the floor ray place it instead.
        if (top < 0.2f || top > 2.5f) return false;

        var width = Mathf.Clamp(rightEdge - left, 0.5f * defaultSize.x, 1.8f * defaultSize.x);
        var depth = Mathf.Clamp(Mathf.Max(back - front, defaultSize.z), 0.5f * defaultSize.z, 1.8f * defaultSize.z);
        var height = Mathf.Clamp(top, 0.4f * defaultSize.y, 1.8f * defaultSize.y);

        center = origin + right * ((left + rightEdge) * 0.5f) + forward * (front + depth * 0.5f);
        center.y = floorY;
        size = new Vector3(width, height, depth);
        yaw = FacingYaw(forward);
        return true;
    }

    /// <summary>
    /// The object's centre on the floor, from where the bottom-centre of its box meets the floor (the
    /// captured camera pose). That point is the object's front, the side facing the phone, so the
    /// centre is half its depth further on: used as the centre, every piece found without depth sat
    /// a quarter to half a metre too close in the room and on the plan (2026-11-12).
    /// </summary>
    bool TryPlaceOnFloor(Rect box, float floorY, float depth, out Vector3 center)
    {
        // A current screen ray would drift if the phone moved during inference.
        var viewportX = Mathf.Clamp01(box.center.x);
        var viewportY = 1f - Mathf.Clamp01(box.yMax);
        var contact = captureBottomLeft
            + (captureBottomRight - captureBottomLeft) * viewportX
            + (captureTopLeft - captureBottomLeft) * viewportY;
        if (!TryProjectToFloor(new Ray(captureOrigin, contact - captureOrigin), floorY, out center))
            return false;
        var away = center - captureOrigin;
        away.y = 0f;
        if (away.sqrMagnitude > 1e-6f)
            center += away.normalized * Mathf.Max(0f, depth) * 0.5f;
        center.y = floorY;
        return true;
    }

    Vector3 CaptureFlatForward()
    {
        var middle = captureBottomLeft + (captureBottomRight - captureBottomLeft) * 0.5f
            + (captureTopLeft - captureBottomLeft) * 0.5f;
        var flat = middle - captureOrigin;
        flat.y = 0f;
        return flat.sqrMagnitude > 1e-6f ? flat.normalized : Vector3.forward;
    }

    /// <summary>Yaw that lines the footprint's width up across the view (front facing the camera).</summary>
    static float FacingYaw(Vector3 flatForward) => Mathf.Atan2(flatForward.x, flatForward.z) * Mathf.Rad2Deg;

    static float Percentile(List<float> values, float fraction)
    {
        var sorted = new List<float>(values);
        sorted.Sort();
        var index = Mathf.Clamp(Mathf.RoundToInt(fraction * (sorted.Count - 1)), 0, sorted.Count - 1);
        return sorted[index];
    }

    struct RawDet
    {
        public string label;
        public float confidence;
        public Rect normalizedBox;
    }

    bool TryCaptureFrame()
    {
        var previousTarget = arCamera.targetTexture;
        try
        {
            var w = arCamera.pixelWidth;
            var h = arCamera.pixelHeight;
            if (w <= 0 || h <= 0)
                return false;

            // AR Foundation sets the camera's projection from the screen, so render at the screen's
            // aspect (short side = model input) to keep the view undistorted.
            var shortSide = Mathf.Min(w, h);
            var frameW = Mathf.RoundToInt(w * (float)InputSize / shortSide);
            var frameH = Mathf.RoundToInt(h * (float)InputSize / shortSide);
            if (frameRt == null || frameRt.width != frameW || frameRt.height != frameH)
            {
                ReleaseTexture(frameRt);
                frameRt = new RenderTexture(frameW, frameH, 24, RenderTextureFormat.ARGB32);
            }

            captureOrigin = arCamera.transform.position;
            captureBottomLeft = arCamera.ViewportToWorldPoint(new Vector3(0, 0, arCamera.nearClipPlane));
            captureBottomRight = arCamera.ViewportToWorldPoint(new Vector3(1, 0, arCamera.nearClipPlane));
            captureTopLeft = arCamera.ViewportToWorldPoint(new Vector3(0, 1, arCamera.nearClipPlane));

            // Copy just the camera image, as the screen shows it: far cheaper than rendering the
            // whole scene a second time, and the scan's own walls and labels stay out of what the
            // model looks at. Without the background material, render the camera as before.
            if (cameraBackground == null) cameraBackground = arCamera.GetComponent<ARCameraBackground>();
            var backgroundMaterial = cameraBackground != null && cameraBackground.enabled ? cameraBackground.material : null;
            if (backgroundMaterial != null)
            {
                Graphics.Blit(null, frameRt, backgroundMaterial);
            }
            else
            {
                arCamera.targetTexture = frameRt;
                arCamera.Render();
                arCamera.targetTexture = previousTarget;
            }

            // Depth for the same moment, so detections can be placed after the phone has moved on.
            if (occlusion == null && cameraManager != null)
                occlusion = ARDepthSnapshot.EnsureDepth(cameraManager.gameObject);
            captureDepth.TryCapture(occlusion, latestDisplayMatrix, arCamera);

            PrepareInput(frameRt);
            return true;
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[ARFurnitureCocoDetector] Frame capture failed: {e.Message}");
            return false;
        }
        finally
        {
            arCamera.targetTexture = previousTarget;
        }
    }

    public static bool TryProjectToFloor(Ray ray, float floorY, out Vector3 point)
    {
        point = default;
        if (ray.direction.y >= -0.001f) return false;
        var distance = (floorY - ray.origin.y) / ray.direction.y;
        if (distance <= 0 || distance > 15f || !float.IsFinite(distance)) return false;
        point = ray.GetPoint(distance);
        return true;
    }

    void BeginInference()
    {
        try
        {
            TextureConverter.ToTensor(inputRt, inputTensor, default);
            inferenceStarted = Time.unscaledTime;
            inferenceFrames = 0;
            discardInFlight = false;
            schedule = worker.ScheduleIterable(inputTensor);
        }
        catch (Exception e)
        {
            OnInferenceFailed(e);
        }
    }

    /// <summary>
    /// How many model layers to run this frame. Each layer is GPU work on top of the AR camera, so
    /// when frames get slower than the phone's usual pace the detector backs off (down to one layer a
    /// frame, and one while the phone turns), and creeps back up while frames stay quick. Detection
    /// then takes a little longer instead of the scan stuttering.
    /// </summary>
    int LayersThisFrame()
    {
        var dt = Time.unscaledDeltaTime;
        if (warming) return 0;
        if (!IsScanning)
        {
            // The phone's usual frame time, learned while the detector is idle.
            if (dt > 0f && dt < 0.2f) usualFrameSeconds = Mathf.Lerp(usualFrameSeconds, dt, 0.05f);
            return 0;
        }

        if (dt > usualFrameSeconds * 1.3f + 0.004f)
            layerBudget = Mathf.Max(1f, layerBudget - 1f);
        else if (dt < usualFrameSeconds * 1.1f)
            layerBudget = Mathf.Min(maxLayersPerFrame, layerBudget + 0.25f);

        return IsMovingFast ? 1 : Mathf.Max(1, Mathf.FloorToInt(layerBudget));
    }

    void Update()
    {
        TrackCameraMotion();
        var layersThisFrame = LayersThisFrame();
        if (!IsScanning) return;
        inferenceFrames++;
        try
        {
            if (Time.unscaledTime - inferenceStarted > 60f)
                throw new TimeoutException("Furniture detection timed out.");
            if (schedule != null)
            {
                // Spread the model over frames a few layers at a time, so the GPU work of one
                // detection doesn't land in one frame (a visible camera stutter). Never wait for output.
                for (var layers = 0; layers < layersThisFrame; layers++)
                {
                    if (schedule.MoveNext()) continue;
                    (schedule as IDisposable)?.Dispose();
                    schedule = null;
                    boxOutput = worker.PeekOutput(0) as Tensor<float>;
                    classOutput = worker.PeekOutput(1) as Tensor<int>;
                    scoreOutput = worker.PeekOutput(2) as Tensor<float>;
                    if (boxOutput == null || classOutput == null || scoreOutput == null)
                        throw new InvalidOperationException("Unexpected furniture model outputs.");
                    boxOutput.ReadbackRequest();
                    classOutput.ReadbackRequest();
                    scoreOutput.ReadbackRequest();
                    break;
                }
            }
            if (schedule != null || boxOutput == null) return;
            if (boxOutput.count > 0 && (!boxOutput.IsReadbackRequestDone()
                || !classOutput.IsReadbackRequestDone() || !scoreOutput.IsReadbackRequestDone())) return;
            var readWatch = System.Diagnostics.Stopwatch.StartNew();
            completedDetections = ReadDetections(boxOutput, classOutput, scoreOutput);
            lastReadMs = (float)readWatch.Elapsed.TotalMilliseconds;
            Debug.Log($"[Perf] Detection took {(Time.unscaledTime - inferenceStarted) * 1000f:F0} ms over {inferenceFrames} frames " +
                      $"(layers/frame now {layerBudget:F1}, usual frame {usualFrameSeconds * 1000f:F0} ms).");
            if (discardInFlight) completedDetections = null;
            failedRunsInARow = 0;
            boxOutput = null;
            classOutput = null;
            scoreOutput = null;
            nextScanTime = Time.unscaledTime + scanIntervalSeconds;
        }
        catch (Exception e)
        {
            OnInferenceFailed(e);
        }
    }

    /// <summary>A run failed one after another this many times: the detector is switched off for the scan.</summary>
    const int MaxFailedRunsInARow = 3;
    int failedRunsInARow;

    /// <summary>
    /// One failed run is dropped and the next one tries again. Switching the detector off at the
    /// first failure ended furniture detection for the rest of the scan, and one run failed early in
    /// every scan on the phone (2026-10-24, "Cannot access the data as it is not available").
    /// </summary>
    void OnInferenceFailed(Exception e)
    {
        failedRunsInARow++;
        // The type and where it was thrown: the phone's logs have Unity stack traces turned off.
        Debug.LogWarning($"[ARFurnitureCocoDetector] Inference failed ({failedRunsInARow} in a row): " +
                         $"{e.GetType().Name}: {e.Message}\n{e.StackTrace}");
        if (failedRunsInARow >= MaxFailedRunsInARow)
        {
            ReleaseModel();
            loadAttempted = true;
            return;
        }

        (schedule as IDisposable)?.Dispose();
        schedule = null;
        boxOutput = null;
        classOutput = null;
        scoreOutput = null;
        nextScanTime = Time.unscaledTime + scanIntervalSeconds;
    }

    /// <summary>Smoothed camera speed (same idea as <see cref="ARScanGuidance"/>), to skip blurry frames.</summary>
    void TrackCameraMotion()
    {
        if (arCamera == null) return;
        var t = arCamera.transform;
        var dt = Time.unscaledDeltaTime;
        if (hasLastPose && dt > 1e-4f)
        {
            var k = 1f - Mathf.Exp(-dt / 0.25f);
            turnSpeed = Mathf.Lerp(turnSpeed, Quaternion.Angle(lastCameraRotation, t.rotation) / dt, k);
            moveSpeed = Mathf.Lerp(moveSpeed, Vector3.Distance(lastCameraPosition, t.position) / dt, k);
        }

        lastCameraRotation = t.rotation;
        lastCameraPosition = t.position;
        hasLastPose = true;
    }

    public void DiscardResults()
    {
        completedDetections = null;
        discardInFlight = IsScanning;
    }

    // The model sees the whole frame, scaled to fit its square input with grey bars on the
    // short sides (letterboxing), so furniture near the screen edges is detected too.
    void PrepareInput(Texture frame)
    {
        if (SystemInfo.copyTextureSupport == UnityEngine.Rendering.CopyTextureSupport.None)
        {
            // No GPU texture copies: fall back to the centred square of the frame.
            var shortSide = (float)Mathf.Min(frame.width, frame.height);
            var cropScale = new Vector2(shortSide / frame.width, shortSide / frame.height);
            var cropOffset = (Vector2.one - cropScale) * 0.5f;
            Graphics.Blit(frame, inputRt, cropScale, cropOffset);
            // Input covers only part of the frame: input = (screen - offset) / scale.
            contentScale = new Vector2(1f / cropScale.x, 1f / cropScale.y);
            contentOffset = new Vector2(-cropOffset.x / cropScale.x, -cropOffset.y / cropScale.y);
            return;
        }

        var fit = Mathf.Min((float)InputSize / frame.width, (float)InputSize / frame.height);
        var contentW = Mathf.Clamp(Mathf.RoundToInt(frame.width * fit), 1, InputSize);
        var contentH = Mathf.Clamp(Mathf.RoundToInt(frame.height * fit), 1, InputSize);
        if (contentRt == null || contentRt.width != contentW || contentRt.height != contentH)
        {
            ReleaseTexture(contentRt);
            contentRt = new RenderTexture(contentW, contentH, 0, RenderTextureFormat.ARGB32);
        }
        Graphics.Blit(frame, contentRt);
        if (!inputRt.IsCreated()) inputRt.Create();

        var previous = RenderTexture.active;
        RenderTexture.active = inputRt;
        GL.Clear(false, true, LetterboxGrey);
        RenderTexture.active = previous;

        var padX = (InputSize - contentW) / 2;
        var padY = (InputSize - contentH) / 2;
        Graphics.CopyTexture(contentRt, 0, 0, 0, 0, contentW, contentH, inputRt, 0, 0, padX, padY);
        contentScale = new Vector2((float)contentW / InputSize, (float)contentH / InputSize);
        contentOffset = new Vector2((float)padX / InputSize, (float)padY / InputSize);
    }

    List<RawDet> RunModel()
    {
        TextureConverter.ToTensor(inputRt, inputTensor, default);
        worker.Schedule(inputTensor);

        if (worker.PeekOutput(0) is not Tensor<float> boxOutput
            || worker.PeekOutput(1) is not Tensor<int> classOutput
            || worker.PeekOutput(2) is not Tensor<float> scoreOutput)
            return new List<RawDet>();

        return ReadDetections(boxOutput, classOutput, scoreOutput);
    }

    List<RawDet> ReadDetections(Tensor<float> boxOutput, Tensor<int> classOutput, Tensor<float> scoreOutput)
    {
        var list = new List<RawDet>();

        using var boxes = boxOutput.ReadbackAndClone();
        using var classIds = classOutput.ReadbackAndClone();
        using var scores = scoreOutput.ReadbackAndClone();

        for (var n = 0; n < boxes.shape[0]; n++)
        {
            var score = scores[n];
            if (score < scoreThreshold) continue;
            var label = RoomDetectorLabels.ClassName(openImages, classIds[n]);
            if (label == null) continue;

            // Boxes are in input pixels with y down; map them back to the whole screen (normalized, y down).
            // The padding is symmetric, so it doesn't matter which way up the input was stored.
            var width = boxes[n, 2] / InputSize / contentScale.x;
            var height = boxes[n, 3] / InputSize / contentScale.y;
            var centerX = (boxes[n, 0] / InputSize - contentOffset.x) / contentScale.x;
            var centerY = (boxes[n, 1] / InputSize - contentOffset.y) / contentScale.y;
            list.Add(new RawDet
            {
                label = label,
                confidence = score,
                normalizedBox = new Rect(centerX - width * 0.5f, centerY - height * 0.5f, width, height),
            });
            if (RoomDetectorLabels.MapFurniture(label) != null || RoomDetectorLabels.MapOpening(label) != null)
                Debug.Log($"[ARFurnitureCocoDetector] Detected {label}, confidence {score:F2}.");
        }

        Debug.Log($"[ARFurnitureCocoDetector] Inference completed: {list.Count} labeled detections.");
        return list;
    }

}

/// <summary>Shared overlap check for plane + coco scanners.</summary>
public static class ARFurniturePlaneAutoScannerOverlapsHelper
{
    /// <summary>The box is the same object as one in either list (see <see cref="FurnitureMatch.SameObject(Vector3, Vector3, float, Vector3, Vector3, float)"/>).</summary>
    public static bool SameAsAny(
        Vector3 center,
        Vector3 size,
        float yaw,
        IReadOnlyList<RoomObstaclePayload> existing,
        IReadOnlyList<FurnitureAutoSuggestion> pending)
    {
        if (existing != null)
        {
            foreach (var ob in existing)
            {
                if (ob?.center == null || ob.size == null) continue;
                if (FurnitureMatch.SameObject(center, size, yaw,
                    new Vector3(ob.center.x, ob.center.y, ob.center.z),
                    new Vector3(ob.size.x, ob.size.y, ob.size.z), ob.yaw)) return true;
            }
        }

        if (pending == null) return false;
        foreach (var s in pending)
        {
            if (FurnitureMatch.SameObject(center, size, yaw, s.center, s.size, s.yaw)) return true;
        }

        return false;
    }

    public static bool Overlaps(
        Vector3 center,
        Vector3 size,
        IReadOnlyList<RoomObstaclePayload> existing,
        IReadOnlyList<FurnitureAutoSuggestion> pending,
        float yaw = 0f)
    {
        if (existing != null)
        {
            foreach (var ob in existing)
            {
                if (ob != null && FootprintsOverlap(center, size, yaw,
                    new Vector3(ob.center.x, ob.center.y, ob.center.z),
                    new Vector3(ob.size.x, ob.size.y, ob.size.z), ob.yaw)) return true;
            }
        }

        if (pending == null) return false;
        foreach (var s in pending)
        {
            if (FootprintsOverlap(center, size, yaw, s.center, s.size, s.yaw)) return true;
        }

        return false;
    }

    public static bool FootprintsOverlap(Vector3 a, Vector3 aSize, float aYaw, Vector3 b, Vector3 bSize, float bYaw)
    {
        var aRotation = Quaternion.Euler(0, aYaw, 0);
        var bRotation = Quaternion.Euler(0, bYaw, 0);
        var ax = aRotation * Vector3.right;
        var az = aRotation * Vector3.forward;
        var bx = bRotation * Vector3.right;
        var bz = bRotation * Vector3.forward;
        var delta = b - a;
        delta.y = 0;
        // Separating-axis test includes each actual footprint and its rotation.
        foreach (var axis in new[] { ax, az, bx, bz })
        {
            var aRadius = Mathf.Abs(Vector3.Dot(ax, axis)) * Mathf.Abs(aSize.x) * 0.5f
                + Mathf.Abs(Vector3.Dot(az, axis)) * Mathf.Abs(aSize.z) * 0.5f;
            var bRadius = Mathf.Abs(Vector3.Dot(bx, axis)) * Mathf.Abs(bSize.x) * 0.5f
                + Mathf.Abs(Vector3.Dot(bz, axis)) * Mathf.Abs(bSize.z) * 0.5f;
            if (Mathf.Abs(Vector3.Dot(delta, axis)) >= aRadius + bRadius + 0.03f) return false;
        }
        return true;
    }
}

/// <summary>
/// Class names for both detector models, and what they mean for the room: furniture types
/// (obstacles for the layout planner) or doors and windows.
/// </summary>
public static class RoomDetectorLabels
{
    public const int OpenImagesClassCount = 601;

    static readonly string[] CocoNames =
    {
        "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
        "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
        "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
        "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
        "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
        "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
        "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
        "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
        "scissors", "teddy bear", "hair drier", "toothbrush",
    };

    /// <summary>
    /// Open Images V7 class ids (Ultralytics yolov8*-oiv7 order) for the classes a room scan uses.
    /// Every other class is masked out of the model's scores.
    /// </summary>
    static readonly Dictionary<int, string> OpenImagesRoomClasses = new()
    {
        { 164, "Door" }, { 587, "Window" }, { 588, "Window blind" }, { 148, "Curtain" },
        { 136, "Couch" }, { 477, "Sofa bed" }, { 499, "Studio couch" }, { 317, "Loveseat" },
        { 34, "Bed" }, { 104, "Chair" }, { 494, "Stool" }, { 41, "Bench" },
        { 514, "Table" }, { 122, "Coffee table" }, { 290, "Kitchen & dining room table" }, { 153, "Desk" },
        { 574, "Wardrobe" }, { 147, "Cupboard" }, { 77, "Cabinetry" }, { 107, "Chest of drawers" },
        { 189, "Filing cabinet" }, { 55, "Bookcase" }, { 453, "Shelf" }, { 352, "Nightstand" },
        { 527, "Television" }, { 419, "Refrigerator" }, { 258, "Houseplant" },
    };

    public static string ClassName(bool openImages, int classId)
    {
        if (openImages)
            return OpenImagesRoomClasses.TryGetValue(classId, out var name) ? name : null;
        return classId >= 0 && classId < CocoNames.Length ? CocoNames[classId] : null;
    }

    /// <summary>1 for room classes, 0 for the rest (shape: classes × 1).</summary>
    public static float[] OpenImagesRoomMask()
    {
        var mask = new float[OpenImagesClassCount];
        foreach (var id in OpenImagesRoomClasses.Keys)
            mask[id] = 1f;
        return mask;
    }

    /// <summary>"door" | "window" for an opening, otherwise null. Blinds and curtains hang over windows.</summary>
    public static string MapOpening(string label) => label?.ToLowerInvariant() switch
    {
        "door" => "door",
        "window" or "window blind" or "curtain" => "window",
        _ => null,
    };

    /// <summary>A curtain is weaker evidence of a window than the window itself.</summary>
    public static float MinOpeningConfidence(string label) => label?.ToLowerInvariant() switch
    {
        "door" => 0.2f,
        "curtain" => 0.35f,
        _ => 0.25f,
    };

    /// <summary>The layout planner's obstacle type for a detected class, or null when it isn't furniture.</summary>
    public static string MapFurniture(string label)
    {
        if (string.IsNullOrEmpty(label)) return null;
        return label.ToLowerInvariant() switch
        {
            "couch" or "sofa bed" or "studio couch" or "loveseat" => "sofa",
            "bed" => "bed",
            "chair" or "stool" or "bench" => "chair",
            "table" or "dining table" or "coffee table" or "kitchen & dining room table" => "table",
            "desk" => "desk",
            "wardrobe" or "cupboard" => "wardrobe",
            "cabinetry" or "chest of drawers" or "filing cabinet" or "bookcase" or "shelf" or "nightstand"
                or "refrigerator" or "television" or "tv" or "houseplant" or "potted plant" => "other",
            _ => null,
        };
    }

    /// <summary>Typical footprint (width, height, depth) when depth can't measure it.</summary>
    public static Vector3 DefaultSize(string label, string obstacleType) => label?.ToLowerInvariant() switch
    {
        "loveseat" => new Vector3(1.5f, 0.85f, 0.9f),
        "stool" => new Vector3(0.4f, 0.6f, 0.4f),
        "bench" => new Vector3(1.2f, 0.45f, 0.4f),
        "coffee table" => new Vector3(1.0f, 0.45f, 0.6f),
        "nightstand" => new Vector3(0.5f, 0.55f, 0.4f),
        "chest of drawers" => new Vector3(0.9f, 1.0f, 0.5f),
        "cabinetry" => new Vector3(1.0f, 0.9f, 0.5f),
        "filing cabinet" => new Vector3(0.5f, 1.0f, 0.6f),
        "bookcase" => new Vector3(0.8f, 1.8f, 0.35f),
        "shelf" => new Vector3(0.8f, 1.5f, 0.35f),
        "refrigerator" => new Vector3(0.7f, 1.7f, 0.7f),
        "houseplant" or "potted plant" => new Vector3(0.4f, 0.8f, 0.4f),
        _ => DefaultSize(obstacleType),
    };

    public static Vector3 DefaultSize(string obstacleType) => obstacleType switch
    {
        "bed" => new Vector3(1.6f, 0.5f, 2.1f),
        "desk" => new Vector3(1.2f, 0.75f, 0.6f),
        "table" => new Vector3(1.1f, 0.75f, 0.75f),
        "chair" => new Vector3(0.5f, 0.9f, 0.5f),
        "wardrobe" => new Vector3(1.8f, 2f, 0.6f),
        "sofa" => new Vector3(2f, 0.85f, 0.95f),
        _ => new Vector3(1f, 0.8f, 1f),
    };
}
