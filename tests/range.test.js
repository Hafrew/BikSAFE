import test from "node:test";
import assert from "node:assert/strict";

import { estimateRangeFromBox, getCameraFocalLengths } from "../src/range.js";

test("focal length increases as FOV narrows", () => {
  const narrow = getCameraFocalLengths(1280, 720, 55);
  const wide = getCameraFocalLengths(1280, 720, 85);
  assert.ok(narrow.focalLengthX > wide.focalLengthX);
});

test("range estimate decreases as the detected box grows", () => {
  const common = {
    className: "car",
    frameWidth: 1280,
    frameHeight: 720,
    horizontalFovDegrees: 67,
  };
  const far = estimateRangeFromBox({ ...common, bbox: [500, 260, 100, 70] });
  const near = estimateRangeFromBox({ ...common, bbox: [400, 180, 300, 210] });
  assert.ok(far > near);
});
