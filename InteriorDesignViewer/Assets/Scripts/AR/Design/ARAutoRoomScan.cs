using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

/// <summary>
/// Automatic room scan on top of the manual corner scan (<see cref="ARDesignCornerRoomBuilder"/>):
///   Floor  — the base point sets itself when the reticle holds still on the floor.
///   Height — locks itself when the live height holds steady while aiming up.
///   Walls  — ARCore's vertical planes become walls (<see cref="AutoWallGeometry"/>), kept steady
///            between rounds by <see cref="AutoWallTracker"/>; where two
///            walls meet is a corner. A wall end with no corner gets an orange marker, and
///            holding the aim there (or tapping) places the corner by hand.
/// Start/Finish, taps, Undo and Rescan keep working the whole time, and the whole thing can be
/// switched off (remembered per device). Nothing sets itself while ARCore isn't tracking well
/// (the points would land in the wrong place) or while the HUD pauses it. Walls found so far are
/// drawn as see-through panels. Each scan's numbers — corners found vs. placed by hand,
/// time per step — go to logcat ("[AutoScanStats]") and persistentDataPath/auto-scan-stats.jsonl.
/// </summary>
[DefaultExecutionOrder(-120)]
public class ARAutoRoomScan : MonoBehaviour
{
    public enum Step
    {
        Off,
        Floor,
        Height,
        Walls,
        Closed,
    }

    /// <summary>Something the user should hear about (the HUD shows a short note and buzzes).</summary>
    public enum Note
    {
        CornerFound,
        CornerAdded,
        CornerRemoved,
        OutlineComplete,
        /// <summary>A tap while tracking was lost: it would have landed in the wrong place.</summary>
        TapIgnored,
        /// <summary>A tap on a corner: taps only add, pressing and holding removes.</summary>
        HoldToRemove,
    }

    // New key: phones from before Auto went off by default kept "on" under "arAutoScanEnabled",
    // so they never got the corner-by-corner flow.
    const string EnabledPrefKey = "arAutoScanEnabledV2";
    const string StatsFileName = "auto-scan-stats.jsonl";

    [Header("Holding still")]
    [Tooltip("The floor point (corner 1) sets itself after the dot is held still this long. At 0.8 s it " +
             "set itself on the way to the corner (5 times in one scan); tapping sets it at once.")]
    [SerializeField] private float floorHoldSeconds = 2f;
    [SerializeField] private float floorHoldRadius = 0.05f;
    [Tooltip("Seconds the live height must stay put (see ScanHeightFilter) before it locks itself.")]
    [SerializeField] private float heightHoldSeconds = 1.2f;
    [Tooltip("The height only locks itself above this (lower readings are furniture or mid-wall).")]
    [SerializeField] private float minAutoHeight = 1.8f;
    [Tooltip("…nor above this: a reading this high is ARCore drifting (in a dim room it locked 5.00 m, " +
             "the builder's cap). A really high ceiling is still confirmed with a tap.")]
    [SerializeField] private float maxAutoHeight = 3.5f;
    [Tooltip("Camera forward.y needed before the height locks itself (looking up).")]
    [SerializeField] private float minLookUp = 0.35f;
    [SerializeField] private float cornerHoldSeconds = 1.2f;
    [SerializeField] private float cornerHoldRadius = 0.45f;
    [SerializeField] private float cornerHoldDrift = 0.12f;
    [SerializeField] private float cornerHoldLineTolerance = 0.35f;

    [Header("Walls")]
    [SerializeField] private float evaluateInterval = 0.25f;
    [Tooltip("Narrower vertical planes are ignored (door frames, table legs).")]
    [SerializeField] private float minPieceWidth = 0.3f;
    [Tooltip("A wall plane must reach at least this high above the floor (sofa backs and tables don't).")]
    [SerializeField] private float minWallTopAboveFloor = 1.2f;
    [SerializeField] private float minTargetWallLength = 0.8f;
    [Tooltip("A corner must be found this many times in a row before it joins the outline.")]
    [SerializeField] private int confirmAfterEvaluations = 3;
    [SerializeField] private int dropAfterMisses = 6;
    [Tooltip("A corner already in the outline goes only after this many rounds unseen (20 = 5 s). After " +
             "1.5 s, found corners flickered in and out while ARCore re-fitted the walls on the phone.")]
    [SerializeField] private int dropConfirmedAfterMisses = 20;
    [SerializeField] private float cornerMatchDistance = 0.3f;
    [SerializeField] private float removeTapRadius = 0.3f;
    [SerializeField] private float suppressRadius = 0.35f;
    [Tooltip("With three corners or more, a tap this close to corner 1 (the floor point) closes the room, " +
             "as by hand, and holding still there adds no corner. On the phone, coming back to corner 1 " +
             "added a fifth corner beside it again and again.")]
    [SerializeField] private float closeTapRadius = 0.5f;
    [Tooltip("A corner placed by hand this close to a blue wall line goes onto it; further away it stays " +
             "where the user aimed (the detected wall can be off the real one).")]
    [SerializeField] private float tapSnapToWall = 0.08f;

    [Header("Help after (seconds)")]
    [SerializeField] private float heightHelpSeconds = 8f;
    [SerializeField] private float stuckHelpSeconds = 8f;

    [Header("Look")]
    [SerializeField] private Color wallColor = new(0.45f, 0.78f, 1f, 0.95f);
    [Tooltip("See-through fill for each wall found so far (floor to the measured height).")]
    [SerializeField] private Color wallPanelColor = new(0.45f, 0.78f, 1f, 0.07f);
    [SerializeField] private Color targetColor = new(1f, 0.55f, 0.15f, 1f);

    sealed class TrackedCorner
    {
        public int id;
        public Vector2 point;
        public AutoWallGeometry.Corner geo;
        public int seen;
        public int misses;
        public bool matched;
        public bool confirmed;
    }

    struct HistoryEntry
    {
        public bool auto;
        public int autoId;
        public Vector2 placed;
    }

    [Serializable]
    sealed class AutoScanStats
    {
        public string startedAt;
        public string device;
        public string outcome;
        public bool floorAuto;
        public bool heightAuto;
        public float heightM;
        public float floorSeconds;
        public float heightSeconds;
        public float wallsSeconds;
        public float totalSeconds;
        public int cornersFinal;
        public int cornersFinalAuto;
        public int cornersFinalByHand;
        public int cornersAutoFound;
        public int cornersHeld;
        public int cornersTapped;
        public int cornersRemoved;
        public int undos;
        public int backToStart;
        public int modeSwitches;
        public int maxWalls;
        public int maxVerticalPlanes;
        public int openEndsAtClose;
        public float roomWidthM;
        public float roomDepthM;
        public float floorAreaM2;
    }

    RoomScanController scanController;
    ARDesignCornerRoomBuilder builder;
    ARPlaneManager planeManager;
    ARPlacementIndicator indicator;
    Camera arCamera;

    readonly AutoWallGeometry.Settings settings = AutoWallGeometry.Settings.Default;
    readonly List<AutoWallGeometry.WallPiece> pieces = new();
    readonly List<TrackedCorner> tracked = new();
    readonly List<Vector2> placed = new();
    /// <summary>Corners in <see cref="placed"/> that were found from the walls (and locked), not placed by hand.</summary>
    readonly List<Vector2> locked = new();
    readonly List<Vector2> suppressed = new();
    readonly List<HistoryEntry> history = new();
    readonly List<AutoWallGeometry.Corner> outlineCorners = new();
    readonly List<AutoWallGeometry.Corner> closingCorners = new();
    readonly List<Vector2> extraPoints = new();
    readonly List<Vector3> lastPushed = new();
    readonly List<LineRenderer> wallLines = new();
    readonly List<MeshFilter> wallPanels = new();
    readonly List<Note> pendingNotes = new();
    List<AutoWallGeometry.Wall> walls = new();
    readonly AutoWallTracker wallTracker = new(AutoWallTracker.Settings.Default);
    /// <summary>A wall not seen just now is still drawn when it's at least this long (m).</summary>
    const float ShownRememberedWallLength = 1.5f;
    List<AutoWallGeometry.OpenEnd> openEnds = new();
    bool[] innerWalls = Array.Empty<bool>();

