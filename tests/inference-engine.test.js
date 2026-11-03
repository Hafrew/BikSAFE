import test from "node:test";
import assert from "node:assert/strict";
import { WorkerCocoInferenceEngine } from "../src/inference-engine.js";

function setup(t) {
  class FakeWorker {
    constructor() { this.handlers = {}; this.messages = []; this.terminated = false; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    postMessage(message) {
      if (this.postError) throw this.postError;
      this.messages.push(message);
    }
    terminate() { this.terminated = true; }
    reply(message) { this.handlers.message({ data: message }); }
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originals = Object.fromEntries(
    ["Worker", "window", "createImageBitmap"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const bitmaps = [];
  Object.assign(globalThis, {
    Worker: FakeWorker,
    window: { setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout },
    createImageBitmap: async () => {
      const bitmap = { closed: false, close() { this.closed = true; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
  });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const engine = new WorkerCocoInferenceEngine();
  t.after(() => engine.terminate());
  return { engine, worker: engine.worker, bitmaps };
}

test("postMessage failure releases its pending request and untransferred bitmap", async (t) => {
  const { engine, worker, bitmaps } = setup(t);
  worker.postError = new Error("transfer rejected");
  await assert.rejects(engine.detect({}, 32, 0.32), /transfer rejected/);
  assert.equal(engine.pending.size, 0);
  assert.equal(bitmaps[0].closed, true);
});

test("Worker crash rejects current and future requests without queuing more work", async (t) => {
  const { engine, worker } = setup(t);
  const pending = engine.request({ type: "detect" });
  const rejected = assert.rejects(pending, /crash/);
  worker.handlers.error({ preventDefault() {}, message: "Worker crash" });
  await rejected;
  assert.equal(worker.terminated, true);
  await assert.rejects(engine.request({ type: "detect" }), /crash|stopped/i);
  assert.equal(worker.messages.length, 1);
});

test("Worker deadline terminates the engine and rejects all pending work", async (t) => {
  const { engine, worker } = setup(t);
  const first = engine.request({ type: "detect" }, [], 10);
  const second = engine.request({ type: "detect" }, [], 100);
  const firstRejected = assert.rejects(first, /deadline/);
  const secondRejected = assert.rejects(second, /deadline|stopped/i);
  t.mock.timers.tick(10);
  await firstRejected;
  assert.equal(worker.terminated, true);
  assert.equal(engine.pending.size, 0);
  await secondRejected;
});

test("termination during bitmap creation closes the bitmap and never posts it", async (t) => {
  const { engine, worker } = setup(t);
  let release;
  const bitmap = { closed: false, close() { this.closed = true; } };
  globalThis.createImageBitmap = () => new Promise((resolve) => { release = resolve; });
  const detection = engine.detect({}, 32, 0.32);
  const rejected = assert.rejects(detection, /stopped|terminated/i);
  engine.terminate();
  release(bitmap);
  await Promise.resolve();
  assert.equal(worker.messages.length, 0);
  await rejected;
  assert.equal(bitmap.closed, true);
  assert.equal(worker.messages.length, 0);
});

test("Worker timing separates bitmap creation from model work", async (t) => {
  const { engine, worker } = setup(t);
  const detection = engine.detect({}, 32, 0.32);
  await Promise.resolve();
  const request = worker.messages[0];
  worker.reply({ type: "result", id: request.id, predictions: [], modelMs: 0 });
  assert.deepEqual(await detection, []);
  assert.equal(engine.lastTimings.workerModelMs, 0);
  assert.ok(engine.lastTimings.bitmapMs >= 0);
  assert.ok(engine.lastTimings.workerRoundTripMs >= 0);
});
