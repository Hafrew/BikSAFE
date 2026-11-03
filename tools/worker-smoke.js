import { canUseWorkerInference, WorkerCocoInferenceEngine } from "../src/inference-engine.js";

const status = document.getElementById("status");
const canvas = document.getElementById("sample");
const context = canvas.getContext("2d");
context.fillStyle = "#68757f";
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "#d8e2e8";
context.fillRect(90, 80, 140, 55);

if (!canUseWorkerInference()) {
  status.textContent = "UNSUPPORTED";
} else {
  try {
    const engine = await WorkerCocoInferenceEngine.create("lite_mobilenet_v2");
    const latencies = [];
    let predictionCount = 0;
    for (let run = 0; run < 6; run += 1) {
      const startedAt = performance.now();
      const predictions = await engine.detect(canvas, 32, 0.32);
      const latencyMs = performance.now() - startedAt;
      predictionCount = predictions.length;
      if (run > 0) {
        latencies.push(latencyMs);
      }
    }
    latencies.sort((a, b) => a - b);
    const medianMs = Math.round(latencies[Math.floor(latencies.length / 2)]);
    const p95Ms = Math.round(latencies.at(-1));
    status.textContent = `PASS / ${engine.backend} / median ${medianMs}ms / p95 ${p95Ms}ms / ${predictionCount} predictions`;
    engine.terminate();
  } catch (error) {
    console.error(error);
    status.textContent = `FAIL / ${error?.message ?? error}`;
  }
}
