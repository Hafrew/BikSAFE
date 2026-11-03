const TIMING_FIELDS = [
  "preprocessMs", "modelCallMs", "trackingMs", "totalMs", "frameToResultMs",
  "callbackToSampleMs", "bitmapMs", "workerRoundTripMs", "workerModelMs", "workerPreprocessMs",
  "renderMs", "feedbackHandlingMs", "frameToHandlingMs",
];

function summarize(rows, field) {
  const values = rows.map((row) => row[field]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return { samples: 0, p50Ms: null, p95Ms: null, p99Ms: null };
  const at = (fraction) => values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
  return { samples: values.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99) };
}

export class RuntimeDiagnostics {
  constructor({ capacity = 18000 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid diagnostics capacity.");
    this.capacity = capacity;
    this.samples = [];
    this.cursor = 0;
    this.totalSamples = 0;
    this.lastResultKey = null;
  }

  record(snapshot, context = {}) {
    if (snapshot.stale || !snapshot.timings) return;
    const key = `${snapshot.sourceGeneration}:${snapshot.sourceFrameAt}:${snapshot.updatedAt}`;
    if (key === this.lastResultKey) return;
    this.lastResultKey = key;
    const row = {
      sourceFrameAt: snapshot.sourceFrameAt,
      resultAt: snapshot.updatedAt,
      sourceGeneration: snapshot.sourceGeneration,
      sourceTimestampOrigin: snapshot.sourceTimestampOrigin,
      backend: snapshot.backend,
      model: snapshot.modelLabel,
      inputSize: snapshot.inferenceSize,
      zone: snapshot.zone,
      healthState: context.healthState ?? "unrecorded",
      mode: context.mode ?? "unrecorded",
    };
    const timings = {
      ...snapshot.timings,
      renderMs: context.renderMs,
      feedbackHandlingMs: context.feedbackHandlingMs,
      frameToHandlingMs: Number.isFinite(context.handledAt)
        ? Math.max(0, context.handledAt - snapshot.sourceFrameAt) : null,
    };
    for (const field of TIMING_FIELDS) {
      row[field] = Number.isFinite(timings[field]) && timings[field] >= 0 ? timings[field] : null;
    }
    this.samples[this.cursor] = row;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.totalSamples += 1;
  }

  export(metadata = {}) {
    const rows = this.totalSamples >= this.capacity
      ? [...this.samples.slice(this.cursor), ...this.samples.slice(0, this.cursor)]
      : [...this.samples];
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      metadata,
      samplePopulation: "Published non-stale results; inspect launch attempt counters for failures and discarded results.",
      physicalAlertOnsetMeasured: false,
      totalSamples: this.totalSamples,
      discardedSamples: this.totalSamples - rows.length,
      capacity: this.capacity,
      summary: Object.fromEntries(TIMING_FIELDS.map((field) => [field, summarize(rows, field)])),
      samples: rows,
    };
  }
}
