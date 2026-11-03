const VERSION = "1.2.0";
const ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite";
const MODEL_HASH = "0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb";

export async function createEfficientDet() {
  const { FilesetResolver, ObjectDetector } = await import(`${ROOT}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${ROOT}/wasm`);
  const response = await fetch(MODEL);
  if (!response.ok) throw new Error(`EfficientDet model download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  if (hash !== MODEL_HASH) throw new Error("EfficientDet did not match the pinned model hash.");
  const detector = await ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetBuffer: bytes, delegate: "CPU" },
    runningMode: "IMAGE",
    scoreThreshold: 0.32,
    maxResults: 32,
    categoryAllowlist: ["car", "truck", "bus", "motorcycle", "bicycle"],
  });
  return {
    backend: "mediapipe-wasm-cpu",
    inferenceSize: "320x320",
    runtimeInfo: { runtime: "MediaPipe Tasks Vision", version: VERSION, model: "EfficientDet-Lite0 int8 v1", modelUrl: MODEL, experimental: true,
      modelHash: MODEL_HASH,
      timingScope: "Full MediaPipe detection task, including its internal resize and postprocessing." },
    detect(source, maxNumBoxes, minScore) {
      return detector.detect(source).detections.flatMap((detection) => {
        const category = detection.categories?.[0];
        const box = detection.boundingBox;
        if (!category || !box || category.score < minScore) return [];
        return [{ class: category.categoryName, score: category.score,
          bbox: [box.originX, box.originY, box.width, box.height] }];
      }).sort((a, b) => b.score - a.score).slice(0, maxNumBoxes);
    },
    dispose() { detector.close(); },
  };
}
