import {
  DETECTION_CANDIDATE_LIMIT,
  DETECTION_LIMIT,
  DETECTION_MIN_SCORE,
  DISTANCE_ESTIMATION,
  FALLBACK_RISK_PROFILES,
  EXPERIMENTAL_MODELS,
  FRESHNESS,
  INFERENCE,
  MODEL_BASE,
  MODEL_CHOICES,
  MODEL_FALLBACKS,
  MODEL_LABELS,
  RANGE_FILTER,
  SCORE_THRESHOLD_BY_CLASS,
  TRACKING,
  VEHICLE_CLASSES,
  VEHICLE_DIMENSIONS_METERS,
} from "./config.js";
import {
  DEFAULT_SETTINGS,
  metersToCarLengths,
  normalizeSettings,
} from "./preferences.js";
import { deriveThreatMetrics, rankThreats } from "./threat.js";
import { analyzeSceneQuality } from "./scene-quality.js";
import { normalizeAndFilterPredictions } from "./detection-filter.js";
import { estimateRangeFromBox, getCameraFocalLengths } from "./range.js";
import { associateGlobally } from "./tracking.js";
import { resolveFrameObservation } from "./frame-timing.js";
import { CandidateInferenceEngine } from "./candidate-engine.js";
import { canUseWorkerInference, WorkerCocoInferenceEngine } from "./inference-engine.js";

const MAX_CONSECUTIVE_INFERENCE_ERRORS = 3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function intersectionOverUnion(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];

  const overlapX1 = Math.max(a[0], b[0]);
  const overlapY1 = Math.max(a[1], b[1]);
  const overlapX2 = Math.min(ax2, bx2);
  const overlapY2 = Math.min(ay2, by2);

  const overlapWidth = Math.max(0, overlapX2 - overlapX1);
  const overlapHeight = Math.max(0, overlapY2 - overlapY1);
  const overlapArea = overlapWidth * overlapHeight;

  const areaA = a[2] * a[3];
  const areaB = b[2] * b[3];
  const union = areaA + areaB - overlapArea;

  return union > 0 ? overlapArea / union : 0;
}

function getBoxCenter(bbox) {
  return {
    x: bbox[0] + bbox[2] / 2,
    y: bbox[1] + bbox[3] / 2,
  };
}

function getBoxArea(bbox) {
  return Math.max(1, bbox[2] * bbox[3]);
}

function getBoxDiagonal(bbox) {
  return Math.hypot(Math.max(1, bbox[2]), Math.max(1, bbox[3]));
}

function predictBox(track, now) {
  const velocity = track.velocity ?? [0, 0, 0, 0];
  const dt = clamp(
    (now - (track.motionAt ?? track.seenAt ?? now)) / 1000,
    0,
    TRACKING.predictionMaxDtSeconds,
  );

  return [
    track.bbox[0] + velocity[0] * dt,
    track.bbox[1] + velocity[1] * dt,
    Math.max(1, track.bbox[2] + velocity[2] * dt),
    Math.max(1, track.bbox[3] + velocity[3] * dt),
  ];
}

function scoreTrackMatch(track, detection) {
  const predicted = track.predictedBbox ?? track.bbox;
  const iou = intersectionOverUnion(predicted, detection.bbox);
  const predictedCenter = getBoxCenter(predicted);
  const detectionCenter = getBoxCenter(detection.bbox);
  const centerDistance = Math.hypot(
    predictedCenter.x - detectionCenter.x,
    predictedCenter.y - detectionCenter.y,
  );
  const centerScale = Math.max(getBoxDiagonal(predicted), getBoxDiagonal(detection.bbox));
  const centerDistanceRatio = centerDistance / centerScale;
  const centerScore = 1 - clamp(
    centerDistanceRatio / TRACKING.centerDistanceGate,
    0,
    1,
  );
  const sizeRatio =
    Math.min(getBoxArea(predicted), getBoxArea(detection.bbox)) /
    Math.max(getBoxArea(predicted), getBoxArea(detection.bbox));

  if (
    iou < TRACKING.trackIouThreshold &&
    (centerDistanceRatio > TRACKING.centerDistanceGate ||
      sizeRatio < TRACKING.sizeRatioGate)
  ) {
    return 0;
  }

  return iou * 0.54 + centerScore * 0.32 + sizeRatio * 0.14;
}

function getZoneSeverity(zone) {
  if (zone === "CLOSE") {
    return 3;
  }

  if (zone === "MEDIUM") {
    return 2;
  }

  if (zone === "FAR") {
    return 1;
  }

  return 0;
}

export class DetectorError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "DetectorError";
    this.code = code;
    this.cause = cause;
  }
}

