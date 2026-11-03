# BikSAFE Mark III optimization and iteration plan

Date: 2026-10-25. Status: researched proposal; no runtime changes or new performance gains claimed.

Implementation update: the [first timing/lifecycle pass](BIKSAFE_MARK_III_PASS1_2026-10-25.md) is now implemented and locally verified. See that checkpoint for current results and open gates; the plan below remains the roadmap, not a statement that every pass is complete.

2026-11-02 steering: the user explicitly chose to defer testing until after GitHub upload/hosted testing and implement pipeline improvements plus the newer model options now. The [experimental model integration checkpoint](BIKSAFE_MARK_III_MODELS_2026-11-02.md) records that changed order. Evaluation and promotion gates remain unfulfilled; the previous pass's measurements do not validate the new code.

## Recommendation

Refresh the measurement and replay system, finish the Worker pipeline, then compare two bounded model/runtime challengers. Select by sustained time to a useful warning, small-object recall, false alerts, and device resource use. Preserve COCO-SSD as the regression baseline until a challenger earns promotion. User-selected priority: iPhone first, with browser support retained.

### iPhone-first execution priority

- Primary environments: iPhone Safari and the iOS Capacitor app's WKWebView, benchmarked separately. Include installed web-app mode if it is an intended delivery surface.
- Establish the minimum supported iPhone/iOS version from device availability and measurements; do not assume the newest device represents the supported floor. Test at least an older supported tier and a recent tier before selecting defaults.
- Preserve a browser-capable inference path. Probe WebGPU with the actual model and keep a validated fallback for environments that cannot run it. Desktop results support development; they do not select iPhone defaults.
- Run bounded runtime feasibility checks on iPhone before spending effort on large model/export comparisons. Discard unsupported candidates early with recorded reasons.
- Android remains a secondary compatibility target. Native acceleration, if required by evidence, starts with an iOS camera/inference adapter while preserving the browser engine.

## Verified starting point

- Local checkout: `C:\Users\darre\Documents\New project 2`; HEAD `cee8612`.
- Fetched GitHub main: `e80fa0e`. Local Mark III changes are uncommitted and overlap upstream changes. The attempted fast-forward was aborted without merging. Preserve and reconcile this work before implementation; do not reset or automatically stash it.
- Refreshed today: `npm.cmd test` passes 26/26; `npm.cmd run eval:synthetic` passes 1,000 cases, zero failures. These establish deterministic regression health, not camera/device or public-data accuracy.
- The device matrix is a blank template. The recorded desktop 30-run synthetic Worker result is historical evidence, not a fresh measurement or phone result.
- Existing strengths: latest-frame metadata, one inference in flight, camera-generation checks, 100 ms start-to-start target, source observation age, health supervision, TTC/path scoring, and an opt-in Worker adapter.
- Existing runtime scripts pin TensorFlow.js 4.17.0 and COCO-SSD 2.2.3. The official TensorFlow.js release page lists 4.22.0; test it as a controlled dependency experiment rather than assuming an upgrade improves latency. [S3]

## What the code review changes about the old plan

1. Timing provenance needs repair first. `src/camera.js` emits callback `now` as `presentedAt`; `src/detector.js` uses this as `sourceFrameAt`. This measures age from a browser callback, not confirmed sensor capture. Callback metadata is not the pixel buffer: `prepareInput()` samples the live video separately. Pair an immutable frame with its metadata when the platform permits, and label timing origin explicitly. Capture metadata is optional and clocks must be checked. [S1]
2. Worker inference is only part of the pipeline. Main-thread canvas drawing/resizing and scene-quality sampling occur before Worker transfer. Measure bitmap creation, transfer, resize, inference, post-processing, association, render, and alert dispatch separately before choosing what to move.
3. COCO-SSD 2.2.3 performs synchronous tensor reads and CPU non-maximum suppression. It also warms its graph during loading; our two additional real-input warm-ups should be evaluated for benefit, not simply increased. The library's 300x300 load warm-up does not prove that changing our input canvas changes network compute proportionally. [S2]
4. TTC escalation requires three hits in `src/threat.js`. At a 100 ms cadence, the first-to-third observation spans about 200 ms, before the final result and alert. Lower inference milliseconds alone cannot establish the existing 250 ms event-to-alert goal.
5. `associateGlobally()` is a score-sorted greedy matcher across all candidate pairs, not a minimum-cost global assignment solver. Test crossing/occluded trajectories before replacing it. More sophisticated assignment is a correctness hypothesis, not an automatic speed improvement.
6. The public-image timer starts after image preparation and ends before application tracking/alerts. It is a model-call metric, not full event-to-alert latency. Missing images are excluded from evaluated-image summaries; require explicit coverage and incomplete-run failure for promotion.
7. Existing tests exercise filtering, range, threat math, and evaluation, but do not establish Worker timeout recovery, frame lifecycle behavior, or physical alert timing.
8. Render-on-change can still become frequent during stale observations: health detail strings include changing millisecond values. Separate stable health transitions from lower-frequency diagnostic text. Overlay rendering receives the raw snapshot even when health blocks vision; explicitly clear or mark expired overlays.

