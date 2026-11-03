import test from "node:test";
import assert from "node:assert/strict";

import { VehicleDetector } from "../src/detector.js";
import { FRESHNESS } from "../src/config.js";
import { WorkerCocoInferenceEngine } from "../src/inference-engine.js";

const CAR = { class: "car", score: 0.9, bbox: [220, 120, 120, 90] };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(t) {
  const clock = { now: 1000 };
  const source = { generation: 1, mode: "front", status: "live" };
  const statuses = [];
  const calls = [];
  const video = { readyState: 4, videoWidth: 1280, videoHeight: 720 };
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { search: "" } },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tag) {
        assert.equal(tag, "canvas");
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage() {},
              getImageData: (x, y, width, height) => ({
                data: new Uint8ClampedArray(width * height * 4),
              }),
            };
          },
        };
      },
    },
  });
  t.mock.method(performance, "now", () => clock.now);
  const detector = new VehicleDetector(video, {
    getSourceState: () => ({ ...source }),
    onStatus: (status) => statuses.push(status),
  });
  detector.model = {
    detect() {
      const call = deferred();
      calls.push(call);
      return call.promise;
    },
  };
  detector.setSourceGeneration(source.generation);
  t.after(() => {
    detector.pause();
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else delete globalThis.window;
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
    else delete globalThis.document;
  });
  const frame = (sequence, presentedAt = clock.now) => ({
    sequence,
    generation: source.generation,
    presentedAt,
    mediaTime: sequence / 30,
  });
  return { detector, clock, source, statuses, calls, frame };
}

// Yield promise continuations without advancing the detector's controlled clock.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a paused detector does not start inference even when called directly", async (t) => {
  const h = setup(t);
  const pending = h.detector.runInference(h.frame(1));
  h.calls[0]?.resolve([CAR]);
  await pending;
  assert.equal(h.calls.length, 0);
  assert.equal(h.detector.snapshot.stale, true);
});

test("pausing while inference is pending prevents the late result from publishing", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  assert.equal(h.calls.length, 1);
  h.detector.pause();
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
  assert.equal(h.statuses.some((status) => status.code === "inference-ready"), false);
});

test("pause then resume on the same camera cannot revive an old result", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  h.detector.pause();
  h.detector.start();
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
});

test("a failure completing after pause does not fault the paused session", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  h.detector.pause();
  h.calls[0].reject(new Error("paused job failed"));
  await settle();
  assert.equal(h.detector.consecutiveInferenceErrors, 0);
  assert.equal(h.statuses.some((status) => status.code === "inference-error"), false);
});

test("a fresh result after resume can publish after the old job is discarded", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  h.detector.pause();
  h.detector.start();
  h.clock.now = 1120;
  const fresh = h.frame(2);
  h.detector.notifyFrame(fresh);
  h.calls[0].resolve([CAR]);
  await settle();
  h.detector.tick(h.clock.now);
  assert.equal(h.calls.length, 2);
  h.clock.now = 1150;
  h.calls[1].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.stale, false);
  assert.equal(h.detector.snapshot.count, 1);
  assert.equal(h.detector.snapshot.sourceFrameAt, fresh.presentedAt);
});

test("camera mode changing away and back cannot revive an earlier result", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  h.detector.setMode("rear");
  h.detector.setMode("front");
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
});

test("a previous camera generation's success cannot populate the current snapshot", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  h.source.generation = 2;
  h.detector.setSourceGeneration(2);
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.sourceGeneration, 2);
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
});

test("a previous camera generation's failure does not fault the new session", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  h.source.generation = 2;
  h.detector.setSourceGeneration(2);
  h.calls[0].reject(new Error("old camera job failed"));
  await settle();
  assert.equal(h.detector.consecutiveInferenceErrors, 0);
  assert.equal(h.statuses.some((status) => status.code === "inference-error"), false);
  assert.equal(h.detector.snapshot.sourceGeneration, 2);
});

test("a repeated frame is not processed twice", async (t) => {
  const h = setup(t);
  h.detector.start();
  const frame = h.frame(1);
  h.detector.notifyFrame(frame);
  h.calls[0].resolve([CAR]);
  await settle();
  h.clock.now += 200;
  h.detector.notifyFrame(frame);
  h.detector.tick(h.clock.now);
  await settle();
  assert.equal(h.calls.length, 1);
});

test("pending camera frames replace each other without overlapping model calls", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  h.clock.now = 1030;
  h.detector.notifyFrame(h.frame(2));
  h.clock.now = 1060;
  const newest = h.frame(3);
  h.detector.notifyFrame(newest);
  assert.equal(h.calls.length, 1);
  h.clock.now = 1120;
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.calls.length, 2);
  h.clock.now = 1150;
  h.calls[1].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.sourceFrameAt, newest.presentedAt);
  assert.equal(h.detector.snapshot.stale, false);
  assert.equal(h.calls.length, 2);
});

test("an inference that expires before completion cannot publish live vehicles", async (t) => {
  const h = setup(t);
  h.detector.start();
  const frame = h.frame(1);
  h.detector.notifyFrame(frame);
  h.clock.now = frame.presentedAt + FRESHNESS.unsafeFrameAgeMs + 1;
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
  assert.equal(h.statuses.some((status) => status.code === "inference-ready"), false);
});

test("track observation time is independent of model completion delay", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1, 970));
  h.clock.now = 1110;
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.count, 1);
  assert.equal(h.detector.tracks[0].seenAt, h.detector.snapshot.sourceFrameAt);
  assert.equal(h.detector.snapshot.sourceFrameAt, 970);
});

test("an old animation timestamp cannot make frame age younger than the completed result", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1, 970));
  h.clock.now = 1110;
  h.calls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.tick(1070).observationAgeMs, 140);
});

