import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateImageDetections,
  intersectionOverUnion,
  summarizeDetectionEvaluation,
  getEvaluationCoverage,
} from "../src/evaluation-metrics.js";

test("evaluation coverage distinguishes a processed empty result from a missing image", () => {
  const expected = [{ id: "a" }, { id: "b" }];
  const coverage = getEvaluationCoverage(expected, [{ id: "a", objects: [] }]);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.evaluatedImages, 1);
  assert.deepEqual(coverage.missingImages, ["b"]);
  assert.equal(getEvaluationCoverage(expected, [{ id: "a" }, { id: "b" }]).complete, true);
});

test("duplicate, unexpected and empty evaluation inputs cannot pass coverage", () => {
  assert.equal(getEvaluationCoverage([], []).complete, false);
  assert.equal(getEvaluationCoverage([{ id: "a" }], [{ id: "a" }, { id: "a" }]).complete, false);
  assert.equal(getEvaluationCoverage([{ id: "a" }, { id: "a" }], [{ id: "a" }]).complete, false);
  const unexpected = getEvaluationCoverage([{ id: "a" }], [{ id: "a" }, { id: "x" }]);
  assert.equal(unexpected.complete, false);
  assert.deepEqual(unexpected.unexpectedImages, ["x"]);
});

test("IoU is one for identical boxes", () => {
  assert.equal(intersectionOverUnion([10, 10, 40, 30], [10, 10, 40, 30]), 1);
});

test("evaluation matches by class and overlap", () => {
  const result = evaluateImageDetections(
    [{ class: "car", bbox: [10, 10, 40, 30] }],
    [
      { class: "car", bbox: [11, 11, 39, 29], score: 0.8 },
      { class: "truck", bbox: [10, 10, 40, 30], score: 0.9 },
    ],
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.falsePositives.length, 1);
  assert.equal(result.falseNegatives.length, 0);
});

test("summary reports precision and recall", () => {
  const summary = summarizeDetectionEvaluation([
    {
      matches: [{ expected: { class: "car" } }],
      falsePositives: [{ class: "car" }],
      falseNegatives: [{ class: "truck" }],
    },
  ]);

  assert.equal(summary.overall.precision, 0.5);
  assert.equal(summary.overall.recall, 0.5);
});

test("summary reports public-ground-truth range error when available", () => {
  const summary = summarizeDetectionEvaluation([
    {
      matches: [{
        expected: { class: "car", distanceMeters: 20 },
        prediction: { class: "car", estimatedDistanceMeters: 18 },
      }],
      falsePositives: [],
      falseNegatives: [],
    },
  ]);

  assert.equal(summary.range.matchedSamples, 1);
  assert.equal(summary.range.medianAbsoluteErrorMeters, 2);
  assert.equal(summary.range.medianAbsolutePercentageError, 0.1);
});
