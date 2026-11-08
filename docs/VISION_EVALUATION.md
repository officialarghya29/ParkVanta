# ParkVanta — Vision Evaluation Protocol

**Status:** protocol and scorer implemented. **No vision model is bundled or deployed**, and this document makes no
accuracy claim. The gate exists so a candidate model can be rejected before it touches a real gate.

## 1. What is scored

A model run exports one prediction per image. The evaluator compares those predictions with labelled ground truth:

| Metric | Definition |
| :--- | :--- |
| Full-plate accuracy | Normalized predicted plate equals the normalized truth |
| Occupancy accuracy | Predicted `OCCUPIED`/`FREE` equals the label |
| p95 latency | 95th percentile of exported per-image inference time |
| False-certain reads | Wrong plate predicted with confidence ≥ 0.90 |
| Per-condition slice | The same metrics split by `condition` |

Normalization removes separators, spaces and lower case: `ka-01-ab-1234` becomes `KA01AB1234`. It does not apply
OCR-confusion corrections; a corrected read is still a miss for evaluation purposes.

## 2. Manifest format

```json
{
  "dataset": "daylight-validation-2026-11",
  "model_name": "anpr-candidate",
  "model_version": "0.4.0",
  "captured_at": "2026-11-08T10:00:00Z",
  "cases": [
    {
      "condition": "daylight",
      "plate_truth": "KA01AB1234",
      "plate_prediction": "KA01AB1234",
      "plate_confidence": 0.98,
      "occupancy_truth": "OCCUPIED",
      "occupancy_prediction": "OCCUPIED",
      "latency_ms": 840
    }
  ]
}
```

`condition` is free text but pilot manifests must at least cover `daylight`, `night`, `rain`, `blur`, `oblique`,
`occluded`, `two-wheeler` and `four-wheeler`.

## 3. Release gate

```bash
cd backend
../.venv/bin/python -m app.vision ../../path/to/manifest.json
```

The command prints a JSON report and exits:

- **0** — every check passed,
- **1** — the manifest scored successfully but failed the gate,
- **2** — the manifest is missing or invalid.

Default pilot thresholds:

| Check | Default |
| :--- | :--- |
| Minimum samples | 100 |
| Full-plate accuracy | ≥ 0.97 |
| Occupancy accuracy | ≥ 0.95 |
| p95 latency | ≤ 2,500 ms |
| False-certain reads | 0 |

Thresholds are explicit flags (`--min-samples`, `--min-plate-accuracy`, `--min-occupancy-accuracy`,
`--max-p95-ms`, `--false-certain-confidence`) so a stricter or condition-specific gate can be applied without
editing code. Lowering a threshold to make a model pass is a decision that belongs in the pilot record.

The AI design's daylight/night split (≥ 97% / ≥ 92%) is applied by scoring each condition slice with its own
manifest and threshold; the combined gate above is the floor.

## 4. What this does not prove

- It does not measure live camera placement, lighting or network jitter.
- It does not calibrate confidence; a model can pass accuracy and still be badly calibrated.
- It does not authorize entry. Vision remains advisory and the guard decision remains authoritative.
- A passing manifest is evidence for that dataset only, never a production-readiness certificate.

## 5. Data handling

Export only predictions and labels. Do not commit images, plate crops or full plates from real residents to the
repository. Store pilot manifests in the restricted evaluation bucket, with access limited to gate staff and the
pilot owner.

## 6. Integration path

```text
model run → prediction manifest → python -m app.vision → PASS / REJECT
                                                        │
                                             PASS ──────┴────── advisory service
                                                        (still behind guard decision)
```

The core API does not import a model. If the optional vision service is unavailable, the gate falls back to manual
verification exactly as it does today.
