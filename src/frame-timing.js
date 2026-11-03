function validTime(value, now) {
  return Number.isFinite(value) && value >= 0 && value <= now;
}

export function describeVideoFrame(callbackAt, mediaTime, metadata = {}) {
  const capture = validTime(metadata.captureTime, callbackAt);
  const presentation = validTime(metadata.presentationTime, callbackAt);
  return {
    callbackAt,
    presentedAt: callbackAt,
    mediaTime,
    observedAt: capture ? metadata.captureTime : presentation ? metadata.presentationTime : callbackAt,
    timestampOrigin: capture ? "capture-metadata" : presentation ? "video-presentation" : "video-callback",
  };
}

export function resolveFrameObservation(frame, sampledAt, sampledMediaTime) {
  const metadataMatched = Number.isFinite(frame.mediaTime) && Number.isFinite(sampledMediaTime)
    ? Math.abs(frame.mediaTime - sampledMediaTime) < 0.0001
    : null;
  const originAt = frame.observedAt ?? frame.presentedAt;
  if (metadataMatched === false || !validTime(originAt, sampledAt)) {
    return { sourceFrameAt: sampledAt, timestampOrigin: "video-sample", metadataMatched };
  }
  return {
    sourceFrameAt: originAt,
    timestampOrigin: frame.timestampOrigin ?? "video-callback",
    metadataMatched,
  };
}
