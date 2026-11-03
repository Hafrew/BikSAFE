let model = null;
let frameProcessor = null;
let frameTools = null;
let busy = false;

function postError(id, error) {
  self.postMessage({
    type: "error",
    id,
    error: error?.message || error?.name || String(error),
  });
}

self.addEventListener("message", async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      importScripts(
        "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js",
        "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js",
      );
      let backend = "cpu";
      try {
        if (await self.tf.setBackend("webgl")) {
          backend = "webgl";
        }
      } catch {
        await self.tf.setBackend("cpu");
      }
      await self.tf.ready();
      model = await self.cocoSsd.load({ base: message.base });
      frameTools = await import("./worker-frame.js");
      frameProcessor = new frameTools.WorkerFrame();
      self.postMessage({ type: "ready", id: message.id, backend });
      return;
    }

    if (message.type === "detect") {
      if (busy) throw new Error("Worker is already processing a frame.");
      if (!model) {
        throw new Error("Worker detector is not initialized.");
      }
      busy = true;
      const frame = message.maxSide
        ? frameProcessor.prepare(message.bitmap, message.maxSide, message.sourceEpoch) : null;
      const startedAt = performance.now();
      const raw = await model.detect(
        frame?.canvas ?? message.bitmap,
        message.maxNumBoxes,
        message.minScore,
      );
      const predictions = frame ? frameTools.scalePredictions(raw, frame) : raw;
      message.bitmap.close?.();
      self.postMessage({
        type: "result", id: message.id, predictions,
        modelMs: performance.now() - startedAt,
        preprocessMs: frame?.preprocessMs ?? 0,
        frameInfo: frame ? {
          inferenceSize: `${frame.width}x${frame.height}`,
          sceneQuality: frame.sceneQuality,
        } : null,
      });
    }
  } catch (error) {
    message.bitmap?.close?.();
    postError(message.id, error);
  } finally {
    if (message.type === "detect") busy = false;
  }
});
