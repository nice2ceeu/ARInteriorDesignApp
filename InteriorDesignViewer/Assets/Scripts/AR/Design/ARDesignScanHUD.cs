using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.XR.ARSubsystems;

/// <summary>
/// Scan chrome for the room scan, ARPlan-inspired frosted cards:
///   • an instruction card (what to do now, one detail line) with a three-step bar
///     (Start · Walk around · Review) so the user always knows where they are; the walk finds
///     walls, doors, windows and furniture together, with a running count;
///   • live coaching from tracking problems ("Move slowly", "Too dark");
///   • a tool rail (Rescan with a second-tap confirm, Auto on/off, Light, Help);
///   • a mini floor plan of what's been mapped (large, with wall lengths, on the review step);
///   • short notes with a buzz when something sets itself (floor, height, corner, door, sofa);
///   • a first-run "how it works" card, which Help reopens;
///   • floor dots that turn green once enough floor is found (only then can the floor point be
///     set), a small aim dot instead of the placement ring while scanning, and the aiming circle
///     for the height step;
///   • a Review panel: ceiling height (+/−), everything found (× removes it), + Add;
///   • Skip on the height step (uses the usual ceiling height);
///   • Undo, which becomes Back in Review (back to walking, keeping everything found).
/// With the automatic scan (<see cref="ARAutoRoomScan"/>) it also shows the hold-still ring and an
/// arrow to a missing corner.
/// </summary>
[DefaultExecutionOrder(-90)]
public class ARDesignScanHUD : MonoBehaviour
{
    [SerializeField] private RoomScanController scanController;
    [SerializeField] private ARSceneBridge bridge;
    [SerializeField] private FurnitureCatalog catalog;
    [SerializeField] private ARPlacementIndicator placementIndicator;
    [SerializeField] private ARDesignCornerRoomBuilder cornerBuilder;
    [SerializeField] private ARDesignSpatialMappingController spatialMapping;
    [SerializeField] private bool spawnSampleOnConfirm = false;
    [SerializeField] private bool measurementOnlyMode = false;
    [SerializeField] private bool enableNativeHud = true;

    static readonly Color Ink = new(0.10f, 0.10f, 0.12f, 1f);
    static readonly Color InkMuted = new(0.35f, 0.36f, 0.40f, 1f);
    static readonly Color Frost = new(1f, 1f, 1f, 0.94f);
    static readonly Color FrostSoft = new(1f, 1f, 1f, 0.82f);
    static readonly Color AccentReady = new(0.18f, 0.55f, 0.42f, 1f);
    static readonly Color MeasurePurple = new(12f / 255f, 41f / 255f, 95f / 255f, 1f); // navy
    static readonly Color MeasurePurpleDisabled = new(0.55f, 0.56f, 0.58f, 0.85f);
    static readonly Color CoachBg = new(1f, 0.95f, 0.85f, 0.97f);
    static readonly Color CoachInk = new(0.47f, 0.26f, 0.03f, 1f);
    static readonly Color RescanArmed = new(0.86f, 0.24f, 0.22f, 1f);
    static readonly Color AutoOrange = new(1f, 0.55f, 0.15f, 1f);
    static readonly Color StepTodo = new(0.90f, 0.90f, 0.92f, 1f);
    static readonly Color ToastBg = new(0.11f, 0.11f, 0.13f, 0.92f);
    static readonly Color Scrim = new(0f, 0f, 0f, 0.62f);

    static readonly Color MapFoundWall = new(0.30f, 0.62f, 0.95f, 1f);
    static readonly Color MapFloor = new(0.12f, 0.12f, 0.14f, 0.07f);
    static readonly Color MapDoor = new(0.20f, 0.55f, 0.95f, 1f);
    static readonly Color MapWindow = new(0.95f, 0.72f, 0.12f, 1f);
    static readonly Color MapFurniture = new(0.55f, 0.35f, 0.20f, 0.55f);
    static readonly Color MapSuggestion = new(1f, 0.55f, 0.12f, 0.40f);
    static readonly Color MapUser = new(0.10f, 0.45f, 0.95f, 1f);
    static readonly Color MaybeChip = new(1f, 0.93f, 0.85f, 0.97f);
    static readonly Color AutoOrangeInk = new(0.75f, 0.35f, 0.05f, 1f);
    static readonly Color AimSearching = new(1f, 1f, 1f, 0.75f);
    static readonly Color AimOnFloor = new(0.35f, 0.92f, 0.55f, 1f);

    const int RetryCornerCount = 4;
    const float RescanConfirmSeconds = 3f;
    const string IntroSeenKey = "arScanIntroSeen";
    const float ToastSeconds = 1.8f;
    /// <summary>A note stays at least this long before a different one takes its place.</summary>
    const float ToastMinSeconds = 0.9f;
    const int ToastQueueMax = 3;
    const float MapRefreshInterval = 0.12f;

    // Layout (canvas units; the canvas is 1080 wide on 16:9 phones and about 966 on 20:9 ones).
    const float CardLeft = 196f;   // clears the app's back button at the top left
    const float CardRight = 24f;
    const float CardTop = 66f;
    const float CardHeight = 156f;
    const float CoachGap = 12f;
    const float CoachHeight = 80f;
    const float RailTop = CardTop + CardHeight + CoachGap + CoachHeight + 18f;
    const float RailWidth = 164f;
    const float RailItemHeight = 64f;
    const float RailGap = 12f;
    const float DockBottom = 78f;
    const float DockWidth = 740f;
    const float DockFullHeight = 180f;
    const float DockCompactHeight = 104f;
    const float CircleButtonsTop = 238f;
    const float MapSmall = 250f;
    const float MapLargeMax = 760f;
    const float MapGap = 20f;

    static readonly string[] SpatialStepNames = { "Start", "Walk around", "Review" };
    static readonly string[] OutlineStepNames = { "Height", "Walls" };
    /// <summary>Share of a full turn to count as having looked across the room (24 directions).</summary>
    const float SweepNeeded = 0.75f;
    const int SweepBuckets = 24;
    const float ReviewChipHeight = 56f;
    const float ReviewChipGap = 10f;
    const int ReviewColumns = 3;

    Canvas canvas;
    RectTransform canvasRect;
    Text topHintLabel;
    Text subtitleLabel;
    Image[] stepChips = System.Array.Empty<Image>();
    Text[] stepLabels = System.Array.Empty<Text>();
    Image[] stepChecks = System.Array.Empty<Image>();
    string[] stepNames = System.Array.Empty<string>();

    RectTransform bottomDock;
    RectTransform bottomShadow;
    float dockHeight = DockFullHeight;
    Button confirmButton;
    Button undoButton;
    Button auxTypeButton;
    Text auxTypeLabel;
    Text confirmLabel;
    Text undoLabel;
    Image confirmImage;
    Image undoImage;

    Button startButton;
    Button finishButton;
    Button heightUndoButton;
    Button skipHeightButton;
    Text startLabel;
    Text finishLabel;
    Text heightUndoLabel;
    Image startImage;
    Image finishImage;
    Image heightUndoImage;

    RectTransform coachChip;
    Text coachTitle;
    Text coachDetail;

    readonly List<(RectTransform holder, Button button)> railItems = new();
    Button rescanButton;
    Image rescanImage;
    Text rescanLabel;
    float rescanArmedUntil = -1f;
    Button autoToggleButton;
    Image autoToggleImage;
    Text autoToggleLabel;
    UnityEngine.XR.ARFoundation.ARCameraManager cameraManager;
    Button lightButton;
    Image lightImage;
    Text lightLabel;
    float nextLightCheckAt;
    bool lightSupported;
    Button helpButton;

    Image dwellRing;
    RectTransform targetArrow;
    RectTransform aimMark;
    RectTransform floorAimDot;
    Image floorAimDotImage;
    bool floorReadyShown;
    bool detectorWarmStarted;
    bool detectorWarmingUp;
    bool detectorWarmDone;
    /// <summary>A measured height under this (m) is flagged: it usually stopped at a door top or a shelf.</summary>
    const float LowCeilingMeters = 2.2f;
    /// <summary>A measured height over this (m) is flagged too: the floor point or the aim was off.</summary>
    const float HighCeilingMeters = 3.0f;
    /// <summary>A second Undo with no corners left before this goes back to the height step.</summary>
    const float RestartHeightConfirmSeconds = 4f;
    float restartHeightConfirmUntil = -1f;

    RectTransform mapPanel;
    ARScanMiniMap map;

    /// <summary>The world direction (x, z) that is up on the mini map / Review floor plan.</summary>
    public bool TryGetMapUp(out Vector2 up)
    {
        up = default;
        if (map == null || !mapFacing) return false;
        var angle = map.Frame.Angle;
        // The map turns floor-plan points by Angle (counter-clockwise); map-up (0, 1) comes from here.
        up = new Vector2(Mathf.Sin(angle), Mathf.Cos(angle));
        return true;
    }
    bool mapExpanded;
    bool mapUserToggled;
    bool mapFacing;
    bool mapSquared;
    float nextMapRefreshAt;
    readonly List<Vector2> mapScratch = new();

    struct PendingToast
    {
        public string key;
        public string text;
        public string pluralFormat;
        public int count;
    }

    RectTransform toastRect;
    CanvasGroup toastGroup;
    Text toastText;
    string toastKey;
    int toastCount;
    float toastShownAt;
    float toastUntil;
    readonly List<PendingToast> toastQueue = new();

    GameObject helpOverlay;
    Text helpButtonLabel;
    Text[] helpStepTitles = System.Array.Empty<Text>();
    Text[] helpStepBodies = System.Array.Empty<Text>();
    Image[] helpStepBadges = System.Array.Empty<Image>();
    bool introOffered;

    float nextLiveRefreshAt;
    ARScanGuidance guidance;
    ARAutoRoomScan autoScan;
    ARScanFloorGrid floorGrid;
    bool active;

    bool lastBaseSet;
    bool lastHeightLocked;
    bool lastLoopClosed;
    int lastCornerCount;
    int lastMapStep = -1;
    bool heightSkipped;

    readonly bool[] sweepBuckets = new bool[SweepBuckets];

    struct ReviewChip
    {
        public Button button;
        public Image image;
        public Text label;
    }

    RectTransform reviewPanel;
    Text reviewHeightValue;
    Text reviewListTitle;
    Text reviewEmptyLabel;
    RectTransform reviewGrid;
    readonly List<ReviewChip> reviewChips = new();
    string reviewSignature = string.Empty;
    bool choosingToAdd;

    bool AutoEnabled => autoScan != null && autoScan.Enabled;

    /// <summary>Automatic scan is driving the floor, height or walls step right now.</summary>
    bool AutoOutlineStep => AutoEnabled && autoScan.IsActive;

    /// <summary>Checking and fixing what the walk found (the outline is closed).</summary>
    bool InReview => spatialMapping != null && spatialMapping.IsReviewing;

    bool HelpVisible => helpOverlay != null && helpOverlay.activeSelf;

    bool Scanning => scanController != null && IsScanning(scanController.Phase);

    bool ShouldShowNativeHud()
    {
        // Dedicated AR Measurement scene keeps Unity chrome even when embedded in RN.
        if (measurementOnlyMode) return true;
        return !ARDesignHostDetect.IsEmbeddedInReactNative();
    }

    void Awake()
    {
        if (scanController == null) scanController = FindFirstObjectByType<RoomScanController>();
        if (bridge == null) bridge = FindFirstObjectByType<ARSceneBridge>();
        if (catalog == null) catalog = FindFirstObjectByType<FurnitureCatalog>();
        if (placementIndicator == null) placementIndicator = FindFirstObjectByType<ARPlacementIndicator>();
        if (cornerBuilder == null) cornerBuilder = FindFirstObjectByType<ARDesignCornerRoomBuilder>();
        if (spatialMapping == null) spatialMapping = FindFirstObjectByType<ARDesignSpatialMappingController>();
        if (measurementOnlyMode && spatialMapping == null && scanController != null)
            spatialMapping = EnsureSpatialMappingRuntime(scanController.gameObject);

        active = enableNativeHud && ShouldShowNativeHud();
        if (!active)
        {
            Debug.Log("[ARDesignScanHUD] Native HUD disabled (React Native host or flag off).");
            enabled = false;
            return;
        }

        if (measurementOnlyMode)
        {
            if (!ARDesignHostDetect.IsEmbeddedInReactNative())
                ARMainMenuBackButton.EnsureOn(gameObject);
            ARMeasurementRnBridge.EnsureOn(gameObject);
        }

        guidance = ARScanGuidance.EnsureOn(gameObject);
        floorGrid = ARScanFloorGrid.EnsureOn(gameObject);
        if (measurementOnlyMode)
        {
            autoScan = ARAutoRoomScan.EnsureOn(gameObject);
            ARPerfLog.EnsureOn(gameObject);
        }

        stepNames = spatialMapping != null ? SpatialStepNames : OutlineStepNames;

        try
        {
            BuildUi();
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[ARDesignScanHUD] Failed to build UI — continuing without HUD. {e}");
            active = false;
            enabled = false;
        }
    }

    void OnEnable()
    {
        if (!active || scanController == null) return;
        scanController.StatusChanged += OnStatus;
        scanController.PhaseChanged += OnPhase;
        if (cornerBuilder != null)
        {
            cornerBuilder.CornersChanged += OnCornersChanged;
            cornerBuilder.HeightPhaseChanged += OnCornersChanged;
            cornerBuilder.TapIgnored += OnTapIgnored;
        }

        if (spatialMapping != null)
        {
            spatialMapping.PhaseChanged += OnSpatialChanged;
            spatialMapping.DataChanged += OnSpatialChanged;
            spatialMapping.Noted += OnSpatialNote;
        }

        if (autoScan != null)
        {
            autoScan.Changed += OnCornersChanged;
            autoScan.Noted += OnAutoNote;
        }
    }

    void OnDisable()
    {
        if (active) TurnLightOff();
        if (floorGrid != null) floorGrid.Visible = false;
        if (active && placementIndicator != null) placementIndicator.HideVisuals = false;
        if (active && cornerBuilder != null) cornerBuilder.FloorPointAllowed = true;
        if (scanController == null) return;
        scanController.StatusChanged -= OnStatus;
        scanController.PhaseChanged -= OnPhase;
        if (cornerBuilder != null)
        {
            cornerBuilder.CornersChanged -= OnCornersChanged;
            cornerBuilder.HeightPhaseChanged -= OnCornersChanged;
            cornerBuilder.TapIgnored -= OnTapIgnored;
        }

        if (spatialMapping != null)
        {
            spatialMapping.PhaseChanged -= OnSpatialChanged;
            spatialMapping.DataChanged -= OnSpatialChanged;
            spatialMapping.Noted -= OnSpatialNote;
        }

        if (autoScan != null)
        {
            autoScan.Changed -= OnCornersChanged;
            autoScan.Noted -= OnAutoNote;
        }
    }

    void OnSpatialChanged() => RefreshCornerUi();

    void Start()
    {
        if (!active || scanController == null) return;
        SnapshotMilestones();
        OnStatus(scanController.GetScanStatus());
        ApplyReticle(scanController.Phase);
        RefreshCornerUi();
        if (Scanning) MaybeShowIntro();
    }

    void OnCornersChanged() => RefreshCornerUi();

    void Update()
    {
        if (!active || cornerBuilder == null) return;
        MaybeWarmUpDetector();
        TrackMilestones();
        TrackClutterHint();
        TrackSweep();
        TrackCornerSnap();

        // Live height / width readouts (and the automatic scan's hold progress) change all the
        // time; about 12 refreshes a second reads the same and rebuilds the UI far less.
        if ((cornerBuilder.IsInHeightPhase || cornerBuilder.CornerCount > 0 || AutoOutlineStep)
            && Time.unscaledTime >= nextLiveRefreshAt)
        {
            nextLiveRefreshAt = Time.unscaledTime + 0.08f;
            RefreshCornerUi();
        }

        RefreshCoaching();
        RefreshRescanButton();
        RefreshAutoOverlay();
        RefreshAutoToggle();
        RefreshLightButton();
        RefreshHelpButton();
        LayoutRail();
        RefreshAimMark();
        RefreshFloorGrid();
        RefreshFloorAimDot();
        if (Time.unscaledTime >= nextMapRefreshAt)
        {
            nextMapRefreshAt = Time.unscaledTime + MapRefreshInterval;
            RefreshMap();
        }

        TickToast();
    }

