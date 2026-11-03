import { CAMERA_MODES, FRESHNESS, MODEL_BASE, MODEL_CHOICES, EXPERIMENTAL_MODELS } from "./config.js";
import { CameraController } from "./camera.js";
import { VehicleDetector } from "./detector.js";
import { FeedbackController } from "./feedback.js";
import { OverlayRenderer } from "./overlay.js";
import {
  loadSettings,
  saveSettings,
  takeSettingsError,
  getModeCameraProfile,
  updateCalibrationSetting,
  updateCameraProfileSetting,
  updateDistanceSetting,
} from "./preferences.js";
import { HEALTH_STATES, ReliabilitySupervisor } from "./reliability.js";
import { SettingsPanelController } from "./settings-panel.js";
import { HudController } from "./ui.js";
import { WAKE_LOCK_STATES, WakeLockController } from "./wake-lock.js";
import { RuntimeDiagnostics } from "./runtime-diagnostics.js";

const CAMERA_RECOVERY_STATES = new Set(["muted", "stale", "ended", "failed"]);
const BLOCKING_HEALTH_STATES = new Set([
  HEALTH_STATES.RECOVERING,
  HEALTH_STATES.UNSAFE,
]);
const MAX_CAMERA_RECOVERY_ATTEMPTS = 5;
const CAMERA_STABILITY_PROBATION_MS = 2000;
const MODEL_CHOICE_STORAGE_KEY = "biksafe:model-choice";
const SAFETY_ACK_STORAGE_KEY = "biksafe:safety-ack-v1";

function registerOfflineCache() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("BikSAFE cache registration failed.", error);
    });
  }, { once: true });
}

function getSavedModelChoice() {
  const linkedModel = new URLSearchParams(window.location.search).get("model");
  if (MODEL_CHOICES.has(linkedModel)) return linkedModel;
  try {
    const saved = window.localStorage.getItem(MODEL_CHOICE_STORAGE_KEY);
    return MODEL_CHOICES.has(saved) ? saved : MODEL_BASE;
  } catch {
    return MODEL_BASE;
  }
}

function saveModelChoice(base) {
  try {
    window.localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, base);
  } catch {
    // The app can run without persisted preferences.
  }
}