    readonly ScanFloorAim.Settings aimSettings = ScanFloorAim.Settings.Default;
    readonly List<AutoWallGeometry.WallPiece> aimPieces = new();
    readonly List<Vector2> aimCorners = new();
    List<AutoWallGeometry.Wall> aimWalls = new();
    float nextAimRefreshAt;

    Transform root;
    Material wallMaterial;
    Material wallPanelMaterial;
    Material targetMaterial;
    LineRenderer targetRing;
    LineRenderer targetPole;
    int targetWall = -1;
    int targetEnd = -1;
    int nextCornerId = 1;
    float nextEvaluateAt;
    float stepStartedAt;
    float lastProgressAt;
    float nextLogAt;
    float nextPushAt;
    int lastWallCount;
    int lastCornerCount;
    bool wasComplete;
    bool holdPaused;
    /// <summary>Last time anything was paused: a hold only counts from then on.</summary>
    float pausedAt = float.NegativeInfinity;
    Vector2 centerSum;
    int centerSamples;

    bool dwellRunning;
    float dwellStartedAt;
    Vector3 dwellAnchor;

    /// <summary>
    /// The floor point just undone. It doesn't set itself there again until the aim has moved off it:
    /// the phone was still aimed at the same spot, so 0.8 s later it came straight back and Undo
    /// looked broken (12 trips back to the floor step in one scan on the phone).
    /// </summary>
    Vector3 lastFloorPoint;
    bool floorWaitsToMoveOff;
    const float FloorMoveOffDistance = 0.3f;

    /// <summary>Corner 1 (the floor point) while it's in the outline: a tap back there closes the room.</summary>
    Vector2 startCorner;
    bool hasStartCorner;

    AutoScanStats stats;
    float sessionStartedAt;
    float floorSetAt;
    float heightSetAt;
    float closedAt;

    public bool Enabled { get; private set; }

    /// <summary>
    /// Corners can be aimed at on the ceiling: the height was measured (not skipped), so the
    /// ceiling is known, and the outline is still open.
    /// </summary>
    public bool CeilingAimAvailable =>
        builder != null && builder.IsHeightLocked && builder.HeightWasMeasured && !builder.IsLoopClosed;

    /// <summary>The aim is on the ceiling right now (the floor point is the spot straight below).</summary>
    public bool AimFromCeiling => Time.frameCount - ceilingAimFrame <= 1;

    /// <summary>Where the aim meets the ceiling while <see cref="AimFromCeiling"/>.</summary>
    public Vector3 CeilingAimPoint { get; private set; }

    int ceilingAimFrame = -10;
    LineRenderer ceilingDrop;
    /// <summary>
    /// Enough floor has been found (the scan's floor dots have turned green). The floor point only
    /// sets itself after that, so it isn't taken from the first small patch ARCore sees.
    /// </summary>
    public bool FloorReady { get; set; } = true;
    public Step CurrentStep { get; private set; } = Step.Off;
    public bool IsActive => Enabled && CurrentStep != Step.Off && CurrentStep != Step.Closed;
    /// <summary>0–1 while holding still for something to set itself.</summary>
    public float DwellProgress { get; private set; }
    public bool HasDwellPoint { get; private set; }
    /// <summary>World point the hold ring is drawn around.</summary>
    public Vector3 DwellPoint { get; private set; }
    /// <summary>A wall end still missing its corner, the one most in front of the camera.</summary>
    public bool HasTarget { get; private set; }
    public Vector3 TargetPoint { get; private set; }
    public int WallCount { get; private set; }
    public int CornerCount { get; private set; }
    public int OpenEndCount { get; private set; }
    public bool OutlineLooksComplete => CornerCount >= RoomPolygonUtil.MinCorners && OpenEndCount == 0;
    public bool CanUndo => history.Count > 0;
    public bool HasCorners => placed.Count > 0 || tracked.Exists(t => t.confirmed);
    public bool NeedsHeightHelp => CurrentStep == Step.Height && Time.unscaledTime - stepStartedAt >= heightHelpSeconds;
    public bool NeedsWallHelp =>
        CurrentStep == Step.Walls && !OutlineLooksComplete && Time.unscaledTime - lastProgressAt >= stuckHelpSeconds;

    /// <summary>ARCore is fully tracking (not starting up, relocalising or short of light or detail).</summary>
    public static bool IsTrackingWell =>
        ARSession.state == ARSessionState.SessionTracking && ARSession.notTrackingReason == NotTrackingReason.None;

    /// <summary>Nothing sets itself right now: tracking isn't good, or the HUD paused it (help card open).</summary>
    public bool IsPaused => holdPaused || !IsTrackingWell;

    /// <summary>Walls found so far (floor-plan lines). Use <see cref="IsRoomWall"/> to skip furniture fronts and slivers.</summary>
    public IReadOnlyList<AutoWallGeometry.Wall> Walls => walls;

    /// <summary>Wall ends still missing their corner.</summary>
    public IReadOnlyList<AutoWallGeometry.OpenEnd> OpenEnds => openEnds;

    public bool IsRoomWall(int index) =>
        index >= 0 && index < walls.Count && index < innerWalls.Length
        && !innerWalls[index] && walls[index].Length >= settings.minCornerWallLength;

    public event Action Changed;
    public event Action<Note> Noted;

    public static ARAutoRoomScan EnsureOn(GameObject host)
    {
        var existing = host.GetComponent<ARAutoRoomScan>();
        return existing != null ? existing : host.AddComponent<ARAutoRoomScan>();
    }

    void Awake()
    {
        // Off by default: the main flow is corner by corner (a floor corner, the height, then
        // ceiling corners, which furniture doesn't hide). Automatic walls stay one tap away.
        Enabled = PlayerPrefs.GetInt(EnabledPrefKey, 0) == 1;
        scanController = FindFirstObjectByType<RoomScanController>();
        builder = FindFirstObjectByType<ARDesignCornerRoomBuilder>();
        planeManager = FindFirstObjectByType<ARPlaneManager>();
        indicator = FindFirstObjectByType<ARPlacementIndicator>();
        arCamera = Camera.main;

        root = new GameObject("AutoRoomScan").transform;
        root.SetParent(transform, false);
        wallMaterial = ARLineMaterialUtil.Create(wallColor);
        wallPanelMaterial = ARLineMaterialUtil.CreateTransparent(wallPanelColor);
        // Without the blending shader the "see-through" fill would be solid and hide the room.
        if (wallPanelMaterial != null && wallPanelMaterial.shader != null && wallPanelMaterial.shader.name != "Sprites/Default")
        {
            Destroy(wallPanelMaterial);
            wallPanelMaterial = null;
        }
        targetMaterial = ARLineMaterialUtil.Create(targetColor);
        targetRing = CreateLine("TargetRing", 0.025f, targetMaterial, true);
        targetPole = CreateLine("TargetPole", 0.02f, targetMaterial, false);
        ceilingDrop = CreateLine("CeilingDrop", 0.012f, wallMaterial, false);
    }

