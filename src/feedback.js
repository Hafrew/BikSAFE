import {
  AUDIO_PROFILES,
  FEEDBACK_INTERVALS,
  HAPTIC_PATTERNS,
  SYSTEM_FAULT_INTERVAL_MS,
} from "./config.js";

function getSeverity(zone) {
  return { CLEAR: 0, FAR: 1, MEDIUM: 2, CLOSE: 3 }[zone] ?? 0;
}

export class FeedbackController {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus;
    this.audioCtx = null;
    this.soundEnabled = true;
    this.hapticsEnabled = typeof navigator.vibrate === "function";
    this.supportsHaptics = this.hapticsEnabled;
    this.lastZone = "CLEAR";
    this.lastAlertAt = 0;
    this.lastHapticAt = 0;
    this.lastSystemFaultAt = 0;
    this.systemFaultActive = false;
    this.lastStatusKey = "";
  }

  async prime() {
    if (!window.AudioContext && !window.webkitAudioContext) {
      this.emitStatus(
        "audio-unsupported",
        "degraded",
        "Audio alerts are not supported in this browser.",
      );
      return false;
    }

    try {
      if (!this.audioCtx) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContextCtor();
      }

      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }

      this.emitStatus("audio-ready", "ready", "Audio alerts ready.");
      return true;
    } catch (error) {
      this.emitStatus(
        "audio-failed",
        "degraded",
        "Audio alerts could not be started.",
        error,
      );
      return false;
    }
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
    if (!enabled) {
      this.lastAlertAt = 0;
    }
  }

  setHapticsEnabled(enabled) {
    this.hapticsEnabled = this.supportsHaptics && enabled;
    if (!enabled) {
      this.lastHapticAt = 0;
    }
  }

  handleZone(zone) {
    if (zone === "CLEAR") {
      this.lastZone = "CLEAR";
      return;
    }

    const now = performance.now();
    const zoneChanged = zone !== this.lastZone;
    const upwardEscalation = getSeverity(zone) > getSeverity(this.lastZone);
    const interval = FEEDBACK_INTERVALS[zone] ?? 2000;

    if (!zoneChanged && now - this.lastAlertAt < interval) {
      return;
    }

    if (this.soundEnabled) {
      this.playTone(zone);
    }

    if (this.hapticsEnabled && (zoneChanged || zone === "CLOSE")) {
      this.vibrate(zone, now, { force: upwardEscalation });
    }

    this.lastAlertAt = now;
    this.lastZone = zone;
  }

  handleSystemFault() {
    const now = performance.now();
    const enteredFault = !this.systemFaultActive;
    this.systemFaultActive = true;
    this.lastZone = "CLEAR";

    if (!enteredFault && now - this.lastSystemFaultAt < SYSTEM_FAULT_INTERVAL_MS) {
      return;
    }

    if (this.soundEnabled) {
      this.playTone("SYSTEM_FAULT");
    }

    if (this.hapticsEnabled) {
      this.vibrate("SYSTEM_FAULT", now, { force: enteredFault });
    }

    this.lastSystemFaultAt = now;
  }

  clearSystemFault() {
    this.systemFaultActive = false;
  }

  playTone(zone) {
    const profile = AUDIO_PROFILES[zone];
    if (!profile || !this.audioCtx) {
      if (this.soundEnabled) {
        this.emitStatus(
          "audio-not-ready",
          "degraded",
          "Audio alerts are not primed yet.",
        );
      }
      return;
    }

    try {
      const oscillator = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      oscillator.type = profile.type;
      oscillator.frequency.value = profile.frequency;
      gain.gain.setValueAtTime(profile.gain, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + profile.duration);

      oscillator.connect(gain);
      gain.connect(this.audioCtx.destination);

      oscillator.start();
      oscillator.stop(this.audioCtx.currentTime + profile.duration);
    } catch (error) {
      this.emitStatus(
        "audio-failed",
        "degraded",
        "Audio alert playback failed.",
        error,
      );
    }
  }

  vibrate(zone, now, { force = false } = {}) {
    if (!this.supportsHaptics || (!force && now - this.lastHapticAt < 800)) {
      return;
    }

    navigator.vibrate(HAPTIC_PATTERNS[zone] ?? HAPTIC_PATTERNS.FAR);
    this.lastHapticAt = now;
  }

  emitStatus(code, state, message, error = null) {
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
      updatedAt: performance.now(),
    });
  }
}
