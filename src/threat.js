import { THREAT_MODEL } from "./config.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getZoneSeverity(zone) {
  if (zone === "CLOSE") {
    return 3;
  }

  if (zone === "MEDIUM") {
    return 2;
  }

  if (zone === "FAR") {
    return 1;
  }

  return 0;
}

export function estimateTimeToCollision(distanceMeters, closingSpeedMps) {
  if (
    !Number.isFinite(distanceMeters) ||
    !Number.isFinite(closingSpeedMps) ||
    closingSpeedMps < THREAT_MODEL.minimumClosingSpeedMps
  ) {
    return null;
  }

  return clamp(distanceMeters / closingSpeedMps, 0, 60);
}

export function estimatePathRelevance(bbox, frameWidth) {
  if (!Array.isArray(bbox) || bbox.length < 4 || !Number.isFinite(frameWidth) || frameWidth <= 0) {
    return THREAT_MODEL.minimumPathRelevance;
  }

  const objectLeft = clamp(bbox[0] / frameWidth, 0, 1);
  const objectRight = clamp((bbox[0] + bbox[2]) / frameWidth, 0, 1);
  const objectWidth = Math.max(objectRight - objectLeft, 0.001);
  const overlap = Math.max(
    0,
    Math.min(objectRight, THREAT_MODEL.corridorRightRatio) -
      Math.max(objectLeft, THREAT_MODEL.corridorLeftRatio),
  );
  const overlapRatio = clamp(overlap / objectWidth, 0, 1);
  const center = (objectLeft + objectRight) / 2;
  const corridorCenter =
    (THREAT_MODEL.corridorLeftRatio + THREAT_MODEL.corridorRightRatio) / 2;
  const corridorHalfWidth =
    (THREAT_MODEL.corridorRightRatio - THREAT_MODEL.corridorLeftRatio) / 2;
  const centerScore = 1 - clamp(
    Math.abs(center - corridorCenter) / Math.max(corridorHalfWidth, 0.001),
    0,
    1,
  );

  // Never discard an adjacent object entirely. The floor keeps cut-in vehicles
  // represented until a future lane model is validated on public data.
  return clamp(
    Math.max(overlapRatio, centerScore * 0.8, THREAT_MODEL.minimumPathRelevance),
    THREAT_MODEL.minimumPathRelevance,
    1,
  );
}

export function deriveThreatMetrics({
  bbox,
  frameWidth,
  effectiveDistanceMeters,
  closingSpeedMps,
  distanceConfidence,
  risk,
  zone,
  hits,
}) {
  const timeToCollisionSeconds = estimateTimeToCollision(
    effectiveDistanceMeters,
    closingSpeedMps,
  );
  const pathRelevance = estimatePathRelevance(bbox, frameWidth);
  const confirmed = (hits ?? 0) >= 3;
  let ttcRisk = 0;

  if (confirmed && timeToCollisionSeconds !== null) {
    if (timeToCollisionSeconds <= THREAT_MODEL.dangerTtcSeconds) {
      ttcRisk = 1;
    } else if (timeToCollisionSeconds <= THREAT_MODEL.warningTtcSeconds) {
      const span = THREAT_MODEL.warningTtcSeconds - THREAT_MODEL.dangerTtcSeconds;
      ttcRisk = 0.55 +
        ((THREAT_MODEL.warningTtcSeconds - timeToCollisionSeconds) / span) * 0.4;
    }
  }

  let adjustedZone = zone;
  if (confirmed && pathRelevance > THREAT_MODEL.minimumPathRelevance) {
    if (timeToCollisionSeconds !== null && timeToCollisionSeconds <= THREAT_MODEL.dangerTtcSeconds) {
      adjustedZone = "CLOSE";
    } else if (
      timeToCollisionSeconds !== null &&
      timeToCollisionSeconds <= THREAT_MODEL.warningTtcSeconds &&
      getZoneSeverity(adjustedZone) < getZoneSeverity("MEDIUM")
    ) {
      adjustedZone = "MEDIUM";
    }
  }

  const zoneBase = {
    CLEAR: 0,
    FAR: 0.18,
    MEDIUM: 0.56,
    CLOSE: 0.86,
  }[adjustedZone] ?? 0;
  const confidence = clamp(Number(distanceConfidence) || 0, 0, 1);
  const threatScore = clamp(
    zoneBase * 0.56 +
      Math.max(clamp(Number(risk) || 0, 0, 1), ttcRisk) * 0.26 +
      pathRelevance * 0.1 +
      confidence * 0.08,
    0,
    1,
  );

  return {
    timeToCollisionSeconds,
    pathRelevance,
    ttcRisk,
    threatScore,
    adjustedZone,
  };
}

export function rankThreats(vehicles) {
  return [...vehicles].sort((a, b) => {
    const threatDelta = (b.threatScore ?? 0) - (a.threatScore ?? 0);
    if (Math.abs(threatDelta) > 0.0001) {
      return threatDelta;
    }

    const severityDelta = getZoneSeverity(b.zone) - getZoneSeverity(a.zone);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return (
      (a.effectiveDistanceMeters ?? Number.POSITIVE_INFINITY) -
      (b.effectiveDistanceMeters ?? Number.POSITIVE_INFINITY)
    );
  });
}