    /// <summary>
    /// A corner is already there (its marker and outline lines show it): no second line on it.
    /// </summary>
    bool NearPlacedCorner(Vector3 floorPoint)
    {
        var p = XZ(floorPoint);
        foreach (var c in builder.Corners)
        {
            if (Vector2.Distance(XZ(c), p) <= DropLineCornerClearance) return true;
        }

        return false;
    }

    const float DropLineCornerClearance = 0.25f;

    /// <summary>Aiming at a ceiling corner: a line from it straight down to where the corner goes.</summary>
    void DrawCeilingDrop()
    {
        if (ceilingDrop == null) return;
        var show = AimFromCeiling && indicator != null && indicator.IsTracking && indicator.IsLockedOnFloor
                   && !NearPlacedCorner(indicator.WorldPosition);
        if (ceilingDrop.enabled != show) ceilingDrop.enabled = show;
        if (!show) return;

        var floor = indicator.WorldPosition;
        ceilingDrop.positionCount = 2;
        ceilingDrop.SetPosition(0, CeilingAimPoint);
        ceilingDrop.SetPosition(1, new Vector3(CeilingAimPoint.x, floor.y + 0.01f, CeilingAimPoint.z));
    }

    void OnEnable()
    {
        if (builder != null)
        {
            builder.AutoTapped += OnTapped;
            builder.AutoLongPressed += OnLongPressed;
        }
        if (scanController != null) scanController.PhaseChanged += OnScanPhase;
        // By hand or automatic, the floor aim reaches into corners.
        if (indicator != null) indicator.ExtendedAim = ResolveAim;
    }

    void OnDisable()
    {
        if (builder != null)
        {
            builder.AutoTapped -= OnTapped;
            builder.AutoLongPressed -= OnLongPressed;
        }
        if (scanController != null) scanController.PhaseChanged -= OnScanPhase;
        if (indicator != null) indicator.ExtendedAim = null;
    }

    void OnDestroy()
    {
        UnpinAll();
        FinishSession("left");
        foreach (var panel in wallPanels)
        {
            if (panel != null && panel.sharedMesh != null) Destroy(panel.sharedMesh);
        }
        if (wallMaterial != null) Destroy(wallMaterial);
        if (wallPanelMaterial != null) Destroy(wallPanelMaterial);
        if (targetMaterial != null) Destroy(targetMaterial);
        if (root != null) Destroy(root.gameObject);
    }

    /// <summary>Turns the automatic scan on or off (remembered on this phone).</summary>
    public void SetEnabled(bool on)
    {
        if (Enabled == on) return;
        Enabled = on;
        PlayerPrefs.SetInt(EnabledPrefKey, on ? 1 : 0);
        PlayerPrefs.Save();
        if (stats != null) stats.modeSwitches++;

        if (builder != null)
        {
            // Corners tapped by hand so far become hand-placed corners of the automatic outline.
            if (on && builder.IsHeightLocked && !builder.IsLoopClosed)
                ImportBuilderCorners();
            builder.AutoOutline = on;
        }

        if (!on)
        {
            ResetDwell();
            HideVisuals();
            CurrentStep = Step.Off;
        }

        Debug.Log($"[AutoScan] Automatic scan {(on ? "on" : "off")}");
        Changed?.Invoke();
    }

    /// <summary>Stops anything from setting itself (e.g. while the help card covers the camera).</summary>
    public void SetHoldPaused(bool paused)
    {
        if (holdPaused == paused) return;
        holdPaused = paused;
        if (paused) ResetDwell();
        Changed?.Invoke();
    }

    void Update()
    {
        if (builder == null || scanController == null) return;
        // By hand or automatic, a corner can be aimed at on the ceiling.
        DrawCeilingDrop();
        if (builder.AutoOutline != Enabled) builder.AutoOutline = Enabled;

        var step = ResolveStep();
        if (step != CurrentStep) EnterStep(step);
        TrackTurnRate();

        // Lost or shaky tracking moves every point: hold everything as it is until it's back.
        if (IsPaused && CurrentStep is Step.Floor or Step.Height or Step.Walls)
        {
            pausedAt = Time.unscaledTime;
            ResetDwell();
            return;
        }

        switch (CurrentStep)
        {
            case Step.Floor:
                TickFloor();
                break;
            case Step.Height:
                TickHeight();
                break;
            case Step.Walls:
                TickWalls();
                break;
            default:
                ResetDwell();
                break;
        }
    }

    Step ResolveStep()
    {
        if (!Enabled) return Step.Off;
        var phase = scanController.Phase;
        if (phase != RoomScanController.ScanPhase.Scanning && phase != RoomScanController.ScanPhase.ReadyToConfirm)
            return Step.Off;
        if (builder.IsInHeightPhase) return builder.HasHeightBase ? Step.Height : Step.Floor;
        return builder.IsLoopClosed ? Step.Closed : Step.Walls;
    }

    void EnterStep(Step step)
    {
        var previous = CurrentStep;
        CurrentStep = step;
        stepStartedAt = Time.unscaledTime;
        ResetDwell();
        // Scan logs explain themselves: each step change, with the floor and height it starts from.
        Debug.Log($"[AutoScan] Step {previous} → {step} (floor y={builder.FloorY:F2}, height {builder.WallHeight:F2} m, " +
                  $"tracking epoch {ARBootstrap.TrackingEpoch})");

        switch (step)
        {
            case Step.Floor:
                var sameScan = stats != null;
                if (!sameScan) StartSession();
                else if (previous is Step.Height or Step.Walls or Step.Closed) stats.backToStart++;
                floorSetAt = heightSetAt = closedAt = -1f;
                // Back to the floor point in the same scan (Undo past the height): the walls seen
                // are still right, so only the corners go. A new scan or a tracking reset starts clean.
                if (sameScan && WallsStillValid) ClearCorners();
                else ClearWalls();
                floorWaitsToMoveOff = sameScan && previous is Step.Height or Step.Walls or Step.Closed;
                // The detector is loaded and warmed up by the scan HUD once AR is tracking steadily:
                // a long pause while ARCore is still starting left the camera black.
                break;
            case Step.Height:
                if (stats == null) StartSession();
                floorSetAt = Time.unscaledTime;
                lastFloorPoint = builder.HeightBasePoint;
                break;
            case Step.Walls:
                if (stats == null) StartSession();
                if (previous is Step.Height or Step.Off or Step.Floor)
                {
                    heightSetAt = Time.unscaledTime;
                    if (stats != null) stats.heightM = builder.WallHeight;
                    // Back from measuring the height again: the walls seen are still right (the
                    // floor step clears them when the scan really starts over). Only corners go.
                    if (previous is Step.Off || !WallsStillValid) ClearWalls();
                    else ClearCorners();
                    // Hand-tapped corners from a manual start carry over.
                    if (builder.CornerCount > 0) ImportBuilderCorners();
                    SeedFloorCorner();
                }
                lastProgressAt = Time.unscaledTime;
                nextEvaluateAt = 0f;
                break;
            case Step.Closed:
                closedAt = Time.unscaledTime;
                RecordOutline();
                break;
        }

        if (step != Step.Walls) HideVisuals();
        Changed?.Invoke();
    }

    // ── Floor aim ─────────────────────────────────────────────────────────────

