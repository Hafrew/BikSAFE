import test from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_EVAL_VARIANTS,
  canvasBoxToSource,
  createDeterministicRng,
  getEvaluationTransform,
  sourceBoxToCanvas,
} from "../tools/evaluation-transforms.js";

test("public evaluation suite includes every deterministic stress family", () => {
  assert.deepEqual(PUBLIC_EVAL_VARIANTS, [
    "original",
    "blur",
    "glare",
    "rain",
    "crop",
    "occlusion",
    "vibration",
  ]);
});

test("evaluation random values are stable for a seed", () => {
  const first = createDeterministicRng("public-frame");
  const second = createDeterministicRng("public-frame");
  assert.deepEqual(
    [first(), first(), first()],
    [second(), second(), second()],
  );
});

test("crop and vibration boxes round-trip into source coordinates", () => {
  for (const variant of ["crop", "vibration"]) {
    const transform = getEvaluationTransform(variant, "frame-1", 1280, 720);
    const sourceBox = [320, 180, 400, 220];
    const canvasBox = sourceBoxToCanvas(sourceBox, transform, 640, 360);
    const roundTrip = canvasBoxToSource(canvasBox, transform, 640, 360);
    roundTrip.forEach((value, index) => {
      assert.ok(Math.abs(value - sourceBox[index]) < 1e-9);
    });
  }
});
