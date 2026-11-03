function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function analyzeSceneQuality(rgba, width, height) {
  const pixelCount = Math.max(1, width * height);
  if (!rgba || rgba.length < pixelCount * 4) {
    return {
      state: "UNUSABLE",
      score: 0,
      reason: "Camera quality sample unavailable.",
    };
  }

  const luma = new Float32Array(pixelCount);
  let sum = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const value =
      rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722;
    luma[index] = value;
    sum += value;
  }

  const mean = sum / pixelCount;
  let varianceSum = 0;
  let gradientSum = 0;
  let gradientCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      varianceSum += (luma[index] - mean) ** 2;
      if (x > 0) {
        gradientSum += Math.abs(luma[index] - luma[index - 1]);
        gradientCount += 1;
      }
      if (y > 0) {
        gradientSum += Math.abs(luma[index] - luma[index - width]);
        gradientCount += 1;
      }
    }
  }

  const standardDeviation = Math.sqrt(varianceSum / pixelCount);
  const meanGradient = gradientCount > 0 ? gradientSum / gradientCount : 0;
  const exposureScore = clamp(1 - Math.abs(mean - 128) / 128, 0, 1);
  const contrastScore = clamp(standardDeviation / 45, 0, 1);
  const detailScore = clamp(meanGradient / 18, 0, 1);
  const score = exposureScore * 0.35 + contrastScore * 0.35 + detailScore * 0.3;

  if (mean < 12) {
    return { state: "UNUSABLE", score, mean, standardDeviation, meanGradient, reason: "Camera view is too dark or covered." };
  }
  if (mean > 243) {
    return { state: "UNUSABLE", score, mean, standardDeviation, meanGradient, reason: "Camera view is overexposed or covered." };
  }
  if (standardDeviation < 5 && meanGradient < 3) {
    return { state: "UNUSABLE", score, mean, standardDeviation, meanGradient, reason: "Camera view lacks usable scene detail." };
  }
  if (mean < 32 || mean > 226 || standardDeviation < 12 || meanGradient < 5) {
    return { state: "DEGRADED", score, mean, standardDeviation, meanGradient, reason: "Camera visibility is limited." };
  }

  return { state: "READY", score, mean, standardDeviation, meanGradient, reason: "Camera image quality is usable." };
}
