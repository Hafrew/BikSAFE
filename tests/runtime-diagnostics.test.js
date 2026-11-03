import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeDiagnostics } from "../src/runtime-diagnostics.js";

const snapshot = (index) => ({
  sourceGeneration: 1, sourceFrameAt: index * 100, updatedAt: index * 100 + 20,
  sourceTimestampOrigin: "video-callback", backend: "webgl", modelLabel: "COCO SSD Lite",
  inferenceSize: "640x360", stale: false, zone: "FAR",
  timings: { preprocessMs: 2, modelCallMs: 15, trackingMs: 3, totalMs: 20 },
  vehicles: [{ rawPrivatePixels: "must not be exported" }],
});

test("diagnostics retain a bounded timing window and disclose total sample count", () => {
  const recorder = new RuntimeDiagnostics({ capacity: 2 });
  for (let index = 1; index <= 3; index++) recorder.record(snapshot(index));
  const report = recorder.export({ platform: "browser" });
  assert.equal(report.totalSamples, 3);
  assert.equal(report.samples.length, 2);
  assert.equal(report.discardedSamples, 1);
  assert.deepEqual(report.samples.map((row) => row.sourceFrameAt), [200, 300]);
  assert.equal(report.summary.totalMs.p95Ms, 20);
  assert.equal(JSON.stringify(report).includes("rawPrivatePixels"), false);
});

test("stale results and repeated HUD redraws are not counted as new inferences", () => {
  const recorder = new RuntimeDiagnostics();
  const result = snapshot(1);
  recorder.record(result);
  recorder.record(result);
  recorder.record({ ...snapshot(2), stale: true });
  assert.equal(recorder.export().totalSamples, 1);
});

test("diagnostics identify frame-age origin and distinguish handling from physical alerts", () => {
  const recorder = new RuntimeDiagnostics();
  recorder.record(snapshot(1), { renderMs: 4, feedbackHandlingMs: 1, handledAt: 130, healthState: "READY", mode: "rear" });
  const report = recorder.export();
  assert.equal(report.samples[0].sourceTimestampOrigin, "video-callback");
  assert.equal(report.samples[0].frameToHandlingMs, 30);
  assert.equal(report.samples[0].feedbackHandlingMs, 1);
  assert.equal(report.samples[0].mode, "rear");
  assert.equal(report.physicalAlertOnsetMeasured, false);
});
