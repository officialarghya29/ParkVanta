# ParkVanta — AI & Computer Vision Design

**Status:** architecture specified; runtime **not deployed**. The product is fully functional without it.

## 1. Principle

AI is an enhancement to parking operations, never an authority. It cannot override a denied entry, and its absence
must never block a gate.

```text
Camera frame → vehicle detection → plate detection → crop → preprocess → OCR
            → registration normalisation → confidence scoring → backend verification
            → advisory result to the guard → human decision
```

## 2. Service boundary

An isolated Python service (`apps/vision` in the target layout), versioned and internal-only:

| Endpoint | Input | Output |
| :--- | :--- | :--- |
| `POST /api/v1/vision/detect-vehicle` | image (≤ 5 MB) | boxes, class, confidence |
| `POST /api/v1/vision/recognize-plate` | image or crop | plate text, confidence, normalised value |
| `POST /api/v1/vision/verify-vehicle` | plate + invitation id | match, confidence, recommendation |
| `POST /api/v1/vision/parking-occupancy` | slot image | occupied: boolean, confidence |
| `GET /health` | — | model versions, warm state |

Timeouts: 2.5 s per inference. The core API ignores vision failures and records a `vision_unavailable` metric.

## 3. Recommended stack

- Python 3.12, OpenCV, PyTorch.
- YOLO-family detector for vehicles and plates (pretrained first; no bespoke training until evaluated).
- PaddleOCR or an equivalently licensed OCR engine for plate text.
- Indian plate normalisation: `^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$`, tolerant of common OCR confusions
  (`O↔0`, `I↔1`, `B↔8`), with an explicit confidence penalty for corrections.

## 4. Confidence policy (proposed, requires pilot calibration)

| Confidence | Behaviour |
| :--- | :--- |
| ≥ 0.90 and exact plate match | Advisory "match" shown to guard; still requires guard action |
| 0.70–0.90 | Advisory "review" with cropped plate image |
| < 0.70 | No recommendation; manual verification |
| Any | AI never authorizes a pass and never opens a barrier |

## 5. Evaluation protocol

Datasets must cover daylight, night/IR, rain, motion blur, oblique angles, partial occlusion, two-wheelers,
four-wheelers, and multiple Indian state formats. Report character accuracy, full-plate accuracy, confidence
calibration, and latency (p50/p95) per condition. Do not claim production readiness from a handful of samples.

Acceptance for pilot use: full-plate accuracy ≥ 97% on the daylight set, ≥ 92% at night, p95 latency ≤ 2.5 s,
and zero cases where a low-confidence read is presented as certain.

## 6. Data handling

- Frames processed in memory; retained only when explicitly enabled for a review queue.
- Plate text is personal data: access restricted to gate staff and admins, retention aligned with visit records.
- No facial recognition, no biometric templates, no identity inference from appearance.

## 7. Integration contract

`POST /gate/entry/authorize` accepts an optional plate. When vision is enabled, the guard UI may prefill the
observed plate; the backend still performs the authoritative comparison against the invitation. Vision output is
stored as an advisory event, never as an authorization.
