const CLASS_FAMILIES = new Map([
  ["car", "large-road-vehicle"],
  ["truck", "large-road-vehicle"],
  ["bus", "large-road-vehicle"],
  ["motorcycle", "narrow-road-vehicle"],
  ["bicycle", "narrow-road-vehicle"],
]);

export function areTrackClassesCompatible(trackClass, detectionClass) {
  return trackClass === detectionClass || (
    CLASS_FAMILIES.has(trackClass) &&
    CLASS_FAMILIES.get(trackClass) === CLASS_FAMILIES.get(detectionClass)
  );
}

export function associateGlobally(
  tracks,
  detections,
  scorePair,
  minimumScore,
) {
  const candidates = [];
  for (const [trackIndex, track] of tracks.entries()) {
    for (const [detectionIndex, detection] of detections.entries()) {
      if (!areTrackClassesCompatible(track.class, detection.class)) {
        continue;
      }
      const classPenalty = track.class === detection.class ? 1 : 0.86;
      const score = scorePair(track, detection) * classPenalty;
      if (score >= minimumScore) {
        candidates.push({ trackIndex, detectionIndex, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const usedTrackIndexes = new Set();
  const usedDetectionIndexes = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (
      usedTrackIndexes.has(candidate.trackIndex) ||
      usedDetectionIndexes.has(candidate.detectionIndex)
    ) {
      continue;
    }
    usedTrackIndexes.add(candidate.trackIndex);
    usedDetectionIndexes.add(candidate.detectionIndex);
    matches.push(candidate);
  }

  return {
    matches,
    unmatchedTrackIndexes: tracks
      .map((_, index) => index)
      .filter((index) => !usedTrackIndexes.has(index)),
    unmatchedDetectionIndexes: detections
      .map((_, index) => index)
      .filter((index) => !usedDetectionIndexes.has(index)),
  };
}
