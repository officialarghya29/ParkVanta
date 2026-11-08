from app.vision.__main__ import main
from app.vision.evaluation import VisionManifest, evaluate


def _manifest(cases: list[dict]) -> VisionManifest:
    return VisionManifest.model_validate(
        {
            "dataset": "unit-fixture",
            "model_name": "candidate",
            "model_version": "0.1-test",
            "cases": cases,
        }
    )


def _case(**overrides) -> dict:
    base = {
        "condition": "daylight",
        "plate_truth": "KA01AB1234",
        "plate_prediction": "KA01AB1234",
        "plate_confidence": 0.98,
        "occupancy_truth": "OCCUPIED",
        "occupancy_prediction": "OCCUPIED",
        "latency_ms": 800.0,
    }
    base.update(overrides)
    return base


def test_vision_evaluation_passes_gate_and_cli(tmp_path):
    manifest = _manifest(
        [
            _case(),
            _case(condition="night", plate_truth="ka-01-ab-1234", plate_prediction="KA01AB1234"),
            _case(occupancy_truth="FREE", occupancy_prediction="FREE"),
            _case(condition="night", latency_ms=1200.0),
        ]
    )
    report = evaluate(
        manifest,
        min_samples=4,
        min_plate_accuracy=0.95,
        min_occupancy_accuracy=0.95,
        max_p95_ms=2500.0,
    )

    assert report["passed"] is True
    assert report["metrics"]["plate_accuracy"] == 1.0
    assert report["metrics"]["false_certain_reads"] == 0
    assert report["per_condition"]["night"]["samples"] == 2

    path = tmp_path / "manifest.json"
    path.write_text(manifest.model_dump_json(), encoding="utf-8")
    assert (
        main(
            [
                str(path),
                "--min-samples",
                "4",
                "--min-plate-accuracy",
                "0.95",
                "--min-occupancy-accuracy",
                "0.95",
            ]
        )
        == 0
    )


def test_vision_evaluation_fails_gate_and_flags_false_certainty(tmp_path):
    manifest = _manifest(
        [
            _case(),
            _case(
                plate_prediction="KA01AB9999",
                plate_confidence=0.99,
                occupancy_truth="FREE",
                occupancy_prediction="OCCUPIED",
            ),
        ]
    )
    report = evaluate(
        manifest,
        min_samples=2,
        min_plate_accuracy=0.90,
        min_occupancy_accuracy=0.90,
    )

    assert report["passed"] is False
    assert report["metrics"]["plate_accuracy"] == 0.5
    assert report["metrics"]["occupancy_accuracy"] == 0.5
    assert report["metrics"]["false_certain_reads"] == 1
    assert "no_false_certain_reads" in report["failures"]

    path = tmp_path / "manifest.json"
    path.write_text(manifest.model_dump_json(), encoding="utf-8")
    assert (
        main(
            [
                str(path),
                "--min-samples",
                "2",
                "--min-plate-accuracy",
                "0.90",
                "--min-occupancy-accuracy",
                "0.90",
            ]
        )
        == 1
    )