    /// <summary>
    /// The scan's floor aim (see <see cref="ScanFloorAim"/>): it follows the floor past the part ARCore
    /// recognized, stops at the bottom of walls and snaps to corners where two walls meet.
    /// </summary>
    bool ResolveAim(Ray ray, float floorY, out Vector3 point, out ARPlacementIndicator.AimKind kind)
    {
        RefreshAimGeometry(floorY);
        var result = ScanFloorAim.Resolve(ray.origin, ray.direction, floorY, aimWalls, aimCorners, aimSettings, out point);
        if (result == ScanFloorAim.Kind.None && CeilingAimAvailable)
        {
            // Floor corner hidden by furniture: the ceiling corner above it gives the same spot.
            result = ScanFloorAim.ResolveCeiling(ray.origin, ray.direction, floorY, floorY + builder.WallHeight,
                aimWalls, aimCorners, aimSettings, out point, out var ceiling);
            if (result != ScanFloorAim.Kind.None)
            {
                ceilingAimFrame = Time.frameCount;
                CeilingAimPoint = ceiling;
            }
        }

        kind = result switch
        {
            ScanFloorAim.Kind.Corner => ARPlacementIndicator.AimKind.Corner,
            ScanFloorAim.Kind.WallBase => ARPlacementIndicator.AimKind.WallBase,
            _ => ARPlacementIndicator.AimKind.Floor,
        };
        return result != ScanFloorAim.Kind.None;
    }

    /// <summary>
    /// Walls and corners the aim stops at and snaps to. The walk keeps its own up to date; before
    /// it (the floor point, or scanning by hand) they are worked out here a few times a second.
    /// </summary>
    void RefreshAimGeometry(float floorY)
    {
        if (Time.unscaledTime < nextAimRefreshAt) return;
        nextAimRefreshAt = Time.unscaledTime + evaluateInterval;
        aimCorners.Clear();

        if (CurrentStep == Step.Walls)
        {
            aimWalls = walls;
            foreach (var t in tracked)
            {
                if (t.matched || t.confirmed) aimCorners.Add(t.point);
            }
            aimCorners.AddRange(placed);
            return;
        }

        aimPieces.Clear();
        CollectPieces(floorY, aimPieces);
        aimWalls = AutoWallGeometry.MergeWalls(aimPieces, settings);
        foreach (var corner in AutoWallGeometry.FindCorners(aimWalls, settings))
            aimCorners.Add(corner.point);
    }

    // ── Floor and height ──────────────────────────────────────────────────────

    void TickFloor()
    {
        if (indicator == null || !indicator.IsLockedOnFloor || !FloorReady)
        {
            ResetDwell();
            return;
        }

        var p = indicator.WorldPosition;
        if (floorWaitsToMoveOff)
        {
            if (Flat(p - lastFloorPoint).magnitude < FloorMoveOffDistance)
            {
                ResetDwell();
                return;
            }

            floorWaitsToMoveOff = false;
        }

        HasDwellPoint = true;
        DwellPoint = p;
        if (!dwellRunning || Flat(p - dwellAnchor).magnitude > floorHoldRadius)
        {
            StartDwell(p);
            return;
        }

        DwellProgress = Mathf.Clamp01((Time.unscaledTime - dwellStartedAt) / floorHoldSeconds);
        if (DwellProgress < 1f) return;

        ResetDwell();
        if (builder.TryConfirmHeightBaseFromIndicator() && stats != null)
            stats.floorAuto = true;
    }

    void TickHeight()
    {
        var live = builder.LiveHeightMeters;
        HasDwellPoint = builder.HasLiveHeightPreview;
        DwellPoint = builder.HeightBasePoint + Vector3.up * live;

        var lookUp = arCamera != null ? arCamera.transform.forward.y : 0f;
        if (!builder.HasLiveHeightPreview || live < minAutoHeight || live > maxAutoHeight || lookUp < minLookUp)
        {
            DwellProgress = 0f;
            return;
        }

        // The builder's reading knows how long it has stayed put (small hand shake allowed).
        // Time spent paused (help card open, tracking frozen) doesn't count as holding.
        var held = Mathf.Min(builder.HeightSteadySeconds, Time.unscaledTime - pausedAt);
        DwellProgress = Mathf.Clamp01(held / heightHoldSeconds);
        if (DwellProgress < 1f) return;

        ResetDwell();
        if (builder.ConfirmHeight() && stats != null)
            stats.heightAuto = true;
    }

    // ── Walls and corners ─────────────────────────────────────────────────────

    void TickWalls()
    {
        var now = Time.unscaledTime;
        if (now >= nextEvaluateAt)
        {
            nextEvaluateAt = now + evaluateInterval;
            SampleCenter();
            Evaluate();
        }

        UpdateTarget();
        TickCornerHold();
        DrawTarget(now);
    }

    void SampleCenter()
    {
        if (arCamera == null) return;
        centerSum += XZ(arCamera.transform.position);
        centerSamples++;
    }

    Vector2 Center =>
        centerSamples > 0 ? centerSum / centerSamples : (arCamera != null ? XZ(arCamera.transform.position) : Vector2.zero);

