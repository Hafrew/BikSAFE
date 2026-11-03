import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  evaluateImageDetections,
  summarizeDetectionEvaluation,
  getEvaluationCoverage,
} from "../src/evaluation-metrics.js";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((value, index, values) => (
    value.startsWith("--") ? [[value.slice(2), values[index + 1]]] : []
  )),
);

const groundTruthArg = args["ground-truth"] ?? args.groundTruth;

if (!groundTruthArg || !args.predictions) {
  console.error("Usage: node tools/evaluate-detections.mjs --ground-truth manifest.json --predictions predictions.json [--out report.json]");
  process.exit(1);
}

const groundTruth = JSON.parse(await readFile(resolve(groundTruthArg), "utf8"));
const predictions = JSON.parse(await readFile(resolve(args.predictions), "utf8"));
const coverage = getEvaluationCoverage(groundTruth.images, predictions.images);
const predictionsById = new Map(predictions.images.map((image) => [image.id, image.objects ?? []]));
const imageResults = groundTruth.images.map((image) => evaluateImageDetections(
  image.objects ?? [],
  predictionsById.get(image.id) ?? [],
));
const report = {
  schemaVersion: 1,
  source: groundTruth.source,
  coverage,
  complete: coverage.complete,
  evaluatedImages: groundTruth.images.length,
  ...summarizeDetectionEvaluation(imageResults),
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (args.out) {
  await writeFile(resolve(args.out), serialized);
}
process.stdout.write(serialized);
if (!coverage.complete) process.exitCode = 2;