    /// <summary>
    /// The object detector's first run compiles its GPU programs and freezes the phone for several
    /// seconds. It used to land the moment the walk started (right after the height); now it runs
    /// once when the scanner opens, with the card saying so and the floor point on hold.
    /// </summary>
    void MaybeWarmUpDetector()
    {
        if (detectorWarmStarted || spatialMapping == null || !Scanning || !cornerBuilder.IsInHeightPhase) return;
        if (spatialMapping.IsDetectorWarm) return;

        // Not while ARCore is still starting: a long pause then left the camera black (the session
        // paused and its restart waited behind the warm-up). Wait for steady tracking, or give up
        // waiting after a while so the scan can't get stuck here.
        var tracking = UnityEngine.XR.ARFoundation.ARSession.state == UnityEngine.XR.ARFoundation.ARSessionState.SessionTracking;
        if (warmWaitStartedAt < 0f) warmWaitStartedAt = Time.unscaledTime;
        if (!tracking) trackingSteadySince = -1f;
        else if (trackingSteadySince < 0f) trackingSteadySince = Time.unscaledTime;
        var steady = tracking && Time.unscaledTime - trackingSteadySince >= SteadyTrackingSeconds;
        if (!steady && Time.unscaledTime - warmWaitStartedAt < MaxWarmWaitSeconds) return;

        detectorWarmStarted = true;
        StartCoroutine(WarmUpDetectorRoutine());
    }

    const float SteadyTrackingSeconds = 1.5f;
    const float MaxWarmWaitSeconds = 20f;
    float warmWaitStartedAt = -1f;
    float trackingSteadySince = -1f;

    /// <summary>The floor point can be set: the detector is ready (or there is none), so no freeze is waiting.</summary>
    bool DetectorReadyForScan => spatialMapping == null || !detectorWarmingUp && (spatialMapping.IsDetectorWarm || detectorWarmDone);

    System.Collections.IEnumerator WarmUpDetectorRoutine()
    {
        detectorWarmingUp = true;
        RefreshCornerUi();
        // The app shows a spinner over Unity (it keeps moving while Unity is busy).
        UnityMessageBridge.SendToApp("scannerPreparing", string.Empty);
        // Let the "getting ready" card and the spinner reach the screen before the model loads.
        yield return null;
        yield return new WaitForEndOfFrame();
        try
        {
            // Spread over frames: the camera keeps moving and the card counts up.
            var warmUp = spatialMapping.WarmUpDetectorRoutine();
            if (warmUp != null) yield return warmUp;
        }
        finally
        {
            detectorWarmingUp = false;
            detectorWarmDone = true;
            UnityMessageBridge.SendToApp("scannerReady", string.Empty);
            RefreshCornerUi();
        }
    }

    void OnPhase(RoomScanController.ScanPhase phase)
    {
        if (canvas != null)
            canvas.gameObject.SetActive(phase != RoomScanController.ScanPhase.Confirmed);
        if (!IsScanning(phase))
        {
            TurnLightOff();
            if (HelpVisible) HideHelp(markSeen: false);
        }

        if (guidance != null)
            guidance.enabled = IsScanning(phase);

        ApplyReticle(phase);
        RefreshCornerUi();
        if (phase == RoomScanController.ScanPhase.Scanning)
            MaybeShowIntro();
    }

    void ApplyReticle(RoomScanController.ScanPhase phase)
    {
        if (placementIndicator == null) return;

        // The placement ring (and its measuring icon) read as "measuring" before anything was set,
        // so the scan aims with its own small dot instead; the ring is back for placing furniture.
        placementIndicator.HideVisuals = IsScanning(phase);

        if (phase != RoomScanController.ScanPhase.Scanning
            && phase != RoomScanController.ScanPhase.ReadyToConfirm)
        {
            placementIndicator.StopTracking(clearOverlay: true);
            return;
        }

        // Height base: show measurement icon. After Finish: hide reticle — width uses the line only.
        if (cornerBuilder != null)
        {
            if (cornerBuilder.IsInHeightPhase && !cornerBuilder.HasHeightBase)
            {
                cornerBuilder.RefreshHeightPlacementIndicator();
                return;
            }

            if (cornerBuilder.IsInHeightPhase)
                return; // base locked; leave overlay frozen until Finish

            if (measurementOnlyMode && cornerBuilder.IsHeightLocked
                && !(AutoEnabled && !cornerBuilder.IsLoopClosed))
            {
                placementIndicator.StopTracking(clearOverlay: true);
                return;
            }
        }

        placementIndicator.StartTracking();
    }

    void OnStatus(ScanStatusPayload status)
    {
        if (!active || status == null) return;
        RefreshCornerUi();
    }

    // ── Which step ────────────────────────────────────────────────────────────

    /// <summary>0 Start (floor point and ceiling height), 1 Walk around, 2 Review.</summary>
    int CurrentStepIndex()
    {
        if (InReview) return 2;
        return cornerBuilder != null && cornerBuilder.IsInHeightPhase ? 0 : 1;
    }

    void RefreshStepBar()
    {
        var current = Mathf.Min(CurrentStepIndex(), stepChips.Length - 1);
        for (var i = 0; i < stepChips.Length; i++)
        {
            var done = i < current;
            var now = i == current;
            stepChips[i].color = done ? AccentReady : now ? Ink : StepTodo;
            stepLabels[i].color = done || now ? Color.white : InkMuted;
            stepLabels[i].fontStyle = now ? FontStyle.Bold : FontStyle.Normal;
            if (stepChecks[i].gameObject.activeSelf != done)
            {
                stepChecks[i].gameObject.SetActive(done);
                // Leave room for the tick on finished steps.
                stepLabels[i].rectTransform.offsetMin = new Vector2(done ? 26f : 6f, 0f);
            }
        }
    }

    // ── Start and walk ────────────────────────────────────────────────────────

    void RefreshCornerUi()
    {
        if (InReview)
        {
            RefreshReviewUi();
            RefreshStepBar();
            ApplyDockLayout();
            return;
        }

        choosingToAdd = false;
        if (reviewPanel != null && reviewPanel.gameObject.activeSelf)
            reviewPanel.gameObject.SetActive(false);
        var autoWalls = AutoEnabled && autoScan.CurrentStep == ARAutoRoomScan.Step.Walls;
        if (auxTypeButton != null)
        {
            // Automatic walk: "Start over" drops every corner and looks at the walls again.
            auxTypeButton.gameObject.SetActive(autoWalls);
            if (autoWalls && auxTypeLabel != null)
                auxTypeLabel.text = "Start over";
        }

        var inHeightPhase = cornerBuilder != null && cornerBuilder.IsInHeightPhase;
        var count = cornerBuilder != null ? cornerBuilder.CornerCount : 0;
        var canConfirmHeight = cornerBuilder != null && cornerBuilder.CanConfirmHeight;
        var canCloseWidth = cornerBuilder != null && cornerBuilder.CanClose;
        var canConfirmWidth = cornerBuilder != null && cornerBuilder.CanConfirm;
        var outlineCrosses = cornerBuilder != null && cornerBuilder.IsOutlineSelfIntersecting;
        var canRectangle = AutoEnabled && autoScan.CanFinishAsRectangle(out _);
        var canConfirm = inHeightPhase ? canConfirmHeight : (canConfirmWidth || canCloseWidth || canRectangle);

        if (cornerBuilder != null)
        {
            BuildOutlineTexts(out var title, out var subtitle);
            if (topHintLabel != null) topHintLabel.text = title;
            if (subtitleLabel != null) subtitleLabel.text = subtitle;
        }

        if (undoButton != null)
        {
            // Automatic walk: Undo takes back a corner, or with none goes back to the height.
            var canUndo = inHeightPhase ? cornerBuilder.HasHeightBase : count > 0 || autoWalls;
            undoButton.interactable = canUndo;
            if (undoImage != null)
                undoImage.color = canUndo ? Frost : FrostSoft;
            if (undoLabel != null)
            {
                undoLabel.text = IsRetryMode() ? "Retry" : "Undo";
                undoLabel.color = canUndo ? Ink : InkMuted;
            }
        }

        var useStartFinish = measurementOnlyMode && inHeightPhase;

        if (bottomDock != null)
            bottomDock.gameObject.SetActive(!useStartFinish);
        if (bottomShadow != null)
            bottomShadow.gameObject.SetActive(!useStartFinish);

        if (startButton != null)
        {
            var showStart = useStartFinish && !cornerBuilder.HasHeightBase;
            startButton.gameObject.SetActive(showStart);
            if (showStart)
            {
                var canStart = cornerBuilder.CanStartHeight && FloorReady;
                startButton.interactable = canStart;
                if (startImage != null)
                    startImage.color = canStart ? MeasurePurple : MeasurePurpleDisabled;
                if (startLabel != null)
                    startLabel.color = canStart ? Color.white : new Color(1f, 1f, 1f, 0.55f);
            }
        }

        if (finishButton != null)
        {
            var showFinish = useStartFinish && cornerBuilder.HasHeightBase;
            finishButton.gameObject.SetActive(showFinish);
            if (showFinish)
            {
                finishButton.interactable = canConfirmHeight;
                if (finishImage != null)
                    finishImage.color = canConfirmHeight ? MeasurePurple : MeasurePurpleDisabled;
                if (finishLabel != null)
                    finishLabel.color = canConfirmHeight
                        ? Color.white
                        : new Color(1f, 1f, 1f, 0.55f);
            }
        }

        // Undo and Skip sit either side of Finish once the floor point is set.
        var showHeightSides = useStartFinish && cornerBuilder.HasHeightBase;
        if (heightUndoButton != null)
            heightUndoButton.gameObject.SetActive(showHeightSides);
        if (skipHeightButton != null)
            skipHeightButton.gameObject.SetActive(showHeightSides);

        if (confirmButton != null)
        {
            if (useStartFinish)
            {
                confirmButton.gameObject.SetActive(false);
            }
            else
            {
                confirmButton.gameObject.SetActive(true);
                confirmButton.interactable = canConfirm;
                if (confirmLabel != null)
                {
                    if (inHeightPhase)
                    {
                        confirmLabel.text = cornerBuilder.HasHeightBase ? "Set height" : "Set base";
                        confirmLabel.color = canConfirmHeight ? Color.white : InkMuted;
                    }
                    else
                    {
                        if (canConfirmWidth)
                            confirmLabel.text = measurementOnlyMode ? "Continue" : "Done";
                        else if (canRectangle)
                            confirmLabel.text = "Finish as rectangle";
                        else if (canCloseWidth)
                            confirmLabel.text = spatialMapping != null ? "Finish" : "Close room";
                        else if (outlineCrosses)
                            confirmLabel.text = "Fix a corner";
                        else if (autoWalls)
                            confirmLabel.text = "Finding corners…";
                        else
                            confirmLabel.text = "Add corners";
                        // Waiting states stay readable: dark text on a light chip.
                        confirmLabel.color = canConfirm ? Color.white : InkMuted;
                    }
                }

                if (confirmImage != null)
                    confirmImage.color = canConfirm ? AccentReady : StepTodo;
            }
        }

        RefreshStepBar();
        ApplyDockLayout();
    }

    const string FindFloorHint = "Move the phone slowly until dots appear on the floor";
    const string FloorGrowingHint = "Keep moving slowly until the dots turn green";

    /// <summary>The floor step's detail line until the floor is found (dots green).</summary>
    string FloorSearchHint() => floorGrid != null && floorGrid.HasFloor ? FloorGrowingHint : FindFloorHint;

    /// <summary>Setting the floor point, and the aim has snapped onto a room corner.</summary>
    bool AimOnCorner =>
        cornerBuilder != null && cornerBuilder.IsInHeightPhase && !cornerBuilder.HasHeightBase
        && placementIndicator != null && placementIndicator.IsLockedOnFloor
        && placementIndicator.CurrentAimKind == ARPlacementIndicator.AimKind.Corner;

    bool wasAimOnCorner;

    /// <summary>A light tick when the floor point's aim snaps onto a corner.</summary>
    void TrackCornerSnap()
    {
        var onCorner = AimOnCorner;
        if (onCorner && !wasAimOnCorner) ARScanHaptics.Play(ARScanHaptics.Kind.Tick);
        wasAimOnCorner = onCorner;
    }

    int LiveHeightCm() => cornerBuilder != null && cornerBuilder.HasLiveHeightPreview
        ? Mathf.RoundToInt(cornerBuilder.LiveHeightMeters * 100f)
        : 0;

    static string Plural(int n, string one, string many) => n == 1 ? $"1 {one}" : $"{n} {many}";

    /// <summary>"3 corners · 1 door · 2 windows · 2 furniture items" — what the walk has found so far.</summary>
    string FoundSummary(int corners)
    {
        var parts = new List<string> { Plural(corners, "corner", "corners") };
        if (spatialMapping != null)
        {
            if (spatialMapping.DoorCount > 0) parts.Add(Plural(spatialMapping.DoorCount, "door", "doors"));
            if (spatialMapping.WindowCount > 0) parts.Add(Plural(spatialMapping.WindowCount, "window", "windows"));
            if (spatialMapping.ObstacleCount > 0) parts.Add(Plural(spatialMapping.ObstacleCount, "furniture item", "furniture items"));
        }

        return string.Join(" · ", parts);
    }

    // ── Looking across the room once the outline is complete ─────────────────

    /// <summary>The outline has every corner, so the walk could end.</summary>
    bool WalkOutlineComplete()
    {
        if (cornerBuilder == null || !cornerBuilder.IsHeightLocked || cornerBuilder.IsLoopClosed) return false;
        if (cornerBuilder.IsOutlineSelfIntersecting) return false;
        return AutoEnabled ? autoScan.OutlineLooksComplete : cornerBuilder.CanClose;
    }

    /// <summary>
    /// After the outline is complete, the user is asked to turn once across the room (furniture in
    /// the middle is missed when the camera only looked at the walls). Tracked by the directions
    /// the camera has faced since.
    /// </summary>
    void TrackSweep()
    {
        if (!Scanning || !cornerBuilder.IsHeightLocked)
        {
            System.Array.Clear(sweepBuckets, 0, sweepBuckets.Length);
            return;
        }

        if (!WalkOutlineComplete()) return;
        var cam = Camera.main;
        if (cam == null) return;
        var forward = cam.transform.forward;
        if (new Vector2(forward.x, forward.z).sqrMagnitude < 1e-4f) return;
        var yaw = Mathf.Repeat(Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg, 360f);
        sweepBuckets[Mathf.Clamp(Mathf.FloorToInt(yaw / (360f / SweepBuckets)), 0, SweepBuckets - 1)] = true;
    }

    float SweepProgress()
    {
        var seen = 0;
        foreach (var b in sweepBuckets)
            if (b) seen++;
        return Mathf.Clamp01(seen / (SweepBuckets * SweepNeeded));
    }

    /// <summary>Title and detail once the outline is complete: look across the room, then Finish.</summary>
    void WalkCompleteTexts(int corners, out string title, out string subtitle)
    {
        var sweep = SweepProgress();
        if (sweep < 1f)
        {
            title = "Room outline found";
            subtitle = $"Now turn slowly to look across the whole room ({Mathf.RoundToInt(sweep * 100f)}%)";
        }
        else
        {
            title = "All done walking";
            subtitle = $"{FoundSummary(corners)} · tap Finish";
        }
    }

