import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((value, index, values) => (
    value.startsWith("--") ? [[value.slice(2), values[index + 1]]] : []
  )),
);

if (!args.labels || !args.out) {
  console.error("Usage: node tools/import-bdd100k.mjs --labels labels.json --out manifest.json [--images path]");
  process.exit(1);
}

const classMap = new Map([
  ["car", "car"],
  ["truck", "truck"],
  ["bus", "bus"],
  ["motor", "motorcycle"],
  ["motorcycle", "motorcycle"],
  ["bike", "bicycle"],
  ["bicycle", "bicycle"],
]);

const labelsPath = resolve(args.labels);
const outputPath = resolve(args.out);
const imageRoot = args.images ? resolve(args.images) : "";
const frames = JSON.parse(await readFile(labelsPath, "utf8"));

const images = frames.map((frame) => ({
  id: frame.name,
  file: imageRoot ? resolve(imageRoot, frame.name) : frame.name,
  attributes: frame.attributes ?? {},
  objects: (frame.labels ?? []).flatMap((label) => {
    const className = classMap.get(label.category);
    const box = label.box2d;
    if (!className || !box) {
      return [];
    }

    return [{
      id: String(label.id ?? `${frame.name}-${className}`),
      class: className,
      bbox: [box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1],
      attributes: label.attributes ?? {},
    }];
  }),
}));

await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  source: "BDD100K",
  labelsPath,
  images,
}, null, 2)}\n`);

console.log(`Imported ${images.length} BDD100K frames to ${outputPath}`);
