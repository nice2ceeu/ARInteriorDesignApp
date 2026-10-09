import base64
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch
from fastapi.testclient import TestClient
from PIL import Image

import app as service
from features import FEATURE_NAMES, feature_vector
import train_ranker


class Inputs(dict):
    def to(self, device):
        return self


class FakeProcessor:
    def __call__(self, **kwargs):
        return Inputs()

    def post_process_object_detection(self, **kwargs):
        return [{"boxes": torch.tensor([[1., 2., 10., 12.], [1., 2., 10., 12.]]),
                 "scores": torch.tensor([0.9, 0.8]), "labels": torch.tensor([0, 0])}]


class FakeDetector:
    device = "cpu"

    def __call__(self, **kwargs):
        return {}

    def to(self, device):
        return self

    def eval(self):
        return self


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(service.app)
        service.state.update(processor=None, detector=None, ranker=None)

    def tearDown(self):
        service.state.update(processor=None, detector=None, ranker=None)

    def test_unloaded_models_report_readiness_and_return_503(self):
        self.assertFalse(self.client.get("/health").json()["detectorReady"])
        self.assertEqual(self.client.post("/detect", json={"imageBase64": "abcd"}).status_code, 503)
        self.assertEqual(self.client.post("/rank", json={"candidates": [{"id": "test", "features": {}}]}).status_code, 503)

    def test_detection_returns_image_boxes_without_invented_depth(self):
        service.state.update(processor=FakeProcessor(), detector=FakeDetector())
        image_bytes = io.BytesIO()
        Image.new("RGB", (20, 20)).save(image_bytes, format="PNG")
        response = self.client.post("/detect", json={
            "imageBase64": base64.b64encode(image_bytes.getvalue()).decode(), "labels": ["chair"]})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["hasMetricDepth"])
        self.assertEqual(body["coordinateSpace"], "image-pixels")
        self.assertEqual(len(body["detections"]), 1)
        self.assertEqual(body["detections"][0]["label"], "chair")
        self.assertEqual(self.client.post("/detect", json={"imageBase64": "not-base64!"}).status_code, 422)
        self.assertEqual(self.client.post("/detect", json={"imageBase64": "abcd", "labels": [""]}).status_code, 422)

    def test_feature_schema_rejects_missing_and_nonfinite_values(self):
        with self.assertRaises(KeyError):
            feature_vector({})
        with self.assertRaises(ValueError):
            feature_vector({name: float("nan") for name in FEATURE_NAMES})

    def test_training_and_loading_real_xgboost_artifact_with_synthetic_smoke_data(self):
        # Exercises mechanics only; no synthetic checkpoint ships as a client model.
        test_root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(dir=test_root) as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(test_root))
            dataset = Path(folder) / "smoke.jsonl"
            output = Path(folder) / "ranker.json"
            rows = []
            for group in range(10):
                for relevance in [0, 2, 4]:
                    features = {name: 0.5 for name in FEATURE_NAMES}
                    features.update(roomArea=20 + group, furnitureCount=4, heuristicScore=50 + relevance * 10)
                    rows.append({"groupId": f"room-{group}", "features": features, "relevance": relevance})
            dataset.write_text("\n".join(json.dumps(row) for row in rows))
            with patch.object(sys, "argv", ["train_ranker.py", str(dataset), "--output", str(output)]):
                train_ranker.main()
            self.assertTrue(output.exists())
            manifest = json.loads(Path(str(output) + ".manifest.json").read_text())
            self.assertEqual(manifest["features"], FEATURE_NAMES)
            self.assertEqual(manifest["validationGroups"], 2)
            with patch.dict("os.environ", {"LAYOUT_RANKER_PATH": str(output)}), \
                 patch("transformers.Owlv2Processor.from_pretrained", return_value=FakeProcessor()), \
                 patch("transformers.Owlv2ForObjectDetection.from_pretrained", return_value=FakeDetector()):
                with TestClient(service.app) as client:
                    self.assertTrue(client.get("/health").json()["rankerReady"])
                    response = client.post("/rank", json={"candidates": [{"id": str(i), "features": row["features"]} for i, row in enumerate(rows[:3])]})
                    self.assertEqual(response.status_code, 200)
                    scores = response.json()["scores"]
                    self.assertEqual(len(scores), 3)
                    self.assertGreater(scores[2], scores[0])


if __name__ == "__main__":
    unittest.main()