    void Evaluate()
    {
        FollowPins();
        var floorY = builder.FloorY;
        pieces.Clear();
        var vertical = CollectPieces(floorY, pieces);
        // Steady walls: planes come and go between rounds, the walls shown shouldn't.
        walls = wallTracker.Update(AutoWallGeometry.MergeWalls(AutoWallGeometry.DropOffAxisPieces(pieces), settings));
        // On the copies shown, so the tracker keeps following what ARCore actually sees.
        AutoWallGeometry.SquareWalls(walls);
        innerWalls = AutoWallGeometry.FindInnerWalls(walls, settings);
        // While the phone spins, ARCore's picture of the room drifts with it (walls and corners were
        // dragged round with the turn and came back on the way back, 2026-11-12): corners seen then
        // are where the drift put them, so they neither count towards locking nor move.
        if (!TurningFast) TrackCorners(AutoWallGeometry.FindCorners(walls, settings));

        // Confirmed corners found this round keep their walls (for ordering); ones missed this
        // round and hand-placed corners go in as plain points.
        outlineCorners.Clear();
        closingCorners.Clear();
        extraPoints.Clear();
        foreach (var t in tracked)
        {
            if (t.matched)
            {
                var geo = t.geo;
                geo.point = t.point;
                closingCorners.Add(geo);
                if (t.confirmed) outlineCorners.Add(geo);
            }
            else if (t.confirmed)
            {
                extraPoints.Add(t.point);
            }
        }
        extraPoints.AddRange(placed);

        openEnds = AutoWallGeometry.FindOpenEnds(walls, closingCorners, extraPoints, settings, minTargetWallLength);
        var outline = AutoWallGeometry.OrderOutline(outlineCorners, extraPoints, Center);

        WallCount = CountRealWalls();
        CornerCount = outline.Count;
        OpenEndCount = openEnds.Count;
        if (WallCount > lastWallCount || CornerCount > lastCornerCount)
            lastProgressAt = Time.unscaledTime;
        lastWallCount = WallCount;
        lastCornerCount = CornerCount;

        if (stats != null)
        {
            stats.maxWalls = Mathf.Max(stats.maxWalls, WallCount);
            stats.maxVerticalPlanes = Mathf.Max(stats.maxVerticalPlanes, vertical);
        }

        PushOutline(outline, floorY);
        DrawWalls(floorY);

        var complete = OutlineLooksComplete && !AutoWallGeometry.CrossesItself(outline);
        if (complete && !wasComplete) pendingNotes.Add(Note.OutlineComplete);
        wasComplete = complete;

        if (Time.unscaledTime >= nextLogAt)
        {
            nextLogAt = Time.unscaledTime + 2f;
            Debug.Log($"[AutoScan] vertical planes={vertical} pieces={pieces.Count} walls={WallCount} " +
                      $"corners={CornerCount} (found {locked.Count}, hand {placed.Count - locked.Count}, seen {tracked.Count}) open ends={OpenEndCount} " +
                      $"floor y={floorY:F2}{(builder.IsOutlineSelfIntersecting ? " CROSSES ITSELF (can't close)" : "")}");
        }

        Changed?.Invoke();
        FlushNotes();
    }

    /// <summary>Notes are sent after the outline and counts are up to date, so the HUD reads the new numbers.</summary>
    void FlushNotes()
    {
        if (pendingNotes.Count == 0) return;
        var notes = pendingNotes.ToArray();
        pendingNotes.Clear();
        foreach (var note in notes)
            Noted?.Invoke(note);
    }

    /// <summary>Each usable vertical plane as a floor-plan line, with the way it faces.</summary>
    int CollectPieces(float floorY, List<AutoWallGeometry.WallPiece> output)
    {
        if (planeManager == null) return 0;
        var vertical = 0;
        foreach (var plane in planeManager.trackables)
        {
            if (plane == null || plane.alignment != PlaneAlignment.Vertical) continue;
            if (plane.subsumedBy != null || plane.trackingState == TrackingState.None) continue;
            vertical++;

            var normal = XZ(plane.normal);
            if (normal.sqrMagnitude < 0.5f) continue;
            normal.Normalize();
            var tangent = new Vector2(-normal.y, normal.x);
            var origin = XZ(plane.center);

            var boundary = plane.boundary;
            if (!boundary.IsCreated || boundary.Length < 3) continue;

            var tMin = float.MaxValue;
            var tMax = float.MinValue;
            var yMin = float.MaxValue;
            var yMax = float.MinValue;
            var tr = plane.transform;
            for (var i = 0; i < boundary.Length; i++)
            {
                var w = tr.TransformPoint(new Vector3(boundary[i].x, 0f, boundary[i].y));
                var t = Vector2.Dot(XZ(w) - origin, tangent);
                tMin = Mathf.Min(tMin, t);
                tMax = Mathf.Max(tMax, t);
                yMin = Mathf.Min(yMin, w.y);
                yMax = Mathf.Max(yMax, w.y);
            }

            var width = tMax - tMin;
            if (width < minPieceWidth) continue;
            if (yMax - floorY < minWallTopAboveFloor) continue;

            output.Add(new AutoWallGeometry.WallPiece
            {
                a = origin + tangent * tMin,
                b = origin + tangent * tMax,
                normal = normal,
                weight = width * Mathf.Max(0.1f, yMax - yMin),
            });
        }

        return vertical;
    }

    void TrackCorners(List<AutoWallGeometry.Corner> found)
    {
        foreach (var t in tracked) t.matched = false;

        foreach (var c in found)
        {
            // Removed by the user, or already placed there by hand (the hand-placed one wins).
            if (IsSuppressed(c.point) || IsNearPlaced(c.point)) continue;

            TrackedCorner best = null;
            var bestDistance = float.MaxValue;
            foreach (var t in tracked)
            {
                if (t.matched) continue;
                // An outline corner gone unseen (kept 5 s) is picked up a little further away: the
                // walls were re-fitted. Otherwise a second corner showed up beside the stale one.
                var reach = t.confirmed && t.misses > 0 ? cornerMatchDistance * 2f : cornerMatchDistance;
                var d = Vector2.Distance(t.point, c.point);
                if (d <= reach && d < bestDistance)
                {
                    bestDistance = d;
                    best = t;
                }
            }

            if (best == null)
            {
                tracked.Add(new TrackedCorner { id = nextCornerId++, point = c.point, geo = c, seen = 1, matched = true });
                continue;
            }

            best.point = Vector2.Lerp(best.point, c.point, 0.5f);
            best.geo = c;
            best.seen++;
            best.misses = 0;
            best.matched = true;
            if (best.seen >= confirmAfterEvaluations) LockCorner(best);
        }

        for (var i = tracked.Count - 1; i >= 0; i--)
        {
            var t = tracked[i];
            if (t.matched) continue;
            t.misses++;
            if (t.misses > (t.confirmed ? dropConfirmedAfterMisses : dropAfterMisses)) tracked.RemoveAt(i);
        }
    }

    /// <summary>
    /// A corner seen where two walls meet a few rounds running stays, like one placed by hand. Found
    /// corners used to come and go with the walls: in a plain, dim room the outline went 4 → 1
    /// corners while the user watched (2026-10-24). Undo and press-and-hold still remove it, and it
    /// isn't found again there.
    /// </summary>
    void LockCorner(TrackedCorner corner)
    {
        tracked.Remove(corner);
        if (IsNearPlaced(corner.point)) return;
        placed.Add(corner.point);
        locked.Add(corner.point);
        Pin(corner.point);
        history.Add(new HistoryEntry { auto = false, placed = corner.point });
        pendingNotes.Add(Note.CornerFound);
        if (stats != null) stats.cornersAutoFound++;
        lastProgressAt = Time.unscaledTime;
    }

    /// <summary>Takes a placed corner out; a locked found one is kept from coming straight back.</summary>
    void UnplaceAt(int index)
    {
        var point = placed[index];
        placed.RemoveAt(index);
        Unpin(point);
        if (locked.Remove(point)) suppressed.Add(point);
    }

    int CountRealWalls()
    {
        var count = 0;
        for (var i = 0; i < walls.Count; i++)
        {
            if (!innerWalls[i] && walls[i].Length >= settings.minCornerWallLength) count++;
        }

        return count;
    }

    void PushOutline(List<Vector2> outline, float floorY)
    {
        // A new or removed corner shows at once; small drifts at most twice a second
        // (each push rebuilds the measurement labels and updates the app).
        var countChanged = outline.Count != lastPushed.Count;
        if (!countChanged && Time.unscaledTime < nextPushAt) return;
        var changed = countChanged;
        for (var i = 0; !changed && i < outline.Count; i++)
            changed = Vector2.Distance(outline[i], XZ(lastPushed[i])) > 0.03f;
        if (!changed) return;
        nextPushAt = Time.unscaledTime + 0.5f;

        lastPushed.Clear();
        foreach (var p in outline)
            lastPushed.Add(new Vector3(p.x, floorY, p.y));
        builder.SetCorners(lastPushed);
    }

    void UpdateTarget()
    {
        HasTarget = false;
        targetWall = -1;
        targetEnd = -1;
        if (openEnds.Count == 0 || arCamera == null) return;

        var camPos = XZ(arCamera.transform.position);
        var forward = XZ(arCamera.transform.forward);
        if (forward.sqrMagnitude < 1e-4f) forward = Vector2.up;
        forward.Normalize();

        var bestScore = float.MaxValue;
        foreach (var end in openEnds)
        {
            var to = end.point - camPos;
            var distance = to.magnitude;
            var angle = distance > 1e-3f ? Vector2.Angle(forward, to / distance) : 0f;
            // Mostly "what you're looking at", a little "what's close".
            var score = angle + distance * 4f;
            if (score < bestScore)
            {
                bestScore = score;
                targetWall = end.wall;
                targetEnd = end.end;
                TargetPoint = new Vector3(end.point.x, builder.FloorY, end.point.y);
            }
        }

        HasTarget = targetWall >= 0;
    }

    /// <summary>
    /// Aiming at the orange marker — or further along that wall, where the real corner may be —
    /// and holding still places a corner where the dot is (on the wall's line only when that close).
    /// </summary>
    void TickCornerHold()
    {
        if (!HasTarget || !builder.IsAimOnFloor || targetWall < 0 || targetWall >= walls.Count)
        {
            ResetDwell();
            return;
        }

        var aim = builder.AimPoint;
        var aim2 = XZ(aim);
        var wall = walls[targetWall];
        var nearMarker = Vector2.Distance(aim2, XZ(TargetPoint)) <= cornerHoldRadius;
        var t = wall.Project(aim2);
        var alongWall = wall.DistanceToLine(aim2) <= cornerHoldLineTolerance
                        && (targetEnd == 0
                            ? t <= wall.tMin + settings.cornerInset && t >= wall.tMin - settings.cornerReach
                            : t >= wall.tMax - settings.cornerInset && t <= wall.tMax + settings.cornerReach);
        // A corner is already here (the one just placed, most often): holding on stacked another
        // one every second while the phone stayed still. Back at corner 1 a tap closes the room.
        if ((!nearMarker && !alongWall) || IsNearPlaced(aim2) || AtStartCorner(aim2))
        {
            ResetDwell();
            return;
        }

        HasDwellPoint = true;
        DwellPoint = aim;
        if (!dwellRunning || Flat(aim - dwellAnchor).magnitude > cornerHoldDrift)
        {
            StartDwell(aim);
            return;
        }

        DwellProgress = Mathf.Clamp01((Time.unscaledTime - dwellStartedAt) / cornerHoldSeconds);
        if (DwellProgress < 1f) return;

        ResetDwell();
        // The user is pointing at the real corner; the blue line may be off the real wall.
        AddPlaced(wall.DistanceToLine(aim2) <= tapSnapToWall ? AutoWallGeometry.SnapToLine(wall, aim2) : aim2);
        if (stats != null) stats.cornersHeld++;
        Evaluate();
    }

    void OnTapped(Vector3 world)
    {
        if (CurrentStep != Step.Walls) return;
        if (!IsTrackingWell)
        {
            Noted?.Invoke(Note.TapIgnored);
            return;
        }

        var p = XZ(world);

        // Back at corner 1 the room closes, as by hand (Finish does the same).
        if (AtStartCorner(p))
        {
            if (builder.CanClose) builder.CloseLoop();
            return;
        }

        // A tap never removes: on a corner it only says how to. Removing with a second tap deleted
        // corners by accident when a tap that seemed to do nothing was tapped again.
        if (FindCornerNear(p, out _, out _))
        {
            Noted?.Invoke(Note.HoldToRemove);
            return;
        }

        AddPlaced(SnapToNearestWall(p));
        if (stats != null) stats.cornersTapped++;
        Evaluate();
    }

    /// <summary>Press and hold on a corner removes it (a found one stays away).</summary>
    void OnLongPressed(Vector3 world)
    {
        if (CurrentStep != Step.Walls) return;
        if (!IsTrackingWell)
        {
            Noted?.Invoke(Note.TapIgnored);
            return;
        }

        if (!TryRemoveCornerNear(XZ(world))) return;
        pendingNotes.Add(Note.CornerRemoved);
        if (stats != null) stats.cornersRemoved++;
        Evaluate();
    }

    void AddPlaced(Vector2 p)
    {
        // A found corner right here is replaced by the hand-placed one.
        foreach (var t in tracked.FindAll(t => Vector2.Distance(t.point, p) <= suppressRadius))
        {
            tracked.Remove(t);
            history.RemoveAll(h => h.auto && h.autoId == t.id);
        }

        placed.Add(p);
        Pin(p);
        history.Add(new HistoryEntry { auto = false, placed = p });
        pendingNotes.Add(Note.CornerAdded);
        lastProgressAt = Time.unscaledTime;
    }

    Vector2 SnapToNearestWall(Vector2 p)
    {
        var best = p;
        var bestDistance = tapSnapToWall;
        for (var i = 0; i < walls.Count; i++)
        {
            if (innerWalls[i]) continue;
            var d = walls[i].DistanceToLine(p);
            if (d <= bestDistance)
            {
                bestDistance = d;
                best = AutoWallGeometry.SnapToLine(walls[i], p);
            }
        }

        return best;
    }

    bool TryRemoveCornerNear(Vector2 p)
    {
        if (!FindCornerNear(p, out var placedIndex, out var autoCorner)) return false;
        if (autoCorner != null)
        {
            RemoveAuto(autoCorner);
            return true;
        }

        var point = placed[placedIndex];
        UnplaceAt(placedIndex);
        history.RemoveAll(h => !h.auto && h.placed == point);
        return true;
    }

    /// <summary>The corner a tap at <paramref name="p"/> is on: a placed one, or a confirmed found one.</summary>
    bool FindCornerNear(Vector2 p, out int placedIndex, out TrackedCorner autoCorner)
    {
        var bestDistance = removeTapRadius;
        placedIndex = -1;
        autoCorner = null;
        for (var i = 0; i < placed.Count; i++)
        {
            var d = Vector2.Distance(placed[i], p);
            if (d <= bestDistance)
            {
                bestDistance = d;
                placedIndex = i;
            }
        }

        foreach (var t in tracked)
        {
            if (!t.confirmed) continue;
            var d = Vector2.Distance(t.point, p);
            if (d <= bestDistance)
            {
                bestDistance = d;
                autoCorner = t;
                placedIndex = -1;
            }
        }

        return autoCorner != null || placedIndex >= 0;
    }

    void RemoveAuto(TrackedCorner corner)
    {
        suppressed.Add(corner.point);
        tracked.Remove(corner);
        history.RemoveAll(h => h.auto && h.autoId == corner.id);
    }

    bool IsSuppressed(Vector2 p)
    {
        foreach (var s in suppressed)
        {
            if (Vector2.Distance(s, p) <= suppressRadius) return true;
        }

        return false;
    }

    bool IsNearPlaced(Vector2 p)
    {
        foreach (var q in placed)
        {
            if (Vector2.Distance(q, p) <= suppressRadius) return true;
        }

        return false;
    }

    /// <summary>Takes back the newest corner (found or placed). False when there is none.</summary>
    public bool Undo()
    {
        while (history.Count > 0)
        {
            var entry = history[^1];
            history.RemoveAt(history.Count - 1);
            if (entry.auto)
            {
                var corner = tracked.Find(t => t.id == entry.autoId);
                if (corner == null) continue;
                RemoveAuto(corner);
            }
            else
            {
                var index = placed.IndexOf(entry.placed);
                if (index < 0) continue;
                UnplaceAt(index);
            }

            pendingNotes.Add(Note.CornerRemoved);
            if (stats != null) stats.undos++;
            Evaluate();
            return true;
        }

        return false;
    }

    /// <summary>
    /// Three corners, one of them square: most rooms are rectangles, so the fourth corner is where
    /// those two walls end. Placing it by hand added extra corners and outlines that crossed
    /// themselves, and closing with three made a triangle.
    /// </summary>
    public bool CanFinishAsRectangle(out Vector2 fourth)
    {
        fourth = default;
        if (CurrentStep != Step.Walls || builder.CornerCount != 3 || builder.IsLoopClosed) return false;
        return AutoWallGeometry.TryRectangleCorner(
            XZ(builder.Corners[0]), XZ(builder.Corners[1]), XZ(builder.Corners[2]), out fourth);
    }

    /// <summary>Adds the fourth corner of the rectangle (Undo takes it back like any placed corner).</summary>
    public bool FinishAsRectangle()
    {
        if (!CanFinishAsRectangle(out var fourth)) return false;
        AddPlaced(fourth);
        if (stats != null) stats.cornersTapped++;
        Evaluate();
        return true;
    }

    /// <summary>Drops every corner (found, placed, removed) and looks at the walls again.</summary>
    public void StartWallsOver()
    {
        ClearWalls();
        if (stats != null) stats.backToStart++;
        SeedFloorCorner();
        builder.SetCorners(lastPushed);
        Evaluate();
    }

    /// <summary>The walls known were seen in this tracking session (a tracking reset moves every plane).</summary>
    bool WallsStillValid => ARBootstrap.TrackingEpoch == wallsEpoch;
    int wallsEpoch;

    void ClearWalls()
    {
        wallsEpoch = ARBootstrap.TrackingEpoch;
        ClearCorners();
        openEnds.Clear();
        walls.Clear();
        wallTracker.Clear();
        innerWalls = Array.Empty<bool>();
        centerSum = Vector2.zero;
        centerSamples = 0;
        lastWallCount = 0;
        WallCount = OpenEndCount = 0;
        HideVisuals();
    }

    /// <summary>Drops every corner (found, placed, removed) but keeps the walls seen so far.</summary>
    void ClearCorners()
    {
        UnpinAll();
        tracked.Clear();
        placed.Clear();
        locked.Clear();
        suppressed.Clear();
        history.Clear();
        lastPushed.Clear();
        lastCornerCount = 0;
        wasComplete = false;
        pendingNotes.Clear();
        CornerCount = 0;
        HasTarget = false;
        hasStartCorner = false;
    }

    /// <summary>
    /// The floor point is corner 1, as by hand: the walk goes round the room and back to it. Left
    /// out of the outline, the walk's first line never reached it. Not in the undo history, so Undo
    /// past the last corner goes back to the height, as by hand; press and hold still removes it.
    /// </summary>
    void SeedFloorCorner()
    {
        hasStartCorner = false;
        if (!builder.HasHeightBase) return;
        var p = XZ(builder.HeightBasePoint);
        // Corners tapped by hand before Auto was switched on already start with it.
        var index = placed.FindIndex(q => Vector2.Distance(q, p) <= suppressRadius);
        if (index < 0)
        {
            placed.Insert(0, p);
            Pin(p);
            index = 0;
        }

        startCorner = placed[index];
        hasStartCorner = true;
    }

    /// <summary>Corner 1 is still in the outline and there's a room's worth of corners: tapping it closes the room.</summary>
    public bool CanCloseAtStart =>
        hasStartCorner && CornerCount >= RoomPolygonUtil.MinCorners && placed.Contains(startCorner);

    bool AtStartCorner(Vector2 p) => CanCloseAtStart && Vector2.Distance(p, startCorner) <= closeTapRadius;

    void ImportBuilderCorners()
    {
        UnpinAll();
        placed.Clear();
        history.Clear();
        foreach (var c in builder.Corners)
        {
            placed.Add(XZ(c));
            Pin(XZ(c));
            history.Add(new HistoryEntry { auto = false, placed = XZ(c) });
        }
    }

    // ── Turning speed ─────────────────────────────────────────────────────────

    /// <summary>Turning faster than this (degrees per second) drifts tracking too much to find corners.</summary>
    const float MaxCornerTurnDegreesPerSecond = 30f;

    float turnRate;
    float lastYaw = float.NaN;

    /// <summary>The phone is turning faster than corners can be found reliably.</summary>
    public bool TurningFast => turnRate > MaxCornerTurnDegreesPerSecond;

    void TrackTurnRate()
    {
        if (arCamera == null) return;
        var yaw = arCamera.transform.eulerAngles.y;
        var dt = Time.unscaledDeltaTime;
        if (!float.IsNaN(lastYaw) && dt > 1e-4f)
        {
            var rate = Mathf.Abs(Mathf.DeltaAngle(lastYaw, yaw)) / dt;
            // Smoothed over a few frames; a single jumpy frame shouldn't stop corner finding.
            turnRate = Mathf.Lerp(turnRate, rate, Mathf.Clamp01(dt * 6f));
        }

        lastYaw = yaw;
    }

    // ── Corners stay on the real corners ─────────────────────────────────────

    /// <summary>
    /// A corner of <see cref="placed"/> and the AR anchor made where it was set. ARCore keeps
    /// correcting its picture of the room while you walk round it: the walls (planes) moved with the
    /// room, but a found corner stayed a fixed point and slid off the real corner (2026-11-12).
    /// Corners placed by hand in the manual scan were already pinned like this.
    /// </summary>
    sealed class CornerPin
    {
        public Vector2 point;
        public ARAnchor anchor;
        public bool released;
    }

    readonly List<CornerPin> pins = new();
    ARAnchorManager anchorManager;

    /// <summary>Anchor jitter below this (5 mm) is ignored.</summary>
    const float PinMoveEpsilon = 0.005f;

    void Pin(Vector2 point)
    {
        if (anchorManager == null) anchorManager = FindFirstObjectByType<ARAnchorManager>();
        if (anchorManager == null || !anchorManager.isActiveAndEnabled) return;
        var pin = new CornerPin { point = point };
        pins.Add(pin);
        CreatePinAsync(pin, new Vector3(point.x, builder.FloorY, point.y));
    }

    async void CreatePinAsync(CornerPin pin, Vector3 world)
    {
        try
        {
            var result = await anchorManager.TryAddAnchorAsync(new Pose(world, Quaternion.identity));
            if (!result.status.IsSuccess() || result.value == null) return;
            if (pin.released || this == null)
            {
                Destroy(result.value.gameObject);
                return;
            }

            pin.anchor = result.value;
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[AutoScan] Corner anchor failed: {e.Message}");
        }
    }

    void Unpin(Vector2 point)
    {
        var index = pins.FindIndex(p => p.point == point);
        if (index < 0) return;
        Release(pins[index]);
        pins.RemoveAt(index);
    }

    void UnpinAll()
    {
        foreach (var pin in pins) Release(pin);
        pins.Clear();
    }

    static void Release(CornerPin pin)
    {
        if (pin.released) return;
        pin.released = true;
        if (pin.anchor != null) Destroy(pin.anchor.gameObject);
        pin.anchor = null;
    }

    /// <summary>Moves each pinned corner to where its anchor is now, so it stays on the real corner.</summary>
    void FollowPins()
    {
        foreach (var pin in pins)
        {
            if (pin.anchor == null || pin.anchor.trackingState != TrackingState.Tracking) continue;
            var now = XZ(pin.anchor.transform.position);
            if (Vector2.Distance(now, pin.point) < PinMoveEpsilon) continue;
            MoveCorner(pin.point, now);
            pin.point = now;
        }
    }

    /// <summary>A corner moved with its anchor: everything that refers to it follows.</summary>
    void MoveCorner(Vector2 from, Vector2 to)
    {
        var i = placed.IndexOf(from);
        if (i >= 0) placed[i] = to;
        var j = locked.IndexOf(from);
        if (j >= 0) locked[j] = to;
        for (var k = 0; k < history.Count; k++)
        {
            if (history[k].auto || history[k].placed != from) continue;
            var entry = history[k];
            entry.placed = to;
            history[k] = entry;
        }

        if (hasStartCorner && startCorner == from) startCorner = to;
    }

    // ── Hold-still helper ─────────────────────────────────────────────────────

    void StartDwell(Vector3 at)
    {
        dwellRunning = true;
        dwellStartedAt = Time.unscaledTime;
        dwellAnchor = at;
        DwellProgress = 0f;
    }

    void ResetDwell()
    {
        dwellRunning = false;
        DwellProgress = 0f;
        HasDwellPoint = false;
    }

    // ── Visuals ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Wall <paramref name="i"/> runs along a longer wall (nearly parallel, within half a metre,
    /// mostly overlapping it): the same real wall estimated twice, which drew overlapping blue.
    /// </summary>
    bool LiesOnLongerWall(int i)
    {
        var w = walls[i];
        var mid = (w.End(0) + w.End(1)) * 0.5f;
        var cos = Mathf.Cos(15f * Mathf.Deg2Rad);
        for (var j = 0; j < walls.Count; j++)
        {
            if (j == i || innerWalls[j]) continue;
            var other = walls[j];
            if (other.Length <= w.Length) continue;
            if (Mathf.Abs(Vector2.Dot(other.dir, w.dir)) < cos) continue;
            if (other.DistanceToLine(mid) > 0.5f) continue;
            var t = other.Project(mid);
            if (t >= other.tMin && t <= other.tMax) return true;
        }

        return false;
    }

    /// <summary>
    /// Each wall found so far: a line along its foot and a see-through panel up to the measured
    /// height over the part that was seen, so the user can tell which walls are captured.
    /// </summary>
    void DrawWalls(float floorY)
    {
        var height = Mathf.Max(0.5f, builder.WallHeight);
        var used = 0;
        var recent = wallTracker.RecentlySeen;
        for (var i = 0; i < walls.Count; i++)
        {
            if (innerWalls[i] || walls[i].Length < settings.minCornerWallLength) continue;
            // Only what reads as a wall: wall-length pieces, and anything shorter only while it's
            // being seen. Remembered fragments (a cabinet side, a door frame) don't clutter the room.
            var seenNow = i >= recent.Count || recent[i];
            if (walls[i].Length < minTargetWallLength || (!seenNow && walls[i].Length < ShownRememberedWallLength))
                continue;
            // One blue panel per real wall: a shorter estimate lying on a longer one isn't drawn.
            if (LiesOnLongerWall(i)) continue;
            if (used >= wallLines.Count)
            {
                wallLines.Add(CreateLine($"AutoWall_{used}", 0.012f, wallMaterial, false));
                wallPanels.Add(wallPanelMaterial != null ? CreatePanel($"AutoWallPanel_{used}") : null);
            }

            var line = wallLines[used];
            var panel = wallPanels[used];
            used++;
            var a = walls[i].End(0);
            var b = walls[i].End(1);
            var footA = new Vector3(a.x, floorY + 0.008f, a.y);
            var footB = new Vector3(b.x, floorY + 0.008f, b.y);
            line.enabled = true;
            line.positionCount = 2;
            line.SetPosition(0, footA);
            line.SetPosition(1, footB);
            if (panel != null) SetPanel(panel, footA, footB, height);
        }

        for (var i = used; i < wallLines.Count; i++)
        {
            wallLines[i].enabled = false;
            if (wallPanels[i] != null) wallPanels[i].gameObject.SetActive(false);
        }
    }

    MeshFilter CreatePanel(string name)
    {
        var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
        go.transform.SetParent(root, false);
        var renderer = go.GetComponent<MeshRenderer>();
        renderer.sharedMaterial = wallPanelMaterial;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        var filter = go.GetComponent<MeshFilter>();
        filter.sharedMesh = new Mesh { name = name };
        filter.sharedMesh.MarkDynamic();
        go.SetActive(false);
        return filter;
    }

    /// <summary>Upright quad from <paramref name="footA"/> to <paramref name="footB"/> (the shader draws both sides).</summary>
    static void SetPanel(MeshFilter panel, Vector3 footA, Vector3 footB, float height)
    {
        var tr = panel.transform;
        var up = Vector3.up * height;
        var mesh = panel.sharedMesh;
        mesh.Clear();
        mesh.SetVertices(new[]
        {
            tr.InverseTransformPoint(footA),
            tr.InverseTransformPoint(footB),
            tr.InverseTransformPoint(footB + up),
            tr.InverseTransformPoint(footA + up),
        });
        mesh.SetTriangles(new[] { 0, 1, 2, 0, 2, 3 }, 0);
        mesh.RecalculateBounds();
        panel.gameObject.SetActive(true);
    }

    void DrawTarget(float now)
    {
        if (!HasTarget)
        {
            targetRing.enabled = false;
            targetPole.enabled = false;
            return;
        }

        const int segments = 32;
        var radius = 0.16f + 0.04f * Mathf.Sin(now * 6f);
        var c = TargetPoint + Vector3.up * 0.015f;
        targetRing.enabled = true;
        targetRing.positionCount = segments;
        for (var i = 0; i < segments; i++)
        {
            var a = i * Mathf.PI * 2f / segments;
            targetRing.SetPosition(i, c + new Vector3(Mathf.Cos(a) * radius, 0f, Mathf.Sin(a) * radius));
        }

        targetPole.enabled = true;
        targetPole.positionCount = 2;
        targetPole.SetPosition(0, c);
        targetPole.SetPosition(1, c + Vector3.up * 0.6f);
    }

    void HideVisuals()
    {
        foreach (var line in wallLines)
        {
            if (line != null) line.enabled = false;
        }

        foreach (var panel in wallPanels)
        {
            if (panel != null) panel.gameObject.SetActive(false);
        }

        if (targetRing != null) targetRing.enabled = false;
        if (targetPole != null) targetPole.enabled = false;
        HasTarget = false;
    }

    LineRenderer CreateLine(string name, float width, Material material, bool loop)
    {
        var go = new GameObject(name);
        go.transform.SetParent(root, false);
        var line = go.AddComponent<LineRenderer>();
        line.sharedMaterial = material;
        line.useWorldSpace = true;
        line.loop = loop;
        line.startWidth = width;
        line.endWidth = width;
        line.numCapVertices = 4;
        line.numCornerVertices = 4;
        line.alignment = LineAlignment.View;
        line.shadowCastingMode = ShadowCastingMode.Off;
        line.receiveShadows = false;
        line.positionCount = 0;
        line.enabled = false;
        return line;
    }

    // ── Test numbers ──────────────────────────────────────────────────────────

    void StartSession()
    {
        stats = new AutoScanStats
        {
            startedAt = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss"),
            device = SystemInfo.deviceModel,
        };
        sessionStartedAt = Time.unscaledTime;
        floorSetAt = heightSetAt = closedAt = -1f;
    }

    void RecordOutline()
    {
        if (stats == null) return;
        stats.cornersFinal = builder.CornerCount;
        var byHand = placed.Count - locked.Count;
        stats.cornersFinalAuto = Mathf.Max(0, builder.CornerCount - byHand);
        stats.cornersFinalByHand = Mathf.Min(byHand, builder.CornerCount);
        stats.openEndsAtClose = OpenEndCount;
        if (builder.CornerCount >= RoomPolygonUtil.MinCorners)
        {
            RoomMeasurementUtil.ComputePolygonExtents(builder.Corners, out var width, out var depth);
            stats.roomWidthM = width;
            stats.roomDepthM = depth;
            stats.floorAreaM2 = Mathf.Abs(RoomPolygonUtil.SignedArea(builder.Corners));
        }
    }

    void OnScanPhase(RoomScanController.ScanPhase phase)
    {
        if (phase == RoomScanController.ScanPhase.Confirmed)
            FinishSession("confirmed");
    }

    void FinishSession(string outcome)
    {
        if (stats == null) return;
        var now = Time.unscaledTime;
        stats.outcome = outcome;
        stats.totalSeconds = now - sessionStartedAt;
        if (floorSetAt > 0f) stats.floorSeconds = floorSetAt - sessionStartedAt;
        if (heightSetAt > 0f && floorSetAt > 0f) stats.heightSeconds = heightSetAt - floorSetAt;
        if (closedAt > 0f && heightSetAt > 0f) stats.wallsSeconds = closedAt - heightSetAt;

        var json = JsonUtility.ToJson(stats);
        Debug.Log($"[AutoScanStats] {json}");
        try
        {
            File.AppendAllText(Path.Combine(Application.persistentDataPath, StatsFileName), json + "\n");
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[AutoScan] Could not save scan stats: {e.Message}");
        }

        stats = null;
    }

    static Vector2 XZ(Vector3 v) => new(v.x, v.z);
    static Vector3 Flat(Vector3 v) => new(v.x, 0f, v.z);
}
