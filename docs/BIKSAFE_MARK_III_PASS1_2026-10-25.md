# Mark III first implementation checkpoint — 2026-10-25

Status: first timing/lifecycle implementation pass verified locally. iPhone first; browser support retained. This is not completion of every optimization-plan gate.

## Delivered

- Session epochs reject late successes and failures after pause, camera mode changes and generation changes. Pause clears active observations; the next session needs a fresh frame. One active inference and newest-pending-frame scheduling remain in place.
- Results older than the existing 500 ms observation limit are discarded before publication. Failed output clears vehicles, and the application clears blocked/expired overlays.
- Track updates use observation timestamps rather than model completion times. Frame descriptors identify capture metadata, presentation metadata, callback time or sampled-video time. Metadata for a different sampled media time is not presented as capture timing. Changing timestamp origin clears incompatible motion history, and non-advancing observation times cannot confirm another observation.
- Frame-age and health checks use the current monotonic clock, avoiding the older animation-frame timestamp. Millisecond health-detail churn was removed, and displayed timings are rounded.
- Startup is disabled until the model-choice listener is ready, preventing a quick tap during the acknowledgement's closing transition from being silently ignored. A browser check reproduced the enabled-too-early state before this guard and passed afterward.
- Worker transfer failures, crashes, undecodable responses and deadlines terminate pending work. Untransferred/detached bitmap cleanup is covered. An initialized Worker failure triggers one main-thread recovery attempt; late camera/session work cannot republish during recovery. A failed fallback leaves detection unavailable.
- Optional recording in Menu > Diag Stats > Record timings > Export timings captures preprocessing, full model call, Worker bitmap/round-trip/model spans, tracking, rendering and feedback-handler spans. Recording is off by default; the ring retains at most 18,000 samples and reports discarded counts. Reports contain compact numeric timing/state data, no camera pixels or bounding boxes.
- Reports label timestamp provenance and explicitly state that physical tone/vibration onset is not measured. They summarize published non-stale outputs; launch counters separately disclose failed, expired and discarded attempts. This is not an end-to-end danger-event evaluator.
- Builds emit `build-manifest.json` with SHA-256 hashes of the 26 served application artifacts and an aggregate fingerprint. External runtime/model payloads are not hashed or deterministically bundled yet.
- Public evaluation reports identify missing, duplicate, invalid and unexpected IDs. Incomplete CLI runs write a report and exit with code 2. Browser summaries mark incomplete coverage as invalid for comparison, and disclose that their timing excludes image preparation and application alerts.
- Backend benchmarking now uses 1,000 inferences per engine by default, alternating order in 50-inference blocks, exports raw samples, and reports p50/p95/p99 and the protocol. `?runs=100` is available for short smoke checks.

## Verification

- Initial regression baseline: 26 passing tests. Final suite: **61/61 passing**, no skipped tests.
- The lifecycle reproduction suite initially demonstrated eight failures among its first 12 tests. Four added runtime-recovery tests then failed before recovery was implemented. A separate animation-timestamp test reproduced an underestimated frame age before its fix.
- Worker adapter tests reproduced pending-request leaks, unsafe reuse after crashes/timeouts, bitmap cleanup failure and missing timing spans before the fixes.
- `npm.cmd run eval:synthetic`: **1,000 cases, zero failures**.
- `node --check` passed for all `src/*.js`, `tools/*.js` and `tools/*.mjs`.
- `npm.cmd run build` passed. All 26 output hashes were independently checked, and the browser runtime report fingerprint matched that build.
- Chrome real-model Worker smoke: PASS, WebGL. Normal main-thread synthetic-camera app and built Worker synthetic-camera app both ran with zero console errors/warnings. Recording/export was exercised through the browser and its JSON inspected. The final build also passed the startup-readiness check and export at a 390x844 viewport; that is desktop layout coverage, not an iPhone benchmark. Existing clipping of the ride-view MONITORING headline at that width was observed; the pre-existing styling was preserved in this latency pass.
- Browser public evaluator: Worker backend, one explicitly generated fixture, all seven stress variants, zero missing images; export succeeded. This verifies plumbing, not public-data detection accuracy.
- Desktop WebKit installation was attempted, but launch was blocked by missing Windows host dependency `icutu77.dll`. No Safari or WKWebView validation is claimed.

## Fresh desktop baseline

Environment: Windows, headless Chrome 155, TensorFlow.js 4.17.0, COCO-SSD 2.2.3 Lite, prepared generated 640x384 canvas. Two models resident, one active inference, alternating block order, 1,000 samples per engine. Other app inference browser sessions were closed for the benchmark.

