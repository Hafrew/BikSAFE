function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getEvaluationCoverage(expectedImages, evaluatedImages) {
  const expectedIds = expectedImages.map((image) => image.id);
  const evaluatedIds = evaluatedImages.map((image) => image.id);
  const expected = new Set(expectedIds);
  const evaluated = new Set(evaluatedIds);
  const missingImages = [...expected].filter((id) => !evaluated.has(id));
  const unexpectedImages = [...evaluated].filter((id) => !expected.has(id));
  const duplicateExpectedIds = expected.size !== expectedIds.length;
  const duplicateEvaluatedIds = evaluated.size !== evaluatedIds.length;
  const invalidIds = [...expectedIds, ...evaluatedIds].some((id) => typeof id !== "string" || !id.trim());
  return {
    expectedImages: expectedIds.length,
    evaluatedImages: [...evaluated].filter((id) => expected.has(id)).length,
    missingImages,
    unexpectedImages,
    duplicateExpectedIds,
    duplicateEvaluatedIds,
    invalidIds,
    complete: expectedIds.length > 0 && !missingImages.length && !unexpectedImages.length &&
      !duplicateExpectedIds && !duplicateEvaluatedIds && !invalidIds,
  };
}

export function intersectionOverUnion(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const overlapWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const overlapHeight = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const overlapArea = overlapWidth * overlapHeight;
  const union = a[2] * a[3] + b[2] * b[3] - overlapArea;
  return union > 0 ? clamp(overlapArea / union, 0, 1) : 0;
}

export function evaluateImageDetections(
  groundTruth,
  predictions,
  { iouThreshold = 0.5, scoreThreshold = 0.32 } = {},
) {
  const candidates = predictions
    .filter((prediction) => (prediction.score ?? 1) >= scoreThreshold)
    .sort((a, b) => (b.score ?? 1) - (a.score ?? 1));
  const matchedGroundTruth = new Set();
  const matches = [];
  const falsePositives = [];

  for (const prediction of candidates) {
    let bestIndex = -1;
    let bestIou = iouThreshold;

    for (const [index, expected] of groundTruth.entries()) {
      if (matchedGroundTruth.has(index) || expected.class !== prediction.class) {
        continue;
      }

      const iou = intersectionOverUnion(expected.bbox, prediction.bbox);
      if (iou >= bestIou) {
        bestIou = iou;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      matchedGroundTruth.add(bestIndex);
      matches.push({ prediction, expected: groundTruth[bestIndex], iou: bestIou });
    } else {
      falsePositives.push(prediction);
    }
  }

  const falseNegatives = groundTruth.filter((_, index) => !matchedGroundTruth.has(index));
  return { matches, falsePositives, falseNegatives };
}

export function summarizeDetectionEvaluation(imageResults) {
  const totals = {
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
  };
  const byClass = {};
  const absoluteRangeErrors = [];
  const relativeRangeErrors = [];

  const getClassTotals = (className) => {
    byClass[className] ??= { truePositive: 0, falsePositive: 0, falseNegative: 0 };
    return byClass[className];
  };

  for (const result of imageResults) {
    for (const match of result.matches) {
      totals.truePositive += 1;
      getClassTotals(match.expected.class).truePositive += 1;
      const expectedDistance = Number(match.expected.distanceMeters);
      const estimatedDistance = Number(match.prediction?.estimatedDistanceMeters);
      if (Number.isFinite(expectedDistance) && Number.isFinite(estimatedDistance)) {
        const absoluteError = Math.abs(estimatedDistance - expectedDistance);
        absoluteRangeErrors.push(absoluteError);
        relativeRangeErrors.push(absoluteError / Math.max(expectedDistance, 0.1));
      }
    }
    for (const prediction of result.falsePositives) {
      totals.falsePositive += 1;
      getClassTotals(prediction.class).falsePositive += 1;
    }
    for (const expected of result.falseNegatives) {
      totals.falseNegative += 1;
      getClassTotals(expected.class).falseNegative += 1;
    }
  }

  const addRates = (counts) => ({
    ...counts,
    precision: counts.truePositive + counts.falsePositive > 0
      ? counts.truePositive / (counts.truePositive + counts.falsePositive)
      : null,
    recall: counts.truePositive + counts.falseNegative > 0
      ? counts.truePositive / (counts.truePositive + counts.falseNegative)
      : null,
  });

  const percentile = (values, ratio) => {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  };

  return {
    overall: addRates(totals),
    byClass: Object.fromEntries(
      Object.entries(byClass).map(([className, counts]) => [className, addRates(counts)]),
    ),
    range: {
      matchedSamples: absoluteRangeErrors.length,
      medianAbsoluteErrorMeters: percentile(absoluteRangeErrors, 0.5),
      p95AbsoluteErrorMeters: percentile(absoluteRangeErrors, 0.95),
      medianAbsolutePercentageError: percentile(relativeRangeErrors, 0.5),
      p95AbsolutePercentageError: percentile(relativeRangeErrors, 0.95),
    },
  };
}
