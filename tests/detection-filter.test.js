import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAndFilterPredictions } from "../src/detection-filter.js";

const input = {
  targetWidth: 640,
  targetHeight: 360,
  sourceWidth: 1280,
  sourceHeight: 720,
};

test("non-vehicle COCO predictions are removed after the wider candidate stage", () => {
  const result = normalizeAndFilterPredictions([
    { class: "person", score: 0.95, bbox: [20, 20, 100, 200] },
    { class: "car", score: 0.8, bbox: [200, 120, 120, 80] },
  ], input);

  assert.equal(result.length, 1);
  assert.equal(result[0].class, "car");
});

test("boxes are scaled back to source camera coordinates", () => {
  const [car] = normalizeAndFilterPredictions([
    { class: "car", score: 0.8, bbox: [200, 120, 120, 80] },
  ], input);

  assert.deepEqual(car.bbox, [400, 240, 240, 160]);
});