    /// <summary>Title (what to do now) and one detail line for the start and the walk.</summary>
    void BuildOutlineTexts(out string title, out string subtitle)
    {
        if (detectorWarmingUp)
        {
            title = "Getting the scanner ready…";
            var percent = Mathf.RoundToInt(spatialMapping.DetectorWarmUpProgress * 100f);
            subtitle = $"{percent}% · longer the first time after an install";
            return;
        }

        if (!DetectorReadyForScan && cornerBuilder.IsInHeightPhase && !cornerBuilder.HasHeightBase)
        {
            title = "Getting the scanner ready…";
            subtitle = "Move the phone slowly so it can see the room";
            return;
        }

        if (TryBuildAutoText(out title, out subtitle)) return;

        var count = cornerBuilder.CornerCount;
        if (cornerBuilder.IsInHeightPhase)
        {
            // By hand, the floor point is also the first corner of the outline.
            if (!cornerBuilder.HasHeightBase)
            {
                if (!FloorReady)
                {
                    title = "Point at the floor";
                    subtitle = FloorSearchHint();
                    return;
                }

                title = "Floor found · aim the dot at a floor corner";
                var onFloor = placementIndicator != null && placementIndicator.IsLockedOnFloor;
                subtitle = !onFloor ? "Aim the camera down at the floor"
                    : AimOnCorner ? (measurementOnlyMode ? "Corner found · tap Start" : "Corner found · tap to set it")
                    : measurementOnlyMode ? "Tap Start · this is your first corner"
                    : "Tap to set it · this is your first corner";
                return;
            }

            title = "Aim up that corner to the ceiling";
            var cm = LiveHeightCm();
            subtitle = cm >= 180 ? $"{cm} cm · tap Set height when the line reaches the ceiling"
                : cm > 0 ? $"{cm} cm · aim higher, or tap Skip"
                : "Tilt the phone up slowly, or tap Skip";
            return;
        }

        // After a measured height, ceiling corners are the way round the room: furniture doesn't
        // hide them, and a line shows where each one lands on the floor.
        var byCeiling = autoScan != null && autoScan.CeilingAimAvailable;
        title = byCeiling ? "Aim at the next ceiling corner" : "Tap each corner of the room on the floor";
        if (cornerBuilder.IsOutlineSelfIntersecting)
        {
            title = "A corner is in the wrong place";
            subtitle = "Tap Undo to move the last corner";
        }
        else if (cornerBuilder.IsSteadying)
        {
            subtitle = "Hold still · placing the corner";
        }
        else if (cornerBuilder.CanConfirm)
        {
            subtitle = $"{count} walls · room closed";
        }
        else if (spatialMapping != null && WalkOutlineComplete())
        {
            WalkCompleteTexts(count, out title, out subtitle);
            if (SweepProgress() >= 1f)
            {
                // Tapping corners by hand: the outline can close before the last corner is tapped.
                title = "Every corner tapped?";
                subtitle = $"{FoundSummary(count)} · then tap Finish";
            }
        }
        else if (autoScan != null && autoScan.AimFromCeiling)
        {
            subtitle = "Tap to place the corner below it";
        }
        else if (count <= 1)
        {
            subtitle = byCeiling ? "Corner 1 is set · aim up at the next corner of the room"
                : measurementOnlyMode ? "Your floor point is corner 1 · walk to the next corner and tap it"
                : "Aim at a floor corner and tap";
        }
        else if (cornerBuilder.HasLivePreview)
        {
            var cm = Mathf.RoundToInt(cornerBuilder.LivePreviewDistanceMeters * 100f);
            subtitle = byCeiling ? $"{cm} cm to here · tap, or aim up at the ceiling corner"
                : $"{FoundSummary(count)} · {cm} cm to here";
        }
        else
        {
            subtitle = byCeiling ? $"{FoundSummary(count)} · back at corner 1 closes the room"
                : $"{FoundSummary(count)} · keep going";
        }
    }

    /// <summary>Title and detail for the floor point, height and walk of the automatic scan.</summary>
    bool TryBuildAutoText(out string title, out string subtitle)
    {
        title = null;
        subtitle = null;
        if (!AutoEnabled || cornerBuilder == null) return false;

        var holding = autoScan.DwellProgress > 0f;
        switch (autoScan.CurrentStep)
        {
            case ARAutoRoomScan.Step.Floor:
            {
                if (!FloorReady)
                {
                    title = "Point at the floor";
                    subtitle = FloorSearchHint();
                    return true;
                }

                // As by hand, the floor point is corner 1 of the outline.
                title = "Floor found · aim the dot at a floor corner";
                var onFloor = placementIndicator != null && placementIndicator.IsLockedOnFloor;
                subtitle = holding ? (AimOnCorner ? "Corner found · hold still…" : "Hold still… this is your first corner")
                    : AimOnCorner ? "Corner found · hold still to set it"
                    : onFloor ? "Hold still 2 s to set it · or tap"
                    : "Aim the camera down at the floor";
                return true;
            }

            case ARAutoRoomScan.Step.Height:
            {
                title = "Aim the circle where the wall meets the ceiling";
                var cm = LiveHeightCm();
                if (holding)
                    subtitle = $"{cm} cm · hold still…";
                else if (cm >= 180)
                    subtitle = $"{cm} cm · hold still to set it, or tap Set height";
                else if (cm > 0)
                    subtitle = $"{cm} cm · aim higher, or tap Skip";
                else
                    subtitle = "Tilt the phone up slowly, or tap Skip";
                return true;
            }

            case ARAutoRoomScan.Step.Walls:
                if (cornerBuilder.IsOutlineSelfIntersecting)
                {
                    title = "A corner is in the wrong place";
                    subtitle = "Press and hold it to remove it, or tap Undo";
                }
                else if (autoScan.OutlineLooksComplete)
                {
                    WalkCompleteTexts(autoScan.CornerCount, out title, out subtitle);
                }
                else
                {
                    title = "Walk slowly around the room";
                    if (holding && autoScan.AimFromCeiling)
                        subtitle = "Ceiling corner · hold still to place the corner below it…";
                    else if (holding)
                        subtitle = "Hold still to place the corner…";
                    // Enough corners for a room: the orange marker is only a hint, corner 1 closes it.
                    else if (autoScan.CanCloseAtStart)
                        subtitle = autoScan.HasTarget ? "Next corner (orange marker), or tap corner 1 to finish"
                            : "Next corner, or tap corner 1 to finish";
                    else if (autoScan.WallCount == 0)
                        subtitle = "Point the phone at a wall about 2 m away";
                    else if (autoScan.HasTarget)
                        subtitle = "Walk to the orange marker and hold the dot on it";
                    else
                        subtitle = $"{FoundSummary(autoScan.CornerCount)} · keep going along the walls";
                }
                return true;
        }

        return false;
    }

    // ── Review ────────────────────────────────────────────────────────────────

    /// <summary>Check and fix what the walk found, then save the room.</summary>
    void RefreshReviewUi()
    {
        if (spatialMapping == null) return;

        if (bottomDock != null) bottomDock.gameObject.SetActive(true);
        if (bottomShadow != null) bottomShadow.gameObject.SetActive(true);
        if (startButton != null) startButton.gameObject.SetActive(false);
        if (finishButton != null) finishButton.gameObject.SetActive(false);
        if (heightUndoButton != null) heightUndoButton.gameObject.SetActive(false);
        if (skipHeightButton != null) skipHeightButton.gameObject.SetActive(false);
        if (auxTypeButton != null) auxTypeButton.gameObject.SetActive(false);

        var mode = spatialMapping.CurrentAddMode;
        var adding = mode != ARDesignSpatialMappingController.AddMode.None;
        var thing = mode switch
        {
            ARDesignSpatialMappingController.AddMode.Door => "door",
            ARDesignSpatialMappingController.AddMode.Window => "window",
            _ => spatialMapping.AddingFurnitureType,
        };

        if (topHintLabel != null)
        {
            topHintLabel.text = adding ? $"Adding a {thing}"
                : choosingToAdd ? "What did the scan miss?"
                : "Check your room";
        }

        if (subtitleLabel != null)
        {
            if (mode == ARDesignSpatialMappingController.AddMode.Furniture)
                subtitleLabel.text = $"Tap the floor where the {thing} stands";
            else if (adding)
                subtitleLabel.text = spatialMapping.HasPendingOpeningEdge
                    ? "Now tap the floor at its other edge"
                    : $"Tap the floor at one edge of the {thing}";
            else if (choosingToAdd)
                subtitleLabel.text = "Pick it below, then tap where it is";
            else
                subtitleLabel.text = BuildReviewSummary();
        }

        if (undoButton != null)
        {
            var canUndo = spatialMapping.CanUndo();
            // Nothing to undo: Back returns to the walk (everything found is kept).
            var showBack = !adding && !canUndo;
            undoButton.interactable = canUndo || showBack;
            if (undoImage != null) undoImage.color = undoButton.interactable ? Frost : FrostSoft;
            undoLabel.text = showBack ? "Back" : "Undo";
            undoLabel.color = undoButton.interactable ? Ink : InkMuted;
        }

        if (confirmButton != null)
        {
            confirmButton.gameObject.SetActive(true);
            confirmButton.interactable = true;
            var cancel = adding || choosingToAdd;
            confirmLabel.text = cancel ? "Cancel" : "Scan complete";
            confirmLabel.color = cancel ? Ink : Color.white;
            if (confirmImage != null)
                confirmImage.color = cancel ? StepTodo : AccentReady;
        }

        RefreshReviewPanel();
    }

    /// <summary>"L 4.2m × W 3.1m × H 2.5m" for the review step (the list below names everything found).</summary>
    string BuildReviewSummary()
    {
        if (cornerBuilder == null || cornerBuilder.CornerCount < 3) return string.Empty;
        RoomMeasurementUtil.ComputePolygonExtents(cornerBuilder.Corners, out var width, out var depth);
        var size = RoomMeasurementUtil.FormatDimensionLabel(width, depth, cornerBuilder.WallHeight);
        return string.IsNullOrEmpty(size) ? "Your room" : size;
    }

    static string Capitalize(string s) =>
        string.IsNullOrEmpty(s) ? s : char.ToUpperInvariant(s[0]) + s.Substring(1);

    /// <summary>
    /// The panel above the floor plan: ceiling height with − / +, then either everything found
    /// (tap a chip to remove it, a "?" chip to add a maybe, + Add for something missed) or, while
    /// choosing, the kinds of things that can be added.
    /// </summary>
    void RefreshReviewPanel()
    {
        if (reviewPanel == null) return;
        var show = InReview && Scanning && !HelpVisible;
        if (reviewPanel.gameObject.activeSelf != show)
            reviewPanel.gameObject.SetActive(show);
        if (!show) return;

        reviewHeightValue.text = $"{cornerBuilder.WallHeight:0.00} m";

        var items = new List<(string key, string label, Color bg, Color text, UnityEngine.Events.UnityAction onClick)>();
        var adding = spatialMapping.CurrentAddMode != ARDesignSpatialMappingController.AddMode.None;
        if (adding)
        {
            reviewListTitle.text = "Adding";
            items.Add(("cancel", "Cancel", StepTodo, Ink, OnCancelAdding));
        }
        else if (choosingToAdd)
        {
            reviewListTitle.text = "Add";
            items.Add(("add-door", "Door", Frost, Ink, () => OnChooseToAdd(ARDesignSpatialMappingController.AddMode.Door, null)));
            items.Add(("add-window", "Window", Frost, Ink, () => OnChooseToAdd(ARDesignSpatialMappingController.AddMode.Window, null)));
            foreach (var type in ARDesignSpatialMappingController.FurnitureTypes)
            {
                var t = type;
                items.Add(($"add-{t}", Capitalize(t), Frost, Ink, () => OnChooseToAdd(ARDesignSpatialMappingController.AddMode.Furniture, t)));
            }

            items.Add(("cancel", "Cancel", StepTodo, Ink, OnCancelAdding));
        }
        else
        {
            reviewListTitle.text = "In this room · tap one to remove it";
            foreach (var o in spatialMapping.Openings)
            {
                var id = o.id;
                items.Add(($"o:{id}", $"{Capitalize(o.type)}  ×", Frost, Ink, () => OnRemoveOpening(id)));
            }

            foreach (var o in spatialMapping.Obstacles)
            {
                var id = o.id;
                items.Add(($"f:{id}", $"{Capitalize(o.type)}  ×", Frost, Ink, () => OnRemoveObstacle(id)));
            }

            // Only what the camera recognised; flat-surface guesses stay as faint boxes in the room.
            foreach (var s in spatialMapping.PendingSuggestions)
            {
                if (s.source != "coco") continue;
                var id = s.id;
                items.Add(($"m:{id}", $"{Capitalize(s.type)}?  +", MaybeChip, AutoOrangeInk, () => OnAcceptMaybe(id)));
            }

            items.Add(("add", "+ Add", AccentReady, Color.white, OnAddClicked));
        }

        var nothingFound = !adding && !choosingToAdd && items.Count == 1;
        if (reviewEmptyLabel.gameObject.activeSelf != nothingFound)
            reviewEmptyLabel.gameObject.SetActive(nothingFound);

        // Rebuild the chips only when what they show changes (their click handlers capture ids).
        var signature = string.Join("|", items.ConvertAll(i => i.key + i.label));
        if (signature != reviewSignature)
        {
            reviewSignature = signature;
            while (reviewChips.Count < items.Count)
                reviewChips.Add(CreateReviewChip());
            for (var i = 0; i < reviewChips.Count; i++)
            {
                var chip = reviewChips[i];
                var visible = i < items.Count;
                chip.button.gameObject.SetActive(visible);
                if (!visible) continue;
                var item = items[i];
                chip.label.text = item.label;
                chip.label.color = item.text;
                chip.image.color = item.bg;
                chip.button.onClick.RemoveAllListeners();
                chip.button.onClick.AddListener(item.onClick);
            }
        }

        LayoutReviewPanel(items.Count, nothingFound);
    }

    void LayoutReviewPanel(int chipCount, bool showEmpty)
    {
        var rows = Mathf.Max(1, Mathf.CeilToInt(chipCount / (float)ReviewColumns));
        var gridHeight = rows * ReviewChipHeight + (rows - 1) * ReviewChipGap;
        const float heightRow = 64f;
        const float titleRow = 40f;
        var emptyRow = showEmpty ? 48f : 0f;
        var panelHeight = 18f + heightRow + 8f + titleRow + emptyRow + gridHeight + 18f;

        reviewGrid.anchoredPosition = new Vector2(0f, 18f);
        reviewGrid.sizeDelta = new Vector2(reviewGrid.sizeDelta.x, gridHeight);
        reviewEmptyLabel.rectTransform.anchoredPosition = new Vector2(0f, 18f + gridHeight + 4f);

        var width = ReviewWidth();
        reviewPanel.sizeDelta = new Vector2(width, panelHeight);
        var grid = reviewGrid.GetComponent<GridLayoutGroup>();
        grid.cellSize = new Vector2((width - 36f - ReviewChipGap * (ReviewColumns - 1)) / ReviewColumns, ReviewChipHeight);

        // Sits on top of the floor plan (which makes room for it, see ApplyMapLayout).
        var mapTop = mapPanel != null && mapPanel.gameObject.activeSelf
            ? mapPanel.anchoredPosition.y + mapPanel.sizeDelta.y
            : DockTop();
        reviewPanel.anchoredPosition = new Vector2(0f, mapTop + 12f);
    }

    float ReviewWidth()
    {
        var canvasWidth = canvasRect != null && canvasRect.rect.width > 0f ? canvasRect.rect.width : 1080f;
        return Mathf.Min(canvasWidth - 48f, MapLargeMax);
    }

    /// <summary>Height the review panel takes, so the floor plan can shrink to fit under it.</summary>
    float ReviewPanelHeight() =>
        reviewPanel != null && reviewPanel.gameObject.activeSelf ? reviewPanel.sizeDelta.y + 12f : 0f;

    void OnAddClicked()
    {
        choosingToAdd = true;
        RefreshCornerUi();
    }

