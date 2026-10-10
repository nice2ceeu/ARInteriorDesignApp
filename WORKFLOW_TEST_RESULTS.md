# Current workflow checks

Tested October 10, 2026. This covers automated service/API checks and source inspection, not a phone UI session.

## Results

- Frontend: 23 tests passed across five suites. Added service workflow coverage for signup/login/session storage/logout, project save/load/list/finalize/delete, and export payloads. Network calls, AsyncStorage, and file writes are mocked in these tests.
- Backend: six authentication and layout/ML gateway regression tests and three Jest validation tests passed. Authentication uses an isolated local test app; this does not verify MongoDB signup on the running server.
- Python: four tests passed. The synthetic XGBoost training/loading test initially hit sandbox temporary-folder permissions and passed when rerun outside the sandbox. Detection uses mocked weights; no real OWLv2 accuracy was measured.
- Live LAN API: health, ML status, bedroom catalog, and bedroom layout generation returned HTTP 200. A 5 x 4 x 2.7 m Minimalist bedroom with a PHP 30,000 budget and a required desk returned three proposals. Login with missing credentials returned HTTP 400. No live user account was created.
- Live ML status: available=false, detectorReady=false, rankerReady=false. The current running setup cannot perform real model inference.

## Confirmed gaps

1. Fixed after this audit: layout saving now also registers the project in savedItems, and the Saved tab opens it in the layout view with its design and room dimensions. The regression test verifies visibility, repeated saving without duplicates, and removal on project deletion. Previously saved project_<id> entries are not migrated; save them again to add them to the Saved tab.
2. PNG, PDF, and GLB export options currently write JSON metadata files, not actual images, PDF documents, or binary GLB assets. The export test confirms their current behavior; these are incomplete user-facing exports.
3. Scanning and tracking still contain simulated logic. The frontend OWLv2 gateway is not wired into scan screens, and live ML models are unavailable.
4. The existing collision/safety test suites include demonstration assertions and placeholders. Their passing result does not establish real camera geometry or AR placement correctness.

## Still requires a phone test

- Fresh app startup and navigation after login/signup.
- MongoDB-backed signup/login, profile updates, and session restoration.
- Camera permissions, photo capture, room scan/calibration, and device measurements.
- AR rendering, dragging, rotation, colors, replacement, and stable world anchors.
- Opening saved designs from the actual UI and sharing exported files through Android.

No full seven-step room-scan-to-final-design workflow is certified by these checks.
