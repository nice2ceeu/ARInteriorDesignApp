# Local model inference

The React Native app calls Express. Express generates feasible placement candidates and asks this private Python service to rank them. Room photos go through Express authentication to OWLv2. No Gemini key is needed.

## Models and current readiness

- OWLv2 is a pretrained image detector. Its first startup downloads the configured checkpoint; a local checkpoint path also works. It returns image-pixel boxes, not room dimensions or 3D coordinates. Camera pose, metric scale and stable anchors still require native AR tracking.
- XGBoost ranks layouts after a client-specific model has been trained. No trained artifact is included because no rated layout dataset is available. Until then, the backend uses explicit geometric scoring and returns `rankingSource: "geometric"`.
- Labeled GLB/OBJ furniture belongs in the catalog. It is not a layout-ranking dataset. Rendering 3D objects can later help create synthetic detector training data, but that pipeline is not implemented here.

## Setup on Windows

Install Python 3.11 or 3.12, then from the repo root:

```powershell
cd ml-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Keep the service bound to loopback. Express exposes the authenticated public endpoint; phones connect to Express, not directly to Python.

In another terminal:

```powershell
cd backend
# Copy only when .env does not already exist; preserve existing secrets otherwise.
Copy-Item .env.example .env
npm install
npm start
```

Set `ML_SERVICE_URL=http://127.0.0.1:8000` in backend/.env. `GET /api/v1/ml/status` reports detector and ranker readiness. Restart Python after configuring model paths. CPU inference can be slow; this photo workflow makes no real-time FPS claim.

## Client furniture catalog

Prepare JSON in the shape of `catalog.example.json`, using measured meter dimensions, actual `pricePHP` and hosted GLB URLs. Set `FURNITURE_CATALOG_PATH` in backend/.env to that file (relative paths resolve from the backend working directory). The backend returns model URLs for downstream 3D loading; the current floor-plan view renders footprints. The built-in catalog uses sample estimates and generated box models, not the client's assets.

## Train the ranker when data is available

Each JSONL record needs:

```json
{"groupId":"room-001","features":{"roomArea":20,"furnitureCount":4,"occupancyRatio":0.3,"budgetUtilization":0.8,"requiredCoverage":1,"minimumGap":0.3,"centerClear":1,"symmetry":0.5,"meanX":0.4,"meanZ":0.6,"heuristicScore":86},"relevance":4}
```

The example illustrates the schema only. Do not train on repeated copies. Export `proposals[].features` from `/api/v1/designs/generate`, then have a designer rate each candidate from 0 (poor) to 4 (excellent). Use the same groupId for all candidates from the same room, including repeated generations, to keep that room in one split. Provide multiple genuinely different rated arrangements per room. The script requires at least five groups for a minimal smoke run; meaningful model quality requires a substantially larger representative dataset.

```powershell
.\.venv\Scripts\python.exe train_ranker.py path\to\rated-layouts.jsonl --output models/layout-ranker.json
```

Set `LAYOUT_RANKER_PATH=models/layout-ranker.json` in ml-service/.env and restart Python. The trainer creates a feature-schema manifest and reports held-out NDCG@3. Training and validation groups are separated by room. The current features capture geometry/budget, not a learned aesthetic style representation.

## API contracts

- `POST /api/v1/ml/detect`: `{ "imageBase64": "...", "labels": ["chair", "door"], "threshold": 0.2 }`. Requires login. At most 5 MB decoded, 16 megapixels and 30 text labels. Unavailable models return 503, never fabricated detections.
- `POST /api/v1/design/generate`: keeps the existing floor-plan array contract; accepts roomDimensions, roomType, style, budgetPHP and requiredFurniture IDs/types.
- `POST /api/v1/designs/generate`: returns proposals, rank features and rankingSource. Also accepts measured `constraints.fixedObstacles` and clearance limits.
- `POST /rank` is internal. Scores are ranking values, not probabilities or accuracy percentages.
- `POST /optimize-layout` is internal: `{ "room": {width, length, height}, "items": [{id, type, name, width, length, height, mandatory}], "openings": [{"type": "door", "wall": "south", "offset": 0.5, "width": 0.9}], "obstacles": [{x, z, width, length}], "count": 3 }`. Returns up to `count` layouts with poses (`x`, `z`, `rotation`), a score (share of rules met) and per-rule `checks`. Both public generate endpoints accept the same `openings` list.

### Design-rule layout optimizer

`layout_optimizer.py` runs simulated annealing (about 1,500 steps × 6 runs, a few seconds on a laptop CPU) over a cost built from interior design guidelines: backs against walls, functional pairs (nightstand–bed, chair–desk, coffee table–sofa, TV–sofa), clear floor in front of furniture, door swing, windows, a walkable path from the door (raster flood fill), and visual balance. It returns diverse layouts, preferring ones that keep all requested furniture and a clear door. Approach after Merrell et al. 2011 and Yu et al. 2011. When this service is offline, Express falls back to a basic grid planner and reports that in the layout warnings.

Furniture footprints use a top-left room origin in meters (x across width, z along depth), and dimensions are rotated when checking occupancy. Rotation 0 backs an item onto the north wall (z = 0); 90 the east wall, 180 the south wall, 270 the west wall. The floor-plan adapter emits oriented footprints with rotation 0 to prevent double rotation. Door and window positions come from the wall the user selects; photo detections alone do not provide positions.

## Verification

```powershell
cd backend
npm run test:ml
npm run test:auth
```

The Node tests use mocked ML responses for the gateway, plus actual geometric generation. They do not establish OWLv2 detection accuracy. Test detection separately on real room photos before deployment.

For Python inference-contract and training-mechanics tests:

```powershell
cd ml-service
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Python tests mock detector weights and train a temporary ranker on synthetic smoke data. The temporary model is deleted; these checks do not measure client-data performance.

References: [OWLv2](https://huggingface.co/docs/transformers/model_doc/owlv2), [XGBoost ranking](https://xgboost.readthedocs.io/en/stable/tutorials/learning_to_rank.html), [FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/).