    void OnChooseToAdd(ARDesignSpatialMappingController.AddMode mode, string furnitureType)
    {
        choosingToAdd = false;
        spatialMapping.StartAdding(mode, furnitureType);
        RefreshCornerUi();
    }

    void OnCancelAdding()
    {
        choosingToAdd = false;
        spatialMapping.CancelAdding();
        RefreshCornerUi();
    }

    void OnRemoveOpening(string id)
    {
        spatialMapping.RemoveOpening(id);
        RefreshCornerUi();
    }

    void OnRemoveObstacle(string id)
    {
        spatialMapping.RemoveObstacle(id);
        RefreshCornerUi();
    }

    void OnAcceptMaybe(string id)
    {
        spatialMapping.AcceptSuggestion(id);
        RefreshCornerUi();
    }

    void OnHeightStep(float delta)
    {
        if (cornerBuilder == null) return;
        cornerBuilder.SetWallHeight(Mathf.Round((cornerBuilder.WallHeight + delta) * 100f) / 100f);
        RefreshCornerUi();
    }

    // ── Notes and milestones ──────────────────────────────────────────────────

    void SnapshotMilestones()
    {
        if (cornerBuilder == null) return;
        lastBaseSet = cornerBuilder.HasHeightBase;
        lastHeightLocked = cornerBuilder.IsHeightLocked;
        lastLoopClosed = cornerBuilder.IsLoopClosed;
        lastCornerCount = cornerBuilder.CornerCount;
    }

    /// <summary>Floor point, height and closed outline, whether set by hand or by the automatic scan.</summary>
    void TrackMilestones()
    {
        if (!Scanning)
        {
            SnapshotMilestones();
            return;
        }

        var baseSet = cornerBuilder.HasHeightBase;
        var locked = cornerBuilder.IsHeightLocked;
        var closed = cornerBuilder.IsLoopClosed;
        var corners = cornerBuilder.CornerCount;

        if (baseSet && !lastBaseSet && !locked)
            ShowToast("floor", "Floor point set", ARScanHaptics.Kind.Tick);
        if (locked && !lastHeightLocked)
        {
            var cm = Mathf.RoundToInt(cornerBuilder.WallHeight * 100f);
            if (!heightSkipped && cornerBuilder.WallHeight < LowCeilingMeters)
            {
                // Rooms are rarely this low: the reading usually stopped at a door top or a shelf.
                ShowToast("height", $"Height {cm} cm looks low · if the ceiling is higher, tap Undo and aim where the wall meets the ceiling",
                    ARScanHaptics.Kind.Warning);
            }
            else if (!heightSkipped && cornerBuilder.WallHeight > HighCeilingMeters)
            {
                // Homes are rarely this high: usually the floor point landed below the floor
                // (ARCore lost its place) or the aim went past the ceiling line.
                ShowToast("height", $"Height {cm} cm looks high · if the ceiling is lower, tap Undo and set the floor point again",
                    ARScanHaptics.Kind.Warning);
            }
            else
            {
                ShowToast("height", heightSkipped ? $"Using {cm} cm · you can change it in Review" : $"Height set · {cm} cm", ARScanHaptics.Kind.Success);
            }

            heightSkipped = false;
        }
        if (closed && !lastLoopClosed)
            ShowToast("closed", spatialMapping != null ? "Walk done · now check your room" : $"Room outline done · {corners} walls", ARScanHaptics.Kind.Success);
        // Corners tapped by hand: a buzz is enough, the corner appears where the finger is.
        if (!AutoEnabled && locked && lastHeightLocked && !closed && corners > lastCornerCount)
            ARScanHaptics.Play(ARScanHaptics.Kind.Tick);

        lastBaseSet = baseSet;
        lastHeightLocked = locked;
        lastLoopClosed = closed;
        lastCornerCount = corners;
    }

    /// <summary>
    /// The automatic walk in a room whose walls are hidden by furniture and curtains keeps losing
    /// walls and corners. After a while with fewer than two corners, suggest the corner-by-corner
    /// flow (ceiling corners aren't hidden). Once per walk.
    /// </summary>
    void TrackClutterHint()
    {
        var walking = AutoEnabled && Scanning && autoScan.CurrentStep == ARAutoRoomScan.Step.Walls;
        if (!walking)
        {
            wallsWalkStartedAt = -1f;
            return;
        }

        if (wallsWalkStartedAt < 0f)
        {
            wallsWalkStartedAt = Time.unscaledTime;
            clutterHintShown = false;
        }

        if (clutterHintShown || autoScan.CornerCount >= 2
            || Time.unscaledTime - wallsWalkStartedAt < ClutterHintAfterSeconds) return;
        clutterHintShown = true;
        ShowToast("clutter", "Walls are hard to see here · try Auto: Off and tap the ceiling corners",
            ARScanHaptics.Kind.Warning);
    }

    const float ClutterHintAfterSeconds = 45f;
    float wallsWalkStartedAt = -1f;
    bool clutterHintShown;

    /// <summary>A tap by hand while ARCore wasn't tracking well: say why, since nothing was placed.</summary>
    void OnTapIgnored(NotTrackingReason reason)
    {
        var text = reason switch
        {
            NotTrackingReason.InsufficientLight => "Too dark to place a corner · turn on more lights",
            NotTrackingReason.ExcessiveMotion => "Moving too fast · hold the phone still, then tap",
            NotTrackingReason.InsufficientFeatures => "Not enough detail here · aim at a textured spot, then tap",
            _ => "Hold on · finding your place again",
        };
        ShowToast("tracking", text, ARScanHaptics.Kind.Warning);
    }

    void OnAutoNote(ARAutoRoomScan.Note note)
    {
        switch (note)
        {
            case ARAutoRoomScan.Note.CornerFound:
                ShowToast("corner-found", $"Corner found · {autoScan.CornerCount} so far", ARScanHaptics.Kind.Tick);
                break;
            case ARAutoRoomScan.Note.CornerAdded:
                ShowToast("corner-added", "Corner added", ARScanHaptics.Kind.Tick);
                break;
            case ARAutoRoomScan.Note.CornerRemoved:
                ShowToast("corner-removed", "Corner removed", ARScanHaptics.Kind.Tick);
                break;
            case ARAutoRoomScan.Note.OutlineComplete:
                ShowToast("outline", "Outline complete · now look around the room", ARScanHaptics.Kind.Success);
                break;
            case ARAutoRoomScan.Note.TapIgnored:
                ShowToast("tracking", "Hold on · finding your place again", ARScanHaptics.Kind.Warning);
                break;
            case ARAutoRoomScan.Note.HoldToRemove:
                ShowToast("corner-remove", "A corner is already here · press and hold it to remove it", ARScanHaptics.Kind.Tick);
                break;
        }
    }

    void OnSpatialNote(ARDesignSpatialMappingController.Note note, string type)
    {
        var name = Capitalize(type);
        switch (note)
        {
            case ARDesignSpatialMappingController.Note.OpeningFound:
                ShowToast("opening-found", $"{name} found", ARScanHaptics.Kind.Tick, "{0} doors & windows found");
                break;
            case ARDesignSpatialMappingController.Note.OpeningAdded:
                ShowToast("opening-added", $"{name} added", ARScanHaptics.Kind.Tick);
                break;
            case ARDesignSpatialMappingController.Note.OpeningRemoved:
                ShowToast("opening-removed", $"{name} removed", ARScanHaptics.Kind.Tick);
                break;
            case ARDesignSpatialMappingController.Note.FurnitureFound:
                ShowToast("furniture-found", $"{name} added", ARScanHaptics.Kind.Tick, "{0} furniture items added");
                break;
            case ARDesignSpatialMappingController.Note.FurnitureAdded:
                ShowToast("furniture-added", $"{name} added", ARScanHaptics.Kind.Tick);
                break;
            case ARDesignSpatialMappingController.Note.FurnitureRemoved:
                ShowToast("furniture-removed", $"{name} removed", ARScanHaptics.Kind.Tick);
                break;
        }
    }

    /// <summary>
    /// Short note above the controls. The same kind arriving while one shows is counted
    /// (<paramref name="pluralFormat"/>, e.g. "{0} doors & windows found") instead of stacking;
    /// a different one waits until the current one has been up for a moment.
    /// </summary>
    void ShowToast(string key, string text, ARScanHaptics.Kind? haptic = null, string pluralFormat = null)
    {
        if (haptic.HasValue) ARScanHaptics.Play(haptic.Value);
        if (toastRect == null) return;

        var now = Time.unscaledTime;
        var showing = toastRect.gameObject.activeSelf && now < toastUntil;
        if (showing && key == toastKey)
        {
            if (pluralFormat != null)
            {
                toastCount++;
                text = string.Format(pluralFormat, toastCount);
            }

            SetToastText(text);
            toastUntil = now + ToastSeconds;
            return;
        }

        if (showing && now - toastShownAt < ToastMinSeconds)
        {
            var index = toastQueue.FindIndex(t => t.key == key);
            var item = new PendingToast { key = key, text = text, pluralFormat = pluralFormat, count = 1 };
            if (index >= 0 && pluralFormat != null)
            {
                item.count = toastQueue[index].count + 1;
                item.text = string.Format(pluralFormat, item.count);
            }

            if (index >= 0) toastQueue[index] = item;
            else if (toastQueue.Count < ToastQueueMax) toastQueue.Add(item);
            else toastQueue[^1] = item;
            // Let the queue move: the current note goes once it has been read.
            toastUntil = Mathf.Min(toastUntil, toastShownAt + ToastMinSeconds);
            return;
        }

        StartToast(key, text, 1);
    }

    void StartToast(string key, string text, int count)
    {
        var now = Time.unscaledTime;
        toastKey = key;
        toastCount = count;
        toastShownAt = now;
        toastUntil = now + (toastQueue.Count > 0 ? ToastMinSeconds : ToastSeconds);
        SetToastText(text);
        toastGroup.alpha = 1f;
        toastRect.gameObject.SetActive(true);
    }

    void SetToastText(string text)
    {
        toastText.text = text;
        var maxWidth = canvasRect != null && canvasRect.rect.width > 0f ? canvasRect.rect.width - 64f : 900f;
        toastRect.sizeDelta = new Vector2(Mathf.Min(toastText.preferredWidth + 72f, maxWidth), 62f);
    }

    void ClearToasts()
    {
        toastQueue.Clear();
        toastUntil = 0f;
        if (toastRect != null) toastRect.gameObject.SetActive(false);
    }

    void TickToast()
    {
        if (toastRect == null || !toastRect.gameObject.activeSelf) return;
        if (HelpVisible)
        {
            ClearToasts();
            return;
        }

        var left = toastUntil - Time.unscaledTime;
        if (left <= 0f)
        {
            if (toastQueue.Count == 0)
            {
                toastRect.gameObject.SetActive(false);
                return;
            }

            var next = toastQueue[0];
            toastQueue.RemoveAt(0);
            StartToast(next.key, next.text, next.count);
            left = toastUntil - Time.unscaledTime;
        }

        toastGroup.alpha = Mathf.Clamp01(left / 0.25f);
        // Just above whatever is highest at the bottom: the dock, the floor plan or the review panel.
        var top = DockTop() + 10f;
        if (mapPanel != null && mapPanel.gameObject.activeSelf)
            top = Mathf.Max(top, mapPanel.anchoredPosition.y + mapPanel.sizeDelta.y);
        if (reviewPanel != null && reviewPanel.gameObject.activeSelf)
            top = Mathf.Max(top, reviewPanel.anchoredPosition.y + reviewPanel.sizeDelta.y);
        toastRect.anchoredPosition = new Vector2(0f, top + 50f);
    }

    // ── Help card ─────────────────────────────────────────────────────────────

    /// <summary>The first scan on a phone starts with the "how it works" card.</summary>
    void MaybeShowIntro()
    {
        if (introOffered || helpOverlay == null || cornerBuilder == null) return;
        if (PlayerPrefs.GetInt(IntroSeenKey, 0) == 1) return;
        if (!Scanning || !cornerBuilder.IsInHeightPhase || cornerBuilder.HasHeightBase) return;
        introOffered = true;
        ShowHelp(firstRun: true);
    }

    void ShowHelp(bool firstRun)
    {
        if (helpOverlay == null) return;
        FillHelpTexts();
        var current = firstRun ? 0 : CurrentStepIndex();
        for (var i = 0; i < helpStepBadges.Length; i++)
        {
            var now = i == current;
            helpStepBadges[i].color = now ? Ink : StepTodo;
            var number = helpStepBadges[i].GetComponentInChildren<Text>();
            if (number != null) number.color = now ? Color.white : Ink;
        }

        helpButtonLabel.text = firstRun ? "Start scanning" : "Back to the scan";
        helpOverlay.SetActive(true);
        autoScan?.SetHoldPaused(true);
    }

    void HideHelp(bool markSeen = true)
    {
        if (helpOverlay == null) return;
        helpOverlay.SetActive(false);
        autoScan?.SetHoldPaused(false);
        if (!markSeen) return;
        PlayerPrefs.SetInt(IntroSeenKey, 1);
        PlayerPrefs.Save();
    }

    void FillHelpTexts()
    {
        var auto = AutoEnabled;
        var titles = spatialMapping != null
            ? new[] { "Start", "Walk around the room", "Check and fix" }
            : new[] { "Height", "Walls" };
        var bodies = spatialMapping != null
            ? new[]
            {
                auto
                    ? "Move slowly until the floor dots turn green. Aim the dot at a floor corner and hold still for 2 seconds, or tap: that's corner 1. Then aim the circle where the wall meets the ceiling, or tap Skip."
                    : "Move slowly until the floor dots turn green. Aim the dot at a floor corner you can see and tap Start: that's corner 1. A line rises from it: aim up to where the corner meets the ceiling and tap Set height.",
                auto
                    ? "Walk slowly along the walls. Corners, doors, windows and furniture appear by themselves; an orange marker shows where a corner may be missing. A corner hidden by furniture? Hold the dot on the ceiling corner above it. Back at corner 1, tap it to close the room."
                    : "Aim at the next corner up on the ceiling (furniture doesn't hide it) and tap: a line shows where it lands on the floor. A floor corner you can see works too. Go round the room; back at corner 1 the room closes. Doors, windows and furniture are found as you go.",
                "Check the floor plan. Tap anything wrong to remove it, use + Add for anything missed, then tap Scan complete.",
            }
            : new[]
            {
                "Point at a floor corner of the room and tap. Aim up that corner to the ceiling and tap Set height.",
                "Tap each floor corner of the room in turn, then tap Close room.",
            };

        for (var i = 0; i < helpStepTitles.Length && i < titles.Length; i++)
        {
            helpStepTitles[i].text = titles[i];
            helpStepBodies[i].text = bodies[i];
        }
    }

    void OnHelpClicked()
    {
        if (HelpVisible) HideHelp();
        else ShowHelp(firstRun: false);
    }

    void RefreshHelpButton()
    {
        if (helpButton == null) return;
        var show = Scanning && !HelpVisible;
        if (helpButton.gameObject.activeSelf != show)
            helpButton.gameObject.SetActive(show);
    }

    // ── Height aim, floor dots, hold ring, corner arrow ──────────────────────

    /// <summary>A circle where the height is read from (no finger down), while measuring it.</summary>
    void RefreshAimMark()
    {
        if (aimMark == null) return;
        var show = Scanning && !HelpVisible && cornerBuilder.IsInHeightPhase && cornerBuilder.HasHeightBase;
        if (aimMark.gameObject.activeSelf != show)
            aimMark.gameObject.SetActive(show);
        if (!show) return;

        var viewport = cornerBuilder.HeightAimViewportPoint;
        aimMark.anchorMin = viewport;
        aimMark.anchorMax = viewport;
        aimMark.anchoredPosition = Vector2.zero;
    }