## Research findings that affect architecture

- Safari 26 shipped WebGPU. ONNX Runtime's published support table still shows Safari WebGPU unsupported; distinguish browser API availability from a working runtime/model combination. Probe adapter creation and a real model invocation in browser and Capacitor WebView independently. Do not extrapolate desktop Chrome results. [S4, S5]
- LiteRT.js offers a current alternative based on `.tflite` models, WebGPU and WASM. Mixed GPU/CPU execution depends on operator and browser capabilities, including JSPI; a nominal GPU selection can still incur fallback. Record actual execution and fallback, not just an available API. [S6]
- ONNX Runtime Web is another candidate when an ONNX export is appropriate. GPU-resident tensors and static-shape graph capture may reduce overhead, but require compatible graphs. WASM threading requires cross-origin isolation; assess hosting and WebView constraints first. A Worker primarily protects UI responsiveness and does not inherently speed the model. [S7, S8]
- MediaPipe's web object detector is a straightforward EfficientDet-Lite0 experiment, but detection calls block their calling thread, so use a Worker. [S9]
- RF-DETR Nano is a quality challenger with an Apache-2.0 model card and an official LiteRT web sample. Its roughly 30.5 million parameters make it a substantial candidate despite the Nano name. Its mobile latency, memory, operator support and converted artifact fidelity remain unmeasured here. [S10, S11]
- A ByteTrack-inspired second association pass can recover low-confidence detections for existing tracks. That is a tracking experiment; do not allow weak detections to create new alerts by themselves. [S12]

## Ordered implementation passes

### Pass 0 — Establish a reproducible baseline

Deliverables:

- Reconcile local/upstream work in an isolated, reviewable checkout without altering the current dirty files. Record exact source revision plus local patch/artifact hashes.
- A shared benchmark manifest: runtime/model versions, model and dataset hashes, preprocessing, thresholds, backend, OS/browser/WebView versions, input size, camera mode and actual camera settings.
- Timings for frame availability or capture where available, sampling, preprocessing, queue wait, transfer, model, post-processing, tracking/threats, render and alert dispatch. Keep physical tone/vibration onset separate unless instrumented.
- Automated replay of timestamped sequences with real timing, frame dropping and injected delays; still-image batch evaluation remains a separate test.
- Alternating backend order, repeated runs, warm/cold starts and p50/p95/p99; retain raw samples and count. Start with at least 1,000 timed inferences per configuration and 20-30 minute sustained finalists, then expand if tails remain unstable.
- Require dataset coverage; report missing inputs, ignored/occluded labels and per-class/object-size/scenario denominators. Start with a fixed public-image development slice and held-out sequence split. Keep adjacent frames from the same sequence in one split.

Exit: immutable baseline reports and successful main/Worker smoke runs, with unmeasured categories explicitly marked. No new model default.

### Pass 1 — Complete and harden the existing pipeline

- Explicit engine lifecycle: initialize, infer, dispose/recover, with a session epoch for pause, camera switch, model switch, timeout and Worker restart. Reject late results from expired sessions.
- Maintain one active job and one replaceable newest frame. Close superseded bitmaps/VideoFrames and test bounded memory. Snapshot pixels and their timing together; use the simplest supported transferable path before considering VideoFrame optimizations.
- Move preprocessing into the Worker where measured cost justifies it. Benchmark transfer of a full frame versus a pre-sized frame: moving resize can increase transferred bytes. Keep scene quality sampled at a bounded rate.
- Add runtime Worker failure handling and a bounded restart/fallback policy; the current main-thread fallback mainly covers Worker initialization failure.
- Keep health transitions event-driven; throttle diagnostic text separately, reuse radar DOM nodes where profiling supports it, and clear invalid overlays.
- Add deterministic tests with deferred inference promises for dropped/repeated frames, old-generation output, pause/resume, timeout, failure, resource cleanup and immediate upward alerts.