export class VehicleDetector {
  constructor(video, { onStatus, getSourceState } = {}) {
    this.video = video;
    this.onStatus = onStatus;
    this.getSourceState = getSourceState ?? (() => ({}));
    this.model = null;
    this.modelBase = MODEL_BASE;
    this.requestedModelBase = MODEL_BASE;
    this.modelLabel = MODEL_LABELS[MODEL_BASE];
    this.modelPromise = null;
    this.workerFallbackAttempted = false;
    this.workerInferenceRequested =
      new URLSearchParams(window.location.search).get("worker") === "1";
    this.backend = "Pending";
    this.mode = "front";
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
    this.enabled = false;
    this.sessionEpoch = 0;
    this.inferenceCounters = { started: 0, published: 0, expired: 0, failed: 0, discardedSession: 0, nonAdvancing: 0 };
    this.trackingTimestampOrigin = null;
    this.trackingObservedAt = null;
    this.inferenceInFlight = false;
    this.nextInferenceAt = 0;
    this.avgInferenceMs = INFERENCE.startingIntervalMs;
    this.sourceGeneration = 0;
    this.latestFrame = null;
    this.lastProcessedFrameSequence = 0;
    this.snapshotSequence = 0;
    this.inferenceFps = 0;
    this.lastInferenceCompletedAt = 0;
    this.lastQualitySampleAt = 0;
    this.sceneQuality = {
      state: "UNKNOWN",
      score: 0,
      reason: "Waiting for a camera quality sample.",
    };
    this.snapshot = this.createEmptySnapshot();
    this.tracks = [];
    this.nextTrackId = 1;
    this.consecutiveInferenceErrors = 0;
    this.lastSuccessfulInferenceAt = 0;
    this.lastStatusKey = "";
    this.workCanvas = document.createElement("canvas");
    this.workCtx = this.workCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    this.qualityCanvas = document.createElement("canvas");
    this.qualityCanvas.width = 32;
    this.qualityCanvas.height = 18;
    this.qualityCtx = this.qualityCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
  }

  createEmptySnapshot() {
    return {
      zone: "CLEAR",
      vehicles: [],
      primary: null,
      count: 0,
      risk: 0,
      latencyMs: 0,
      observationAgeMs: 0,
      sourceFrameAt: 0,
      sourceTimestampOrigin: "unavailable",
      timings: null,
      sourceGeneration: this.sourceGeneration,
      inferenceFps: this.inferenceFps,
      sceneQuality: this.sceneQuality,
      sequence: this.snapshotSequence,
      inferenceSize: "--",
      modelLabel: this.modelLabel,
      backend: this.backend,
      thresholds: this.getModeThresholds(),
      updatedAt: 0,
      stale: true,
    };
  }

  setSettings(settings) {
    this.settings = normalizeSettings(settings);
    this.snapshotSequence += 1;
    this.snapshot = {
      ...this.snapshot,
      thresholds: this.getModeThresholds(),
      sequence: this.snapshotSequence,
    };
  }

  getModeThresholds() {
    return this.settings.distanceTuning[this.mode];
  }

  setModelPreference(base) {
    if (this.model || this.modelPromise || !MODEL_CHOICES.has(base)) {
      return;
    }

    this.modelBase = base;
    this.requestedModelBase = base;
    this.modelLabel = MODEL_LABELS[base] ?? base;
    this.snapshot = {
      ...this.snapshot,
      modelLabel: this.modelLabel,
    };
  }

  async configureBackend() {
    if (!window.tf) {
      throw new DetectorError(
        "TF_UNAVAILABLE",
        "TensorFlow.js did not load.",
      );
    }

    const failures = [];
    let selectedBackend = null;

    for (const backend of ["webgl", "cpu"]) {
      try {
        const success = await tf.setBackend(backend);
        if (success) {
          selectedBackend = backend;
          break;
        }
        failures.push({
          backend,
          error: new DetectorError(
            "TF_BACKEND_REJECTED",
            `${backend} backend was rejected by TensorFlow.js.`,
          ),
        });
      } catch (error) {
        failures.push({ backend, error });
      }
    }

    if (!selectedBackend) {
      throw new DetectorError(
        "TF_BACKEND_UNAVAILABLE",
        "No TensorFlow.js backend could start.",
        failures[0]?.error,
      );
    }

    await tf.ready();
    this.backend = (tf.getBackend && tf.getBackend()) || "Ready";

    if (failures.length > 0 && selectedBackend === "cpu") {
      this.emitStatus("backend-fallback", {
        state: "degraded",
        message: "WebGL unavailable; detector is running on CPU.",
        error: failures[0].error,
      });
    } else {
      this.emitStatus("backend-ready", {
        state: "ready",
        message: `Detector backend ready: ${this.backend}.`,
      });
    }
  }