    /// <summary>
    /// Floor dots only while the floor point is still to be set. They turn green once enough floor
    /// is found ("Floor found"); only then can the floor point be set.
    /// </summary>
    void RefreshFloorGrid()
    {
        if (floorGrid == null) return;
        floorGrid.Visible = Scanning && !HelpVisible && cornerBuilder.IsInHeightPhase && !cornerBuilder.HasHeightBase;
        if (autoScan != null) autoScan.FloorReady = floorGrid.IsReady && DetectorReadyForScan;
        cornerBuilder.FloorPointAllowed = floorGrid.IsReady && DetectorReadyForScan;

        if (!floorGrid.Visible) return;
        if (floorGrid.IsReady && !floorReadyShown)
            ShowToast("floor-ready", "Floor found · now set your floor point", ARScanHaptics.Kind.Success);
        floorReadyShown = floorGrid.IsReady;
    }

    /// <summary>The floor point can be set: enough floor found (or no dots to wait for).</summary>
    bool FloorReady => (floorGrid == null || floorGrid.IsReady) && DetectorReadyForScan;

    /// <summary>
    /// A small dot where the scan aims on the floor (the placement ring is hidden while scanning):
    /// white while searching, green on the floor. Not while aiming at the ceiling.
    /// </summary>
    void RefreshFloorAimDot()
    {
        if (floorAimDot == null) return;
        var show = Scanning && !HelpVisible && !InReview && placementIndicator != null && placementIndicator.IsTracking
                   && !cornerBuilder.IsLoopClosed && !(cornerBuilder.IsInHeightPhase && cornerBuilder.HasHeightBase);
        var local = Vector2.zero;
        if (show) show = TryScreenToCanvas(placementIndicator.AimScreenPoint, out local);
        if (floorAimDot.gameObject.activeSelf != show)
            floorAimDot.gameObject.SetActive(show);
        if (!show) return;

        floorAimDot.anchoredPosition = local;
        var onFloor = placementIndicator.IsLockedOnFloor && (FloorReady || !cornerBuilder.IsInHeightPhase);
        floorAimDotImage.color = onFloor ? AimOnFloor : AimSearching;
    }

    /// <summary>Hold-still ring around what is about to set itself, and an arrow to a missing corner off screen.</summary>
    void RefreshAutoOverlay()
    {
        if (dwellRing == null || targetArrow == null) return;

        var cam = Camera.main;
        var showRing = !HelpVisible && AutoOutlineStep && autoScan.HasDwellPoint && autoScan.DwellProgress > 0.02f && cam != null;
        if (showRing)
        {
            var screen = cam.WorldToScreenPoint(autoScan.DwellPoint);
            var local = Vector2.zero;
            showRing = screen.z > 0f && TryScreenToCanvas(screen, out local);
            if (showRing)
            {
                dwellRing.rectTransform.anchoredPosition = local;
                dwellRing.fillAmount = autoScan.DwellProgress;
            }
        }
        if (!showRing && !HelpVisible && cornerBuilder != null && cornerBuilder.IsSteadying && cam != null)
        {
            // A corner tapped by hand fills the same ring while the aim settles.
            var screen = cam.WorldToScreenPoint(cornerBuilder.SteadyPoint);
            var local = Vector2.zero;
            showRing = screen.z > 0f && TryScreenToCanvas(screen, out local);
            if (showRing)
            {
                dwellRing.rectTransform.anchoredPosition = local;
                dwellRing.fillAmount = cornerBuilder.SteadyProgress;
            }
        }
        if (dwellRing.gameObject.activeSelf != showRing)
            dwellRing.gameObject.SetActive(showRing);

        var showArrow = false;
        if (!HelpVisible && AutoOutlineStep && autoScan.CurrentStep == ARAutoRoomScan.Step.Walls && autoScan.HasTarget && cam != null)
        {
            var screen = cam.WorldToScreenPoint(autoScan.TargetPoint);
            var center = new Vector2(Screen.width * 0.5f, Screen.height * 0.5f);
            var dir = (Vector2)screen - center;
            if (screen.z < 0f) dir = -dir;
            var margin = Screen.width * 0.08f;
            var onScreen = screen.z > 0f
                           && screen.x > margin && screen.x < Screen.width - margin
                           && screen.y > margin && screen.y < Screen.height - margin;
            if (!onScreen && dir.sqrMagnitude > 1f)
            {
                // Pin to an inset rectangle around the screen centre, pointing at the corner.
                var half = new Vector2(Screen.width * 0.5f - margin * 1.6f, Screen.height * 0.5f - margin * 3f);
                var scale = Mathf.Min(half.x / Mathf.Max(Mathf.Abs(dir.x), 1e-3f), half.y / Mathf.Max(Mathf.Abs(dir.y), 1e-3f));
                var pinned = center + dir * scale;
                if (TryScreenToCanvas(pinned, out var local))
                {
                    showArrow = true;
                    targetArrow.anchoredPosition = local;
                    var angle = Mathf.Atan2(dir.y, dir.x) * Mathf.Rad2Deg;
                    // The arrow icon points left (180°).
                    targetArrow.localRotation = Quaternion.Euler(0f, 0f, angle - 180f);
                }
            }
        }
        if (targetArrow.gameObject.activeSelf != showArrow)
            targetArrow.gameObject.SetActive(showArrow);
    }

    bool TryScreenToCanvas(Vector2 screen, out Vector2 local)
    {
        local = default;
        if (canvasRect == null) return false;
        var uiCamera = canvas != null && canvas.renderMode != RenderMode.ScreenSpaceOverlay ? canvas.worldCamera : null;
        return RectTransformUtility.ScreenPointToLocalPointInRectangle(canvasRect, screen, uiCamera, out local);
    }

    // ── Mini floor plan ───────────────────────────────────────────────────────

    void RefreshMap()
    {
        if (mapPanel == null || map == null || cornerBuilder == null) return;

        var step = CurrentStepIndex();
        if (step == 0)
        {
            // New scan: the next walls step turns the map to face the user again.
            mapFacing = false;
            mapSquared = false;
        }

        // A size the user picked lasts for that step only.
        if (step != lastMapStep)
        {
            lastMapStep = step;
            mapUserToggled = false;
        }

        var show = Scanning && !HelpVisible && step >= 1;
        if (mapPanel.gameObject.activeSelf != show)
            mapPanel.gameObject.SetActive(show);
        if (!show) return;

        // Large on the review step unless the user shrank it; small elsewhere unless they enlarged it.
        if (!mapUserToggled) mapExpanded = InReview;
        ApplyMapLayout();

        var cam = Camera.main;
        if (!mapFacing && cam != null)
        {
            map.Frame.FaceUp(XZ(cam.transform.forward));
            mapFacing = true;
        }

        var corners = cornerBuilder.Corners;
        var closed = cornerBuilder.IsLoopClosed && corners.Count >= 3;
        if (closed && !mapSquared)
        {
            map.Frame.SquareTo(LongestEdgeDirection(corners));
            mapSquared = true;
        }

        map.Begin();
        mapScratch.Clear();
        foreach (var c in corners) mapScratch.Add(XZ(c));

        if (closed)
        {
            map.AddPolygon(mapScratch, MapFloor);
        }
        else if (AutoEnabled && autoScan.CurrentStep == ARAutoRoomScan.Step.Walls)
        {
            // Walls the camera has found so far, under the outline they make.
            var walls = autoScan.Walls;
            for (var i = 0; i < walls.Count; i++)
            {
                if (autoScan.IsRoomWall(i))
                    map.AddLine(walls[i].End(0), walls[i].End(1), 7f, MapFoundWall);
            }
        }

        var edgeCount = closed ? mapScratch.Count : mapScratch.Count - 1;
        for (var i = 0; i < edgeCount; i++)
            map.AddLine(mapScratch[i], mapScratch[(i + 1) % mapScratch.Count], 4f, Ink);
        // An open outline of 3+ corners will close back to the first one.
        if (!closed && mapScratch.Count >= 3)
            map.AddLine(mapScratch[^1], mapScratch[0], 2f, new Color(Ink.r, Ink.g, Ink.b, 0.3f));

        if (spatialMapping != null) AddSpatialToMap(corners, closed);

        if (!closed)
        {
            foreach (var p in mapScratch)
            {
                map.AddDot(p, 7f, Ink);
                map.AddDot(p, 4.5f, Color.white);
            }

            if (AutoEnabled && autoScan.HasTarget)
            {
                var pulse = 9f + 2f * Mathf.Sin(Time.unscaledTime * 6f);
                map.AddDot(XZ(autoScan.TargetPoint), pulse, AutoOrange);
            }
            else if (!AutoEnabled && cornerBuilder.HasLivePreview && mapScratch.Count > 0)
            {
                map.AddLine(mapScratch[^1], XZ(cornerBuilder.AimPoint), 3f, AutoOrange, fit: false);
            }
        }

        if (mapExpanded && closed) AddWallLengths(corners);

        // Where the user is; on the review step it doesn't widen the map.
        if (cam != null)
            map.AddMarker(XZ(cam.transform.position), XZ(cam.transform.forward), MapUser, fit: !InReview);

        map.End(0.25f);
    }

    void AddSpatialToMap(IReadOnlyList<Vector3> corners, bool closed)
    {
        if (!closed)
        {
            // During the walk: what has been found so far, placed in the room.
            foreach (var o in spatialMapping.LiveOpenings)
                map.AddLine(XZ(o.a), XZ(o.b), 9f, o.kind == "door" ? MapDoor : MapWindow, fit: false);
            foreach (var s in spatialMapping.LiveFurniture)
                map.AddBox(new Vector2(s.center.x, s.center.z), new Vector2(s.size.x, s.size.z), s.yaw, MapFurniture, fit: false);
        }
        else if (InReview)
        {
            foreach (var s in spatialMapping.PendingSuggestions)
            {
                var center = new Vector2(s.center.x, s.center.z);
                map.AddBox(center, new Vector2(s.size.x, s.size.z), s.yaw, MapSuggestion, fit: false);
                if (mapExpanded) map.AddLabel(center, Vector2.zero, $"{Capitalize(s.type)}?");
            }
        }

        foreach (var o in spatialMapping.Obstacles)
        {
            if (o?.center == null || o.size == null) continue;
            var center = new Vector2(o.center.x, o.center.z);
            map.AddBox(center, new Vector2(o.size.x, o.size.z), o.yaw, MapFurniture, fit: false);
            if (mapExpanded && closed) map.AddLabel(center, Vector2.zero, Capitalize(o.type));
        }

        if (!closed) return;
        foreach (var opening in spatialMapping.Openings)
        {
            var i = opening.wallIndex;
            if (i < 0 || i >= corners.Count) continue;
            var a = XZ(corners[i]);
            var b = XZ(corners[(i + 1) % corners.Count]);
            var length = Vector2.Distance(a, b);
            if (length < 1e-3f) continue;
            var dir = (b - a) / length;
            var start = a + dir * Mathf.Clamp(opening.offsetAlongWall, 0f, length);
            var end = a + dir * Mathf.Clamp(opening.offsetAlongWall + opening.width, 0f, length);
            map.AddLine(start, end, 9f, opening.type == "door" ? MapDoor : MapWindow, fit: false);
        }
    }

    /// <summary>Length of each wall next to it, outside the room.</summary>
    void AddWallLengths(IReadOnlyList<Vector3> corners)
    {
        for (var i = 0; i < corners.Count; i++)
        {
            var a = corners[i];
            var b = corners[(i + 1) % corners.Count];
            var a2 = XZ(a);
            var b2 = XZ(b);
            var length = Vector2.Distance(a2, b2);
            if (length < 0.3f) continue;

            var mid = (a2 + b2) * 0.5f;
            var normal = new Vector2(-(b2 - a2).y, (b2 - a2).x) / length;
            var probe = mid + normal * 0.05f;
            if (RoomPolygonUtil.PointInsidePolygonXZ(new Vector3(probe.x, 0f, probe.y), corners))
                normal = -normal;
            // A label beside a wall needs about half its width more room than one above or below it.
            var dir = map.Frame.ProjectDirection(normal);
            var push = dir * 18f + new Vector2(dir.x * 38f, 0f);
            map.AddLabel(mid, push, $"{Mathf.RoundToInt(length * 100f)} cm");
        }
    }

    static Vector2 LongestEdgeDirection(IReadOnlyList<Vector3> corners)
    {
        var best = Vector2.right;
        var bestLength = 0f;
        for (var i = 0; i < corners.Count; i++)
        {
            var d = XZ(corners[(i + 1) % corners.Count]) - XZ(corners[i]);
            if (d.sqrMagnitude <= bestLength) continue;
            bestLength = d.sqrMagnitude;
            best = d;
        }

        return best;
    }

    void ApplyMapLayout()
    {
        var dockTop = DockTop();
        // The large map has wall lengths beside the walls: leave room for them inside the panel.
        map.padding = mapExpanded ? 84f : 22f;
        if (mapExpanded)
        {
            var width = canvasRect != null && canvasRect.rect.width > 0f ? canvasRect.rect.width : 1080f;
            var size = Mathf.Min(width - 48f, MapLargeMax);
            if (InReview)
            {
                // Under the instruction card, the review panel and above the dock.
                var height = canvasRect != null && canvasRect.rect.height > 0f ? canvasRect.rect.height : 1920f;
                var room = height - (CardTop + CardHeight + CoachGap + CoachHeight + 24f) - dockTop - MapGap - ReviewPanelHeight();
                size = Mathf.Clamp(room, 260f, size);
            }
            mapPanel.anchorMin = mapPanel.anchorMax = mapPanel.pivot = new Vector2(0.5f, 0f);
            mapPanel.sizeDelta = new Vector2(size, size);
            mapPanel.anchoredPosition = new Vector2(0f, dockTop + MapGap);
        }
        else
        {
            mapPanel.anchorMin = mapPanel.anchorMax = mapPanel.pivot = Vector2.zero;
            mapPanel.sizeDelta = new Vector2(MapSmall, MapSmall);
            mapPanel.anchoredPosition = new Vector2(24f, dockTop + MapGap);
        }
    }

    void OnMapClicked()
    {
        mapUserToggled = true;
        mapExpanded = !mapExpanded;
        nextMapRefreshAt = 0f;
    }

    static Vector2 XZ(Vector3 v) => new(v.x, v.z);

    // ── Dock and tool rail ────────────────────────────────────────────────────

    /// <summary>The dock is lower when there are no extra buttons above Undo and the main action.</summary>
    void ApplyDockLayout()
    {
        if (bottomDock == null) return;
        var auxShown = auxTypeButton != null && auxTypeButton.gameObject.activeSelf;
        var height = auxShown ? DockFullHeight : DockCompactHeight;
        if (Mathf.Approximately(height, dockHeight)) return;
        dockHeight = height;
        bottomDock.sizeDelta = new Vector2(DockWidth, height);
        if (bottomShadow != null) bottomShadow.sizeDelta = new Vector2(DockWidth + 20f, height + 20f);
    }

    float DockTop()
    {
        if (bottomDock != null && bottomDock.gameObject.activeSelf) return DockBottom + dockHeight;
        var circles = (startButton != null && startButton.gameObject.activeSelf)
                      || (finishButton != null && finishButton.gameObject.activeSelf);
        return circles ? CircleButtonsTop : DockBottom;
    }

    /// <summary>Stacks the visible rail buttons from the top, with no gaps for hidden ones.</summary>
    void LayoutRail()
    {
        var y = -RailTop - RailItemHeight * 0.5f;
        foreach (var (holder, button) in railItems)
        {
            if (holder == null || button == null || !button.gameObject.activeSelf) continue;
            holder.anchoredPosition = new Vector2(-CardRight - RailWidth * 0.5f, y);
            y -= RailItemHeight + RailGap;
        }
    }

