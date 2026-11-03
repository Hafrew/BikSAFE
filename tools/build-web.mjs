import { cp, copyFile, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outDir = join(root, "dist", "app");

const files = [
  "index.html",
  "styles.css",
  "sw.js",
  "privacy.html",
  "manifest.webmanifest",
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of files) {
  await copyFile(join(root, file), join(outDir, file));
}

await cp(join(root, "src"), join(outDir, "src"), { recursive: true });
const browserTools = [
  "index.html", "public-eval.html", "public-eval.js", "evaluation-transforms.js",
  "backend-benchmark.html", "backend-benchmark.js", "worker-smoke.html", "worker-smoke.js",
];
await mkdir(join(outDir, "tools"), { recursive: true });
for (const file of browserTools) {
  await copyFile(join(root, "tools", file), join(outDir, "tools", file));
}

async function sourcePaths(directory) {
  const entries = await readdir(join(outDir, directory), { withFileTypes: true });
  const paths = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourcePaths(path) : [path];
  }));
  return paths.flat();
}
const artifacts = {};
for (const path of [...files, ...await sourcePaths("src"), ...await sourcePaths("tools")].sort()) {
  artifacts[path] = createHash("sha256").update(await readFile(join(outDir, path))).digest("hex");
}
const fingerprint = createHash("sha256").update(JSON.stringify(artifacts)).digest("hex");
await writeFile(join(outDir, "build-manifest.json"), JSON.stringify({
  schemaVersion: 1,
  fingerprint,
  artifacts,
  externalModelWeightsHashed: false,
}, null, 2));

console.log(`Built web assets in ${outDir}`);
console.log(`Source fingerprint: ${fingerprint}`);
