import { SIZE, resizeToInput, toInputTensor, selectQueries, decode } from "./vendor/rfdetr-host.js";

const VERSION = "2.5.3";
const ROOT = `https://cdn.jsdelivr.net/npm/@litertjs/core@${VERSION}`;
const REVISION = "388a9bb69eefac2efff19d5bb92cea49b7379a5a";
const MODEL_ROOT = `https://huggingface.co/litert-community/RF-DETR-Nano-LiteRT/resolve/${REVISION}`;
const HASHES = {
  A: "de71a9c0c3fb2e1c617f3a79b2ce3541ea33b7ceb9bd5e7edd752b067efe33a1",
  B: "ced9a6b29f8196c6d66c9864a11f4fd2d7e23bb5ab2d0d83f49101f85321fc86",
};
const SHAPES = {
  A: { in: { image: [1, 3, SIZE, SIZE] }, out: {
    encClass: [1, 576, 91], encCoord: [1, 576, 4], memory: [1, 576, 256],
  } },
  B: { in: { memory: [1, 576, 256], refpoints: [1, 300, 4] }, out: {
    boxes: [1, 300, 4], logits: [1, 300, 91],
  } },
};
const VEHICLES = { 2: "bicycle", 3: "car", 4: "motorcycle", 6: "bus", 8: "truck" };

async function modelBytes(key) {
  const response = await fetch(`${MODEL_ROOT}/rfdetr_graph${key}_fp16.tflite`);
  if (!response.ok) throw new Error(`RF-DETR graph ${key} download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  if (hash !== HASHES[key]) throw new Error(`RF-DETR graph ${key} did not match the pinned model hash.`);
  return bytes;
}

function bind(details, wanted) {
  if (details.length !== Object.keys(wanted).length) throw new Error("RF-DETR tensor count does not match the pinned export.");
  return Object.fromEntries(Object.entries(wanted).map(([name, shape]) => {
    const slot = details.findIndex((entry) => entry.shape.length === shape.length &&
      shape.every((size, index) => entry.shape[index] === size));
    if (slot < 0) throw new Error(`RF-DETR tensor ${name} has an unexpected shape.`);
    return [name, slot];
  }));
}

export async function createRfDetr() {
  const { Tensor, isWebGPUSupported, loadAndCompile, loadLiteRt } = await import(`${ROOT}/+esm`);
  await loadLiteRt(`${ROOT}/wasm/`, { threads: false });
  const graphs = {};
  let retriedOnCpu = false;
  async function compile(key, accelerator) {
    const compiled = await loadAndCompile(await modelBytes(key), { accelerator });
    try {
      return { model: compiled, accelerator: compiled.options?.accelerator ?? "unreported",
        input: bind(compiled.getInputDetails(), SHAPES[key].in),
        output: bind(compiled.getOutputDetails(), SHAPES[key].out) };
    } catch (error) {
      compiled.delete();
      throw error;
    }
  }
  async function run(key, feeds) {
    const graph = graphs[key];
    const inputs = [];
    let outputs = [];
    try {
      for (const [name, slot] of Object.entries(graph.input)) {
        inputs[slot] = Tensor.fromTypedArray(feeds[name], SHAPES[key].in[name]);
      }
      outputs = await graph.model.run(inputs);
      const values = {};
      for (const [name, slot] of Object.entries(graph.output)) {
        // Own the host arrays before deleting the runtime's output tensors.
        values[name] = new Float32Array(await outputs[slot].data());
      }
      return values;
    } finally {
      for (const output of outputs) output?.delete();
      for (const input of inputs) input?.delete();
    }
  }
  try {
    if (isWebGPUSupported()) {
      try { graphs.A = await compile("A", "webgpu"); }
      catch { graphs.A = await compile("A", "wasm"); }
    } else {
      graphs.A = await compile("A", "wasm");
    }
    // The upstream sample documents incorrect decoder logits on WebGPU.
    graphs.B = await compile("B", "wasm");
  } catch (error) {
    graphs.A?.model.delete();
    graphs.B?.model.delete();
    throw error;
  }
  return {
    get backend() { return `litert-a-${graphs.A.accelerator}-b-wasm`; },
    inferenceSize: `${SIZE}x${SIZE}`,
    fullResolutionInput: true,
    runtimeInfo: { runtime: "LiteRT.js", version: VERSION, model: "RF-DETR Nano split fp16",
      modelRevision: REVISION, modelHashes: HASHES, experimental: true,
      timingScope: "Full adapter call, including Pillow-style resize, normalization, graph runs, host query selection and NMS." },
    async detect(canvas, maxNumBoxes, minScore) {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      const input = toInputTensor(resizeToInput(pixels.data, canvas.width, canvas.height));
      let a;
      try { a = await run("A", { image: input }); }
      catch (error) {
        if (graphs.A.accelerator !== "webgpu" || retriedOnCpu) throw error;
        retriedOnCpu = true;
        graphs.A.model.delete();
        graphs.A = await compile("A", "wasm");
        a = await run("A", { image: input });
      }
      const { refpoints } = selectQueries(a.encClass, a.encCoord);
      const b = await run("B", { memory: a.memory, refpoints });
      return decode(b.boxes, b.logits, minScore).filter((item) => VEHICLES[item.cls])
        .slice(0, maxNumBoxes).map((item) => {
          const x1 = Math.max(0, Math.min(1, item.xyxy[0]));
          const y1 = Math.max(0, Math.min(1, item.xyxy[1]));
          const x2 = Math.max(x1, Math.min(1, item.xyxy[2]));
          const y2 = Math.max(y1, Math.min(1, item.xyxy[3]));
          return { class: VEHICLES[item.cls], score: item.score,
            bbox: [x1 * canvas.width, y1 * canvas.height,
              (x2 - x1) * canvas.width, (y2 - y1) * canvas.height] };
        });
    },
    dispose() { graphs.A?.model.delete(); graphs.B?.model.delete(); },
  };
}
