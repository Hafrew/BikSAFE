import test from "node:test";
import assert from "node:assert/strict";
import { describeVideoFrame, resolveFrameObservation } from "../src/frame-timing.js";

test("valid capture metadata is retained with explicit clock provenance", () => {
  const frame = describeVideoFrame(1000, 1, { captureTime: 940, presentationTime: 980 });
  assert.equal(frame.observedAt, 940);
  assert.equal(frame.timestampOrigin, "capture-metadata");
  assert.equal(frame.callbackAt, 1000);
});

test("unavailable or invalid capture metadata falls back to presentation then callback", () => {
  assert.equal(describeVideoFrame(1000, 1, { captureTime: 1100, presentationTime: 980 }).observedAt, 980);
  const callback = describeVideoFrame(1000, 1, { captureTime: NaN, presentationTime: -1 });
  assert.equal(callback.observedAt, 1000);
  assert.equal(callback.timestampOrigin, "video-callback");
});

test("metadata from another media frame cannot describe newly sampled pixels", () => {
  const frame = describeVideoFrame(1000, 1, { captureTime: 940 });
  const observation = resolveFrameObservation(frame, 1010, 1.033);
  assert.equal(observation.sourceFrameAt, 1010);
  assert.equal(observation.timestampOrigin, "video-sample");
  assert.equal(observation.metadataMatched, false);
});

test("matching sampled media time preserves the measured frame origin", () => {
  const frame = describeVideoFrame(1000, 1, { presentationTime: 980 });
  const observation = resolveFrameObservation(frame, 1010, 1);
  assert.equal(observation.sourceFrameAt, 980);
  assert.equal(observation.timestampOrigin, "video-presentation");
  assert.equal(observation.metadataMatched, true);
});

test("legacy frame descriptors retain callback provenance without inventing capture time", () => {
  const observation = resolveFrameObservation({ presentedAt: 970 }, 1000);
  assert.equal(observation.sourceFrameAt, 970);
  assert.equal(observation.timestampOrigin, "video-callback");
});