function getSafetyAcknowledged() {
  try {
    return window.localStorage.getItem(SAFETY_ACK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveSafetyAcknowledgement() {
  try {
    window.localStorage.setItem(SAFETY_ACK_STORAGE_KEY, "true");
  } catch {
    // The acknowledgement still applies for this launch.
  }
}

class BikSAFEApp {
  constructor() {
    this.video = document.getElementById("video");
    this.overlayCanvas = document.getElementById("overlay");
    this.retryButton = document.getElementById("retry-button");
    this.startButton = document.getElementById("start-button");
    this.safetyGate = document.getElementById("safety-gate");
    this.safetyAckCheckbox = document.getElementById("safety-ack-checkbox");
    this.safetyAcceptButton = document.getElementById("safety-accept-button");
    this.modelSelect = document.getElementById("model-select");
    this.frontModeButton = document.getElementById("front-mode-button");
    this.rearModeButton = document.getElementById("rear-mode-button");
    this.settingsButton = document.getElementById("settings-button");
    this.diagnosticsButton = document.getElementById("diagnostics-button");
    this.diagnosticsCloseButton = document.getElementById("diagnostics-close-button");
    this.controlsToggleButton = document.getElementById("controls-toggle-button");
    this.rideViewButton = document.getElementById("ride-view-button");
    this.visionViewButton = document.getElementById("vision-view-button");
    this.soundButton = document.getElementById("sound-button");
    this.cameraViewButton = document.getElementById("camera-view-button");
    this.pauseButton = document.getElementById("pause-button");
    this.hapticsButton = document.getElementById("haptics-button");
    this.demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
    this.runtimeDiagnostics = new RuntimeDiagnostics();
    this.recordingTimings = false;
    this.buildManifest = null;
    fetch("./build-manifest.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((manifest) => { this.buildManifest = manifest; })
      .catch(() => { /* Source-mode development may not have a build manifest. */ });

    this.ui = new HudController();
    this.health = new ReliabilitySupervisor({
      onChange: (snapshot) => {
        this.healthSnapshot = snapshot;
        this.ui.updateHealth(snapshot);
      },
    });
    this.healthSnapshot = this.health.getSnapshot();
    this.settingsPanel = new SettingsPanelController();
    this.camera = new CameraController(this.video, {
      onStatus: (status) => this.handleCameraStatus(status),
      onFrame: (frame) => this.detector?.notifyFrame(frame),
      demoMode: this.demoMode,
    });
    this.detector = new VehicleDetector(this.video, {
      onStatus: (status) => this.handleDetectorStatus(status),
      getSourceState: () => this.camera.getSourceState(),
    });
    this.feedback = new FeedbackController({
      onStatus: (status) => this.handleFeedbackStatus(status),
    });
    this.wakeLock = new WakeLockController({
      onStatus: (status) => this.handleWakeLockStatus(status),
    });
    this.overlay = new OverlayRenderer(this.video, this.overlayCanvas);

    this.settings = loadSettings();
    this.reportSettingsError(takeSettingsError());
    this.mode = this.settings.activeMode;
    this.detector.setSettings(this.settings);

    this.running = false;
    this.paused = false;
    this.switching = false;
    this.viewMode = "ride";
    this.controlsOpen = false;
    this.settingsOpen = false;
    this.diagnosticsOpen = false;
    this.fpsFrames = 0;
    this.fpsLastAt = performance.now();
    this.fps = 0;
    this.startedAt = 0;
    this.cameraRecoveryAttempts = 0;
    this.cameraRecoveryTimer = null;
    this.cameraStabilityTimer = null;
    this.lastRenderedSequence = -1;
    this.lastRenderedHealthAt = -1;
    this.lastRenderedFps = -1;
  }

  bindEvents() {
    const helpPage = document.getElementById("help-page");
    helpPage.addEventListener("close", () => {
      document.getElementById(this.running ? "controls-toggle-button" : "home-help-button").focus();
    });
    for (const id of ["home-help-button", "ride-help-button"]) {
      document.getElementById(id).addEventListener("click", () => {
        this.setControlsOpen(false);
        if (!helpPage.open) helpPage.showModal();
      });
    }
    document.getElementById("end-ride-button").addEventListener("click", () => {
      if (!this.running) return;
      this.running = false;
      this.detector.pause();
      window.clearTimeout(this.cameraRecoveryTimer);
      window.clearTimeout(this.cameraStabilityTimer);
      this.camera.stop();
      this.overlay.clear();
      this.wakeLock.stop();
      if (this.feedback.audioCtx?.state !== "closed") {
        void this.feedback.audioCtx?.close().catch(() => {});
      }
      if (this.feedback.supportsHaptics) navigator.vibrate(0);
      window.location.reload();
    });
    const setSetupDirection = (mode) => {
      this.mode = mode;
      this.settings.activeMode = mode;
      this.persistSettings();
      this.applyModeState();
      this.renderSettingsPanel();
    };
    document.getElementById("setup-front-button").addEventListener("click", () => setSetupDirection("front"));
    document.getElementById("setup-rear-button").addEventListener("click", () => setSetupDirection("rear"));
    this.cameraViewButton.addEventListener("click", () => {
      this.setViewMode(this.viewMode === "ride" ? "vision" : "ride");
    });
    this.pauseButton.addEventListener("click", () => this.setPaused(!this.paused));
    document.getElementById("record-timings-button")?.addEventListener("click", (event) => {
      this.runtimeDiagnostics = new RuntimeDiagnostics();
      this.recordingTimings = true;
      event.currentTarget.textContent = "Restart recording";
      document.getElementById("export-timings-button").disabled = false;
    });
    document.getElementById("export-timings-button")?.addEventListener("click", () => {
      const report = this.runtimeDiagnostics.export({
        userAgent: navigator.userAgent,
        syntheticCamera: this.demoMode,
        tfjsVersion: window.tf?.version?.tfjs ?? "unavailable",
        cocoSsdVersion: "2.2.3",
        inferenceCountersSinceLaunch: { ...this.detector.inferenceCounters },
        healthStateAtExport: this.health.getSnapshot().state,
        buildFingerprint: this.buildManifest?.fingerprint ?? "unavailable-in-source-mode",
        externalModelWeightsHashed: this.buildManifest?.externalModelWeightsHashed ?? false,
        requestedModel: this.detector.requestedModelBase,
        activeModel: this.detector.modelBase,
        activeRuntime: this.detector.model?.runtimeInfo ?? { runtime: "TensorFlow.js", version: "4.17.0", model: "COCO-SSD 2.2.3" },
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "biksafe-runtime-diagnostics.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    this.retryButton.addEventListener("click", () => {
      window.location.reload();
    });

    this.safetyAckCheckbox?.addEventListener("change", () => {
      if (this.safetyAcceptButton) {
        this.safetyAcceptButton.disabled = !this.safetyAckCheckbox.checked;
      }
    });

    this.frontModeButton.addEventListener("click", () => {
      void this.switchMode("front");
    });
    this.rearModeButton.addEventListener("click", () => {
      void this.switchMode("rear");
    });

    this.controlsToggleButton.addEventListener("click", () => {
      this.setControlsOpen(!this.controlsOpen);
    });

    this.rideViewButton.addEventListener("click", () => {
      this.setViewMode("ride");
    });
    this.visionViewButton.addEventListener("click", () => {
      this.setViewMode("vision");
    });

    this.soundButton.addEventListener("click", async () => {
      await this.feedback.prime();
      this.feedback.setSoundEnabled(!this.feedback.soundEnabled);
      this.ui.setSoundEnabled(this.feedback.soundEnabled);
    });

    this.hapticsButton.addEventListener("click", () => {
      this.feedback.setHapticsEnabled(!this.feedback.hapticsEnabled);
      this.ui.setHapticsEnabled(
        this.feedback.hapticsEnabled,
        this.feedback.supportsHaptics,
      );
    });

    this.modelSelect?.addEventListener("change", () => {
      if (MODEL_CHOICES.has(this.modelSelect.value)) {
        saveModelChoice(this.modelSelect.value);
      }
    });

    this.settingsButton.addEventListener("click", () => {
      this.setSettingsOpen(true);
    });

    this.diagnosticsButton.addEventListener("click", () => {
      this.setDiagnosticsOpen(!this.diagnosticsOpen);
    });
    this.diagnosticsCloseButton.addEventListener("click", () => {
      this.setDiagnosticsOpen(false);
    });

    this.settingsPanel.bind({
      onClose: () => this.setSettingsOpen(false),
      onThresholdChange: (mode, key, value) => {
        this.settings = updateDistanceSetting(this.settings, mode, key, value);
        this.persistSettings();
        this.applySettings();
      },
      onCarLengthChange: (key, value) => {
        this.settings = updateCalibrationSetting(this.settings, key, value);
        this.persistSettings();
        this.applySettings();
      },
      onFovChange: (mode, value) => {
        this.settings = updateCameraProfileSetting(
          this.settings,
          mode,
          "horizontalFovDegrees",
          value,
        );
        this.persistSettings();
        this.applySettings();
      },
    });

    document.addEventListener(
      "pointerdown",
      async () => {
        await this.feedback.prime();
      },
      { once: true },
    );

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.settingsOpen) {
        this.setSettingsOpen(false);
      } else if (event.key === "Escape" && this.diagnosticsOpen) {
        this.setDiagnosticsOpen(false);
      } else if (event.key === "Escape" && this.controlsOpen) {
        this.setControlsOpen(false);
      }
    });

    window.addEventListener("resize", () => {
      this.overlay.resize();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.feedback.lastZone = "CLEAR";
        this.detector.pause();
        this.health.report("lifecycle.hidden", {
          state: HEALTH_STATES.RECOVERING,
          title: "Vision paused",
          detail: "BikSafe is waiting for fresh camera frames.",
          subsystem: "lifecycle",
        });
      } else {
        this.health.clear("lifecycle.hidden");
        if (this.running && !this.paused && this.camera.isLive()) {
          this.detector.start();
        }
      }
    });

    window.addEventListener("error", (event) => {
      this.reportRuntimeFault(event.error || event.message);
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.reportRuntimeFault(event.reason);
    });
  }

  waitForSafetyAcknowledgement() {
    if (!this.safetyGate || !this.safetyAcceptButton || getSafetyAcknowledged()) {
      if (this.safetyGate) {
        this.safetyGate.hidden = true;
      }
      return Promise.resolve();
    }

    this.safetyGate.hidden = false;
    this.safetyGate.classList.remove("is-hidden");
    if (this.safetyAckCheckbox) {
      this.safetyAckCheckbox.checked = false;
    }
    this.safetyAcceptButton.disabled = true;

    return new Promise((resolve) => {
      this.safetyAcceptButton.addEventListener("click", () => {
        saveSafetyAcknowledgement();
        this.safetyGate.classList.add("is-hidden");
        window.setTimeout(() => {
          this.safetyGate.hidden = true;
          resolve();
        }, 260);
      }, { once: true });
    });
  }

  waitForModelChoice() {
    const savedChoice = getSavedModelChoice();

    if (!this.modelSelect || !this.startButton) {
      return Promise.resolve(savedChoice);
    }

    this.modelSelect.value = savedChoice;
    document.getElementById("advanced-setup").open = EXPERIMENTAL_MODELS.has(savedChoice);
    const updateModelNote = () => {
      const note = document.getElementById("model-note");
      if (!note) return;
      note.textContent = this.modelSelect.value === "rfdetr_nano"
        ? "Experimental: about 56 MB on first use. iPhone performance and accuracy are untested."
        : EXPERIMENTAL_MODELS.has(this.modelSelect.value)
          ? "Experimental: iPhone performance and accuracy are untested. Model downloads on first use."
          : "COCO baseline for comparison.";
    };
    updateModelNote();
    this.modelSelect.addEventListener("change", updateModelNote);

    return new Promise((resolve) => {
      this.startButton.addEventListener("click", () => {
        const choice = MODEL_CHOICES.has(this.modelSelect.value)
          ? this.modelSelect.value
          : MODEL_BASE;

        saveModelChoice(choice);
        document.body.classList.add("starting");
        document.getElementById("setup-front-button").disabled = true;
        document.getElementById("setup-rear-button").disabled = true;
        this.modelSelect.disabled = true;
        this.startButton.disabled = true;
        this.startButton.textContent = "Starting...";
        resolve(choice);
      }, { once: true });
      this.startButton.disabled = false;
    });
  }

  renderSettingsPanel(snapshot = this.detector.snapshot) {
    this.settingsPanel.render(this.settings, {
      mode: this.mode,
      modelLabel: snapshot.modelLabel ?? this.detector.modelLabel,
      backend: snapshot.backend ?? this.detector.backend,
    });
    document.getElementById("diagnostics-requested-model").textContent = this.detector.requestedModelBase;
    document.getElementById("diagnostics-active-model").textContent = this.detector.modelLabel;
    const runtime = this.detector.model?.runtimeInfo;
    document.getElementById("diagnostics-runtime").textContent = runtime
      ? JSON.stringify(runtime)
      : `TensorFlow.js / ${snapshot.backend ?? this.detector.backend}`;
  }

  setSettingsOpen(open) {
    if (open && this.diagnosticsOpen) this.setDiagnosticsOpen(false);
    this.settingsOpen = open;
    this.settingsPanel.setOpen(open);
    this.ui.setSettingsOpen(open);
    if (open) {
      this.setControlsOpen(false);
      this.renderSettingsPanel(this.detector.snapshot);
    }
  }

  applySettings() {
    this.detector.setSettings(this.settings);
    this.reportCalibrationHealth();
    this.renderSettingsPanel(this.detector.snapshot);
  }

  persistSettings() {
    const result = saveSettings(this.settings);
    if (result?.ok === false) {
      this.reportSettingsError({ type: "save", error: result.error });
    } else {
      this.health.clear("settings.save");
    }
  }

  setDiagnosticsOpen(open) {
    if (open && this.settingsOpen) this.setSettingsOpen(false);
    this.diagnosticsOpen = open;
    this.ui.setDiagnosticsOpen(open);
    if (open) {
      this.renderSettingsPanel();
      this.setControlsOpen(false);
    }
  }

  setControlsOpen(open) {
    this.controlsOpen = open;
    this.ui.setControlsOpen(open);
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode === "vision" ? "vision" : "ride";
    this.ui.setViewMode(this.viewMode);
    this.overlay.setViewMode(this.viewMode);
  }

  setPaused(paused) {
    if (!this.running || this.switching) return;
    this.paused = paused;
    this.setControlsOpen(false);
    this.feedback.lastZone = "CLEAR";
    this.feedback.clearSystemFault();
    this.overlay.clear();
    if (paused) {
      this.detector.pause();
      window.clearTimeout(this.cameraRecoveryTimer);
      this.cameraRecoveryTimer = null;
    } else {
      this.startedAt = performance.now();
      this.lastRenderedSequence = -1;
      if (this.camera.isLive() && !document.hidden) this.detector.start();
      else this.scheduleCameraRecovery();
    }
    this.ui.setPaused(paused);
  }

  reportSettingsError(settingsError) {
    if (!settingsError) {
      return;
    }

    this.health.report(`settings.${settingsError.type}`, {
      state: HEALTH_STATES.DEGRADED,
      title:
        settingsError.type === "load"
          ? "Settings fallback"
          : "Settings not saved",
      detail:
        settingsError.type === "load"
          ? "Saved settings could not be loaded; defaults are active."
          : "Settings changed for this session but could not be saved.",
      subsystem: "settings",
      error: settingsError.error,
    });
  }

  applyModeState() {
    const meta = CAMERA_MODES[this.mode];
    this.video.classList.toggle("mirrored", meta.mirrored);
    this.overlayCanvas.classList.toggle("mirrored", meta.mirrored);
    this.ui.setMode(this.mode);
    this.detector.setMode(this.mode);
    this.reportCalibrationHealth();
  }

  reportCalibrationHealth() {
    const profile = getModeCameraProfile(this.settings, this.mode);

    if (profile.calibrated) {
      this.health.clear("calibration.fov");
      return;
    }

    this.health.report("calibration.fov", {
      state: HEALTH_STATES.DEGRADED,
      title: "Camera FOV estimated",
      detail: "Distance margins widened until camera FOV is tuned.",
      subsystem: "calibration",
    });
  }

  handleCameraStatus(status) {
    if (status.state === "live") {
      this.detector.setSourceGeneration(status.generation);
      if (this.running && !this.paused && !document.hidden) {
        this.detector.start();
      }
      this.health.clear("camera.stream");
      this.health.clear("camera.recovery");
      window.clearTimeout(this.cameraStabilityTimer);
      const stableGeneration = status.generation;
      this.cameraStabilityTimer = window.setTimeout(() => {
        if (
          this.camera.isLive() &&
          this.camera.getSourceState().generation === stableGeneration
        ) {
          this.cameraRecoveryAttempts = 0;
        }
      }, CAMERA_STABILITY_PROBATION_MS);
      return;
    }

    window.clearTimeout(this.cameraStabilityTimer);
    this.cameraStabilityTimer = null;

    if (status.state === "starting") {
      if (this.running) {
        this.detector.pause();
        this.health.report("camera.stream", {
          state: HEALTH_STATES.RECOVERING,
          title: "Camera starting",
          detail: status.message,
          subsystem: "camera",
        });
      }
      return;
    }

    if (status.state === "stopped" && !this.running) {
      this.health.clear("camera.stream");
      return;
    }

    const state =
      status.state === "failed" && this.cameraRecoveryAttempts >= MAX_CAMERA_RECOVERY_ATTEMPTS
        ? HEALTH_STATES.UNSAFE
        : HEALTH_STATES.RECOVERING;

    if (this.running) {
      this.detector.pause();
    }

    this.health.report("camera.stream", {
      state,
      title: state === HEALTH_STATES.UNSAFE ? "Camera unavailable" : "Camera recovering",
      detail: status.message,
      subsystem: "camera",
      error: status.error,
    });

    if (this.running && CAMERA_RECOVERY_STATES.has(status.state)) {
      this.scheduleCameraRecovery();
    }
  }

  handleDetectorStatus(status) {
    if (status.state === "ready") {
      if (status.code === "backend-ready") {
        this.health.clear("detector.backend");
      } else if (status.code === "model-ready") {
        this.health.clear("detector.model");
      } else if (status.code === "inference-ready") {
        this.health.clear("detector.inference");
        this.health.clear("detector.stale");
      }
      return;
    }

    if (status.code === "backend-fallback") {
      this.health.report("detector.backend", {
        state: HEALTH_STATES.DEGRADED,
        title: "Detector backend degraded",
        detail: status.message,
        subsystem: "detector",
        error: status.error,
      });
      return;
    }

    if (status.code === "worker-fallback") {
      this.health.report("detector.worker", {
        state: HEALTH_STATES.DEGRADED,
        title: "Worker detector fallback",
        detail: status.message,
        subsystem: "detector",
        error: status.error,
      });
      return;
    }

    if (status.code === "model-fallback") {
      this.health.report("detector.model", {
        state: HEALTH_STATES.DEGRADED,
        title: "Detector model degraded",
        detail: status.message,
        subsystem: "detector",
        error: status.error,
      });
      return;
    }

    const issueCode = status.code.startsWith("inference")
      ? "detector.inference"
      : status.code.startsWith("model")
        ? "detector.model"
        : `detector.${status.code}`;

    this.health.report(issueCode, {
      state:
        status.state === "unsafe"
          ? HEALTH_STATES.UNSAFE
          : status.state === "recovering"
            ? HEALTH_STATES.RECOVERING
            : HEALTH_STATES.DEGRADED,
      title:
        status.state === "unsafe"
          ? "Detector unavailable"
          : "Detector degraded",
      detail: status.message,
      subsystem: "detector",
      error: status.error,
    });
  }

  handleWakeLockStatus(status) {
    if (status.state === WAKE_LOCK_STATES.ACTIVE) {
      this.health.clear("wake.lock");
      return;
    }

    if (status.state === WAKE_LOCK_STATES.INACTIVE && !this.running) {
      this.health.clear("wake.lock");
      return;
    }

    this.health.report("wake.lock", {
      state: HEALTH_STATES.DEGRADED,
      title: "Screen not locked awake",
      detail: status.message,
      subsystem: "wake-lock",
      error: status.error,
    });
  }

  handleFeedbackStatus(status) {
    if (status.state === "ready") {
      this.health.clear("feedback.audio");
      return;
    }

    this.health.report("feedback.audio", {
      state: HEALTH_STATES.DEGRADED,
      title: "Audio alert degraded",
      detail: status.message,
      subsystem: "feedback",
      error: status.error,
    });
  }

  reportRuntimeFault(error) {
    this.health.report("runtime.fault", {
      state: HEALTH_STATES.UNSAFE,
      title: "Runtime fault",
      detail: "A browser runtime error occurred.",
      subsystem: "runtime",
      error,
    });
  }

  scheduleCameraRecovery() {
    if (
      this.cameraRecoveryTimer ||
      this.switching ||
      this.paused ||
      !this.running ||
      this.camera.isLive()
    ) {
      return;
    }

    const delay = Math.min(5000, 500 * 2 ** this.cameraRecoveryAttempts);
    this.health.report("camera.recovery", {
      state: HEALTH_STATES.RECOVERING,
      title: "Camera recovery",
      detail: `Restarting camera in ${(delay / 1000).toFixed(1)}s.`,
      subsystem: "camera",
    });

    this.cameraRecoveryTimer = window.setTimeout(() => {
      this.cameraRecoveryTimer = null;
      void this.recoverCamera();
    }, delay);
  }

  async recoverCamera() {
    if (!this.running || this.paused || this.switching || this.camera.isLive()) {
      return;
    }

    this.cameraRecoveryAttempts += 1;

    try {
      await this.camera.start(this.mode);
      this.video.classList.add("live");
      this.health.clear("camera.recovery");
    } catch (error) {
      const exhausted = this.cameraRecoveryAttempts >= MAX_CAMERA_RECOVERY_ATTEMPTS;
      this.health.report("camera.recovery", {
        state: exhausted ? HEALTH_STATES.UNSAFE : HEALTH_STATES.RECOVERING,
        title: exhausted ? "Camera recovery failed" : "Camera recovery",
        detail: exhausted
          ? "Camera could not be restarted. Stop riding before relying on this app."
          : "Camera restart failed; retrying.",
        subsystem: "camera",
        error,
      });

      if (!exhausted) {
        this.scheduleCameraRecovery();
      }
    }
  }

  checkRuntimeHealth(now, snapshot) {
    if (!this.running || !this.camera.isLive() || !this.detector.model) {
      return;
    }

    if (snapshot.stale) {
      this.health.report("detector.stale", {
        state: HEALTH_STATES.RECOVERING,
        title: "Detector output invalid",
        detail: "Waiting for a fresh vehicle observation.",
        subsystem: "detector",
      });
      return;
    }

    if (!snapshot.updatedAt || !snapshot.sourceFrameAt) {
      if (now - this.startedAt > FRESHNESS.firstInferenceGraceMs) {
        this.health.report("detector.stale", {
          state: HEALTH_STATES.UNSAFE,
          title: "Detector stale",
          detail: "Detector has not produced a live result.",
          subsystem: "detector",
        });
      }
      return;
    }

    const sourceState = this.camera.getSourceState();
    if (snapshot.sourceGeneration !== sourceState.generation) {
      this.health.report("detector.stale", {
        state: HEALTH_STATES.RECOVERING,
        title: "Camera transition",
        detail: "Waiting for results from the active camera.",
        subsystem: "detector",
      });
      return;
    }

    const observationAgeMs = Math.max(0, now - snapshot.sourceFrameAt);
    if (observationAgeMs > FRESHNESS.unsafeFrameAgeMs) {
      this.health.report("detector.stale", {
        state: HEALTH_STATES.UNSAFE,
        title: "Detector observation expired",
        detail: `Latest trusted frame exceeded the ${FRESHNESS.unsafeFrameAgeMs} ms observation-age limit.`,
        subsystem: "detector",
      });
      return;
    }

    if (observationAgeMs > FRESHNESS.degradedFrameAgeMs) {
      this.health.report("detector.stale", {
        state: HEALTH_STATES.RECOVERING,
        title: "Detector catching up",
        detail: `Latest trusted frame exceeded the ${FRESHNESS.degradedFrameAgeMs} ms observation-age limit.`,
        subsystem: "detector",
      });
      return;
    }

    this.health.clear("detector.stale");

    if (snapshot.sceneQuality?.state === "UNUSABLE") {
      this.health.report("perception.quality", {
        state: HEALTH_STATES.RECOVERING,
        title: "Camera view unavailable",
        detail: snapshot.sceneQuality.reason,
        subsystem: "perception",
      });
      return;
    }

    if (snapshot.sceneQuality?.state === "DEGRADED") {
      this.health.report("perception.quality", {
        state: HEALTH_STATES.DEGRADED,
        title: "Camera visibility limited",
        detail: snapshot.sceneQuality.reason,
        subsystem: "perception",
      });
    } else {
      this.health.clear("perception.quality");
    }
  }

  updateFps(now) {
    this.fpsFrames += 1;

    if (now - this.fpsLastAt >= 1000) {
      this.fps = this.fpsFrames;
      this.fpsFrames = 0;
      this.fpsLastAt = now;
    }

    return this.fps;
  }

  async switchMode(nextMode) {
    if (this.switching || nextMode === this.mode) {
      return;
    }

    this.switching = true;
    this.detector.pause();
    this.health.report("camera.switch", {
      state: HEALTH_STATES.RECOVERING,
      title: "Switching camera",
      detail: "Waiting for a fresh frame from the selected camera.",
      subsystem: "camera",
    });
    this.ui.setLoading(76, `Switching to ${CAMERA_MODES[nextMode].label}...`);

    try {
      await this.camera.start(nextMode);
      this.mode = nextMode;
      this.settings.activeMode = nextMode;
      this.persistSettings();
      this.applyModeState();
      this.renderSettingsPanel(this.detector.snapshot);
      this.health.clear("camera.switch");
      this.ui.hideLoading();
    } catch (error) {
      this.health.report("camera.switch", {
        state: HEALTH_STATES.DEGRADED,
        title: "Camera switch failed",
        detail: "Continuing with the previous camera mode.",
        subsystem: "camera",
        error,
      });
      this.ui.hideLoading();
    } finally {
      this.switching = false;
      if (this.running && !this.paused && this.camera.isLive()) {
        this.detector.start();
      }
    }
  }

  loop = () => {
    if (!this.running) {
      return;
    }

    if (this.paused) {
      window.requestAnimationFrame(this.loop);
      return;
    }

    const now = performance.now();
    const snapshot = this.detector.tick(now);
    this.checkRuntimeHealth(now, snapshot);
    const health = this.health.getSnapshot();
    const fps = this.updateFps(now);
    const shouldRender =
      snapshot.sequence !== this.lastRenderedSequence ||
      health.changedAt !== this.lastRenderedHealthAt ||
      fps !== this.lastRenderedFps;

    const renderStartedAt = performance.now();
    if (shouldRender) {
      if (snapshot.stale || BLOCKING_HEALTH_STATES.has(health.state)) this.overlay.clear();
      else this.overlay.render(snapshot);
      this.ui.update(snapshot, {
        mode: this.mode,
        fps,
        health,
        viewMode: this.viewMode,
      });
      this.lastRenderedSequence = snapshot.sequence;
      this.lastRenderedHealthAt = health.changedAt;
      this.lastRenderedFps = fps;

      if (this.settingsOpen || this.diagnosticsOpen) {
        this.renderSettingsPanel(snapshot);
      }
    }

    const renderMs = performance.now() - renderStartedAt;
    const feedbackStartedAt = performance.now();
    if (BLOCKING_HEALTH_STATES.has(health.state)) {
      this.feedback.handleSystemFault();
    } else {
      this.feedback.clearSystemFault();
      this.feedback.handleZone(snapshot.zone);
    }

    if (this.recordingTimings) {
      this.runtimeDiagnostics.record(snapshot, {
        renderMs,
        feedbackHandlingMs: performance.now() - feedbackStartedAt,
        handledAt: performance.now(),
        healthState: health.state,
        mode: this.mode,
      });
    }

    window.requestAnimationFrame(this.loop);
  };

  async init() {
    registerOfflineCache();
    this.bindEvents();
    this.applyModeState();
    this.applySettings();
    if (this.demoMode) {
      this.health.report("runtime.demo", {
        state: HEALTH_STATES.DEGRADED,
        title: "Synthetic demo mode",
        detail: "Synthetic frames are active. Do not use this mode while riding.",
        subsystem: "runtime",
        recoverable: false,
      });
    }
    this.ui.setSoundEnabled(this.feedback.soundEnabled);
    this.ui.setHapticsEnabled(
      this.feedback.hapticsEnabled,
      this.feedback.supportsHaptics,
    );
    if (!this.feedback.supportsHaptics) {
      this.health.report("feedback.haptics", {
        state: HEALTH_STATES.DEGRADED,
        title: "Haptic alert unavailable",
        detail: "This browser or device does not support vibration alerts.",
        subsystem: "feedback",
      });
    }
    this.ui.setSettingsOpen(false);
    this.ui.setDiagnosticsOpen(false);
    this.setControlsOpen(false);
    this.setViewMode("ride");
    this.ui.updateHealth(this.healthSnapshot);

    this.ui.setLoading(4, "Review safety notice.");
    await this.waitForSafetyAcknowledgement();
    this.ui.setLoading(6, "Choose detection mode.");
    const selectedModel = await this.waitForModelChoice();
    this.detector.setModelPreference(selectedModel);

    this.ui.setLoading(18, "Preparing detector...");
    const modelTask = this.detector.loadModel().then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );

    this.ui.setLoading(38, "Starting camera...");
    try {
      await this.camera.start(this.mode);
    } catch (error) {
      this.health.report("camera.start", {
        state: HEALTH_STATES.UNSAFE,
        title: "Camera unavailable",
        detail: "Camera could not start.",
        subsystem: "camera",
        error,
      });
      this.ui.showFatalError({
        eyebrow: "Camera unavailable",
        title: "Camera could not start.",
        message:
          error?.message ||
          "Allow camera access and make sure no other app is using the camera.",
      });
      return;
    }

    this.video.classList.add("live");
    this.applyModeState();
    this.ui.setLoading(58, "Holding screen awake...");
    await this.wakeLock.start();
    this.ui.setLoading(70, "Loading vehicle model...");

    try {
      const modelResult = await modelTask;
      if (!modelResult.ok) {
        throw modelResult.error;
      }
    } catch (error) {
      this.health.report("detector.model", {
        state: HEALTH_STATES.UNSAFE,
        title: "Detector unavailable",
        detail: "Vehicle detector model failed to load.",
        subsystem: "detector",
        error,
      });
      this.ui.showFatalError({
        eyebrow: "Detector unavailable",
        title: "Vehicle detection could not start.",
        message:
          error?.message ||
          "Check the network connection and reload before relying on this app.",
      });
      return;
    }

    this.ui.setLoading(88, "Warming detector...");
    try {
      const warmup = await this.detector.warmUp();
      if (warmup && warmup.maxMs > FRESHNESS.unsafeFrameAgeMs) {
        this.health.report("detector.performance", {
          state: HEALTH_STATES.DEGRADED,
          title: "Detector performance limited",
          detail: `Warm-up took ${Math.round(warmup.maxMs)}ms on this device.`,
          subsystem: "detector",
        });
      } else {
        this.health.clear("detector.performance");
      }
    } catch (error) {
      this.health.report("detector.performance", {
        state: HEALTH_STATES.DEGRADED,
        title: "Detector warm-up failed",
        detail: "The first live inference may be slower than normal.",
        subsystem: "detector",
        error,
      });
    }

    this.renderSettingsPanel(this.detector.snapshot);
    this.ui.setLoading(
      100,
      this.health.getSnapshot().state === HEALTH_STATES.READY
        ? "Ready to ride."
        : "Ready with safety warnings.",
    );
    this.ui.hideLoading();

    this.startedAt = performance.now();
    this.running = true;
    this.detector.start();
    window.requestAnimationFrame(this.loop);
  }
}

const app = new BikSAFEApp();
app.init();
