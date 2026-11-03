import {
  canUseWorkerInference,
  WorkerCocoInferenceEngine,
} from "../src/inference-engine.js";

const requestedRuns = Number(new URLSearchParams(location.search).get("runs") ?? 1000);
const MEASURED_RUNS = Number.isInteger(requestedRuns) && requestedRuns >= 20 && requestedRuns <= 5000
  ? requestedRuns : 1000;
const BLOCK_SIZE = 50;
const MODEL_BASE = "lite_mobilenet_v2";
const status = document.getElementById("status");
const canvas = document.getElementById("sample");
const context = canvas.getContext("2d", { alpha: false });

context.fillStyle = "#68757f";
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "#d8e2e8";
context.fillRect(180, 160, 280, 110);

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(values) {
  return {
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(...values),
  };
}

async function benchmarkBlock(label, infer, samples) {
  const remaining = Math.min(BLOCK_SIZE, MEASURED_RUNS - samples.latencies.length);
  status.textContent = `${label}: ${samples.latencies.length} / ${MEASURED_RUNS}`;
  for (let run = 0; run < remaining; run += 1) {
    const heartbeatStartedAt = performance.now();
    const heartbeat = new Promise((resolve) => {
      window.setTimeout(() => resolve(performance.now() - heartbeatStartedAt), 0);
    });
    const startedAt = performance.now();
    await infer();
    samples.latencies.push(performance.now() - startedAt);
    samples.mainThreadStalls.push(await heartbeat);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function reportSamples(samples) {
  return {
    latency: summarize(samples.latencies),
    mainThreadStall: summarize(samples.mainThreadStalls),
    raw: samples,
  };
}

let workerEngine = null;
let mainModel = null;
try {
  if (!canUseWorkerInference()) {
    throw new Error("Worker inference is unsupported in this browser.");
  }

  status.textContent = "Loading main-thread model...";
  await window.tf.setBackend("webgl");
  await window.tf.ready();
  mainModel = await window.cocoSsd.load({ base: MODEL_BASE });

  status.textContent = "Loading Worker model...";
  workerEngine = await WorkerCocoInferenceEngine.create(MODEL_BASE);
  const mainInfer = () => mainModel.detect(canvas, 32, 0.32);
  const workerInfer = () => workerEngine.detect(canvas, 32, 0.32);
  status.textContent = "Warming both engines...";
  await mainInfer();
  await workerInfer();
  const mainSamples = { latencies: [], mainThreadStalls: [] };
  const workerSamples = { latencies: [], mainThreadStalls: [] };
  for (let block = 0; mainSamples.latencies.length < MEASURED_RUNS; block += 1) {
    if (block % 2 === 0) {
      await benchmarkBlock("Main thread", mainInfer, mainSamples);
      await benchmarkBlock("Worker", workerInfer, workerSamples);
    } else {
      await benchmarkBlock("Worker", workerInfer, workerSamples);
      await benchmarkBlock("Main thread", mainInfer, mainSamples);
    }
  }
  const main = reportSamples(mainSamples);
  const worker = reportSamples(workerSamples);
  const buildManifest = await fetch("../build-manifest.json", { cache: "no-store" })
    .then((response) => response.json()).catch(() => null);
  const results = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    evidenceKind: "GENERATED_PIPELINE_BENCHMARK_NOT_ACCURACY_DATA",
    timingScope: "Model-call latency including Worker bitmap/transfer; input canvas already prepared. Timer stall is a setTimeout probe, not a long-task trace.",
    protocol: "Alternating order of 50-inference blocks; both models resident, one inference at a time.",
    userAgent: navigator.userAgent,
    tfjsVersion: window.tf.version.tfjs,
    cocoSsdVersion: "2.2.3",
    buildFingerprint: buildManifest?.fingerprint ?? null,
    inputSize: `${canvas.width}x${canvas.height}`,
    modelBase: MODEL_BASE,
    measuredRuns: MEASURED_RUNS,
    mainBackend: window.tf.getBackend(),
    workerBackend: workerEngine.backend,
    main,
    worker,
    p95LatencyDeltaMs: main.latency.p95Ms - worker.latency.p95Ms,
    p95MainThreadStallDeltaMs:
      main.mainThreadStall.p95Ms - worker.mainThreadStall.p95Ms,
  };
  status.dataset.results = JSON.stringify(results);
  const download = document.getElementById("download");
  download.disabled = false;
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "biksafe-backend-benchmark.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  status.textContent = [
    "PASS",
    `main p95 ${Math.round(main.latency.p95Ms)}ms / stall ${Math.round(main.mainThreadStall.p95Ms)}ms`,
    `worker p95 ${Math.round(worker.latency.p95Ms)}ms / stall ${Math.round(worker.mainThreadStall.p95Ms)}ms`,
  ].join(" / ");
} catch (error) {
  console.error(error);
  status.textContent = `FAIL / ${error?.message ?? error}`;
} finally {
  workerEngine?.terminate();
  mainModel?.dispose();
}
