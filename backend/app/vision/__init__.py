"""Offline vision evaluation. No model is bundled or deployed."""

from app.vision.evaluation import VisionCase, VisionManifest, evaluate

__all__ = ["VisionCase", "VisionManifest", "evaluate"]
