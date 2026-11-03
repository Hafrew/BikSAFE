import {
  DETECTION_CANDIDATE_LIMIT,
  DETECTION_MIN_SCORE,
  DISTANCE_ESTIMATION,
  EXPERIMENTAL_MODELS,
} from "../src/config.js";
import { normalizeAndFilterPredictions } from "../src/detection-filter.js";
import {
  evaluateImageDetections,
  summarizeDetectionEvaluation,
  getEvaluationCoverage,
} from "../src/evaluation-metrics.js";
import { WorkerCocoInferenceEngine } from "../src/inference-engine.js";
import { CandidateInferenceEngine } from "../src/candidate-engine.js";
import { estimateRangeFromBox } from "../src/range.js";
import {
  PUBLIC_EVAL_VARIANTS,
  canvasBoxToSource,
  drawEvaluationTransform,
  getEvaluationTransform,
} from "./evaluation-transforms.js";

const manifestInput = document.getElementById("manifest");
const imagesInput = document.getElementById("images");
const modelSelect = document.getElementById("model");
const backendSelect = document.getElementById("backend");
const maxSideSelect = document.getElementById("max-side");
const suiteSelect = document.getElementById("suite");
const runButton = document.getElementById("run");
const runFixtureButton = document.getElementById("run-fixture");
const progress = document.getElementById("progress");
const status = document.getElementById("status");
const canvas = document.getElementById("work");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });

