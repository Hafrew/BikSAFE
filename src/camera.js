import { CAMERA_CONSTRAINTS, CAMERA_MODES } from "./config.js";
import { describeVideoFrame } from "./frame-timing.js";

const METADATA_TIMEOUT_MS = 3500;
const STALE_FRAME_MS = 750;
const WATCHDOG_INTERVAL_MS = 150;

export class CameraError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "CameraError";
    this.code = code;
    this.cause = cause;
  }
}

export class CameraController {
  constructor(video, { onStatus, onFrame, demoMode = false } = {}) {
    this.video = video;
    this.onStatus = onStatus;
    this.onFrame = onFrame;
    this.demoMode = demoMode;
    this.syntheticSession = null;
    this.stream = null;
    this.mode = "front";
    this.status = "stopped";
    this.statusMessage = "";
    this.lastFrameAt = 0;
    this.lastVideoTime = 0;
    this.generation = 0;
    this.frameSequence = 0;
    this.watchdogTimer = null;
    this.frameCallbackId = null;
    this.boundTrackHandlers = [];
  }

  async start(mode = "front") {
    if (this.demoMode) {
      return this.startSynthetic(mode);
    }

    const previousStream = this.stream;
    const previousMode = this.mode;
    this.emitStatus("starting", `Starting ${CAMERA_MODES[mode].label} camera.`);

    let nextStream = null;

    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: CAMERA_MODES[mode].facingMode },
          ...CAMERA_CONSTRAINTS,
        },
        audio: false,
      });

      this.unbindTrackHandlers();
      this.stream = nextStream;
      this.mode = mode;
      this.video.srcObject = nextStream;
      this.bindTrackHandlers(nextStream);
      await this.waitForMetadata();
      await this.playVideo();

      if (previousStream && previousStream !== nextStream) {
        previousStream.getTracks().forEach((track) => track.stop());
      }

      this.generation += 1;
      this.frameSequence = 0;
      this.lastFrameAt = performance.now();
      this.lastVideoTime = this.video.currentTime;
      this.startFrameWatchdog();
      this.emitStatus("live", `${CAMERA_MODES[mode].label} camera live.`);
      return nextStream;
    } catch (error) {
      this.unbindTrackHandlers();

      if (nextStream) {
        nextStream.getTracks().forEach((track) => track.stop());
      }

      if (previousStream && this.hasLiveTrack(previousStream)) {
        this.stream = previousStream;
        this.mode = previousMode;
        this.video.srcObject = previousStream;
        this.bindTrackHandlers(previousStream);
        this.startFrameWatchdog();
        this.emitStatus("live", `${CAMERA_MODES[previousMode].label} camera still live.`);
      } else {
        this.stream = null;
        this.video.srcObject = null;
        this.stopFrameWatchdog();
        this.emitStatus("failed", "Camera failed to start.", error);
      }

      throw error instanceof CameraError
        ? error
        : new CameraError("CAMERA_START_FAILED", "Camera failed to start.", error);
    }
  }

  async waitForMetadata() {
    if (this.video.readyState >= 1 && this.video.videoWidth > 0) {
      return;
    }

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(
          new CameraError(
            "CAMERA_METADATA_TIMEOUT",
            "Camera metadata did not become available in time.",
          ),
        );
      }, METADATA_TIMEOUT_MS);

      const cleanup = () => {
        window.clearTimeout(timeout);
        this.video.removeEventListener("loadedmetadata", handleLoaded);
      };

      const handleLoaded = () => {
        cleanup();
        resolve();
      };

      this.video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    });
  }

  async playVideo() {
    try {
      await this.video.play();
    } catch (error) {
      throw new CameraError(
        "CAMERA_PLAY_FAILED",
        "Camera playback was blocked or failed.",
        error,
      );
    }
  }

  bindTrackHandlers(stream) {
    this.unbindTrackHandlers();

    for (const track of stream.getVideoTracks()) {
      const handleEnded = () => {
        this.emitStatus("ended", "Camera stream ended.");
      };
      const handleMute = () => {
        this.emitStatus("muted", "Camera stream is not delivering frames.");
      };
      const handleUnmute = () => {
        this.lastFrameAt = performance.now();
        this.emitStatus("live", "Camera stream resumed.");
      };

      track.addEventListener("ended", handleEnded);
      track.addEventListener("mute", handleMute);
      track.addEventListener("unmute", handleUnmute);

      this.boundTrackHandlers.push({ track, type: "ended", handler: handleEnded });
      this.boundTrackHandlers.push({ track, type: "mute", handler: handleMute });
      this.boundTrackHandlers.push({ track, type: "unmute", handler: handleUnmute });
    }
  }

  unbindTrackHandlers() {
    this.boundTrackHandlers.forEach(({ track, type, handler }) => {
      track.removeEventListener(type, handler);
    });
    this.boundTrackHandlers = [];
  }

  startFrameWatchdog() {
    this.stopFrameWatchdog();

    if ("requestVideoFrameCallback" in this.video) {
      this.scheduleVideoFrameCallback();
    }

    this.watchdogTimer = window.setInterval(() => {
      this.updateFrameHeartbeatFromVideoTime();
      this.checkFrameFreshness();
    }, WATCHDOG_INTERVAL_MS);
  }

  scheduleVideoFrameCallback() {
    if (!this.stream || !("requestVideoFrameCallback" in this.video)) {
      return;
    }

    this.frameCallbackId = this.video.requestVideoFrameCallback((now, metadata) => {
      this.lastFrameAt = now;
      this.lastVideoTime = this.video.currentTime;
      this.emitFrame(now, metadata?.mediaTime ?? this.video.currentTime, metadata);

      if (this.status === "stale" || this.status === "muted") {
        this.emitStatus("live", "Camera frames resumed.");
      }

      this.scheduleVideoFrameCallback();
    });
  }

  updateFrameHeartbeatFromVideoTime() {
    if ("requestVideoFrameCallback" in this.video) {
      return;
    }

    if (this.video.readyState < 2) {
      return;
    }

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      this.lastFrameAt = performance.now();
      this.emitFrame(this.lastFrameAt, this.video.currentTime);

      if (this.status === "stale" || this.status === "muted") {
        this.emitStatus("live", "Camera frames resumed.");
      }
    }
  }

  checkFrameFreshness() {
    if (!this.stream || this.status === "ended" || this.status === "failed") {
      return;
    }

    const trackLive = this.hasLiveTrack(this.stream);
    if (!trackLive) {
      this.emitStatus("ended", "Camera track is no longer live.");
      return;
    }

    if (performance.now() - this.lastFrameAt > STALE_FRAME_MS) {
      this.emitStatus("stale", "Camera frames are stale.");
    }
  }

  stopFrameWatchdog() {
    if (this.watchdogTimer) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (
      this.frameCallbackId !== null &&
      "cancelVideoFrameCallback" in this.video
    ) {
      this.video.cancelVideoFrameCallback(this.frameCallbackId);
    }

    this.frameCallbackId = null;
  }

  hasLiveTrack(stream = this.stream) {
    return Boolean(
      stream?.getVideoTracks().some((track) => track.readyState === "live"),
    );
  }

  isLive() {
    return this.status === "live" && this.hasLiveTrack();
  }

  async startSynthetic(mode = "front") {
    if (typeof HTMLCanvasElement.prototype.captureStream !== "function") {
      throw new CameraError(
        "SYNTHETIC_CAMERA_UNAVAILABLE",
        "Synthetic camera streams are not supported in this browser.",
      );
    }

    const previousStream = this.stream;
    const previousSession = this.syntheticSession;
    const nextSession = this.createSyntheticSession(mode);
    let nextStream = null;
    this.emitStatus("starting", `Starting synthetic ${CAMERA_MODES[mode].label}.`);

    try {
      nextStream = nextSession.canvas.captureStream(30);
      this.unbindTrackHandlers();
      this.stream = nextStream;
      this.mode = mode;
      this.video.srcObject = nextStream;
      this.bindTrackHandlers(nextStream);
      await this.waitForMetadata();
      await this.playVideo();

      if (previousStream && previousStream !== nextStream) {
        previousStream.getTracks().forEach((track) => track.stop());
      }
      this.stopSyntheticSession(previousSession);
      this.syntheticSession = nextSession;
      this.generation += 1;
      this.frameSequence = 0;
      this.lastFrameAt = performance.now();
      this.lastVideoTime = this.video.currentTime;
      this.startFrameWatchdog();
      this.emitStatus("live", `Synthetic ${CAMERA_MODES[mode].label} live.`);
      return nextStream;
    } catch (error) {
      this.stopSyntheticSession(nextSession);
      nextStream?.getTracks().forEach((track) => track.stop());
      this.stream = previousStream ?? null;
      this.syntheticSession = previousSession ?? null;
      this.video.srcObject = previousStream ?? null;
      if (previousStream && this.hasLiveTrack(previousStream)) {
        this.bindTrackHandlers(previousStream);
        this.startFrameWatchdog();
        this.emitStatus("live", "Previous synthetic camera still live.");
      } else {
        this.stopFrameWatchdog();
        this.emitStatus("failed", "Synthetic camera failed to start.", error);
      }
      throw error instanceof CameraError
        ? error
        : new CameraError(
          "SYNTHETIC_CAMERA_START_FAILED",
          "Synthetic camera failed to start.",
          error,
        );
    }
  }

  createSyntheticSession(mode) {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d", { alpha: false });
    const session = { canvas, context, animationFrameId: null, active: true };
    const startedAt = performance.now();

    const draw = (now) => {
      if (!session.active) {
        return;
      }
      const elapsed = (now - startedAt) / 1000;
      const sky = context.createLinearGradient(0, 0, 0, canvas.height);
      sky.addColorStop(0, "#87b6cf");
      sky.addColorStop(0.48, "#d4d2bd");
      sky.addColorStop(0.49, "#4b5557");
      sky.addColorStop(1, "#171c1e");
      context.fillStyle = sky;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = "#c9b75d";
      for (let index = 0; index < 14; index += 1) {
        const y = 390 + index * 28;
        const width = 10 + index * 4;
        context.fillRect(canvas.width / 2 - width / 2, y, width, 13);
      }

      for (let index = 0; index < 80; index += 1) {
        const x = (index * 173 + Math.sin(elapsed + index) * 24) % canvas.width;
        const y = (index * 97) % canvas.height;
        const shade = 55 + (index * 37) % 150;
        context.fillStyle = `rgb(${shade}, ${Math.min(235, shade + 18)}, ${Math.min(245, shade + 28)})`;
        context.fillRect(x, y, 4 + (index % 5), 4 + ((index * 3) % 7));
      }

      context.fillStyle = mode === "rear" ? "#b85d55" : "#425d75";
      const vehicleScale = 0.85 + (Math.sin(elapsed * 0.7) + 1) * 0.2;
      const vehicleWidth = 210 * vehicleScale;
      const vehicleHeight = 105 * vehicleScale;
      const vehicleX = canvas.width / 2 - vehicleWidth / 2;
      const vehicleY = 330 - vehicleHeight / 2;
      context.fillRect(vehicleX, vehicleY, vehicleWidth, vehicleHeight);
      context.fillStyle = "#b8d8e5";
      context.fillRect(
        vehicleX + vehicleWidth * 0.2,
        vehicleY + vehicleHeight * 0.15,
        vehicleWidth * 0.6,
        vehicleHeight * 0.32,
      );
      context.fillStyle = "#101416";
      context.beginPath();
      context.arc(vehicleX + vehicleWidth * 0.22, vehicleY + vehicleHeight, 22 * vehicleScale, 0, Math.PI * 2);
      context.arc(vehicleX + vehicleWidth * 0.78, vehicleY + vehicleHeight, 22 * vehicleScale, 0, Math.PI * 2);
      context.fill();

      session.animationFrameId = window.requestAnimationFrame(draw);
    };
    session.animationFrameId = window.requestAnimationFrame(draw);
    return session;
  }

  stopSyntheticSession(session = this.syntheticSession) {
    if (!session) {
      return;
    }
    session.active = false;
    if (session.animationFrameId !== null) {
      window.cancelAnimationFrame(session.animationFrameId);
    }
    if (session === this.syntheticSession) {
      this.syntheticSession = null;
    }
  }

  emitFrame(presentedAt, mediaTime, metadata) {
    this.frameSequence += 1;
    this.onFrame?.({
      sequence: this.frameSequence,
      generation: this.generation,
      ...describeVideoFrame(presentedAt, mediaTime, metadata),
    });
  }

  getSourceState() {
    return {
      generation: this.generation,
      lastFrameAt: this.lastFrameAt,
      frameSequence: this.frameSequence,
      mode: this.mode,
      status: this.status,
    };
  }

  emitStatus(state, message, error = null) {
    if (state === this.status && message === this.statusMessage && !error) {
      return;
    }

    this.status = state;
    this.statusMessage = message;
    this.onStatus?.({
      state,
      mode: this.mode,
      message,
      error,
      lastFrameAt: this.lastFrameAt,
      generation: this.generation,
      frameSequence: this.frameSequence,
      updatedAt: performance.now(),
    });
  }

  stop() {
    if (!this.stream) {
      return;
    }

    this.stopFrameWatchdog();
    this.stopSyntheticSession();
    this.unbindTrackHandlers();
    this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.emitStatus("stopped", "Camera stopped.");
  }
}
