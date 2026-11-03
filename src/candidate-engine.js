import { canUseWorkerInference, WorkerCocoInferenceEngine } from "./inference-engine.js";

export class CandidateInferenceEngine extends WorkerCocoInferenceEngine {
  static async create(modelId) {
    if (!canUseWorkerInference()) throw new Error("This model needs Worker, ImageBitmap and OffscreenCanvas support.");
    const engine = new CandidateInferenceEngine();
    try {
      const result = await engine.request({ type: "init", modelId }, [], 180000);
      engine.backend = result.backend;
      engine.runtimeInfo = result.runtimeInfo;
      return engine;
    } catch (error) {
      engine.terminate();
      throw error;
    }
  }

  constructor() {
    // MediaPipe's WASM loader uses importScripts, which needs a classic Worker.
    super(new URL("./candidate-worker.js", import.meta.url));
    this.experimental = true;
  }
}
