import test from "node:test";
import assert from "node:assert/strict";

import { areTrackClassesCompatible, associateGlobally } from "../src/tracking.js";

test("related road-vehicle labels remain association compatible", () => {
  assert.equal(areTrackClassesCompatible("car", "truck"), true);
  assert.equal(areTrackClassesCompatible("bicycle", "motorcycle"), true);
  assert.equal(areTrackClassesCompatible("car", "bicycle"), false);
});

test("global association takes the strongest non-conflicting pairs", () => {
  const tracks = [{ id: 1, class: "car" }, { id: 2, class: "car" }];
  const detections = [{ id: "a", class: "car" }, { id: "b", class: "car" }];
  const scores = new Map([
    ["1-a", 0.8],
    ["1-b", 0.7],
    ["2-a", 0.6],
    ["2-b", 0.95],
  ]);
  const result = associateGlobally(
    tracks,
    detections,
    (track, detection) => scores.get(`${track.id}-${detection.id}`),
    0.3,
  );

  assert.deepEqual(
    result.matches.map(({ trackIndex, detectionIndex }) => [trackIndex, detectionIndex]),
    [[1, 1], [0, 0]],
  );
});
