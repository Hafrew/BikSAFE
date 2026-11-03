import { VEHICLE_DIMENSIONS_METERS } from "./config.js";

export function getCameraFocalLengths(
  frameWidth,
  frameHeight,
  horizontalFovDegrees,
) {
  const horizontalFovRadians = (horizontalFovDegrees * Math.PI) / 180;
  const focalLengthX = frameWidth / (2 * Math.tan(horizontalFovRadians / 2));
  const verticalFovRadians =
    2 * Math.atan((frameHeight / frameWidth) * Math.tan(horizontalFovRadians / 2));
  const focalLengthY = frameHeight / (2 * Math.tan(verticalFovRadians / 2));
  return { focalLengthX, focalLengthY };
}

export function estimateRangeFromBox({
  className,
  bbox,
  frameWidth,
  frameHeight,
  horizontalFovDegrees,
  focalLengthX,
  focalLengthY,
}) {
  const dimensions = VEHICLE_DIMENSIONS_METERS[className] ?? VEHICLE_DIMENSIONS_METERS.car;
  const fallbackFocal = getCameraFocalLengths(
    frameWidth,
    frameHeight,
    horizontalFovDegrees,
  );
  const fx = Number.isFinite(focalLengthX) ? focalLengthX : fallbackFocal.focalLengthX;
  const fy = Number.isFinite(focalLengthY) ? focalLengthY : fallbackFocal.focalLengthY;
  const boxWidth = Math.max(bbox[2], 1);
  const boxHeight = Math.max(bbox[3], 1);
  const widthEstimate = (dimensions.width * fx) / boxWidth;
  const heightEstimate = (dimensions.height * fy) / boxHeight;
  const widthWeight = className === "car" || className === "truck" || className === "bus"
    ? 0.65
    : 0.45;
  return widthEstimate * widthWeight + heightEstimate * (1 - widthWeight);
}
