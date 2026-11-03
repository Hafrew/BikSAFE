import { analyzeSceneQuality } from "./scene-quality.js";

// Owned by one Worker; canvases are reused and only one job is active.
export class WorkerFrame {
  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    this.context = this.canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    this.qualityCanvas = new OffscreenCanvas(32, 18);
    this.qualityContext = this.qualityCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    this.lastQualityAt = -Infinity;
    this.sceneQuality = null;
    this.sourceEpoch = null;
  }

  prepare(bitmap, maxSide = 640, sourceEpoch) {
    const startedAt = performance.now();
    if (this.sourceEpoch !== sourceEpoch) {
      this.sourceEpoch = sourceEpoch;
      this.lastQualityAt = -Infinity;
    }
    const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)) : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.drawImage(bitmap, 0, 0, width, height);
    if (startedAt - this.lastQualityAt >= 500) {
      try {
        this.qualityContext.drawImage(this.canvas, 0, 0, 32, 18);
        const sample = this.qualityContext.getImageData(0, 0, 32, 18);
        this.sceneQuality = analyzeSceneQuality(sample.data, 32, 18);
      } catch {
        this.sceneQuality = { state: "DEGRADED", score: 0, reason: "Camera image quality could not be measured." };
      }
      this.lastQualityAt = startedAt;
    }
    return {
      canvas: this.canvas,
      width, height,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      sceneQuality: this.sceneQuality,
      preprocessMs: performance.now() - startedAt,
    };
  }
}

export function scalePredictions(predictions, frame) {
  const sx = frame.sourceWidth / frame.width;
  const sy = frame.sourceHeight / frame.height;
  return predictions.map((prediction) => ({
    ...prediction,
    bbox: [prediction.bbox[0] * sx, prediction.bbox[1] * sy,
      prediction.bbox[2] * sx, prediction.bbox[3] * sy],
  }));
}
