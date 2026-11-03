export const PUBLIC_EVAL_VARIANTS = [
  "original",
  "blur",
  "glare",
  "rain",
  "crop",
  "occlusion",
  "vibration",
];

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createDeterministicRng(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function getEvaluationTransform(variant, seed, sourceWidth, sourceHeight) {
  if (!PUBLIC_EVAL_VARIANTS.includes(variant)) {
    throw new Error(`Unknown public evaluation transform: ${variant}`);
  }
  const rng = createDeterministicRng(`${seed}:${variant}`);
  const sourceRect = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const effect = {};

  if (variant === "crop") {
    sourceRect.x = sourceWidth * 0.08;
    sourceRect.y = sourceHeight * 0.08;
    sourceRect.width = sourceWidth * 0.84;
    sourceRect.height = sourceHeight * 0.84;
  } else if (variant === "vibration") {
    const marginX = sourceWidth * 0.03;
    const marginY = sourceHeight * 0.03;
    sourceRect.x = rng() * marginX * 2;
    sourceRect.y = rng() * marginY * 2;
    sourceRect.width = sourceWidth - marginX * 2;
    sourceRect.height = sourceHeight - marginY * 2;
  } else if (variant === "glare") {
    Object.assign(effect, {
      xRatio: 0.2 + rng() * 0.6,
      yRatio: 0.08 + rng() * 0.34,
      radiusRatio: 0.2 + rng() * 0.12,
    });
  } else if (variant === "occlusion") {
    Object.assign(effect, {
      xRatio: 0.12 + rng() * 0.58,
      yRatio: 0.42 + rng() * 0.28,
      widthRatio: 0.18 + rng() * 0.12,
      heightRatio: 0.18 + rng() * 0.12,
    });
  } else if (variant === "rain") {
    effect.seed = `${seed}:rain-overlay`;
  }

  return { variant, sourceRect, effect };
}

export function canvasBoxToSource(box, transform, canvasWidth, canvasHeight) {
  const [x, y, width, height] = box;
  const { sourceRect } = transform;
  const scaleX = sourceRect.width / canvasWidth;
  const scaleY = sourceRect.height / canvasHeight;
  return [
    sourceRect.x + x * scaleX,
    sourceRect.y + y * scaleY,
    width * scaleX,
    height * scaleY,
  ];
}

export function sourceBoxToCanvas(box, transform, canvasWidth, canvasHeight) {
  const [x, y, width, height] = box;
  const { sourceRect } = transform;
  const scaleX = canvasWidth / sourceRect.width;
  const scaleY = canvasHeight / sourceRect.height;
  return [
    (x - sourceRect.x) * scaleX,
    (y - sourceRect.y) * scaleY,
    width * scaleX,
    height * scaleY,
  ];
}

export function drawEvaluationTransform(context, source, transform) {
  const { width, height } = context.canvas;
  const { sourceRect, variant, effect } = transform;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  if (variant === "blur") {
    context.filter = `blur(${Math.max(1.5, width / 320)}px)`;
  }
  context.drawImage(
    source,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    width,
    height,
  );
  context.filter = "none";

  if (variant === "glare") {
    const x = width * effect.xRatio;
    const y = height * effect.yRatio;
    const radius = Math.max(width, height) * effect.radiusRatio;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(255, 250, 218, 0.94)");
    gradient.addColorStop(0.38, "rgba(255, 238, 182, 0.48)");
    gradient.addColorStop(1, "rgba(255, 238, 182, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  } else if (variant === "rain") {
    const rng = createDeterministicRng(effect.seed);
    context.strokeStyle = "rgba(205, 231, 245, 0.48)";
    context.lineWidth = Math.max(1, width / 640);
    context.beginPath();
    for (let drop = 0; drop < 110; drop += 1) {
      const x = rng() * width;
      const y = rng() * height;
      const length = height * (0.025 + rng() * 0.045);
      context.moveTo(x, y);
      context.lineTo(x - length * 0.18, y + length);
    }
    context.stroke();
    context.fillStyle = "rgba(50, 72, 87, 0.12)";
    context.fillRect(0, 0, width, height);
  } else if (variant === "occlusion") {
    context.fillStyle = "rgba(8, 13, 18, 0.88)";
    context.fillRect(
      width * effect.xRatio,
      height * effect.yRatio,
      width * effect.widthRatio,
      height * effect.heightRatio,
    );
  }
  context.restore();
}