    /// <summary>
    /// The flash, switched on through ARCore so the AR camera keeps running (the phone's own
    /// flashlight takes the camera away). Shown while scanning, on phones that support it.
    /// </summary>
    void RefreshLightButton()
    {
        if (lightButton == null) return;
        if (cameraManager == null) cameraManager = FindFirstObjectByType<UnityEngine.XR.ARFoundation.ARCameraManager>();
        if (Time.unscaledTime >= nextLightCheckAt)
        {
            nextLightCheckAt = Time.unscaledTime + 0.5f;
            lightSupported = cameraManager != null && cameraManager.DoesCurrentCameraSupportTorch();
        }

        var show = lightSupported && Scanning;
        if (lightButton.gameObject.activeSelf != show)
            lightButton.gameObject.SetActive(show);
        if (!show) return;

        var on = cameraManager.currentCameraTorchMode == UnityEngine.XR.ARSubsystems.XRCameraTorchMode.On;
        lightLabel.text = on ? "Light: On" : "Light: Off";
        lightLabel.color = Ink;
        if (lightImage != null)
            lightImage.color = on ? new Color(1f, 0.86f, 0.35f, 0.97f) : Frost;
    }

    void OnLightClicked()
    {
        if (cameraManager == null) return;
        var on = cameraManager.currentCameraTorchMode == UnityEngine.XR.ARSubsystems.XRCameraTorchMode.On;
        cameraManager.requestedCameraTorchMode = on
            ? UnityEngine.XR.ARSubsystems.XRCameraTorchMode.Off
            : UnityEngine.XR.ARSubsystems.XRCameraTorchMode.On;
    }

    /// <summary>The light goes off with the scan screen (it isn't needed afterwards and drains the battery).</summary>
    void TurnLightOff()
    {
        if (cameraManager == null) cameraManager = FindFirstObjectByType<UnityEngine.XR.ARFoundation.ARCameraManager>();
        if (cameraManager != null
            && cameraManager.requestedCameraTorchMode == UnityEngine.XR.ARSubsystems.XRCameraTorchMode.On)
            cameraManager.requestedCameraTorchMode = UnityEngine.XR.ARSubsystems.XRCameraTorchMode.Off;
    }

    /// <summary>The Auto on/off switch shows while outlining (floor, height, walls).</summary>
    void RefreshAutoToggle()
    {
        if (autoToggleButton == null || autoScan == null) return;
        var outlining = Scanning && !InReview && cornerBuilder != null && !cornerBuilder.IsLoopClosed;
        if (autoToggleButton.gameObject.activeSelf != outlining)
            autoToggleButton.gameObject.SetActive(outlining);
        if (!outlining) return;

        autoToggleLabel.text = autoScan.Enabled ? "Auto: On" : "Auto: Off";
        autoToggleLabel.color = autoScan.Enabled ? Color.white : Ink;
        if (autoToggleImage != null)
            autoToggleImage.color = autoScan.Enabled ? AccentReady : Frost;
    }

    void OnAutoToggleClicked()
    {
        if (autoScan == null) return;
        autoScan.SetEnabled(!autoScan.Enabled);
        ShowToast("auto", autoScan.Enabled ? "Automatic scan on" : "Automatic scan off · tap the corners yourself");
        ApplyReticle(scanController != null ? scanController.Phase : RoomScanController.ScanPhase.Scanning);
        RefreshCornerUi();
    }

    static bool IsScanning(RoomScanController.ScanPhase phase) =>
        phase == RoomScanController.ScanPhase.Scanning || phase == RoomScanController.ScanPhase.ReadyToConfirm;

    /// <summary>
    /// Whether the current step needs the camera on the floor, and whether it is.
    /// Null when the step doesn't use the floor (aiming at the ceiling, closed outline, review).
    /// </summary>
    bool? FloorAimForCurrentStep()
    {
        if (scanController == null || cornerBuilder == null || !IsScanning(scanController.Phase)) return null;
        if (InReview) return null;

        var indicatorOnFloor = placementIndicator != null && placementIndicator.IsLockedOnFloor;
        if (cornerBuilder.IsInHeightPhase)
            return cornerBuilder.HasHeightBase ? null : indicatorOnFloor;
        if (cornerBuilder.IsLoopClosed) return null;
        // Automatic walls: the camera should be on the walls, not the floor.
        if (AutoEnabled) return null;
        return cornerBuilder.CornerCount > 0 ? cornerBuilder.IsAimOnFloor : indicatorOnFloor;
    }

    void RefreshCoaching()
    {
        if (coachChip == null || guidance == null) return;

        guidance.FloorAim = FloorAimForCurrentStep();
        var issue = guidance.isActiveAndEnabled ? guidance.Current : ARScanGuidance.Issue.None;
        // While the floor point is to be set, the card already says to point at the floor and move
        // slowly: the tip would only repeat it.
        if (cornerBuilder.IsInHeightPhase && !cornerBuilder.HasHeightBase
            && issue is ARScanGuidance.Issue.NoFloor or ARScanGuidance.Issue.Starting)
            issue = ARScanGuidance.Issue.None;
        var trackingIssue = issue != ARScanGuidance.Issue.None;
        string helpTitle = null;
        string helpDetail = null;
        var autoHelp = !trackingIssue && TryGetAutoHelp(out helpTitle, out helpDetail);
        var show = !HelpVisible && (trackingIssue || autoHelp);
        if (coachChip.gameObject.activeSelf != show)
            coachChip.gameObject.SetActive(show);
        if (!show) return;

        coachTitle.text = trackingIssue ? guidance.Title : helpTitle;
        coachDetail.text = trackingIssue ? guidance.Detail : helpDetail;
    }

    /// <summary>When nothing is wrong with tracking, the automatic scan's own "stuck?" help.</summary>
    bool TryGetAutoHelp(out string title, out string detail)
    {
        title = null;
        detail = null;
        if (!AutoEnabled || cornerBuilder == null) return false;

        if (autoScan.NeedsHeightHelp)
        {
            var useCm = cornerBuilder.LiveHeightMeters >= 1.8f
                ? Mathf.RoundToInt(cornerBuilder.LiveHeightMeters * 100f)
                : Mathf.RoundToInt(cornerBuilder.WallHeight * 100f);
            var skipCm = Mathf.RoundToInt(cornerBuilder.DefaultWallHeight * 100f);
            title = "Ceiling hard to measure?";
            detail = useCm >= 180 && Mathf.Abs(useCm - skipCm) > 2
                ? $"Tap Set height to use {useCm} cm, or Skip to use {skipCm} cm"
                : $"Tap Skip to use {skipCm} cm · you can change it in Review";
            return true;
        }

        if (autoScan.NeedsWallHelp && autoScan.HasTarget && autoScan.CeilingAimAvailable)
        {
            title = "Corner hidden by furniture?";
            detail = "Hold the dot on the ceiling corner above it instead";
            return true;
        }

        if (autoScan.NeedsWallHelp)
        {
            title = "Wall not showing up?";
            detail = "Plain walls are hard to detect. Tap the floor corner where this wall ends";
            return true;
        }

        return false;
    }

    /// <summary>Rescan appears once there is something to lose, and asks for a second tap.</summary>
    void RefreshRescanButton()
    {
        if (rescanButton == null || cornerBuilder == null) return;

        var hasProgress = Scanning
                          && (cornerBuilder.HasHeightBase || cornerBuilder.CornerCount > 0 || InReview);
        if (rescanButton.gameObject.activeSelf != hasProgress)
            rescanButton.gameObject.SetActive(hasProgress);

        var armed = Time.unscaledTime <= rescanArmedUntil;
        rescanLabel.text = armed ? "Tap again" : "Rescan";
        rescanLabel.color = armed ? Color.white : Ink;
        if (rescanImage != null)
            rescanImage.color = armed ? RescanArmed : Frost;
    }

    void OnRescanClicked()
    {
        if (Time.unscaledTime > rescanArmedUntil)
        {
            rescanArmedUntil = Time.unscaledTime + RescanConfirmSeconds;
            RefreshRescanButton();
            ShowToast("rescan", "Tap Rescan again to start over", ARScanHaptics.Kind.Warning);
            return;
        }

        rescanArmedUntil = -1f;
        if (scanController == null) return;
        scanController.StartRoomScan();
        SnapshotMilestones();
        ClearToasts();
        ShowToast("rescan", "Starting over", ARScanHaptics.Kind.Warning);
        OnStatus(scanController.GetScanStatus());
        ApplyReticle(scanController.Phase);
        RefreshCornerUi();
        RefreshRescanButton();
    }

    // ── Buttons ───────────────────────────────────────────────────────────────

    /// <summary>Corners 1–3 → Undo (remove last). All 4 placed → Retry (start the outline over).</summary>
    bool IsRetryMode()
    {
        // The automatic outline isn't built in tap order, so Undo always takes back one corner.
        if (AutoEnabled) return false;
        return cornerBuilder != null
               && !cornerBuilder.IsInHeightPhase
               && !cornerBuilder.IsLoopClosed
               && !cornerBuilder.IsOutlineSelfIntersecting
               && cornerBuilder.CornerCount >= RetryCornerCount;
    }

    void OnUndoClicked()
    {
        // Scan logs tell an Undo apart from the scan going back by itself.
        Debug.Log($"[ScanHUD] Undo (corners {cornerBuilder?.CornerCount ?? 0}, height step {cornerBuilder != null && cornerBuilder.IsInHeightPhase})");
        if (InReview)
        {
            if (spatialMapping.CurrentAddMode != ARDesignSpatialMappingController.AddMode.None)
            {
                // While adding, Undo only takes back the first edge of a door/window.
                if (spatialMapping.HasPendingOpeningEdge) spatialMapping.UndoLast();
            }
            else if (spatialMapping.CanUndo())
            {
                spatialMapping.UndoLast();
            }
            else
            {
                // Back to the walk, keeping everything found.
                choosingToAdd = false;
                spatialMapping.BackToWalk();
                ShowToast("back", "Back to walking · everything found is kept");
            }

            RefreshCornerUi();
            return;
        }

        if (cornerBuilder != null && cornerBuilder.IsInHeightPhase)
        {
            if (AutoEnabled && cornerBuilder.HasHeightBase)
                ShowToast("undo-floor", "Floor point removed · aim at another spot on the floor, or tap to place it");
            cornerBuilder.UndoHeightBase();
        }
        else if (cornerBuilder != null && cornerBuilder.IsLoopClosed)
        {
            cornerBuilder.ReopenLoop();
            ShowToast("reopen", "Back to the walls · fix a corner, then close the room again");
        }
        else if (AutoEnabled && cornerBuilder != null && cornerBuilder.IsHeightLocked)
        {
            // Newest corner first. With none left, a second Undo goes back to measuring the
            // height: one press used to do it straight away, mid-walk, by surprise.
            if (!autoScan.Undo())
            {
                if (Time.unscaledTime <= restartHeightConfirmUntil)
                {
                    restartHeightConfirmUntil = -1f;
                    cornerBuilder.RestartFromHeight();
                }
                else
                {
                    restartHeightConfirmUntil = Time.unscaledTime + RestartHeightConfirmSeconds;
                    ShowToast("undo-height", "No corners to undo · tap Undo again to set the floor point and height again");
                }
            }
        }
        else if (IsRetryMode())
            cornerBuilder.ResetCorners();
        else if (cornerBuilder != null && cornerBuilder.IsHeightLocked && cornerBuilder.CornerCount <= 1)
            cornerBuilder.RestartFromHeight();
        else
            cornerBuilder?.UndoLastCorner();
        RefreshCornerUi();
    }

    /// <summary>"Start over" during the automatic walk: drops every corner and looks at the walls again.</summary>
    void OnAuxTypeClicked()
    {
        if (!AutoEnabled || autoScan.CurrentStep != ARAutoRoomScan.Step.Walls) return;
        autoScan.StartWallsOver();
        ShowToast("walls-over", "Corners cleared · looking at the walls again", ARScanHaptics.Kind.Tick);
        RefreshCornerUi();
    }

    /// <summary>Skip measuring: the usual ceiling height is used (Review can change it).</summary>
    void OnSkipHeightClicked()
    {
        if (cornerBuilder == null) return;
        heightSkipped = true;
        if (!cornerBuilder.SkipHeight())
        {
            heightSkipped = false;
            return;
        }

        if (scanController != null)
            OnStatus(scanController.GetScanStatus());
        RefreshCornerUi();
    }

    void OnStartClicked()
    {
        if (cornerBuilder == null || !FloorReady || !cornerBuilder.TryConfirmHeightBaseFromIndicator())
            return;

        RefreshCornerUi();
    }

    void OnFinishClicked()
    {
        if (cornerBuilder == null || !cornerBuilder.ConfirmHeight())
            return;

        if (scanController != null)
            OnStatus(scanController.GetScanStatus());
        RefreshCornerUi();
    }

    void OnConfirmClicked()
    {
        if (cornerBuilder != null && cornerBuilder.IsInHeightPhase)
        {
            if (measurementOnlyMode)
            {
                if (!cornerBuilder.HasHeightBase)
                    OnStartClicked();
                else
                    OnFinishClicked();
                return;
            }

            if (!cornerBuilder.ConfirmHeight())
                return;

            if (scanController != null)
                OnStatus(scanController.GetScanStatus());
            RefreshCornerUi();
            return;
        }

        if (InReview)
        {
            // While choosing or adding something, the main button cancels that.
            if (choosingToAdd || spatialMapping.CurrentAddMode != ARDesignSpatialMappingController.AddMode.None)
            {
                OnCancelAdding();
                return;
            }

            if (spatialMapping.TryPrimaryAction(out var confirmedRoom) && confirmedRoom)
                FinalizeRoomScan();
            RefreshCornerUi();
            return;
        }

        // Three corners with a square one: the fourth goes where those walls end, then the room closes.
        if (AutoEnabled && autoScan.FinishAsRectangle())
        {
            if (cornerBuilder.CanClose) cornerBuilder.CloseLoop();
            ShowToast("rectangle", "Fourth corner added · tap Undo if it isn't where the room ends", ARScanHaptics.Kind.Tick);
            RefreshCornerUi();
            return;
        }

        // Finish the walk (or close the room): Review comes next.
        if (cornerBuilder != null && cornerBuilder.CanClose)
        {
            cornerBuilder.CloseLoop();
            RefreshCornerUi();
            return;
        }

        if (cornerBuilder != null && !cornerBuilder.CanConfirm)
            return;

        FinalizeRoomScan();
    }

    void FinalizeRoomScan()
    {
        if (bridge != null)
            bridge.ConfirmRoomScan();
        else if (scanController != null && !scanController.ConfirmRoomScan())
            return;

        if (scanController == null || !scanController.IsConfirmed)
            return;

        ARScanHaptics.Play(ARScanHaptics.Kind.Success);
        if (canvas != null)
            canvas.gameObject.SetActive(false);

        placementIndicator?.StopTracking(clearOverlay: true);

        if (!spawnSampleOnConfirm) return;

        var placement = FindFirstObjectByType<FurniturePlacementController>();
        placement?.SpawnFurniture(new SpawnFurnitureRequest
        {
            modelId = "sample-cube",
            catalogId = "sample-cube",
            width = 0.5f,
            height = 0.5f,
            depth = 0.5f,
        });
    }

    // ── Building the UI ───────────────────────────────────────────────────────

    void BuildUi()
    {
        var root = new GameObject("ARDesignScanHUD");
        root.transform.SetParent(transform, false);

        canvas = root.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 1000;
        canvasRect = (RectTransform)root.transform;
        var scaler = root.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1080, 1920);
        scaler.matchWidthOrHeight = 0.5f;
        root.AddComponent<GraphicRaycaster>();

        ARDesignUiUtil.EnsureEventSystem();

        // Drawn first so everything else sits on top: hold ring, corner arrow, height aim.
        if (autoScan != null)
            BuildAutoMarkers(root.transform);
        BuildAimMark(root.transform);