| Metric | Main thread | Worker |
| --- | ---: | ---: |
| Model-call p95 | 23.5 ms | 25.0 ms |
| Model-call p99 | 24.6 ms | 26.6 ms |
| Timer-stall probe p95 | 23.7 ms | 0.2 ms |

Interpretation: this run supports a main-thread responsiveness benefit, with slightly slower Worker model-call duration on this desktop. It does not establish a raw inference speed gain, physical alert latency, mobile accuracy, thermal behavior, or an improvement relative to the older benchmark with a different protocol. Worker remains opt-in.

Raw artifacts:

- [Desktop backend benchmark](benchmarks/2026-10-25-desktop-generated-backend.json)
- [Built Worker runtime export](benchmarks/2026-10-25-desktop-worker-runtime-smoke.json), 26 recorded output samples; a plumbing smoke, not the sustained benchmark
- [Generated public-evaluator smoke](benchmarks/2026-10-25-generated-public-pipeline-smoke.json)
- [Before/after hashes of existing source files changed in this pass](benchmarks/2026-10-25-pass1-source-changes.json)

Final verified application fingerprint: `b77b9c7290df623b43b059f9441d34647c93f48f6a3be720c9d3a87fb5b743fd`.

The backend benchmark was captured earlier in this pass at fingerprint `1d2486c2ea3161d620b0aee7a57853ce7a7a0391071cbbf4595f6284f87c633d`, before the final tracker timestamp guards and startup-readiness fix. Its `inference-engine.js` and `inference-worker.js` are unchanged in the final build. The separate runtime smoke export and artifact-hash check cover the final build. The two raw reports retain their actual measured fingerprints.

## Source preservation and Git state

The original source snapshot, tracked patch, working-tree status and SHA-256 manifest are at:

`C:\Users\darre\Documents\Codex\2026-10-25\biksafe-before-pass1-182501`

It covers web source, tests, tools, docs and relevant root configuration; native projects and dependencies were not copied because they were not edited. Comparing existing files against the snapshot found changes only in the intended web implementation, tests, tooling and ignore file. Existing unrelated edits to configuration thresholds, camera/alert settings, styling and native projects were preserved.

Work remains local and uncommitted on `main` at `cee8612`. GitHub main was fetched at `e80fa0e`; the earlier fast-forward was blocked by overlapping local edits. No reset, stash, upstream merge, push or deployment was performed. The source fingerprint identifies the measured local overlay rather than implying HEAD alone reproduces it.

## Resume sequence

1. Preserve this overlay and the original snapshot when preparing a reviewable branch. Reconcile upstream changes explicitly; do not replace local Mark III with the older upstream detector.
2. On an older supported iPhone tier and a recent tier, collect Safari and Capacitor WKWebView results separately. Use an HTTPS-hosted build or the iOS app for actual camera tests; desktop localhost is a development smoke path. Start with the existing main engine, then the same build with `?worker=1`.
3. Use the diagnostics recorder and the backend benchmark on identical inputs. Keep p95 model-call time, frame age, UI responsiveness, physical alerts and event-to-warning replay as separate measurements. Reports using video-sample provenance do not measure sensor capture delay.
4. Add immutable real public-image and timestamped-sequence reports, model/dataset hashes and full failure-attempt timing. The current public-image pipeline and deterministic threat scenarios do not yet establish sequence-level warning latency or accuracy.
5. Inspect timestamp-origin transitions on real devices. The current code resets incompatible motion history and drops non-advancing timestamps. If origins alternate frequently, establish a consistent observation timeline to preserve track continuity without creating artificial closing speeds.
6. Profile preprocessing/transfer on iPhone before moving more work into the Worker. Compare the full-frame transfer cost with pre-sizing on the UI thread; this pass instruments that decision but has not moved resizing.
7. Run the bounded EfficientDet-Lite0 and RF-DETR Nano experiments from the [optimization plan](BIKSAFE_MARK_III_OPTIMIZATION_PLAN_2026-10-25.md). Change one model/runtime/cadence variable at a time. Keep Worker opt-in until supported-device and quality gates pass.

Local developer commands:

```powershell
npm.cmd test
npm.cmd run eval:synthetic
npm.cmd run build
npm.cmd run serve -- --dist --port=8014
# Built synthetic-camera smoke: http://localhost:8014/?demo=1&worker=1
# Run a second source server for tools:
npm.cmd run serve -- --port=8013
# http://localhost:8013/tools/backend-benchmark.html
# http://localhost:8013/tools/public-eval.html
```

Physical iPhone results, sustained mobile resource tests, public-dataset accuracy, full timestamped event replay, runtime/model replacement, native inference and deterministic offline model packaging remain open.