  async loadModel() {
    if (this.model) {
      return {
        label: this.modelLabel,
        base: this.modelBase,
        backend: this.backend,
      };
    }

    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        if (EXPERIMENTAL_MODELS.has(this.modelBase)) {
          const requested = this.modelBase;
          try {
            this.emitStatus("model-loading", { state: "ready", message: `Loading ${this.modelLabel}...` });
            this.model = await CandidateInferenceEngine.create(requested);
            this.backend = `worker-${this.model.backend}`;
            this.snapshot = { ...this.snapshot, modelLabel: this.modelLabel, backend: this.backend };
            this.emitStatus("model-experimental", {
              state: "degraded", message: `${this.modelLabel}: accuracy and iPhone performance have not been validated.`,
            });
            return { label: this.modelLabel, base: this.modelBase, backend: this.backend };
          } catch (error) {
            this.model = null;
            this.modelBase = MODEL_BASE;
            this.modelLabel = MODEL_LABELS[MODEL_BASE];
            this.emitStatus("candidate-fallback", {
              state: "degraded", message: `${MODEL_LABELS[requested]} unavailable; using COCO SSD Lite.`, error,
            });
          }
        }
        const loader = window.cocoSsd;
        let useWorker = this.workerInferenceRequested && canUseWorkerInference();
        if (!useWorker) {
          await this.configureBackend();
        }

        if (!loader && !useWorker) {
          throw new DetectorError(
            "MODEL_LIBRARY_UNAVAILABLE",
            "COCO-SSD model library did not load.",
          );
        }

        const modelCandidates = [
          this.modelBase,
          ...MODEL_FALLBACKS,
        ].filter((base, index, candidates) => (
          MODEL_CHOICES.has(base) && candidates.indexOf(base) === index
        ));
        let lastError = null;

        for (const [index, base] of modelCandidates.entries()) {
          try {
            this.modelBase = base;
            this.modelLabel = MODEL_LABELS[base] ?? base;
            this.emitStatus("model-loading", {
              state: "ready",
              message: `Loading ${this.modelLabel}.`,
            });
            if (useWorker) {
              try {
                this.model = await WorkerCocoInferenceEngine.create(base);
                this.backend = `worker-${this.model.backend}`;
                this.emitStatus("backend-ready", {
                  state: "ready",
                  message: `Detector backend ready: ${this.backend}.`,
                });
              } catch (workerError) {
                useWorker = false;
                this.emitStatus("worker-fallback", {
                  state: "degraded",
                  message: "Worker inference unavailable; using the main-thread detector.",
                  error: workerError,
                });
                await this.configureBackend();
                if (!loader) {
                  throw workerError;
                }
                this.model = await loader.load({ base });
              }
            } else {
              this.model = await loader.load({ base });
            }
            break;
          } catch (error) {
            lastError = error;
            if (index < modelCandidates.length - 1) {
              const nextBase = modelCandidates[index + 1];
              const nextLabel = MODEL_LABELS[nextBase] ?? nextBase;
              this.emitStatus("model-fallback", {
                state: "degraded",
                message: `${this.modelLabel} failed; trying ${nextLabel}.`,
                error,
              });
            }
          }
        }

        if (!this.model) {
          this.emitStatus("model-failed", {
            state: "unsafe",
            message: "Vehicle detector model failed to load.",
            error: lastError,
          });
          throw new DetectorError(
            "MODEL_LOAD_FAILED",
            "Vehicle detector model failed to load.",
            lastError,
          );
        }

        this.modelLabel = MODEL_LABELS[this.modelBase] ?? this.modelBase;
        this.snapshot = {
          ...this.snapshot,
          modelLabel: this.modelLabel,
          backend: this.backend,
        };

        this.emitStatus("model-ready", {
          state: "ready",
          message: `Vehicle detector ready: ${this.modelLabel}.`,
        });

        return {
          label: this.modelLabel,
          base: this.modelBase,
          backend: this.backend,
        };
      })();
    }

    return this.modelPromise;
  }

  setMode(mode) {
    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    this.latestFrame = null;
    this.resetTracks();
  }

  setSourceGeneration(generation) {
    const nextGeneration = Number(generation);
    if (!Number.isFinite(nextGeneration) || nextGeneration === this.sourceGeneration) {
      return;
    }

    this.sourceGeneration = nextGeneration;
    this.latestFrame = null;
    this.lastProcessedFrameSequence = 0;
    this.resetTracks();
  }

  notifyFrame(frame) {
    if (!frame || frame.generation !== this.sourceGeneration) {
      return;
    }

    this.latestFrame = frame;
    const now = performance.now();
    if (this.shouldInfer(now)) {
      void this.runInference(frame);
    }
  }

  start() {
    this.enabled = true;
    if (this.shouldInfer(performance.now())) {
      void this.runInference(this.latestFrame);
    }
  }

  pause() {
    this.enabled = false;
    this.latestFrame = null;
    this.nextInferenceAt = 0;
    this.resetTracks();
  }

  async warmUp(runs = 2) {
    if (!this.model || this.video.readyState < 2 || this.video.videoWidth <= 0) {
      return null;
    }

    const durations = [];
    for (let index = 0; index < runs; index += 1) {
      const startedAt = performance.now();
      const input = this.prepareInput();
      await this.model.detect(
        input.source,
        DETECTION_CANDIDATE_LIMIT,
        DETECTION_MIN_SCORE,
        { maxSide: INFERENCE.maxSide, sourceEpoch: this.sessionEpoch },
      );
      durations.push(performance.now() - startedAt);
      this.snapshot = {
        ...this.snapshot,
        inferenceSize: this.model.lastFrameInfo?.inferenceSize ?? `${input.targetWidth}x${input.targetHeight}`,
      };
    }

    durations.sort((a, b) => a - b);
    return {
      runs: durations.length,
      medianMs: durations[Math.floor(durations.length / 2)],
      maxMs: durations.at(-1),
    };
  }

  invalidateSnapshot() {
    this.snapshotSequence += 1;
    this.snapshot = {
      ...this.snapshot,
      vehicles: [],
      primary: null,
      count: 0,
      risk: 0,
      stale: true,
      sequence: this.snapshotSequence,
    };
  }

  resetTracks() {
    this.sessionEpoch += 1;
    this.tracks = [];
    this.lastQualitySampleAt = -Infinity;
    this.trackingTimestampOrigin = null;
    this.trackingObservedAt = null;
    this.consecutiveInferenceErrors = 0;
    this.lastInferenceCompletedAt = 0;
    this.inferenceFps = 0;
    this.snapshotSequence += 1;
    this.snapshot = {
      ...this.createEmptySnapshot(),
      modelLabel: this.modelLabel,
      backend: this.backend,
      sequence: this.snapshotSequence,
    };
    this.lastSuccessfulInferenceAt = 0;
  }

  tick(now) {
    now = Math.max(now, performance.now());
    if (this.shouldInfer(now)) {
      void this.runInference(this.latestFrame);
    }

    const observationAgeMs = this.snapshot.sourceFrameAt
      ? Math.max(0, now - this.snapshot.sourceFrameAt)
      : 0;

    return {
      ...this.snapshot,
      observationAgeMs,
      thresholds: this.getModeThresholds(),
      modelLabel: this.modelLabel,
      backend: this.backend,
    };
  }

  shouldInfer(now) {
    return (
      this.model &&
      this.enabled &&
      !this.inferenceInFlight &&
      this.latestFrame &&
      this.latestFrame.sequence !== this.lastProcessedFrameSequence &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      now >= this.nextInferenceAt
    );
  }

  prepareInput() {
    const videoWidth = this.video.videoWidth || 1;
    const videoHeight = this.video.videoHeight || 1;
    if (this.model?.preprocessInWorker) {
      return { source: this.video, targetWidth: videoWidth, targetHeight: videoHeight,
        sourceWidth: videoWidth, sourceHeight: videoHeight };
    }
    const scale = Math.min(1, INFERENCE.maxSide / Math.max(videoWidth, videoHeight));
    const targetWidth = Math.max(256, Math.round(videoWidth * scale));
    const targetHeight = Math.max(256, Math.round(videoHeight * scale));

    if (
      this.workCanvas.width !== targetWidth ||
      this.workCanvas.height !== targetHeight
    ) {
      this.workCanvas.width = targetWidth;
      this.workCanvas.height = targetHeight;
    }

    this.workCtx.drawImage(this.video, 0, 0, targetWidth, targetHeight);

    const now = performance.now();
    if (now - this.lastQualitySampleAt >= 500) {
      try {
        this.qualityCtx.drawImage(
          this.workCanvas,
          0,
          0,
          this.qualityCanvas.width,
          this.qualityCanvas.height,
        );
        const sample = this.qualityCtx.getImageData(
          0,
          0,
          this.qualityCanvas.width,
          this.qualityCanvas.height,
        );
        this.sceneQuality = analyzeSceneQuality(
          sample.data,
          this.qualityCanvas.width,
          this.qualityCanvas.height,
        );
      } catch {
        this.sceneQuality = {
          state: "DEGRADED",
          score: 0,
          reason: "Camera image quality could not be measured.",
        };
      }
      this.lastQualitySampleAt = now;
    }

    return {
      source: this.workCanvas,
      targetWidth,
      targetHeight,
      sourceWidth: videoWidth,
      sourceHeight: videoHeight,
    };
  }

  async runInference(frame = this.latestFrame) {
    if (
      !frame || !this.enabled || !this.model || this.inferenceInFlight ||
      frame.generation !== this.sourceGeneration ||
      frame.sequence <= this.lastProcessedFrameSequence
    ) {
      return;
    }

    this.inferenceInFlight = true;
    this.inferenceCounters.started += 1;
    const startedAt = performance.now();
    const sourceMode = this.mode;
    const epoch = this.sessionEpoch;
    const model = this.model;
    const sourceGeneration = frame.generation;
    const observation = resolveFrameObservation(frame, startedAt, this.video.currentTime);
    const { sourceFrameAt } = observation;
    this.lastProcessedFrameSequence = frame.sequence;
    const isCurrentSession = () => (
      this.enabled && epoch === this.sessionEpoch && model === this.model &&
      sourceGeneration === this.sourceGeneration && sourceMode === this.mode &&
      sourceGeneration === this.getSourceState().generation
    );

    try {
      const input = this.prepareInput();
      const preparedAt = performance.now();
      const predictions = await model.detect(
        input.source,
        DETECTION_CANDIDATE_LIMIT,
        DETECTION_MIN_SCORE,
        { maxSide: INFERENCE.maxSide, sourceEpoch: epoch },
      );
      const modelCompletedAt = performance.now();

      if (!isCurrentSession()) {
        this.inferenceCounters.discardedSession += 1;
        return;
      }
      if (model instanceof WorkerCocoInferenceEngine) {
        this.backend = `worker-${model.backend}`;
        if (model.lastFrameInfo?.sceneQuality) this.sceneQuality = model.lastFrameInfo.sceneQuality;
      }

      if (performance.now() - sourceFrameAt > FRESHNESS.unsafeFrameAgeMs) {
        this.inferenceCounters.expired += 1;
        this.invalidateSnapshot();
        this.emitStatus("inference-expired", {
          state: "recovering",
          message: "Inference exceeded the observation-age limit; result discarded.",
        });
        return;
      }

      const normalized = this.normalizeDetections(predictions, input);
      if (
        this.trackingTimestampOrigin === observation.timestampOrigin &&
        this.trackingObservedAt !== null && sourceFrameAt <= this.trackingObservedAt
      ) {
        this.inferenceCounters.nonAdvancing += 1;
        this.invalidateSnapshot();
        this.emitStatus("inference-expired", {
          state: "recovering",
          message: "Observation time did not advance; result discarded.",
        });
        return;
      }
      if (this.trackingTimestampOrigin !== observation.timestampOrigin) {
        // Mixing capture and sampling timestamps would fabricate range velocity.
        this.tracks = [];
      }
      this.trackingTimestampOrigin = observation.timestampOrigin;
      this.trackingObservedAt = sourceFrameAt;
      const tracked = rankThreats(
        this.trackDetections(normalized, sourceFrameAt),
      ).slice(0, DETECTION_LIMIT);

      const primary = tracked[0] ?? null;
      const zone = primary?.zone ?? "CLEAR";
      const completedAt = performance.now();
      const latencyMs = Math.round(completedAt - startedAt);
      const observationAgeMs = Math.max(0, completedAt - sourceFrameAt);
      if (this.lastInferenceCompletedAt > 0) {
        const cadenceMs = Math.max(1, completedAt - this.lastInferenceCompletedAt);
        const instantFps = 1000 / cadenceMs;
        this.inferenceFps = this.inferenceFps > 0
          ? lerp(this.inferenceFps, instantFps, 0.25)
          : instantFps;
      }
      this.lastInferenceCompletedAt = completedAt;
      this.snapshotSequence += 1;

      this.snapshot = {
        zone,
        vehicles: tracked.slice(0, 5),
        primary,
        count: tracked.length,
        risk: primary?.risk ?? 0,
        latencyMs,
        observationAgeMs,
        sourceFrameAt,
        sourceTimestampOrigin: observation.timestampOrigin,
        timings: {
          preprocessMs: preparedAt - startedAt,
          modelCallMs: modelCompletedAt - preparedAt,
          trackingMs: completedAt - modelCompletedAt,
          totalMs: completedAt - startedAt,
          frameToResultMs: observationAgeMs,
          callbackToSampleMs: observation.metadataMatched === false
            ? null : Math.max(0, startedAt - (frame.callbackAt ?? frame.presentedAt ?? startedAt)),
          metadataMatched: observation.metadataMatched,
          ...model.lastTimings,
        },
        sourceGeneration,
        inferenceFps: this.inferenceFps,
        sceneQuality: this.sceneQuality,
        sequence: this.snapshotSequence,
        inferenceSize: model.lastFrameInfo?.inferenceSize ?? `${input.targetWidth}x${input.targetHeight}`,
        modelLabel: this.modelLabel,
        backend: this.backend,
        thresholds: this.getModeThresholds(),
        updatedAt: completedAt,
        stale: false,
      };
      this.inferenceCounters.published += 1;
      this.consecutiveInferenceErrors = 0;
      this.lastSuccessfulInferenceAt = completedAt;
      this.emitStatus("inference-ready", {
        state: "ready",
        message: "Detector inference healthy.",
      });
    } catch (error) {
      if (!isCurrentSession()) {
        this.inferenceCounters.discardedSession += 1;
        return;
      }
      this.inferenceCounters.failed += 1;
      this.consecutiveInferenceErrors += 1;
      this.invalidateSnapshot();

      this.emitStatus("inference-error", {
        state:
          this.consecutiveInferenceErrors >= MAX_CONSECUTIVE_INFERENCE_ERRORS
            ? "unsafe"
            : "recovering",
        message:
          this.consecutiveInferenceErrors >= MAX_CONSECUTIVE_INFERENCE_ERRORS
            ? "Detector inference is repeatedly failing."
            : "Detector inference failed; output invalidated.",
        error,
      });
      if (model instanceof WorkerCocoInferenceEngine && error.code === "WORKER_FAILED") {
        await this.recoverWorker(model, error);
      }
    } finally {
      if (epoch === this.sessionEpoch) {
        const duration = performance.now() - startedAt;
        this.avgInferenceMs = lerp(this.avgInferenceMs, duration, 0.28);
        this.nextInferenceAt = startedAt + INFERENCE.targetIntervalMs;
      }
      this.inferenceInFlight = false;

      if (this.shouldInfer(performance.now())) {
        void this.runInference(this.latestFrame);
      }
    }
  }

  async recoverWorker(failedModel, error) {
    if (this.workerFallbackAttempted) return;
    this.workerFallbackAttempted = true;
    failedModel.terminate();
    this.model = null;
    this.latestFrame = null;
    this.resetTracks();
    if (EXPERIMENTAL_MODELS.has(this.modelBase)) {
      this.modelBase = MODEL_BASE;
      this.modelLabel = MODEL_LABELS[MODEL_BASE];
    }
    this.emitStatus("worker-fallback", {
      state: "degraded",
      message: "Worker stopped; loading the main-thread detector. Waiting for fresh output.",
      error,
    });
    try {
      await this.configureBackend();
      if (!window.cocoSsd) throw new Error("Main-thread detector library is unavailable.");
      this.model = await window.cocoSsd.load({ base: this.modelBase });
      this.snapshot = { ...this.snapshot, backend: this.backend, modelLabel: this.modelLabel };
    } catch (fallbackError) {
      this.model = null;
      this.emitStatus("inference-error", {
        state: "unsafe",
        message: "Worker and main-thread recovery failed. Reload to restart detection.",
        error: fallbackError,
      });
    }
  }

  normalizeDetections(predictions, input) {
    return normalizeAndFilterPredictions(predictions, input);
  }

  trackDetections(detections, now) {
    const activeTracks = this.tracks.filter(
      (track) => now - track.seenAt <= TRACKING.trackTtlMs,
    ).map((track) => ({
      ...track,
      predictedBbox: predictBox(track, now),
    }));
    const usedTrackIds = new Set();
    const updatedTracks = [];
    const association = associateGlobally(
      activeTracks,
      detections,
      scoreTrackMatch,
      TRACKING.minAssociationScore,
    );

    for (const match of association.matches) {
      const bestTrack = activeTracks[match.trackIndex];
      const detection = detections[match.detectionIndex];
      const dt = Math.max((now - (bestTrack.seenAt ?? now)) / 1000, 0.001);
      const rawVelocity = detection.bbox.map(
          (value, index) => (value - bestTrack.bbox[index]) / dt,
      );

      bestTrack.velocity = (bestTrack.velocity ?? [0, 0, 0, 0]).map(
        (value, index) =>
          lerp(value, rawVelocity[index], TRACKING.velocitySmoothingAlpha),
      );
      bestTrack.bbox = (bestTrack.predictedBbox ?? bestTrack.bbox).map(
        (value, index) => lerp(value, detection.bbox[index], TRACKING.smoothingAlpha),
      );
      bestTrack.score = lerp(bestTrack.score, detection.score, 0.5);
      bestTrack.seenAt = now;
      bestTrack.motionAt = now;
      if (bestTrack.class === detection.class) {
        bestTrack.label = detection.label;
      }
      bestTrack.hits = (bestTrack.hits ?? 0) + 1;
      bestTrack.misses = 0;
      bestTrack.matchScore = match.score;
      usedTrackIds.add(bestTrack.id);
      updatedTracks.push(bestTrack);
    }

    for (const detectionIndex of association.unmatchedDetectionIndexes) {
      const detection = detections[detectionIndex];
      updatedTracks.push({
        id: this.nextTrackId++,
        class: detection.class,
        label: detection.label,
        bbox: [...detection.bbox],
        predictedBbox: [...detection.bbox],
        velocity: [0, 0, 0, 0],
        score: detection.score,
        seenAt: now,
        motionAt: now,
        hits: 1,
        misses: 0,
      });
    }

    const retainedTracks = activeTracks
      .filter(
        (track) =>
          !usedTrackIds.has(track.id) && now - track.seenAt <= TRACKING.holdTtlMs,
      )
      .map((track) => ({
        ...track,
        bbox: track.predictedBbox ?? track.bbox,
        score: track.score * TRACKING.retainedScoreDecay,
        misses: (track.misses ?? 0) + 1,
        motionAt: now,
      }));

    this.tracks = [...updatedTracks, ...retainedTracks];

    return this.tracks.map((track) => this.computeMetrics(track, now));
  }

  getFallbackRisk(track, frameWidth, frameHeight) {
    const [x, y, width, height] = track.bbox;
    const areaRatio = (width * height) / (frameWidth * frameHeight);
    const bottomRatio = clamp((y + height) / frameHeight, 0, 1);
    const centerRatio = clamp((x + width / 2) / frameWidth, 0, 1);
    const centerBias = 1 - clamp(Math.abs(centerRatio - 0.5) / 0.5, 0, 1);
    const threshold = SCORE_THRESHOLD_BY_CLASS[track.class] ?? 0.45;
    const confidenceScore = clamp((track.score - threshold) / (1 - threshold), 0, 1);
    const areaScore = clamp((areaRatio - 0.002) / 0.18, 0, 1);
    const bottomScore = clamp((bottomRatio - 0.35) / 0.65, 0, 1);

    const risk = clamp(
      areaScore * 0.52 +
        bottomScore * 0.22 +
        centerBias * 0.16 +
        confidenceScore * 0.1,
      0,
      1,
    );

    const thresholds = FALLBACK_RISK_PROFILES[this.mode];
    let zone = "CLEAR";

    if (risk >= thresholds.close) {
      zone = "CLOSE";
    } else if (risk >= thresholds.medium) {
      zone = "MEDIUM";
    } else if (risk >= thresholds.far) {
      zone = "FAR";
    }

    return { risk, zone, areaRatio, bottomRatio, centerBias };
  }

  getActiveCameraProfile() {
    return this.settings.calibration.cameraProfiles[this.mode];
  }

  getCalibrationConfidence(profile) {
    return profile.calibrated
      ? DISTANCE_ESTIMATION.calibratedConfidence
      : DISTANCE_ESTIMATION.estimatedConfidence;
  }

  getCameraFocalLengths(frameWidth, frameHeight, profile = this.getActiveCameraProfile()) {
    return getCameraFocalLengths(
      frameWidth,
      frameHeight,
      profile.horizontalFovDegrees,
    );
  }

  estimateRange(track, frameWidth, frameHeight) {
    const cameraProfile = this.getActiveCameraProfile();
    const distanceMeters = estimateRangeFromBox({
      className: track.class,
      bbox: track.bbox,
      frameWidth,
      frameHeight,
      horizontalFovDegrees: cameraProfile.horizontalFovDegrees,
    });

    return {
      rawDistanceMeters: clamp(
        distanceMeters,
        DISTANCE_ESTIMATION.minDistanceMeters,
        DISTANCE_ESTIMATION.maxDistanceMeters,
      ),
      calibrationConfidence: this.getCalibrationConfidence(cameraProfile),
      calibrationSource: cameraProfile.calibrated ? "tuned" : "estimated",
      horizontalFovDegrees: cameraProfile.horizontalFovDegrees,
    };
  }

  zoneCandidateFromDistance(distanceMeters, previousZone) {
    const thresholds = this.getModeThresholds();

    if (
      previousZone === "CLOSE" &&
      distanceMeters <= thresholds.dangerMeters + RANGE_FILTER.dangerExitMarginMeters
    ) {
      return "CLOSE";
    }

    if (distanceMeters <= thresholds.dangerMeters) {
      return "CLOSE";
    }

    if (
      previousZone === "MEDIUM" &&
      distanceMeters <= thresholds.warningMeters + RANGE_FILTER.warningExitMarginMeters
    ) {
      return "MEDIUM";
    }

    if (distanceMeters <= thresholds.warningMeters) {
      return "MEDIUM";
    }

    return "FAR";
  }

  applyZoneHysteresis(track, candidateZone, now) {
    const currentZone = track.zone ?? candidateZone;
    const currentSeverity = getZoneSeverity(currentZone);
    const candidateSeverity = getZoneSeverity(candidateZone);

    if (candidateSeverity >= currentSeverity) {
      track.pendingZone = null;
      track.pendingZoneSince = 0;
      return candidateZone;
    }

    if (track.pendingZone !== candidateZone) {
      track.pendingZone = candidateZone;
      track.pendingZoneSince = now;
      return currentZone;
    }

    if (now - track.pendingZoneSince >= RANGE_FILTER.downgradeHoldMs) {
      track.pendingZone = null;
      track.pendingZoneSince = 0;
      return candidateZone;
    }

    return currentZone;
  }

  riskFromDistance(distanceMeters) {
    const thresholds = this.getModeThresholds();

    if (distanceMeters <= thresholds.dangerMeters) {
      const intensity = 1 - distanceMeters / thresholds.dangerMeters;
      return clamp(0.76 + intensity * 0.24, 0.76, 1);
    }

    if (distanceMeters <= thresholds.warningMeters) {
      const span = Math.max(thresholds.warningMeters - thresholds.dangerMeters, 0.5);
      const intensity = 1 - (distanceMeters - thresholds.dangerMeters) / span;
      return clamp(0.42 + intensity * 0.3, 0.42, 0.75);
    }

    return clamp(0.14 + thresholds.warningMeters / (distanceMeters * 4), 0.14, 0.38);
  }

  updateRangeFilter(track, rawDistanceMeters, calibrationConfidence, now) {
    const previousDistance = track.distanceMeters;
    const previousVelocity = track.distanceVelocityMps ?? 0;
    const previousAt = track.distanceUpdatedAt ?? now;
    const dt = clamp(
      (now - previousAt) / 1000,
      0.001,
      TRACKING.predictionMaxDtSeconds,
    );
    const calibrated = calibrationConfidence >= DISTANCE_ESTIMATION.calibratedConfidence;
    const baseUncertainty =
      rawDistanceMeters *
      (calibrated
        ? RANGE_FILTER.calibratedUncertaintyRatio
        : RANGE_FILTER.estimatedUncertaintyRatio);

    if (!Number.isFinite(previousDistance)) {
      track.rawDistanceMeters = rawDistanceMeters;
      track.distanceMeters = rawDistanceMeters;
      track.distanceVelocityMps = 0;
      track.closingSpeedMps = 0;
      track.distanceUncertaintyMeters = baseUncertainty;
      track.distanceConfidence = clamp(calibrationConfidence, 0.2, 0.95);
      track.distanceUpdatedAt = now;
      return track;
    }

    const predictedDistance = clamp(
      previousDistance + previousVelocity * dt,
      DISTANCE_ESTIMATION.minDistanceMeters,
      DISTANCE_ESTIMATION.maxDistanceMeters,
    );
    const residual = rawDistanceMeters - predictedDistance;
    const alpha = clamp(
      RANGE_FILTER.distanceAlphaMin +
        Math.abs(residual) * RANGE_FILTER.distanceResidualScale,
      RANGE_FILTER.distanceAlphaMin,
      RANGE_FILTER.distanceAlphaMax,
    );
    const smoothedDistance = clamp(
      predictedDistance + residual * alpha,
      DISTANCE_ESTIMATION.minDistanceMeters,
      DISTANCE_ESTIMATION.maxDistanceMeters,
    );
    const rawVelocity = (smoothedDistance - previousDistance) / dt;
    const velocity = lerp(previousVelocity, rawVelocity, RANGE_FILTER.velocityAlpha);
    const nextUncertainty =
      baseUncertainty + Math.abs(residual) * RANGE_FILTER.residualUncertaintyWeight;
    const uncertainty = lerp(
      track.distanceUncertaintyMeters ?? nextUncertainty,
      nextUncertainty,
      RANGE_FILTER.uncertaintyAlpha,
    );
    const confidencePenalty = clamp(
      (uncertainty / Math.max(smoothedDistance, 1)) * 0.72,
      0,
      0.5,
    );

    track.rawDistanceMeters = rawDistanceMeters;
    track.distanceMeters = smoothedDistance;
    track.distanceVelocityMps = velocity;
    track.closingSpeedMps = Math.max(0, -velocity);
    track.distanceUncertaintyMeters = uncertainty;
    track.distanceConfidence = clamp(
      calibrationConfidence - confidencePenalty,
      0.2,
      0.95,
    );
    track.distanceUpdatedAt = now;
    return track;
  }

  computeMetrics(track, now) {
    const frameWidth = this.video.videoWidth || 1;
    const frameHeight = this.video.videoHeight || 1;
    const fallback = this.getFallbackRisk(track, frameWidth, frameHeight);
    const range = this.estimateRange(track, frameWidth, frameHeight);
    this.updateRangeFilter(
      track,
      range.rawDistanceMeters,
      range.calibrationConfidence,
      now,
    );

    const effectiveDistanceMeters = clamp(
      track.distanceMeters -
        track.distanceUncertaintyMeters * RANGE_FILTER.conservativeUncertaintyWeight,
      DISTANCE_ESTIMATION.minDistanceMeters,
      DISTANCE_ESTIMATION.maxDistanceMeters,
    );
    const distanceCarLengths = metersToCarLengths(track.distanceMeters, this.settings);
    const candidateZone = Number.isFinite(track.distanceMeters)
      ? this.zoneCandidateFromDistance(effectiveDistanceMeters, track.zone)
      : fallback.zone;
    const distanceZone = Number.isFinite(track.distanceMeters)
      ? this.applyZoneHysteresis(track, candidateZone, now)
      : fallback.zone;
    const distanceRisk = Number.isFinite(track.distanceMeters)
      ? this.riskFromDistance(effectiveDistanceMeters)
      : fallback.risk;
    const threat = deriveThreatMetrics({
      bbox: track.bbox,
      frameWidth,
      effectiveDistanceMeters,
      closingSpeedMps: track.closingSpeedMps,
      distanceConfidence: track.distanceConfidence,
      risk: distanceRisk,
      zone: distanceZone,
      hits: track.hits,
    });
    const risk = Math.max(distanceRisk, threat.ttcRisk * 0.9);

    Object.assign(track, {
      ...fallback,
      rawDistanceMeters: range.rawDistanceMeters,
      distanceMeters: track.distanceMeters,
      distanceCarLengths,
      effectiveDistanceMeters,
      distanceVelocityMps: track.distanceVelocityMps,
      closingSpeedMps: track.closingSpeedMps,
      distanceUncertaintyMeters: track.distanceUncertaintyMeters,
      distanceConfidence: track.distanceConfidence,
      calibrationSource: range.calibrationSource,
      horizontalFovDegrees: range.horizontalFovDegrees,
      risk,
      zone: threat.adjustedZone,
      timeToCollisionSeconds: threat.timeToCollisionSeconds,
      pathRelevance: threat.pathRelevance,
      ttcRisk: threat.ttcRisk,
      threatScore: threat.threatScore,
    });

    return { ...track };
  }

  emitStatus(code, { state, message, error = null }) {
    const key = `${code}|${state}|${message}|${error?.message || error?.name || ""}`;
    if (key === this.lastStatusKey) {
      return;
    }

    this.lastStatusKey = key;
    this.onStatus?.({
      code,
      state,
      message,
      error,
      consecutiveInferenceErrors: this.consecutiveInferenceErrors,
      lastSuccessfulInferenceAt: this.lastSuccessfulInferenceAt,
      updatedAt: performance.now(),
    });
  }
}
