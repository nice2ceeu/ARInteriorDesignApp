# AR Interior Design App

**An AI-powered AR interior design system with real-time spatial mapping and generative layouts.**

A user measures (and later scans) a room, sets preferences such as room type, style, a peso budget and required furniture, and the system generates furniture arrangements that follow interior design rules. The user previews a layout over the camera, in 3D and as a floor plan, then saves the final design with a PDF floor plan and a cost breakdown.

## Design flow and current status

| Step | Status | Notes |
| --- | --- | --- |
| 1. Scan the room | Simulated | Camera screens exist; room capture is simulated until native ARCore scanning is added. |
| 2. Spatial mapping | Partial | Room size is entered by hand (or prefilled from a project). Door and window walls are selectable. OWLv2 can detect objects in a photo, but detections have no 3D position. |
| 3. Preferences | Working | Room type, style, PHP budget, required furniture. |
| 4. Generate layouts | Working | Python design-rule optimizer (see below). The XGBoost ranker waits for a rated-layout dataset. |
| 5. AR visualization | Partial | The whole arrangement renders over the live camera; it is not yet anchored to the floor. |
| 6. Customization | Partial | Regenerate, move the AR arrangement as a group, select items in 3D. Per-item move, recolor and swap are not built yet. |
| 7. Final design | Working | Saves the design to the project, PDF floor plan with cost breakdown, PNG snapshot, GLB model, sharing. |

Tested on a Tecno Spark 30C (Android 14) in Expo Go: login, Home, project creation, AI Design generation, AR overlay, 3D Layout.

## Architecture

```
React Native app (Expo)  ──HTTP──▶  Node/Express API  ──HTTP (private)──▶  Python ML service (FastAPI)
  frontend/                          backend/  :3000                        ml-service/  127.0.0.1:8000
  screens, AR/3D views,              auth, projects, catalog,               layout optimizer, OWLv2 detection,
  PDF/GLB export                     layout planning gateway                XGBoost layout ranker
```

The phone talks only to the Node API. Node calls the Python service, which stays on loopback. If Python is offline, Node falls back to a basic placement planner and says so in the layout warnings.

## How layouts are generated

`ml-service/layout_optimizer.py` scores a layout against interior design guidelines and searches for good layouts with simulated annealing, following Merrell et al. (2011, *Interactive Furniture Layout Using Interior Design Guidelines*) and Yu et al. (2011, *Make It Home*).

Rules checked for every layout:

- Beds, wardrobes, dressers, desks, sofas and shelves have their back against a wall
- Functional pairs: nightstand beside the bed head, chair at the desk, coffee table in front of the sofa, TV opposite the sofa, dining chairs at the table
- Clear floor in front of beds (0.6 m), wardrobes (0.9 m), dressers and desks
- Door swing kept clear; tall furniture kept off windows; desk near a window for daylight
- A walkable 0.6 m path from the door to every item
- Visual balance across the room
- No overlaps, inside the room, within the PHP budget

Each layout reports the rules it meets ("Design rules met: 14 of 15"), shown in the app. Scores are the share of rules met, not user ratings. Room dimensions must be measured; photos alone do not provide 3D positions.

## Getting started

Prerequisites: Node.js 22.8+, Python 3.12 (3.11 also works; newer versions may lack PyTorch wheels), Expo Go on an Android phone on the same Wi-Fi, and optionally MongoDB (without it, accounts are kept in memory until the server restarts).

```powershell
# 1. Install
npm run install:all
cd ml-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
cd ..

# 2. Configure: copy backend/.env.example and frontend/.env.example to .env.
#    For a phone, set EXPO_PUBLIC_API_BASE_URL=http://<your-PC-LAN-IP>:3000/api/v1 in frontend/.env.

# 3. Run (three terminals)
cd ml-service; .\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
npm run dev:backend
npm run start:frontend      # scan the QR code with Expo Go
```

The first Python start downloads the OWLv2 detection model (several hundred MB). `GET /api/v1/ml/status` reports what is ready.

## Data and datasets

- **Furniture catalog** (`FURNITURE_CATALOG_PATH` in `backend/.env`): JSON in the shape of `ml-service/catalog.example.json`, with measured dimensions, `pricePHP` and an optional `modelUrl` to a GLB model. Until it is set, built-in sample furniture and sample prices are used, and the app says so. Home shows item counts per room only for a real catalog.
- **3D models**: files placed in `backend/public/models/` are served at `http://<server>:3000/models/<file>.glb` and can be referenced from the catalog's `modelUrl`.
- **Rated layouts** for the XGBoost ranker: JSONL described in [ml-service/README.md](ml-service/README.md).
- Public datasets that can help (check each license; most are research-only or non-commercial): 3D-FRONT / 3D-FUTURE (furnished room layouts and furniture models), ARKitScenes (real phone scans with labeled furniture boxes), Amazon Berkeley Objects (product metadata and GLB models), 3D-SPAD (human plausibility ratings of scenes), and CC BY 4.0 indoor detection sets on Roboflow Universe.

## Testing

```powershell
cd frontend; npm test                         # 34 Jest tests
cd backend;  npm run test:ml; npm run test:auth
cd ml-service; .\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Backend Jest (`npm test`) uses a Unix-style environment variable and does not run on Windows as written; run `npx jest` with `NODE_OPTIONS=--experimental-vm-modules` from Git Bash instead.

## Known limitations

- Room scanning and AR anchoring need native ARCore (a development build; Expo Go cannot load it).
- The splash screen always opens Login; "Forgot password" and the AR capture button are placeholders.
- Layout scores measure design-rule compliance, not aesthetics or user preference, until the ranker is trained on ratings.
- Prices and furniture are samples until a client catalog is configured.

## Project structure

```
frontend/     Expo / React Native app (app/ screens, components/, services/, hooks/, utils/)
backend/      Express API (src/routes, src/controllers, src/services/layoutPlanner.js)
ml-service/   FastAPI service (layout_optimizer.py, app.py, train_ranker.py, tests/)
docs/         Design notes, diagrams and database documentation
```

## License

Intended license: MIT. No LICENSE file has been added yet. Datasets and 3D models keep their own licenses.
