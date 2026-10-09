"""Private inference service. Express is the public API/authentication boundary."""
import base64
import io
import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from features import FEATURE_NAMES, FEATURE_VERSION, feature_vector

load_dotenv()
logger = logging.getLogger("interior-ml")
DEFAULT_LABELS = ["chair", "sofa", "table", "desk", "bed", "wardrobe", "door", "window"]
Image.MAX_IMAGE_PIXELS = 16_000_000
state = {"processor": None, "detector": None, "ranker": None}
inference_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    from transformers import Owlv2ForObjectDetection, Owlv2Processor
    model_id = os.getenv("OWL_MODEL_ID", "google/owlv2-base-patch16-ensemble")
    try:
        state["processor"] = Owlv2Processor.from_pretrained(model_id)
        state["detector"] = Owlv2ForObjectDetection.from_pretrained(model_id).to(os.getenv("ML_DEVICE", "cpu")).eval()
    except Exception:
        logger.exception("OWLv2 could not load; detection will return 503")
    ranker_path = os.getenv("LAYOUT_RANKER_PATH")
    if ranker_path:
        try:
            from xgboost import XGBRanker
            manifest = json.loads(Path(ranker_path + ".manifest.json").read_text(encoding="utf-8"))
            if manifest["featureVersion"] != FEATURE_VERSION or manifest["features"] != FEATURE_NAMES:
                raise ValueError("Ranker feature schema does not match this service")
            ranker = XGBRanker()
            ranker.load_model(ranker_path)
            state["ranker"] = ranker
        except Exception:
            logger.exception("Layout ranker could not load; ranking will return 503")
    yield
    state.update(processor=None, detector=None, ranker=None)


app = FastAPI(title="Interior Design ML", lifespan=lifespan)


class DetectionRequest(BaseModel):
    imageBase64: str = Field(min_length=1, max_length=7_000_000)
    labels: list[str] | None = Field(default=None, min_length=1, max_length=30)
    threshold: float = Field(default=0.2, ge=0, le=1)


class Candidate(BaseModel):
    id: str
    features: dict[str, float]


class RankingRequest(BaseModel):
    candidates: list[Candidate] = Field(min_length=1, max_length=50)


@app.get("/health")
def health():
    return {
        "detector": "owlv2", "detectorReady": state["detector"] is not None,
        "ranker": "xgboost", "rankerReady": state["ranker"] is not None,
        "featureVersion": FEATURE_VERSION,
    }


@app.post("/detect")
def detect(request: DetectionRequest):
    if state["detector"] is None or state["processor"] is None:
        raise HTTPException(503, "OWLv2 is not loaded")
    labels = request.labels or DEFAULT_LABELS
    if any(not label.strip() or len(label) > 100 for label in labels):
        raise HTTPException(422, "Labels must be nonempty and at most 100 characters")
    try:
        raw = request.imageBase64.split(",", 1)[-1]
        image_bytes = base64.b64decode(raw, validate=True)
        if len(image_bytes) > 5_000_000:
            raise ValueError("Image exceeds 5 MB")
        image = Image.open(io.BytesIO(image_bytes))
        if image.format not in {"JPEG", "PNG"}:
            raise ValueError("Only JPEG and PNG images are accepted")
        if image.width * image.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError("Image exceeds 16 megapixels")
        image = ImageOps.exif_transpose(image).convert("RGB")
    except (ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(422, "Provide a valid JPEG or PNG room image under 5 MB") from error
    import torch
    with inference_lock, torch.inference_mode():
        processor = state["processor"]
        detector = state["detector"]
        inputs = processor(text=[[f"a photo of a {label}" for label in labels]], images=image, return_tensors="pt").to(detector.device)
        outputs = detector(**inputs)
        result = processor.post_process_object_detection(
            outputs=outputs, threshold=request.threshold,
            target_sizes=torch.tensor([[image.height, image.width]], device=detector.device),
        )[0]
    detections = []
    for box, score, label in zip(result["boxes"], result["scores"], result["labels"]):
        x1, y1, x2, y2 = box.tolist()
        x1, y1 = min(image.width, max(0, x1)), min(image.height, max(0, y1))
        detections.append({"label": labels[int(label)], "confidence": float(score),
                           "boundingBox": {"x": x1, "y": y1,
                                           "width": max(0, min(image.width, x2) - x1),
                                           "height": max(0, min(image.height, y2) - y1)}})
    retained = []
    for detection in sorted(detections, key=lambda item: item["confidence"], reverse=True):
        if not any(other["label"] == detection["label"] and iou(other["boundingBox"], detection["boundingBox"]) > 0.5 for other in retained):
            retained.append(detection)
        if len(retained) >= 50:
            break
    return {"model": "owlv2", "imageWidth": image.width, "imageHeight": image.height,
            "detections": retained, "coordinateSpace": "image-pixels", "hasMetricDepth": False}


def iou(a, b):
    width = max(0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    height = max(0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    intersection = width * height
    union = a["width"] * a["height"] + b["width"] * b["height"] - intersection
    return intersection / union if union else 0


@app.post("/rank")
def rank(request: RankingRequest):
    if state["ranker"] is None:
        raise HTTPException(503, "No trained layout ranker is configured")
    try:
        matrix = np.asarray([feature_vector(candidate.features) for candidate in request.candidates], dtype=np.float32)
    except (KeyError, ValueError) as error:
        raise HTTPException(422, "Missing or invalid layout features") from error
    scores = state["ranker"].predict(matrix).tolist()
    return {"scores": scores, "modelVersion": os.getenv("LAYOUT_RANKER_VERSION", "client-v1")}
