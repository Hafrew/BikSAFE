# BikSafe Mark III: AI-First Plan

## Objective

Move BikSafe as close as practical to the Phase 3 runtime using work that Codex
can implement, test, and repeat locally. Personal riding footage and personal
road testing are not prerequisites for development or regression testing.

The release boundary remains conservative: public-road safety claims still need
independent validation, but that validation can be commissioned on a closed
course and does not need to use the developer's or user's personal rides.

## Priority Order

### P0: Current-engine safety and correctness

- [x] Pass an explicit COCO-SSD minimum score.
- [x] Expand the pre-filter candidate pool before removing non-vehicle classes.
- [x] Reduce the fixed small/distant-object rejection floor.
- [x] Invalidate output immediately after an inference failure.
- [x] Bind results to camera generation and mode.
- [x] Supervise source-frame age rather than inference completion time.
- [x] Prevent haptic throttling from suppressing upward danger escalation.
- [x] Add a distinct system-fault tone and haptic.
- [x] Reject non-finite persisted safety settings.
- [x] Stop treating an FOV slider movement as proven calibration.

### P1: Evaluation without personal riding data

- [x] Add deterministic unit tests for threat, TTC, settings, and detection metrics.
- [x] Add a seeded synthetic approach-scenario evaluator.
- [x] Add a BDD100K annotation importer.
- [x] Add class-aware detection precision/recall evaluation.
- [x] Add a browser batch runner that executes the production model over a
      public evaluation manifest.
- [x] Add KITTI calibration and 3D-label import for distance-error evaluation.
- [x] Add deterministic blur, glare, rain, crop, occlusion, and vibration
      transforms to the public image suite.

Preferred public sources:

- BDD100K for diverse road-object detection, weather, time-of-day, and scene
  slices: <https://github.com/ucbdrive/bdd100k>
- KITTI tracking/object data for calibrated geometry and 3D distance labels:
  <https://www.cvlibs.net/datasets/kitti/>
- Tsinghua-Daimler Cyclist Benchmark for cyclist/motorcyclist recall:
  <https://www.gavrila.net/Datasets/Daimler_Pedestrian_Benchmark_D/Tsinghua-Daimler_Cyclist_Detec/tsinghua-daimler_cyclist_detec.html>
- nuScenes/nuImages only when its non-commercial or commercial license fits the
  intended release: <https://nuscenes.org/>

Dataset licensing must be checked before redistributing images or derived
artifacts. Keep downloaded datasets outside the app package and Git history.

### P2: Data-free perception improvements

- [x] Add time-to-collision estimation from smoothed range velocity.
- [x] Require a confirmed multi-frame track before TTC escalation.
- [x] Add conservative path relevance without filtering adjacent cut-in objects.
- [x] Rank primary threats using severity, TTC, path relevance, and confidence.
- [x] Replace detection-order greedy association with global compatible-class matching.
- [ ] Add a second low-confidence association pass after public-data threshold tuning.
- [ ] Calibrate uncertainty constants against KITTI/nuScenes public 3D labels.
- [ ] Benchmark the three existing COCO variants against public scenario slices.
- [ ] Benchmark a license-compatible traffic-specific quantized detector before
      changing the production model.

### P3: Latency architecture

- [x] Drive inference from presented camera frames.
- [x] Use a latest-frame queue and never process the same frame twice.
- [x] Target start-to-start inference cadence instead of adding idle time after
      every completion.
- [x] Record source-frame age and detector cadence separately from render FPS.
- [x] Redraw the HUD and overlay only when perception or health state changes.
- [x] Add an opt-in dedicated Worker inference adapter with automatic main-thread
      fallback (`?worker=1`).
- [x] Add a clearly labeled synthetic camera (`?demo=1`) so the complete app can
      be tested without camera permission or personal footage.
- [ ] Promote Worker inference to the default only after public-data and sustained
      device benchmarks show a p95 improvement.
- [x] Add startup model warm-up and sustained backend benchmarking.
- [ ] Add adaptive input resolution based on public-data recall and measured
      p95 frame age.
- [ ] Bundle and fingerprint the runtime and model for deterministic offline use.

## Automated Commands

```powershell
npm test
npm run eval:synthetic
npm run eval:public-fixtures
npm run build
```

Public BDD100K evaluation flow:

```powershell
node tools/import-bdd100k.mjs --labels C:\datasets\bdd100k\labels.json --images C:\datasets\bdd100k\images --out C:\datasets\biksafe-bdd-manifest.json
npm run serve -- --port=8000
start http://localhost:8000/tools/public-eval.html
node tools/evaluate-detections.mjs --ground-truth C:\datasets\biksafe-bdd-manifest.json --predictions C:\datasets\biksafe-predictions.json --out C:\datasets\biksafe-report.json
```

The browser evaluator can now run either backend at 640, 512, or 384 px and can
apply the original image plus six deterministic stress variants. Its generated
fixture button verifies the complete browser pipeline without a camera or
dataset download; that fixture is explicitly not accuracy evidence.

## Current Local Benchmark

On the development desktop, the 30-run 640x384 synthetic backend benchmark
reported main-thread p95 inference of 77.4 ms and p95 timer stall of 79.3 ms,
versus Worker p95 inference of 54.5 ms and p95 timer stall of 0.7 ms. This is a
useful architecture signal, not a release gate or a substitute for public-image
and supported-device measurements. Worker mode therefore remains opt-in.

## Next AI-First Checkpoint

1. Download a small, license-compatible public BDD100K/KITTI slice outside Git
   and run every model/backend/input-size combination through the evaluator.
2. Use those immutable reports to tune association confidence and uncertainty,
   then select safe adaptive-resolution floors.
3. Promote Worker mode only if public-image recall is unchanged and supported
   devices show a sustained p95 frame-age improvement.
4. Bundle and fingerprint the chosen runtime/model after licensing and package
   size are confirmed. None of these steps requires personal riding data.

## Acceptance Gates

- No normal threat state after a stale, failed, wrong-generation, or expired
  observation.
- Threat-onset to first enabled alert p95 at or below 250 ms on the supported
  device matrix.
- Danger-event recall and false-alert gates are calculated from immutable public
  and synthetic suites before every release.
- Model, preprocessing, thresholds, and evaluation report are versioned together.
- No raw personal ride video is required or collected by the normal workflow.