Exit: lower sustained p95 frame-to-result age or better responsiveness at equivalent detection output, no queue growth, no stale-result publication and no resource leak. Promote Worker only on configurations that pass.

### Pass 2 — Run a bounded runtime/model comparison

Baseline: current COCO-SSD Lite Worker with fixed preprocessing; optionally test TensorFlow.js 4.22.0 in a separate version-only comparison. Also compare the official TensorFlow.js WASM backend against the current plain CPU fallback in a separate backend-only experiment. Keep backend package versions matched and verify the COCO wrapper's explicit CPU post-processing path. [S13]

| Candidate | Purpose | Initial experiment |
| --- | --- | --- |
| EfficientDet-Lite0 via MediaPipe Worker | Practical mobile-oriented alternative | Official compatible model and preprocessing; CPU/GPU options supported by that API; verify selected weight license and notices |
| RF-DETR Nano via LiteRT.js Worker | Newer quality challenger | Official sample/export path, fixed supported shape, WebGPU and WASM fallback; pin and hash exported weights |

Use ONNX Runtime Web only as a controlled execution alternative for a suitable candidate export, not a simultaneous third rewrite. Try FP16 for GPU and INT8 for CPU only where supported and after output/recall comparison. Quantization is an accuracy and operator-coverage experiment, not a guaranteed win. Verify exporter, weights, runtime, and redistributed artifact licenses separately.

Measure the same class mappings, pixel geometry, small/distant object bins, crowded scenes, blur/night/rain/occlusion slices, application threat behavior and sustained device timing. Distinguish GPU kernel time, full model-call time, and app time. Preprocessing and NMS belong in the candidate budget.

Exit: one candidate wins on the relevant latency/quality/resource tradeoff across supported device tiers; otherwise retain COCO and keep the evidence. Do not change model, cadence and tracker in the same comparison.

### Pass 3 — Improve useful warning speed and track continuity

- Use source observation times for velocity/range updates instead of inference completion timestamps; varying model duration must not masquerade as object motion.
- Add high-confidence then low-confidence association for existing confirmed tracks. Preserve weak detections before the current class filter so this pass actually has candidates. Do not initialize threats solely from weak matches. [S12]
- Compare the current greedy matcher with a small assignment solver only if crossing/occlusion replays show a benefit.
- Audit confirmation delay, range smoothing, retained-track expiry and downgrade hysteresis together. Compare evidence-duration and confidence-based confirmation while keeping single-frame TTC escalation blocked. Preserve immediate well-supported danger escalation.
- Calibrate class-dependent range uncertainty on held-out calibrated data; report range error versus distance, occlusion and truncation. Public car-camera calibration is not validation of a handlebar-mounted phone.

Exit: earlier correctly supported alerts with controlled false alerts and fewer ID resets. Static-image mAP alone cannot pass this stage.

### Pass 4 — Device profiles, startup and sustained operation

- Select among a small set of validated model/input/cadence profiles using rolling frame-age measurements and hysteresis. Prefer maintaining small-object visibility; do not blindly crop to the center or lower resolution under load. Any crop path must retain periodic full-frame coverage and pass cut-in tests.
- Respect models' fixed exported shapes. Changing only the preview/preprocessing canvas is not necessarily a valid model-resolution change.
- Bundle and hash the chosen runtime/model locally; version service-worker caches with the artifact manifest. Test first launch, cached launch, cache eviction, partial download and offline restart. Existing opaque CDN caching is not deterministic packaging.
- Test 20-30 minute sessions first on iPhone Safari and iOS Capacitor WKWebView, front and rear, with memory, long tasks, cadence drift, battery consumption where measurable, and thermal indicators where available. Test Android compatibility afterward. Do not claim phone temperature from an unavailable browser API.
- Prefer compact logs and stable UI updates over expensive decorative effects. Profile before allocation micro-optimization.

