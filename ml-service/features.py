"""Shared feature order for serving and training; version with model artifacts."""
FEATURE_VERSION = 1
FEATURE_NAMES = [
    "roomArea", "furnitureCount", "occupancyRatio", "budgetUtilization",
    "requiredCoverage", "minimumGap", "centerClear", "symmetry", "meanX", "meanZ", "heuristicScore",
]


def feature_vector(features):
    import math
    values = [features[name] for name in FEATURE_NAMES]
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values):
        raise ValueError("Layout features must be finite numbers")
    return values
