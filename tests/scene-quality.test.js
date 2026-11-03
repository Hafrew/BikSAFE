import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSceneQuality } from "../src/scene-quality.js";

function solidFrame(width, height, value) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return data;
}

test("covered black frame is unusable", () => {
  const result = analyzeSceneQuality(solidFrame(8, 8, 0), 8, 8);
  assert.equal(result.state, "UNUSABLE");
});

test("flat gray frame is unusable", () => {
  const result = analyzeSceneQuality(solidFrame(8, 8, 128), 8, 8);
  assert.equal(result.state, "UNUSABLE");
});

test("high-detail balanced frame is ready", () => {
  const width = 8;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (x + y) % 2 === 0 ? 50 : 205;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  assert.equal(analyzeSceneQuality(data, width, height).state, "READY");
});