function baseName(path) {
  return String(path).replaceAll("\\", "/").split("/").at(-1);
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function summarizeLatencies(values) {
  return {
    samples: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length > 0 ? Math.max(...values) : null,
  };
}

async function loadGeneratedFixture() {
  const fixtureCanvas = document.createElement("canvas");
  fixtureCanvas.width = 1280;
  fixtureCanvas.height = 720;
  const fixtureContext = fixtureCanvas.getContext("2d", { alpha: false });
  const sky = fixtureContext.createLinearGradient(0, 0, 0, 720);
  sky.addColorStop(0, "#94b6ca");
  sky.addColorStop(0.58, "#d8dee0");
  sky.addColorStop(0.59, "#5b6266");
  sky.addColorStop(1, "#272d30");
  fixtureContext.fillStyle = sky;
  fixtureContext.fillRect(0, 0, 1280, 720);
  fixtureContext.fillStyle = "#c8d2d8";
  fixtureContext.fillRect(530, 430, 220, 105);
  fixtureContext.fillStyle = "#233542";
  fixtureContext.fillRect(565, 400, 150, 55);
  fixtureContext.fillStyle = "#151a1d";
  fixtureContext.beginPath();
  fixtureContext.arc(570, 545, 31, 0, Math.PI * 2);
  fixtureContext.arc(715, 545, 31, 0, Math.PI * 2);
  fixtureContext.fill();

  const imageBlob = await new Promise((resolve) => fixtureCanvas.toBlob(resolve, "image/png"));
  const manifest = {
    schemaVersion: 1,
    source: "GENERATED_PIPELINE_FIXTURE_NOT_ACCURACY_DATA",
    images: [{
      id: "generated-road-fixture.png",
      file: "generated-road-fixture.png",
      attributes: { generated: true },
      objects: [{ class: "car", bbox: [530, 400, 220, 176] }],
    }],
  };
  const manifestTransfer = new DataTransfer();
  manifestTransfer.items.add(new File(
    [JSON.stringify(manifest)],
    "generated-manifest.json",
    { type: "application/json" },
  ));
  const imageTransfer = new DataTransfer();
  imageTransfer.items.add(new File(
    [imageBlob],
    "generated-road-fixture.png",
    { type: "image/png" },
  ));
  manifestInput.files = manifestTransfer.files;
  imagesInput.files = imageTransfer.files;
}

runFixtureButton.addEventListener("click", async () => {
  runFixtureButton.disabled = true;
  try {
    status.textContent = "Generating non-accuracy pipeline fixture...";
    await loadGeneratedFixture();
    runButton.click();
  } catch (error) {
    console.error(error);
    status.textContent = `Fixture failed: ${error?.message ?? error}`;
  } finally {
    runFixtureButton.disabled = false;
  }
});

runButton.addEventListener("click", async () => {
  const manifestFile = manifestInput.files?.[0];
  const imageFiles = Array.from(imagesInput.files ?? []);
  if (!manifestFile || imageFiles.length === 0) {
    status.textContent = "Select both a manifest and its public image directory.";
    return;
  }

  runButton.disabled = true;
  let workerEngine = null;
  let mainModel = null;
  try {
    const manifest = JSON.parse(await manifestFile.text());
    const filesByName = new Map();
    for (const file of imageFiles) {
      filesByName.set(file.name, file);
      filesByName.set(file.webkitRelativePath, file);
    }
    const modelBase = modelSelect.value;
    const backendChoice = backendSelect.value;
    const inputMaxSide = Number(maxSideSelect.value);
    const variants = suiteSelect.value === "stress"
      ? PUBLIC_EVAL_VARIANTS
      : ["original"];
    let detectorBackend;
    let detect;

    status.textContent = `Loading ${backendChoice === "worker" || EXPERIMENTAL_MODELS.has(modelBase) ? "Worker" : "main-thread"} detector...`;
    if (backendChoice === "worker" || EXPERIMENTAL_MODELS.has(modelBase)) {
      workerEngine = EXPERIMENTAL_MODELS.has(modelBase)
        ? await CandidateInferenceEngine.create(modelBase)
        : await WorkerCocoInferenceEngine.create(modelBase);
      detectorBackend = `worker-${workerEngine.backend}`;
      detect = (input) => workerEngine.detect(
        input,
        DETECTION_CANDIDATE_LIMIT,
        DETECTION_MIN_SCORE,
      );
    } else {
      await tf.setBackend("webgl");
      await tf.ready();
      mainModel = await cocoSsd.load({ base: modelBase });
      detectorBackend = tf.getBackend();
      detect = (input) => mainModel.detect(
        input,
        DETECTION_CANDIDATE_LIMIT,
        DETECTION_MIN_SCORE,
      );
    }

    const resultsByVariant = new Map(
      variants.map((variant) => [variant, []]),
    );
    const evaluationsByVariant = new Map(
      variants.map((variant) => [variant, []]),
    );
    const latenciesByVariant = new Map(
      variants.map((variant) => [variant, []]),
    );
    const missing = [];
    progress.max = manifest.images.length * variants.length;
    progress.value = 0;

    for (const [index, image] of manifest.images.entries()) {
      const file = filesByName.get(image.file) ?? filesByName.get(baseName(image.file));
      if (!file) {
        missing.push(image.id);
        progress.value += variants.length;
        continue;
      }

      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, inputMaxSide / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(256, Math.round(bitmap.width * scale));
      canvas.height = Math.max(256, Math.round(bitmap.height * scale));

      for (const variant of variants) {
        const transform = getEvaluationTransform(
          variant,
          image.id,
          bitmap.width,
          bitmap.height,
        );
        drawEvaluationTransform(context, bitmap, transform);
        const startedAt = performance.now();
        const raw = await detect(canvas);
        if (workerEngine) detectorBackend = `worker-${workerEngine.backend}`;
        latenciesByVariant.get(variant).push(performance.now() - startedAt);
        const objects = normalizeAndFilterPredictions(raw, {
          targetWidth: canvas.width,
          targetHeight: canvas.height,
          sourceWidth: canvas.width,
          sourceHeight: canvas.height,
        }).map(({ class: className, bbox: canvasBox, score }) => {
          const bbox = canvasBoxToSource(
            canvasBox,
            transform,
            canvas.width,
            canvas.height,
          );
          return {
            class: className,
            bbox,
            score,
            estimatedDistanceMeters: estimateRangeFromBox({
              className,
              bbox,
              frameWidth: bitmap.width,
              frameHeight: bitmap.height,
              horizontalFovDegrees: DISTANCE_ESTIMATION.horizontalFovDegreesDefault,
              focalLengthX: image.calibration?.focalLengthX,
              focalLengthY: image.calibration?.focalLengthY,
            }),
          };
        });
        resultsByVariant.get(variant).push({ id: image.id, objects });
        evaluationsByVariant.get(variant).push(
          evaluateImageDetections(image.objects ?? [], objects),
        );
        progress.value += 1;
        status.textContent = `${variant}: ${index + 1} / ${manifest.images.length}`;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      bitmap.close();
    }

    const variantLatency = Object.fromEntries(
      variants.map((variant) => [
        variant,
        summarizeLatencies(latenciesByVariant.get(variant)),
      ]),
    );
    const variantEvaluation = Object.fromEntries(
      variants.map((variant) => [
        variant,
        summarizeDetectionEvaluation(evaluationsByVariant.get(variant)),
      ]),
    );
    const coverage = getEvaluationCoverage(manifest.images, resultsByVariant.get("original"));
    downloadJson("biksafe-public-predictions.json", {
      schemaVersion: 1,
      source: manifest.source,
      modelBase,
      detectorBackend,
      runtimeInfo: workerEngine?.runtimeInfo ?? { runtime: "TensorFlow.js", version: "4.17.0", model: "COCO-SSD 2.2.3" },
      experimental: EXPERIMENTAL_MODELS.has(modelBase),
      requestedBackend: backendChoice,
      inputMaxSide,
      suite: suiteSelect.value,
      latency: variantLatency.original,
      evaluation: variantEvaluation.original,
      missingImages: missing,
      coverage,
      complete: coverage.complete,
      timingScope: "Model call including Worker transfer when selected; excludes image preparation, tracking and alerts.",
      images: resultsByVariant.get("original"),
      stress: variants.length > 1 ? {
        variants: variants.slice(1),
        latency: Object.fromEntries(
          variants.slice(1).map((variant) => [variant, variantLatency[variant]]),
        ),
        evaluation: Object.fromEntries(
          variants.slice(1).map((variant) => [variant, variantEvaluation[variant]]),
        ),
        images: Object.fromEntries(
          variants.slice(1).map((variant) => [variant, resultsByVariant.get(variant)]),
        ),
      } : undefined,
    });
    status.textContent = `${coverage.complete ? "Complete" : "INCOMPLETE - not valid for comparison"}: ${resultsByVariant.get("original").length} images x ${variants.length} variants, ${missing.length} missing. Predictions exported.`;
  } catch (error) {
    console.error(error);
    status.textContent = error?.message ?? "Evaluation failed.";
  } finally {
    workerEngine?.terminate();
    mainModel?.dispose?.();
    runButton.disabled = false;
  }
});