Exit: supported profiles remain responsive with no growing memory, stale-result reuse or silent backend changes. Unsupported configurations show a clear degraded state.

### Conditional Pass 5 — Native inference adapter

If the best browser profile cannot meet the agreed iPhone goals, build one iOS native adapter behind the same engine contract. Evaluate native camera-frame access and Core ML/LiteRT; return compact detections, timestamps and health to the web UI. Preserve the browser-capable engine and its own validated profile. Avoid bridging full-resolution frames as base64. Measure the complete native-to-JS alert path before choosing a migration. Android native acceleration follows only if later priorities and measurements justify it. Native work is contingent on measured browser limitations, not the first step.

## Proposed acceptance criteria and iteration rules

These are proposed engineering gates, not achieved results or a product safety certification:

- Preserve the existing p95 event-to-first-enabled-alert goal of 250 ms, measured on timestamped scenarios. Report model-call p95 and observation age separately; never substitute them for event-to-alert.
- Use p95 observation-to-result age at or below 150 ms as an initial optimization target on supported profiles, subject to calibration of timestamp origin. Continue the existing 250/500 ms degradation/expiry supervision until evidence justifies a separate change.
- Promote a speed change when a paired comparison shows a meaningful improvement (initial decision rule: at least 15% lower p95 app frame age or meeting the latency budget) with no lost critical scenarios in the fixed regression suite. This relative threshold is a project decision, not a literature claim.
- Evaluate class/scenario recall and false-alert rate per clip/minute at matched thresholds; show confidence intervals and sample sizes. Agree absolute release thresholds after baseline collection. Absence of a statistically clear regression on a tiny sample is not evidence of equivalence.
- Track ID switches, time to first true warning, longest missed interval, stale-output duration, camera recovery, cold/cached startup, memory and sustained cadence. Bootstrap/report by clip or session rather than treating correlated video frames as independent evidence.
- One hypothesis per iteration: record problem, change, fixed inputs, baseline, candidate, raw report, decision and next step. Keep/revert based on evidence; update the report and rerun only impacted gates.
- Stop broad model searching once a candidate meets the agreed goals. Fine-tune on licensed public data only when failure slices establish a specific need; hold out independent sequences. No personal riding footage is a prerequisite.

## First implementation batch

1. Isolate and reconcile the current source state.
2. Add stage timings, frame provenance, session lifecycle tests, coverage checks and benchmark exports.
3. Refresh main/Worker baseline with real public images and timestamped replay, prioritizing iPhone Safari and iOS WKWebView.
4. Move the measured preprocessing bottleneck and harden Worker runtime recovery.
5. Run the two-candidate comparison, then choose the next pass from its evidence.

This research pass adds documentation only. Runtime implementation, deployments, commits and new measured performance improvements are not part of this result.

## Primary sources

- S1: [MDN requestVideoFrameCallback metadata and timing](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
- S2: [Pinned COCO-SSD 2.2.3 implementation](https://raw.githubusercontent.com/tensorflow/tfjs-models/coco-ssd-v2.2.3/coco-ssd/src/index.ts).
- S3: [TensorFlow.js 4.22.0 release](https://github.com/tensorflow/tfjs/releases/tag/tfjs-v4.22.0).
- S4: [WebKit: Safari 26.0 features](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
- S5: [ONNX Runtime Web support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).
- S6: [LiteRT.js official README, fallback limitations](https://github.com/google-ai-edge/LiteRT/blob/main/litert/js/README.md) and [web runtime documentation](https://ai.google.dev/edge/litert/web).
- S7: [ONNX Runtime Web performance diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html).
- S8: [ONNX Runtime Web environment flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).
- S9: [MediaPipe object detector overview](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector/index) and [web threading guidance](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector/web_js).
- S10: [Roboflow RF-DETR Nano model card](https://huggingface.co/Roboflow/rf-detr-nano/blob/main/README.md) and [official model specifications](https://playground.roboflow.com/models/roboflow/rf-detr).
- S11: [Official LiteRT samples portal](https://google-ai-edge.github.io/litert-samples/).
- S12: [ByteTrack paper](https://arxiv.org/abs/2110.06864).
- S13: [TensorFlow.js platform and backend guidance](https://www.tensorflow.org/js/guide/platform_environment).
