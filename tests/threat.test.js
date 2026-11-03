import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveThreatMetrics,
  estimatePathRelevance,
  estimateTimeToCollision,
  rankThreats,
} from "../src/threat.js";

test("TTC is unavailable for stationary or receding objects", () => {
  assert.equal(estimateTimeToCollision(20, 0), null);
  assert.equal(estimateTimeToCollision(20, -3), null);
});

test("TTC uses distance divided by closing speed", () => {
  assert.equal(estimateTimeToCollision(18, 6), 3);
});

test("path relevance retains an adjacent-object safety floor", () => {
  const relevance = estimatePathRelevance([0, 100, 80, 120], 1280);
  assert.ok(relevance >= 0.15);
  assert.ok(relevance < 0.5);
});

test("confirmed imminent approach escalates without distance threshold tuning", () => {
  const metrics = deriveThreatMetrics({
    bbox: [480, 220, 260, 210],
    frameWidth: 1280,
    effectiveDistanceMeters: 15,
    closingSpeedMps: 8,
    distanceConfidence: 0.8,
    risk: 0.3,
    zone: "FAR",
    hits: 4,
  });

  assert.equal(metrics.adjustedZone, "CLOSE");
  assert.ok(metrics.threatScore > 0.7);
});

test("single-frame detections cannot escalate from TTC", () => {
  const metrics = deriveThreatMetrics({
    bbox: [480, 220, 260, 210],
    frameWidth: 1280,
    effectiveDistanceMeters: 15,
    closingSpeedMps: 8,
    distanceConfidence: 0.8,
    risk: 0.3,
    zone: "FAR",
    hits: 1,
  });

  assert.equal(metrics.adjustedZone, "FAR");
});

test("ranking favors a confirmed approaching threat over a weak far track", () => {
  const ranked = rankThreats([
    { id: 1, threatScore: 0.25, zone: "FAR", effectiveDistanceMeters: 9 },
    { id: 2, threatScore: 0.82, zone: "CLOSE", effectiveDistanceMeters: 18 },
  ]);

  assert.equal(ranked[0].id, 2);
});