        BuildInstructionCard(root.transform);
        BuildCoachChip(root.transform);
        BuildRail(root.transform);
        BuildMap(root.transform);
        if (spatialMapping != null)
            BuildReviewPanel(root.transform);
        BuildDock(root.transform);
        BuildHeightButtons(root.transform);
        BuildToast(root.transform);
        BuildHelpCard(root.transform);
    }

    /// <summary>
    /// Centred across the top, clear of the app's back button on the left and as far in on the
    /// right (the client asked for the instruction centred, 2026-10-26).
    /// </summary>
    static void PlaceTopBand(RectTransform rt, float top, float height)
    {
        rt.anchorMin = new Vector2(0f, 1f);
        rt.anchorMax = new Vector2(1f, 1f);
        rt.pivot = new Vector2(0.5f, 1f);
        rt.offsetMin = new Vector2(CardLeft, -top - height);
        rt.offsetMax = new Vector2(-CardLeft, -top);
    }

    void BuildInstructionCard(Transform root)
    {
        var shadow = ARDesignUiUtil.CreateRoundedImage(root, new Color(0f, 0f, 0f, 0.18f), 40);
        shadow.raycastTarget = false;
        PlaceTopBand(shadow.rectTransform, CardTop + 6f, CardHeight);

        var card = ARDesignUiUtil.CreateRoundedImage(root, Frost, 36);
        var cardRt = card.rectTransform;
        PlaceTopBand(cardRt, CardTop, CardHeight);

        topHintLabel = ARDesignUiUtil.CreateText(cardRt, "Scan your room", 30, FontStyle.Bold, TextAnchor.MiddleCenter);
        topHintLabel.color = Ink;
        ShrinkToFit(topHintLabel, 20);
        Stretch(topHintLabel.rectTransform, new Vector2(0.04f, 0.62f), new Vector2(0.96f, 0.95f));

        subtitleLabel = ARDesignUiUtil.CreateText(cardRt, string.Empty, 21, FontStyle.Normal, TextAnchor.MiddleCenter);
        subtitleLabel.color = InkMuted;
        ShrinkToFit(subtitleLabel, 15);
        Stretch(subtitleLabel.rectTransform, new Vector2(0.05f, 0.36f), new Vector2(0.95f, 0.63f));

        // Step bar: one chip per step, filled in as the scan moves on.
        var count = stepNames.Length;
        stepChips = new Image[count];
        stepLabels = new Text[count];
        stepChecks = new Image[count];
        const float left = 0.03f;
        const float right = 0.97f;
        var slot = (right - left) / count;
        for (var i = 0; i < count; i++)
        {
            var chip = ARDesignUiUtil.CreateRoundedImage(cardRt, StepTodo, 24);
            chip.raycastTarget = false;
            var chipRt = chip.rectTransform;
            chipRt.anchorMin = new Vector2(left + slot * i, 0.08f);
            chipRt.anchorMax = new Vector2(left + slot * (i + 1), 0.30f);
            chipRt.offsetMin = new Vector2(3f, 0f);
            chipRt.offsetMax = new Vector2(-3f, 0f);
            stepChips[i] = chip;

            var check = ARDesignUiUtil.CreateImage(chipRt, Color.white);
            check.sprite = ARDesignUiUtil.CheckSprite();
            check.preserveAspect = true;
            check.raycastTarget = false;
            var checkRt = check.rectTransform;
            checkRt.anchorMin = new Vector2(0f, 0.5f);
            checkRt.anchorMax = new Vector2(0f, 0.5f);
            checkRt.pivot = new Vector2(0f, 0.5f);
            checkRt.anchoredPosition = new Vector2(8f, 0f);
            checkRt.sizeDelta = new Vector2(22f, 22f);
            check.gameObject.SetActive(false);
            stepChecks[i] = check;

            var label = ARDesignUiUtil.CreateText(chipRt, stepNames[i], 18, FontStyle.Normal, TextAnchor.MiddleCenter);
            label.color = InkMuted;
            label.raycastTarget = false;
            ShrinkToFit(label, 12);
            var labelRt = label.rectTransform;
            labelRt.anchorMin = Vector2.zero;
            labelRt.anchorMax = Vector2.one;
            labelRt.offsetMin = new Vector2(6f, 0f);
            labelRt.offsetMax = new Vector2(-6f, 0f);
            stepLabels[i] = label;
        }
    }

    void BuildCoachChip(Transform root)
    {
        // Coaching chip under the instruction card ("Move slowly", "Point at the floor", …).
        var chip = ARDesignUiUtil.CreateRoundedImage(root, CoachBg, 30);
        chip.raycastTarget = false;
        coachChip = chip.rectTransform;
        PlaceTopBand(coachChip, CardTop + CardHeight + CoachGap, CoachHeight);

        coachTitle = ARDesignUiUtil.CreateText(coachChip, string.Empty, 24, FontStyle.Bold, TextAnchor.MiddleCenter);
        coachTitle.color = CoachInk;
        coachTitle.raycastTarget = false;
        ShrinkToFit(coachTitle, 18);
        Stretch(coachTitle.rectTransform, new Vector2(0.05f, 0.48f), new Vector2(0.95f, 0.94f));

        coachDetail = ARDesignUiUtil.CreateText(coachChip, string.Empty, 18, FontStyle.Normal, TextAnchor.MiddleCenter);
        coachDetail.color = CoachInk;
        coachDetail.raycastTarget = false;
        ShrinkToFit(coachDetail, 13);
        Stretch(coachDetail.rectTransform, new Vector2(0.05f, 0.08f), new Vector2(0.95f, 0.50f));
        coachChip.gameObject.SetActive(false);
    }

    /// <summary>Rescan, Auto, Light and Help down the right edge, under the instruction card.</summary>
    void BuildRail(Transform root)
    {
        rescanButton = CreateRailButton(root, "Rescan", Frost, Ink, OnRescanClicked, out rescanImage, out rescanLabel);
        if (autoScan != null)
            autoToggleButton = CreateRailButton(root, "Auto: On", AccentReady, Color.white, OnAutoToggleClicked, out autoToggleImage, out autoToggleLabel);
        lightButton = CreateRailButton(root, "Light: Off", Frost, Ink, OnLightClicked, out lightImage, out lightLabel);
        helpButton = CreateRailButton(root, "Help", Frost, Ink, OnHelpClicked, out _, out _);
        LayoutRail();
    }

    Button CreateRailButton(
        Transform root,
        string label,
        Color bg,
        Color textColor,
        UnityEngine.Events.UnityAction onClick,
        out Image image,
        out Text text)
    {
        var holder = new GameObject(label + "Holder", typeof(RectTransform));
        holder.transform.SetParent(root, false);
        var rt = (RectTransform)holder.transform;
        rt.anchorMin = new Vector2(1f, 1f);
        rt.anchorMax = new Vector2(1f, 1f);
        rt.pivot = new Vector2(0.5f, 0.5f);
        rt.sizeDelta = new Vector2(RailWidth, RailItemHeight);
        var button = CreatePillButton(holder.transform, label, Vector2.zero, Vector2.one, bg, textColor, onClick, out image, out text);
        text.fontSize = 22;
        button.gameObject.SetActive(false);
        railItems.Add((rt, button));
        return button;
    }

    void BuildAutoMarkers(Transform root)
    {
        dwellRing = ARDesignUiUtil.CreateImage(root, Color.white);
        dwellRing.sprite = ARDesignUiUtil.CircleRingSprite(128, 0.14f);
        dwellRing.type = Image.Type.Filled;
        dwellRing.fillMethod = Image.FillMethod.Radial360;
        dwellRing.fillOrigin = (int)Image.Origin360.Top;
        dwellRing.fillClockwise = true;
        dwellRing.fillAmount = 0f;
        dwellRing.raycastTarget = false;
        var ringRt = dwellRing.rectTransform;
        ringRt.anchorMin = new Vector2(0.5f, 0.5f);
        ringRt.anchorMax = new Vector2(0.5f, 0.5f);
        ringRt.pivot = new Vector2(0.5f, 0.5f);
        ringRt.sizeDelta = new Vector2(150f, 150f);
        dwellRing.gameObject.SetActive(false);

        var arrowChip = ARDesignUiUtil.CreateImage(root, AutoOrange);
        ARDesignUiUtil.ApplyCircle(arrowChip);
        arrowChip.raycastTarget = false;
        targetArrow = arrowChip.rectTransform;
        targetArrow.anchorMin = new Vector2(0.5f, 0.5f);
        targetArrow.anchorMax = new Vector2(0.5f, 0.5f);
        targetArrow.pivot = new Vector2(0.5f, 0.5f);
        targetArrow.sizeDelta = new Vector2(96f, 96f);
        var arrowIcon = ARDesignUiUtil.CreateImage(targetArrow, Color.white);
        arrowIcon.sprite = LoadArrowSprite();
        arrowIcon.preserveAspect = true;
        arrowIcon.raycastTarget = false;
        Stretch(arrowIcon.rectTransform, new Vector2(0.22f, 0.22f), new Vector2(0.78f, 0.78f));
        targetArrow.gameObject.SetActive(false);
    }

    /// <summary>Ring with a centre dot at the point the height is read from.</summary>
    void BuildAimMark(Transform root)
    {
        var ring = ARDesignUiUtil.CreateImage(root, new Color(1f, 1f, 1f, 0.95f));
        ring.sprite = ARDesignUiUtil.CircleRingSprite(128, 0.1f);
        ring.raycastTarget = false;
        aimMark = ring.rectTransform;
        aimMark.pivot = new Vector2(0.5f, 0.5f);
        aimMark.sizeDelta = new Vector2(76f, 76f);

        var dot = ARDesignUiUtil.CreateImage(aimMark, Color.white);
        ARDesignUiUtil.ApplyCircle(dot);
        dot.raycastTarget = false;
        var dotRt = dot.rectTransform;
        dotRt.anchorMin = dotRt.anchorMax = dotRt.pivot = new Vector2(0.5f, 0.5f);
        dotRt.sizeDelta = new Vector2(12f, 12f);
        aimMark.gameObject.SetActive(false);

        // The floor aim while scanning: a dot with a dark edge so it reads on white floors too.
        var edge = ARDesignUiUtil.CreateImage(root, new Color(0f, 0f, 0f, 0.35f));
        ARDesignUiUtil.ApplyCircle(edge);
        edge.raycastTarget = false;
        floorAimDot = edge.rectTransform;
        floorAimDot.anchorMin = floorAimDot.anchorMax = floorAimDot.pivot = new Vector2(0.5f, 0.5f);
        floorAimDot.sizeDelta = new Vector2(34f, 34f);

        floorAimDotImage = ARDesignUiUtil.CreateImage(floorAimDot, AimSearching);
        ARDesignUiUtil.ApplyCircle(floorAimDotImage);
        floorAimDotImage.raycastTarget = false;
        var innerRt = floorAimDotImage.rectTransform;
        innerRt.anchorMin = innerRt.anchorMax = innerRt.pivot = new Vector2(0.5f, 0.5f);
        innerRt.sizeDelta = new Vector2(24f, 24f);
        floorAimDot.gameObject.SetActive(false);
    }

    void BuildMap(Transform root)
    {
        var panel = ARDesignUiUtil.CreateRoundedImage(root, Frost, 32);
        mapPanel = panel.rectTransform;
        var button = panel.gameObject.AddComponent<Button>();
        button.targetGraphic = panel;
        button.transition = Selectable.Transition.None;
        button.onClick.AddListener(OnMapClicked);

        var go = new GameObject("MiniMap", typeof(RectTransform));
        go.transform.SetParent(mapPanel, false);
        map = go.AddComponent<ARScanMiniMap>();
        map.raycastTarget = false;
        var rt = map.rectTransform;
        rt.anchorMin = Vector2.zero;
        rt.anchorMax = Vector2.one;
        rt.offsetMin = new Vector2(8f, 8f);
        rt.offsetMax = new Vector2(-8f, -8f);
        mapPanel.gameObject.SetActive(false);
        ApplyMapLayout();
    }

    void BuildDock(Transform root)
    {
        // Bottom dock (hidden during the Start / Finish height step). It is anchored by its bottom
        // edge and only its height changes, so the buttons are placed from the bottom.
        var shadow = ARDesignUiUtil.CreateRoundedImage(root, new Color(0f, 0f, 0f, 0.18f), 40);
        shadow.raycastTarget = false;
        bottomShadow = shadow.rectTransform;
        bottomShadow.anchorMin = bottomShadow.anchorMax = new Vector2(0.5f, 0f);
        bottomShadow.pivot = new Vector2(0.5f, 0f);
        bottomShadow.anchoredPosition = new Vector2(0f, DockBottom - 16f);
        bottomShadow.sizeDelta = new Vector2(DockWidth + 20f, DockFullHeight + 20f);

        var dock = ARDesignUiUtil.CreateRoundedImage(root, Frost, 40);
        bottomDock = dock.rectTransform;
        bottomDock.anchorMin = bottomDock.anchorMax = new Vector2(0.5f, 0f);
        bottomDock.pivot = new Vector2(0.5f, 0f);
        bottomDock.anchoredPosition = new Vector2(0f, DockBottom);
        bottomDock.sizeDelta = new Vector2(DockWidth, DockFullHeight);
        dockHeight = DockFullHeight;
        // The measurement scan starts on the Start / Finish height step — keep the dock off until then.
        bottomShadow.gameObject.SetActive(false);
        bottomDock.gameObject.SetActive(false);

        auxTypeButton = CreatePillButton(bottomDock, "Start over", Vector2.zero, Vector2.zero, FrostSoft, Ink, OnAuxTypeClicked, out _, out auxTypeLabel);
        PlaceInDock(auxTypeButton, 0.05f, 0.48f, 100f, 164f);
        auxTypeLabel.fontSize = 24;
        auxTypeButton.gameObject.SetActive(false);

        undoButton = CreatePillButton(bottomDock, "Undo", Vector2.zero, Vector2.zero, Frost, Ink, OnUndoClicked, out undoImage, out undoLabel);
        PlaceInDock(undoButton, 0.05f, 0.30f, 16f, 88f);

        confirmButton = CreatePillButton(bottomDock, "Add corners", Vector2.zero, Vector2.zero, StepTodo, InkMuted, OnConfirmClicked, out confirmImage, out confirmLabel);
        PlaceInDock(confirmButton, 0.32f, 0.95f, 16f, 88f);
    }

    static void PlaceInDock(Button button, float xMin, float xMax, float bottom, float top)
    {
        var rt = (RectTransform)button.transform;
        rt.anchorMin = new Vector2(xMin, 0f);
        rt.anchorMax = new Vector2(xMax, 0f);
        rt.offsetMin = new Vector2(0f, bottom);
        rt.offsetMax = new Vector2(0f, top);
    }

    void BuildHeightButtons(Transform root)
    {
        startButton = CreateCenterActionButton(
            root, "Start", new Vector2(0.5f, 0f), new Vector2(0f, 160f), 156f, MeasurePurple,
            OnStartClicked, out startImage, out startLabel);
        startButton.gameObject.SetActive(false);

        finishButton = CreateCenterActionButton(
            root, "Set\nheight", new Vector2(0.5f, 0f), new Vector2(0f, 160f), 156f, MeasurePurple,
            OnFinishClicked, out finishImage, out finishLabel);
        finishButton.gameObject.SetActive(false);

        // Undo beside Finish, so a misplaced base point can be set again.
        heightUndoButton = CreateCenterActionButton(
            root, "Undo", new Vector2(0.5f, 0f), new Vector2(-220f, 160f), 112f, Frost,
            OnUndoClicked, out heightUndoImage, out heightUndoLabel);
        heightUndoLabel.color = Ink;
        heightUndoButton.gameObject.SetActive(false);

        // Skip on the other side: use the usual ceiling height (Review can change it).
        skipHeightButton = CreateCenterActionButton(
            root, "Skip", new Vector2(0.5f, 0f), new Vector2(220f, 160f), 112f, Frost,
            OnSkipHeightClicked, out _, out var skipLabel);
        skipLabel.color = Ink;
        skipHeightButton.gameObject.SetActive(false);
    }

    /// <summary>Review panel: ceiling height row, a short title, and a grid of chips.</summary>
    void BuildReviewPanel(Transform root)
    {
        var panel = ARDesignUiUtil.CreateRoundedImage(root, Frost, 32);
        reviewPanel = panel.rectTransform;
        reviewPanel.anchorMin = reviewPanel.anchorMax = new Vector2(0.5f, 0f);
        reviewPanel.pivot = new Vector2(0.5f, 0f);
        reviewPanel.sizeDelta = new Vector2(ReviewWidth(), 260f);

        // Ceiling height:  − 2.50 m +
        var heightTitle = ARDesignUiUtil.CreateText(reviewPanel, "Ceiling height", 24, FontStyle.Bold, TextAnchor.MiddleLeft);
        heightTitle.color = Ink;
        heightTitle.raycastTarget = false;
        PlaceFromTop(heightTitle.rectTransform, 18f, 64f, 22f, 300f);

        var minus = CreatePillButton(reviewPanel, "−", Vector2.zero, Vector2.zero, StepTodo, Ink, () => OnHeightStep(-0.05f), out _, out _);
        PlaceTopRight((RectTransform)minus.transform, 18f + 4f, 64f, 56f, 210f);
        reviewHeightValue = ARDesignUiUtil.CreateText(reviewPanel, "2.50 m", 26, FontStyle.Bold, TextAnchor.MiddleCenter);
        reviewHeightValue.color = Ink;
        reviewHeightValue.raycastTarget = false;
        PlaceTopRight(reviewHeightValue.rectTransform, 18f, 120f, 64f, 88f);
        var plus = CreatePillButton(reviewPanel, "+", Vector2.zero, Vector2.zero, StepTodo, Ink, () => OnHeightStep(0.05f), out _, out _);
        PlaceTopRight((RectTransform)plus.transform, 18f + 4f, 64f, 56f, 22f);

        reviewListTitle = ARDesignUiUtil.CreateText(reviewPanel, "In this room", 20, FontStyle.Bold, TextAnchor.MiddleLeft);
        reviewListTitle.color = InkMuted;
        reviewListTitle.raycastTarget = false;
        PlaceFromTop(reviewListTitle.rectTransform, 18f + 64f + 8f, 40f, 22f, 22f);

        // Grid of chips, anchored to the bottom so the panel can grow upward.
        var gridGo = new GameObject("ReviewChips", typeof(RectTransform), typeof(GridLayoutGroup));
        gridGo.transform.SetParent(reviewPanel, false);
        reviewGrid = (RectTransform)gridGo.transform;
        reviewGrid.anchorMin = new Vector2(0f, 0f);
        reviewGrid.anchorMax = new Vector2(1f, 0f);
        reviewGrid.pivot = new Vector2(0.5f, 0f);
        reviewGrid.offsetMin = new Vector2(18f, 18f);
        reviewGrid.offsetMax = new Vector2(-18f, 18f + ReviewChipHeight);
        var grid = gridGo.GetComponent<GridLayoutGroup>();
        grid.spacing = new Vector2(ReviewChipGap, ReviewChipGap);
        grid.startCorner = GridLayoutGroup.Corner.UpperLeft;
        grid.startAxis = GridLayoutGroup.Axis.Horizontal;
        grid.childAlignment = TextAnchor.UpperLeft;
        grid.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
        grid.constraintCount = ReviewColumns;

        reviewEmptyLabel = ARDesignUiUtil.CreateText(
            reviewPanel,
            "Nothing found yet. Point the phone at it, or tap + Add.",
            20, FontStyle.Italic, TextAnchor.MiddleLeft);
        reviewEmptyLabel.color = InkMuted;
        reviewEmptyLabel.raycastTarget = false;
        var emptyRt = reviewEmptyLabel.rectTransform;
        emptyRt.anchorMin = new Vector2(0f, 0f);
        emptyRt.anchorMax = new Vector2(1f, 0f);
        emptyRt.pivot = new Vector2(0.5f, 0f);
        emptyRt.offsetMin = new Vector2(22f, 0f);
        emptyRt.offsetMax = new Vector2(-22f, 44f);
        reviewEmptyLabel.gameObject.SetActive(false);

        reviewPanel.gameObject.SetActive(false);
    }

    ReviewChip CreateReviewChip()
    {
        var button = CreatePillButton(reviewGrid, "Chip", Vector2.zero, Vector2.one, Frost, Ink, () => { }, out var image, out var label);
        label.fontSize = 22;
        ShrinkToFit(label, 14);
        return new ReviewChip { button = button, image = image, label = label };
    }

    /// <summary>Top-right anchored box inside a card: <paramref name="right"/> in from the right edge.</summary>
    static void PlaceTopRight(RectTransform rt, float top, float width, float height, float right)
    {
        rt.anchorMin = rt.anchorMax = new Vector2(1f, 1f);
        rt.pivot = new Vector2(1f, 1f);
        rt.anchoredPosition = new Vector2(-right, -top);
        rt.sizeDelta = new Vector2(width, height);
    }

    void BuildToast(Transform root)
    {
        var bg = ARDesignUiUtil.CreateRoundedImage(root, ToastBg, 30);
        bg.raycastTarget = false;
        toastRect = bg.rectTransform;
        toastRect.anchorMin = toastRect.anchorMax = new Vector2(0.5f, 0f);
        toastRect.pivot = new Vector2(0.5f, 0.5f);
        toastRect.sizeDelta = new Vector2(400f, 62f);
        toastGroup = bg.gameObject.AddComponent<CanvasGroup>();
        toastGroup.blocksRaycasts = false;
        toastGroup.interactable = false;

        toastText = ARDesignUiUtil.CreateText(toastRect, string.Empty, 24, FontStyle.Bold, TextAnchor.MiddleCenter);
        toastText.color = Color.white;
        toastText.raycastTarget = false;
        toastText.horizontalOverflow = HorizontalWrapMode.Overflow;
        Stretch(toastText.rectTransform, Vector2.zero, Vector2.one);
        toastRect.gameObject.SetActive(false);
    }

    /// <summary>"How it works": the steps and a few tips, over a dark scrim that blocks the camera taps.</summary>
    void BuildHelpCard(Transform root)
    {
        var scrim = ARDesignUiUtil.CreateImage(root, Scrim);
        helpOverlay = scrim.gameObject;
        helpOverlay.name = "HelpOverlay";
        Stretch(scrim.rectTransform, Vector2.zero, Vector2.one);

        const float rowHeight = 132f;
        const float rowsTop = 196f;
        var visibleSteps = stepNames.Length;
        var cardHeight = rowsTop + rowHeight * visibleSteps + 260f;

        var card = ARDesignUiUtil.CreateRoundedImage(scrim.rectTransform, Color.white, 40);
        var cardRt = card.rectTransform;
        cardRt.anchorMin = new Vector2(0f, 0.5f);
        cardRt.anchorMax = new Vector2(1f, 0.5f);
        cardRt.pivot = new Vector2(0.5f, 0.5f);
        cardRt.offsetMin = new Vector2(28f, -cardHeight * 0.5f);
        cardRt.offsetMax = new Vector2(-28f, cardHeight * 0.5f);

        var title = ARDesignUiUtil.CreateText(cardRt, $"Scan your room in {visibleSteps} steps", 38, FontStyle.Bold, TextAnchor.MiddleLeft);
        title.color = Ink;
        ShrinkToFit(title, 26);
        PlaceFromTop(title.rectTransform, 44f, 60f, 44f, 44f);

        var intro = ARDesignUiUtil.CreateText(cardRt, "Hold the phone upright and follow the card at the top of the screen.", 22, FontStyle.Normal, TextAnchor.MiddleLeft);
        intro.color = InkMuted;
        ShrinkToFit(intro, 16);
        PlaceFromTop(intro.rectTransform, 108f, 64f, 44f, 44f);

        helpStepTitles = new Text[visibleSteps];
        helpStepBodies = new Text[visibleSteps];
        helpStepBadges = new Image[visibleSteps];
        for (var i = 0; i < visibleSteps; i++)
        {
            var top = rowsTop + rowHeight * i;
            var badge = ARDesignUiUtil.CreateImage(cardRt, StepTodo);
            ARDesignUiUtil.ApplyCircle(badge);
            badge.raycastTarget = false;
            var badgeRt = badge.rectTransform;
            badgeRt.anchorMin = badgeRt.anchorMax = new Vector2(0f, 1f);
            badgeRt.pivot = new Vector2(0f, 1f);
            badgeRt.anchoredPosition = new Vector2(44f, -top - 4f);
            badgeRt.sizeDelta = new Vector2(56f, 56f);
            var number = ARDesignUiUtil.CreateText(badgeRt, (i + 1).ToString(), 26, FontStyle.Bold, TextAnchor.MiddleCenter);
            number.color = Ink;
            number.raycastTarget = false;
            Stretch(number.rectTransform, Vector2.zero, Vector2.one);
            helpStepBadges[i] = badge;

            var stepTitle = ARDesignUiUtil.CreateText(cardRt, string.Empty, 27, FontStyle.Bold, TextAnchor.UpperLeft);
            stepTitle.color = Ink;
            stepTitle.raycastTarget = false;
            PlaceFromTop(stepTitle.rectTransform, top, 38f, 124f, 44f);
            helpStepTitles[i] = stepTitle;

            var body = ARDesignUiUtil.CreateText(cardRt, string.Empty, 21, FontStyle.Normal, TextAnchor.UpperLeft);
            body.color = InkMuted;
            body.raycastTarget = false;
            ShrinkToFit(body, 15);
            PlaceFromTop(body.rectTransform, top + 38f, rowHeight - 46f, 124f, 44f);
            helpStepBodies[i] = body;
        }

        var tips = ARDesignUiUtil.CreateText(
            cardRt,
            "Tips: turn the lights on and move slowly. Undo and Back are always there, and Rescan starts over.",
            21, FontStyle.Italic, TextAnchor.MiddleLeft);
        tips.color = InkMuted;
        ShrinkToFit(tips, 15);
        PlaceFromTop(tips.rectTransform, rowsTop + rowHeight * visibleSteps + 4f, 76f, 44f, 44f);

        var start = CreatePillButton(cardRt, "Start scanning", Vector2.zero, Vector2.zero, AccentReady, Color.white, () => HideHelp(), out _, out helpButtonLabel);
        var startRt = (RectTransform)start.transform;
        startRt.anchorMin = new Vector2(0f, 0f);
        startRt.anchorMax = new Vector2(1f, 0f);
        startRt.offsetMin = new Vector2(44f, 40f);
        startRt.offsetMax = new Vector2(-44f, 136f);
        helpButtonLabel.fontSize = 30;

        helpOverlay.SetActive(false);
    }

    /// <summary>Top-anchored row inside a card: <paramref name="top"/> down from its top edge, inset left/right.</summary>
    static void PlaceFromTop(RectTransform rt, float top, float height, float left, float right)
    {
        rt.anchorMin = new Vector2(0f, 1f);
        rt.anchorMax = new Vector2(1f, 1f);
        rt.pivot = new Vector2(0.5f, 1f);
        rt.offsetMin = new Vector2(left, -top - height);
        rt.offsetMax = new Vector2(-right, -top);
    }

    static void Stretch(RectTransform rt, Vector2 min, Vector2 max)
    {
        rt.anchorMin = min;
        rt.anchorMax = max;
        rt.offsetMin = Vector2.zero;
        rt.offsetMax = Vector2.zero;
    }

    static Sprite LoadArrowSprite()
    {
        const string path = "UIIcons/back-arrow";
        var sprite = Resources.Load<Sprite>(path);
        if (sprite != null) return sprite;
        var tex = Resources.Load<Texture2D>(path);
        return tex == null
            ? null
            : Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f), 100f);
    }

    static ARDesignSpatialMappingController EnsureSpatialMappingRuntime(GameObject host)
    {
        var spatial = host.GetComponent<ARDesignSpatialMappingController>();
        if (spatial == null)
            spatial = host.AddComponent<ARDesignSpatialMappingController>();
        if (host.GetComponent<ARDesignSpatialMappingVisualizer>() == null)
            host.AddComponent<ARDesignSpatialMappingVisualizer>();
        if (host.GetComponent<ARFurnitureAutoSuggestService>() == null)
            host.AddComponent<ARFurnitureAutoSuggestService>();
        return spatial;
    }

    /// <summary>Long text (room size summary, coaching detail) shrinks instead of being cut off.</summary>
    static void ShrinkToFit(Text text, int minSize)
    {
        text.resizeTextForBestFit = true;
        text.resizeTextMinSize = minSize;
        text.resizeTextMaxSize = text.fontSize;
    }

    static Button CreateCenterActionButton(
        Transform parent,
        string label,
        Vector2 anchor,
        Vector2 anchoredPos,
        float diameter,
        Color bg,
        UnityEngine.Events.UnityAction onClick,
        out Image image,
        out Text text)
    {
        var go = new GameObject(label + "ActionButton", typeof(RectTransform), typeof(Image), typeof(Button));
        go.transform.SetParent(parent, false);
        image = go.GetComponent<Image>();
        ARDesignUiUtil.ApplyCircle(image);
        image.color = bg;

        var button = go.GetComponent<Button>();
        button.targetGraphic = image;
        button.onClick.AddListener(onClick);
        var colors = button.colors;
        colors.highlightedColor = new Color(0.18f, 0.32f, 0.55f, 1f);
        colors.pressedColor = new Color(0.08f, 0.18f, 0.38f, 1f);
        colors.disabledColor = MeasurePurpleDisabled;
        button.colors = colors;

        var rt = go.GetComponent<RectTransform>();
        rt.anchorMin = anchor;
        rt.anchorMax = anchor;
        rt.pivot = new Vector2(0.5f, 0.5f);
        rt.anchoredPosition = anchoredPos;
        rt.sizeDelta = new Vector2(diameter, diameter);

        text = ARDesignUiUtil.CreateText(go.transform, label, 26, FontStyle.Bold, TextAnchor.MiddleCenter);
        text.color = Color.white;
        text.horizontalOverflow = HorizontalWrapMode.Overflow;
        text.raycastTarget = false;
        var textRt = text.rectTransform;
        textRt.anchorMin = Vector2.zero;
        textRt.anchorMax = Vector2.one;
        textRt.offsetMin = new Vector2(8f, 8f);
        textRt.offsetMax = new Vector2(-8f, -8f);
        return button;
    }

    static Button CreatePillButton(
        Transform parent,
        string label,
        Vector2 anchorMin,
        Vector2 anchorMax,
        Color bg,
        Color textColor,
        UnityEngine.Events.UnityAction onClick,
        out Image image,
        out Text text)
    {
        var go = new GameObject(label + "Button", typeof(RectTransform), typeof(Image), typeof(Button));
        go.transform.SetParent(parent, false);
        image = go.GetComponent<Image>();
        ARDesignUiUtil.ApplyRounded(image, 32);
        image.color = bg;

        var button = go.GetComponent<Button>();
        button.targetGraphic = image;
        button.onClick.AddListener(onClick);
        var colors = button.colors;
        colors.highlightedColor = Color.white;
        colors.pressedColor = new Color(0.92f, 0.92f, 0.94f, 1f);
        colors.disabledColor = new Color(1f, 1f, 1f, 0.55f);
        button.colors = colors;

        var rt = go.GetComponent<RectTransform>();
        rt.anchorMin = anchorMin;
        rt.anchorMax = anchorMax;
        rt.offsetMin = Vector2.zero;
        rt.offsetMax = Vector2.zero;

        text = ARDesignUiUtil.CreateText(go.transform, label, 28, FontStyle.Bold, TextAnchor.MiddleCenter);
        text.color = textColor;
        var textRt = text.rectTransform;
        textRt.anchorMin = Vector2.zero;
        textRt.anchorMax = Vector2.one;
        textRt.offsetMin = new Vector2(8f, 4f);
        textRt.offsetMax = new Vector2(-8f, -4f);
        return button;
    }
}