test("a change of timestamp origin cannot manufacture motion from earlier timing history", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1, 970));
  h.calls[0].resolve([CAR]);
  await settle();
  const firstId = h.detector.tracks[0].id;
  h.clock.now = 1120;
  h.detector.notifyFrame({ ...h.frame(2), observedAt: 1080, timestampOrigin: "capture-metadata" });
  h.calls[1].resolve([CAR]);
  await settle();
  assert.notEqual(h.detector.tracks[0].id, firstId);
  assert.equal(h.detector.tracks[0].hits, 1);
});

test("a non-advancing observation timestamp cannot count as another confirmed observation", async (t) => {
  const h = setup(t);
  h.detector.start();
  h.detector.notifyFrame(h.frame(1, 970));
  h.calls[0].resolve([CAR]);
  await settle();
  h.clock.now = 1120;
  h.detector.notifyFrame(h.frame(2, 960));
  h.calls[1].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
});

async function setupWorkerFallback(t) {
  const h = setup(t);
  const originals = Object.fromEntries(
    ["Worker", "createImageBitmap", "tf"].map((key) => [
      key, Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  class FakeWorker {
    static instances = [];
    constructor() {
      this.handlers = {};
      this.messages = [];
      this.terminated = false;
      FakeWorker.instances.push(this);
    }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(message) { this.handlers.message({ data: message }); }
  }
  let backend = "cpu";
  const tf = {
    async setBackend(value) { backend = value; return true; },
    async ready() {},
    getBackend: () => backend,
  };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [key, value] of Object.entries({
    Worker: FakeWorker,
    createImageBitmap: async () => ({ close() {} }),
    tf,
  })) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.assign(window, {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout,
    tf,
  });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const mainLoad = deferred();
  const mainCalls = [];
  const mainModel = {
    detect() {
      const call = deferred();
      mainCalls.push(call);
      return call.promise;
    },
  };
  const loads = [];
  window.cocoSsd = {
    load(options) {
      loads.push(options);
      return mainLoad.promise;
    },
  };
  const initializing = WorkerCocoInferenceEngine.create("lite_mobilenet_v2");
  const worker = FakeWorker.instances[0];
  worker.reply({ type: "ready", id: worker.messages[0].id, backend: "webgl" });
  const engine = await initializing;
  t.after(() => engine.terminate());
  h.detector.model = engine;
  h.detector.backend = "worker-webgl";
  h.detector.start();
  h.detector.notifyFrame(h.frame(1));
  await settle();
  const firstDetection = worker.messages.find((message) => message.type === "detect");
  worker.reply({ type: "result", id: firstDetection.id, predictions: [CAR], modelMs: 0 });
  await settle();
  assert.equal(h.detector.snapshot.stale, false);
  assert.equal(h.detector.snapshot.count, 1);
  h.clock.now = 1120;
  h.detector.notifyFrame(h.frame(2));
  await settle();
  worker.handlers.error({ preventDefault() {}, message: "Worker runtime crashed" });
  await settle();
  assert.equal(engine.failure.code, "WORKER_FAILED");
  return { ...h, engine, worker, mainLoad, mainCalls, mainModel, loads };
}

test("a runtime Worker crash invalidates output and recovers on the next fresh main-thread frame", async (t) => {
  const h = await setupWorkerFallback(t);
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
  assert.equal(h.loads.length, 1);
  assert.equal(h.worker.terminated, true);
  h.mainLoad.resolve(h.mainModel);
  await settle();
  assert.equal(h.detector.snapshot.stale, true);
  h.clock.now = 1250;
  const fresh = h.frame(3);
  h.detector.notifyFrame(fresh);
  await settle();
  assert.equal(h.mainCalls.length, 1);
  h.clock.now = 1280;
  h.mainCalls[0].resolve([CAR]);
  await settle();
  assert.equal(h.detector.snapshot.stale, false);
  assert.equal(h.detector.snapshot.count, 1);
  assert.equal(h.detector.snapshot.sourceFrameAt, fresh.presentedAt);
  assert.equal(h.detector.snapshot.backend, "webgl");
});

test("pausing during Worker fallback cannot start or publish stale main-thread work", async (t) => {
  const h = await setupWorkerFallback(t);
  assert.equal(h.loads.length, 1);
  h.detector.pause();
  h.mainLoad.resolve(h.mainModel);
  await settle();
  assert.equal(h.mainCalls.length, 0);
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
  assert.equal(h.detector.snapshot.updatedAt, 0);
});

test("camera changes during Worker fallback cannot resurrect a previous generation", async (t) => {
  const h = await setupWorkerFallback(t);
  assert.equal(h.loads.length, 1);
  h.source.generation = 2;
  h.detector.setSourceGeneration(2);
  h.mainLoad.resolve(h.mainModel);
  await settle();
  assert.equal(h.mainCalls.length, 0);
  assert.equal(h.detector.snapshot.sourceGeneration, 2);
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
});

test("failed main-thread recovery remains unavailable and never retries the dead Worker", async (t) => {
  const h = await setupWorkerFallback(t);
  assert.equal(h.loads.length, 1);
  h.mainLoad.reject(new Error("fallback model unavailable"));
  await settle();
  const workerRequests = h.worker.messages.length;
  h.clock.now = 1250;
  h.detector.notifyFrame(h.frame(3));
  await settle();
  assert.equal(h.detector.snapshot.stale, true);
  assert.equal(h.detector.snapshot.count, 0);
  assert.equal(h.mainCalls.length, 0);
  assert.equal(h.worker.messages.length, workerRequests);
  assert.ok(h.statuses.some((status) => status.state === "unsafe"));
});
