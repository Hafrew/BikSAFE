# Mark III experimental model and Worker pipeline integration — 2026-11-02

Status: implemented locally, packaged, **not tested**. User explicitly authorized implementing steps 3–4 now and deferring testing/benchmarks until after GitHub upload and hosted testing. iPhone first, browser support retained.

## Changes

- COCO Lite remains the default. Existing COCO variants remain available.
- Added manual, clearly labeled startup choices for EfficientDet-Lite0 and RF-DETR Nano. Both run inside a dedicated Worker. Startup notes disclose experimental status and the RF-DETR model download size.
- Added direct selection through `?model=efficientdet_lite0`, `?model=rfdetr_nano`, or `?model=lite_mobilenet_v2`. The query overrides a previously saved choice, which helps compare the same build consistently.
- Worker paths now capture/transfer the video frame and perform canvas resizing and sampled scene-quality analysis off the UI thread. Scene-quality sampling is refreshed when the camera/session epoch changes. The baseline main-thread pipeline is retained.
- Worker results use source-frame pixel coordinates, so the existing filters, range estimates, tracking and overlay keep their common coordinate contract. Worker-side preprocessing gets its own diagnostic timing span.
- Experimental model initialization/runtime failures fall back visibly to the COCO baseline. Reports preserve requested and active model identifiers so fallback cannot be mistaken for a successful candidate run. The public evaluator reports candidate errors instead of substituting another model during a comparison.
- Diagnostics export runtime/model versions, model hashes/revision, requested versus active model, backend and source build fingerprint. The new adapters report full task/adapter timing, not GPU-kernel-only timing.
- Added a comparison-tools landing page at `tools/index.html`. The web build now includes this page, the public evaluator, COCO Worker smoke page and COCO backend benchmark. Opening these pages after upload is optional and explicitly starts their respective checks.
- Updated the service-worker cache version and precache list for the new source modules. Remote model/runtime assets remain first-use downloads; this is not deterministic offline packaging.

## Model implementations and provenance

### EfficientDet-Lite0

- Runtime: `@mediapipe/tasks-vision@1.2.0`, loaded only when selected.
- Model: Google's EfficientDet-Lite0 int8 version 1, 320-square network input.
- Model URL: [versioned model](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite).
- Model bytes: 4,602,795; SHA-256 `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`.
- Uses the CPU/WASM delegate and the task's model preprocessing/postprocessing, with vehicle allowlisting and the existing app confidence filters afterward. It is a comparison candidate, not a presumed latency winner.

### RF-DETR Nano

- Runtime: `@litertjs/core@2.5.3`, loaded only when selected.
- Model revision: `388a9bb69eefac2efff19d5bb92cea49b7379a5a`; two split fp16 TFLite graphs, about 56 MB of model weights plus runtime assets.
- Graph A SHA-256: `de71a9c0c3fb2e1c617f3a79b2ce3541ea33b7ceb9bd5e7edd752b067efe33a1`.
- Graph B SHA-256: `ced9a6b29f8196c6d66c9864a11f4fd2d7e23bb5ab2d0d83f49101f85321fc86`.
- Graph A requests WebGPU and can fall back to WASM at compile or execution failure. Graph B stays on WASM because the official example documents incorrect decoder results on WebGPU.
- Retains the official sample's Pillow-style antialiased resize, float32 ImageNet normalization, shape-based tensor binding, top-300 proposal selection and per-class NMS. Uses sparse COCO category IDs and maps vehicle boxes back to source pixels.
- Host routines are adapted from pinned Google sample revision `9467001474dc4e072ebc588e5eb9b5fdcf63abbc`; license and adaptation notes are in `src/vendor/`.

Both adapters compare downloaded weights against their pinned SHA-256 before loading. The RF-DETR reference contract and primary-source links are in [adapter sources](BIKSAFE_MODEL_ADAPTER_SOURCES_2026-11-02.md). Runtime sources/package declarations and model assets were inspected/downloaded to establish these contracts; no model inference was executed here.

## What was and was not checked

- `npm.cmd run build` completed and created `dist/app`, including the browser comparison tools and source artifact manifest.
- Packaged source fingerprint: `21f5b77e1d0b1b77d63f086c709f63bf80d3bd6f865cf6aaa0102008c6c0307c`.
- Source was read/reviewed and `git diff --check` found no whitespace errors.
- **Not run:** unit tests, synthetic evaluations, browser smoke checks, accuracy checks, numerical parity checks, performance benchmarks, Safari, WKWebView or phone sessions.
- The previous October checkpoint's 61-test and performance results apply to that previous source version. They do not validate this integration.
- No performance, detection-quality, memory or power improvements are measured or claimed for these changes.

## GitHub / hosting handoff

The changes are local and uncommitted. No push or deployment was performed. Existing overlapping work remains preserved on `main`; do not force-push/reset to resolve the earlier upstream divergence.

Before-change source backup: `C:\Users\darre\Documents\Codex\2026-11-02\biksafe-before-model-options-174445`.

The web artifact is static:

```text
Build command: npm run build
Publish directory: dist/app
Browser test hub: <your HTTPS preview URL>/tools/
```

GitHub stores the source. Browser camera checks need an actual HTTPS preview/Pages deployment or the iOS application; a repository file view does not run the app. No hosting configuration or paid service was selected in this pass.

After upload, start with the comparison hub and verify the requested/active model fields in each exported report. Use the exact same build and scenario for:

1. COCO Lite main-thread baseline.
2. COCO Lite with `?worker=1`, which now includes Worker preprocessing.
3. EfficientDet-Lite0 experimental Worker.
4. RF-DETR Nano experimental Worker.

The public evaluator's experimental choices use Workers regardless of its baseline backend selector. Its raw report identifies the actual backend and experimental status. It will not silently compare COCO when a candidate failed to load.

If the old model list remains visible after deployment, allow the service worker to update and reload, then check the report's build fingerprint. Keep initial checks stationary. Actual timing, distant-object recall, false alerts, range/TTC behavior, frame dimensions, fallback handling and 20–30-minute device behavior remain for the deferred testing phase.

The current code uses externally served runtime JavaScript/WASM. Hashing the model graphs does not pin the contents of every runtime dependency. Keep these paths experimental until hosted/device checks are complete; do not use the older desktop benchmark to promote them.
