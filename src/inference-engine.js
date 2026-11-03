const WORKER_INIT_TIMEOUT_MS = 12000;

function workerFailure(message) {
  return Object.assign(new Error(message), { code: "WORKER_FAILED" });
}

export function canUseWorkerInference() {
  return (
    typeof Worker === "function" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas === "function"
  );
}

export class WorkerCocoInferenceEngine {
  static async create(base) {
    const engine = new WorkerCocoInferenceEngine();
    try {
      const result = await engine.request(
        { type: "init", base },
        [],
        WORKER_INIT_TIMEOUT_MS,
      );
      engine.backend = result.backend;
      return engine;
    } catch (error) {
      engine.terminate();
      throw error;
    }
  }

  constructor(workerUrl = new URL("./inference-worker.js", import.meta.url), workerOptions) {
    this.worker = new Worker(workerUrl, workerOptions);
    this.pending = new Map();
    this.nextId = 1;
    this.backend = "worker-pending";
    this.failure = null;
    this.lastTimings = null;
    this.lastFrameInfo = null;
    this.preprocessInWorker = true;
    this.runtimeInfo = { runtime: "TensorFlow.js", version: "4.17.0", model: "COCO-SSD 2.2.3" };
    this.worker.addEventListener("message", (event) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      window.clearTimeout(pending.timeout);
      if (message.type === "error") {
        const error = workerFailure(message.error);
        pending.reject(error);
        this.terminate(error);
      } else {
        pending.resolve(message);
      }
    });
    this.worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.terminate(workerFailure(event.message || "Worker inference failed."));
    });
    this.worker.addEventListener("messageerror", () => {
      this.terminate(workerFailure("Worker response could not be decoded."));
    });
  }

  request(message, transfer = [], timeoutMs = 10000) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.terminate(workerFailure(`${message.type} Worker deadline exceeded.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        this.terminate(workerFailure(error.message || "Worker transfer failed."));
      }
    });
  }

  async detect(input, maxNumBoxes, minScore, options = {}) {
    if (this.failure) throw this.failure;
    this.lastTimings = null;
    this.lastFrameInfo = null;
    const startedAt = performance.now();
    const bitmap = await createImageBitmap(input);
    const bitmapReadyAt = performance.now();
    try {
      const result = await this.request(
        { type: "detect", bitmap, maxNumBoxes, minScore, ...options },
        [bitmap],
      );
      this.lastTimings = {
        bitmapMs: bitmapReadyAt - startedAt,
        workerRoundTripMs: performance.now() - bitmapReadyAt,
        workerModelMs: Number.isFinite(result.modelMs) ? result.modelMs : null,
        workerPreprocessMs: Number.isFinite(result.preprocessMs) ? result.preprocessMs : null,
      };
      this.lastFrameInfo = result.frameInfo ?? null;
      if (result.backend) this.backend = result.backend;
      return result.predictions;
    } finally {
      // Safe for a detached bitmap too; the Worker closes its received owner.
      bitmap.close();
    }
  }

  terminate(error = workerFailure("Worker inference stopped.")) {
    if (this.failure) return;
    this.failure = error;
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
