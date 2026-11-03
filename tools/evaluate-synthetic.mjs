import { deriveThreatMetrics } from "../src/threat.js";

let seed = 0x5afe2026;
function random() {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const cases = [];
for (let index = 0; index < 1000; index += 1) {
  const distance = 4 + random() * 46;
  const closingSpeed = random() * 16;
  const hits = random() > 0.2 ? 3 + Math.floor(random() * 8) : 1;
  const centerX = 260 + random() * 760;
  const width = 60 + random() * 280;
  const metrics = deriveThreatMetrics({
    bbox: [centerX - width / 2, 180, width, 160],
    frameWidth: 1280,
    effectiveDistanceMeters: distance,
    closingSpeedMps: closingSpeed,
    distanceConfidence: 0.7,
    risk: 0.25,
    zone: "FAR",
    hits,
  });
  const ttc = closingSpeed >= 0.6 ? distance / closingSpeed : null;
  const shouldEscalateDanger = hits >= 3 && ttc !== null && ttc <= 2.5;
  const singleFrameEscalated = hits < 3 && metrics.adjustedZone !== "FAR";
  cases.push({ shouldEscalateDanger, singleFrameEscalated, metrics });
}

const failures = cases.filter((entry) => (
  (entry.shouldEscalateDanger && entry.metrics.adjustedZone !== "CLOSE") ||
  entry.singleFrameEscalated ||
  entry.metrics.pathRelevance < 0.15
));
const report = {
  seed: "0x5afe2026",
  cases: cases.length,
  failures: failures.length,
  dangerEscalations: cases.filter((entry) => entry.metrics.adjustedZone === "CLOSE").length,
  warningEscalations: cases.filter((entry) => entry.metrics.adjustedZone === "MEDIUM").length,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  process.exit(1);
}
