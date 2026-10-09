"""Train on real rated candidates grouped by room/request; not 3D assets alone."""
import argparse
import json
from pathlib import Path

import numpy as np
from xgboost import XGBRanker

from features import FEATURE_NAMES, FEATURE_VERSION, feature_vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", help="JSONL: each line has groupId, features, relevance (integer 0-4)")
    parser.add_argument("--output", default="models/layout-ranker.json")
    args = parser.parse_args()
    rows = [json.loads(line) for line in Path(args.dataset).read_text(encoding="utf-8").splitlines() if line.strip()]
    groups = {}
    for row in rows:
        feature_vector(row["features"])
        if type(row.get("relevance")) is not int or not 0 <= row["relevance"] <= 4:
            raise ValueError("relevance must be an integer from 0 to 4")
        groups.setdefault(str(row["groupId"]), []).append(row)
    if len(groups) < 5 or any(len(group) < 2 for group in groups.values()):
        raise ValueError("Provide at least five room/request groups, each with at least two rated layouts")
    if any(len({row["relevance"] for row in group}) < 2 for group in groups.values()):
        raise ValueError("Each group must contain different relevance ratings")
    keys = sorted(groups)
    rng = np.random.default_rng(42)
    rng.shuffle(keys)
    split = max(1, len(keys) // 5)
    validation_keys, training_keys = keys[:split], keys[split:]

    def matrix(selected):
        records = [row for key in selected for row in groups[key]]
        return (np.asarray([feature_vector(row["features"]) for row in records], dtype=np.float32),
                np.asarray([row["relevance"] for row in records]),
                [len(groups[key]) for key in selected])

    train_x, train_y, train_groups = matrix(training_keys)
    val_x, val_y, val_groups = matrix(validation_keys)
    model = XGBRanker(objective="rank:ndcg", n_estimators=150, max_depth=4,
                      learning_rate=0.05, random_state=42, eval_metric="ndcg@3", n_jobs=2)
    model.fit(train_x, train_y, group=train_groups,
              eval_set=[(val_x, val_y)], eval_group=[val_groups], verbose=False)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(output)
    manifest = {"featureVersion": FEATURE_VERSION, "features": FEATURE_NAMES,
                "trainingGroups": len(training_keys), "validationGroups": len(validation_keys),
                "validationNdcgAt3": model.evals_result()["validation_0"]["ndcg@3"][-1]}
    Path(str(output) + ".manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
