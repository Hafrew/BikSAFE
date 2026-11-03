import {
  SCORE_THRESHOLD_BY_CLASS,
  TRACKING,
  VEHICLE_CLASSES,
} from "./config.js";

export function toDisplayLabel(className) {
  if (className === "motorcycle") {
    return "Motorcycle";
  }
  return className.charAt(0).toUpperCase() + className.slice(1);
}

export function isUsefulVehiclePrediction(prediction, frameWidth, frameHeight) {
  if (!VEHICLE_CLASSES.has(prediction.class)) {
    return false;
  }

  const threshold = SCORE_THRESHOLD_BY_CLASS[prediction.class] ?? 0.45;
  if (prediction.score < threshold) {
    return false;
  }

  const frameArea = Math.max(1, frameWidth * frameHeight);
  const boxWidth = prediction.bbox[2];
  const boxHeight = prediction.bbox[3];
  const aspectRatio = boxWidth / Math.max(boxHeight, 1);
  const areaRatio = (boxWidth * boxHeight) / frameArea;

  if (areaRatio < TRACKING.minAreaRatio) {
    return false;
  }
  if (Math.min(boxWidth, boxHeight) < TRACKING.minShortSidePx) {
    return false;
  }
  if (prediction.class === "motorcycle" || prediction.class === "bicycle") {
    return aspectRatio > 0.24 && aspectRatio < 4.2;
  }
  return aspectRatio > 0.45 && aspectRatio < 5.6;
}

export function normalizeAndFilterPredictions(predictions, input) {
  const scaleX = input.sourceWidth / input.targetWidth;
  const scaleY = input.sourceHeight / input.targetHeight;
  return predictions
    .map((prediction) => ({
      class: prediction.class,
      label: toDisplayLabel(prediction.class),
      score: prediction.score,
      bbox: [
        prediction.bbox[0] * scaleX,
        prediction.bbox[1] * scaleY,
        prediction.bbox[2] * scaleX,
        prediction.bbox[3] * scaleY,
      ],
    }))
    .filter((prediction) => isUsefulVehiclePrediction(
      prediction,
      input.sourceWidth,
      input.sourceHeight,
    ));
}
