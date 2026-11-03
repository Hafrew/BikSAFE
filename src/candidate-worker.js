let adapter = null;
let frameProcessor = null;
let frameTools = null;
let busy = false;

self.addEventListener("message", async ({ data: message }) => {
  try {
    if (message.type === "init") {
      if (adapter) throw new Error("Model is already initialized.");
      frameTools = await import("./worker-frame.js");
      if (message.modelId === "efficientdet_lite0") {
        const { createEfficientDet } = await import("./efficientdet-adapter.js");
        adapter = await createEfficientDet();
      } else if (message.modelId === "rfdetr_nano") {
        const { createRfDetr } = await import("./rfdetr-adapter.js");
        adapter = await createRfDetr();
      } else {
        throw new Error("Unknown experimental model.");
      }
      frameProcessor = new frameTools.WorkerFrame();
      self.postMessage({ type: "ready", id: message.id, backend: adapter.backend, runtimeInfo: adapter.runtimeInfo });
      return;
    }
    if (message.type === "detect") {
      if (!adapter || busy) throw new Error("Model is unavailable or already processing a frame.");
      busy = true;
      const frame = frameProcessor.prepare(message.bitmap, adapter.fullResolutionInput ? 0 : (message.maxSide ?? 640), message.sourceEpoch);
      const startedAt = performance.now();
      const raw = await adapter.detect(frame.canvas, message.maxNumBoxes, message.minScore);
      const predictions = frameTools.scalePredictions(raw, frame);
      self.postMessage({
        type: "result", id: message.id, predictions,
        modelMs: performance.now() - startedAt,
        preprocessMs: frame.preprocessMs,
        backend: adapter.backend,
        frameInfo: { inferenceSize: adapter.inferenceSize, sceneQuality: frame.sceneQuality },
      });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, error: error?.message ?? String(error) });
  } finally {
    message.bitmap?.close();
    if (message.type === "detect") busy = false;
  }
});
