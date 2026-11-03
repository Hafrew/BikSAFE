import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const importBdd = fileURLToPath(new URL("../tools/import-bdd100k.mjs", import.meta.url));
const importKitti = fileURLToPath(new URL("../tools/import-kitti.mjs", import.meta.url));
const evaluate = fileURLToPath(new URL("../tools/evaluate-detections.mjs", import.meta.url));

async function runNode(script, args) {
  return run(process.execPath, [script, ...args], {
    windowsHide: true,
  });
}

test("public-data import and evaluation CLIs work without ride data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "biksafe-public-pipeline-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const bddLabels = join(root, "bdd-labels.json");
  const bddImages = join(root, "bdd-images");
  const bddManifest = join(root, "bdd-manifest.json");
  const predictions = join(root, "predictions.json");
  const report = join(root, "report.json");
  await mkdir(bddImages);
  await writeFile(bddLabels, JSON.stringify([{
    name: "public-frame.jpg",
    attributes: { weather: "rainy", timeofday: "daytime" },
    labels: [
      {
        id: 1,
        category: "car",
        box2d: { x1: 10, y1: 20, x2: 50, y2: 80 },
      },
      {
        id: 2,
        category: "person",
        box2d: { x1: 1, y1: 2, x2: 3, y2: 4 },
      },
    ],
  }]));

  await runNode(importBdd, [
    "--labels", bddLabels,
    "--images", bddImages,
    "--out", bddManifest,
  ]);

  const importedBdd = JSON.parse(await readFile(bddManifest, "utf8"));
  assert.equal(importedBdd.source, "BDD100K");
  assert.deepEqual(importedBdd.images[0].objects, [{
    id: "1",
    class: "car",
    bbox: [10, 20, 40, 60],
    attributes: {},
  }]);

  await writeFile(predictions, JSON.stringify({
    schemaVersion: 1,
    images: [{
      id: "public-frame.jpg",
      objects: [{ class: "car", bbox: [10, 20, 40, 60], score: 0.9 }],
    }],
  }));
  await runNode(evaluate, [
    "--ground-truth", bddManifest,
    "--predictions", predictions,
    "--out", report,
  ]);

  const evaluation = JSON.parse(await readFile(report, "utf8"));
  assert.equal(evaluation.evaluatedImages, 1);
  assert.equal(evaluation.overall.precision, 1);
  assert.equal(evaluation.overall.recall, 1);

  const kittiLabels = join(root, "label_2");
  const kittiImages = join(root, "image_2");
  const kittiCalibration = join(root, "calib");
  const kittiManifest = join(root, "kitti-manifest.json");
  await Promise.all([
    mkdir(kittiLabels),
    mkdir(kittiImages),
    mkdir(kittiCalibration),
  ]);
  await writeFile(
    join(kittiLabels, "000000.txt"),
    "Car 0.00 0 0.0 10 20 50 80 1.5 1.8 4.0 1 1.5 20 0\n",
  );
  await writeFile(
    join(kittiCalibration, "000000.txt"),
    "P2: 700 0 600 0 0 710 180 0 0 0 1 0\n",
  );

  await runNode(importKitti, [
    "--labels", kittiLabels,
    "--images", kittiImages,
    "--calibration", kittiCalibration,
    "--out", kittiManifest,
  ]);

  const importedKitti = JSON.parse(await readFile(kittiManifest, "utf8"));
  const kittiImage = importedKitti.images[0];
  assert.equal(importedKitti.source, "KITTI");
  assert.equal(kittiImage.calibration.focalLengthX, 700);
  assert.equal(kittiImage.calibration.focalLengthY, 710);
  assert.equal(kittiImage.objects[0].forwardDistanceMeters, 20);
  assert.equal(kittiImage.objects[0].distanceMeters, Math.hypot(1, 1.5, 20));
});

test("evaluation CLI writes an incomplete report and exits nonzero when an image was not evaluated", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "biksafe-incomplete-eval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = join(root, "manifest.json");
  const predictions = join(root, "predictions.json");
  const report = join(root, "report.json");
  await writeFile(manifest, JSON.stringify({ source: "test", images: [
    { id: "evaluated", objects: [] }, { id: "missing", objects: [] },
  ] }));
  await writeFile(predictions, JSON.stringify({ images: [{ id: "evaluated", objects: [] }] }));
  await assert.rejects(runNode(evaluate, [
    "--ground-truth", manifest, "--predictions", predictions, "--out", report,
  ]), (error) => error.code === 2);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.complete, false);
  assert.deepEqual(result.coverage.missingImages, ["missing"]);
});
