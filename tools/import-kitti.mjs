import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((value, index, values) => (
    value.startsWith("--") ? [[value.slice(2), values[index + 1]]] : []
  )),
);

if (!args.labels || !args.images || !args.out) {
  console.error("Usage: node tools/import-kitti.mjs --labels label_2 --images image_2 --out manifest.json [--calibration calib]");
  process.exit(1);
}

const labelsDir = resolve(args.labels);
const imagesDir = resolve(args.images);
const calibrationDir = args.calibration ? resolve(args.calibration) : null;
const outputPath = resolve(args.out);
const classMap = new Map([
  ["Car", "car"],
  ["Van", "car"],
  ["Truck", "truck"],
  ["Tram", "bus"],
  ["Cyclist", "bicycle"],
]);

function parseCalibration(text) {
  const values = Object.fromEntries(text.trim().split(/\r?\n/).map((line) => {
    const [key, raw] = line.split(":", 2);
    return [key, raw.trim().split(/\s+/).map(Number)];
  }));
  const projection = values.P2 ?? values.P_rect_02;
  if (!projection || projection.length < 12) {
    return null;
  }
  return {
    focalLengthX: projection[0],
    focalLengthY: projection[5],
    principalX: projection[2],
    principalY: projection[6],
  };
}

const labelFiles = (await readdir(labelsDir)).filter((file) => file.endsWith(".txt")).sort();
const images = [];
for (const labelFile of labelFiles) {
  const id = basename(labelFile, ".txt");
  const lines = (await readFile(join(labelsDir, labelFile), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const objects = lines.flatMap((line, index) => {
    const fields = line.trim().split(/\s+/);
    const className = classMap.get(fields[0]);
    if (!className || fields.length < 15) {
      return [];
    }
    const numbers = fields.slice(1).map(Number);
    const [truncated, occluded, alpha, x1, y1, x2, y2, height, width, length, x, y, z] = numbers;
    return [{
      id: `${id}-${index}`,
      class: className,
      bbox: [x1, y1, x2 - x1, y2 - y1],
      distanceMeters: Math.hypot(x, y, z),
      forwardDistanceMeters: z,
      dimensionsMeters: { height, width, length },
      attributes: { truncated, occluded, alpha },
    }];
  });
  let calibration = null;
  if (calibrationDir) {
    try {
      calibration = parseCalibration(await readFile(join(calibrationDir, labelFile), "utf8"));
    } catch {
      calibration = null;
    }
  }
  images.push({
    id,
    file: join(imagesDir, `${id}.png`),
    calibration,
    objects,
  });
}

await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  source: "KITTI",
  labelsPath: labelsDir,
  images,
}, null, 2)}\n`);
console.log(`Imported ${images.length} KITTI frames to ${outputPath}`);
