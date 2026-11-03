import { CAMERA_MODES, ZONE_STYLES } from "./config.js";

const BLOCKING_HEALTH_STATES = new Set(["RECOVERING", "UNSAFE"]);

function formatMeters(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return value >= 10 ? `${value.toFixed(0)}m` : `${value.toFixed(1)}m`;
}

function formatLatency(latencyMs) {
  return latencyMs > 0 ? `${Math.round(latencyMs)}ms` : "--";
}

function formatRate(rate) {
  return Number.isFinite(rate) && rate > 0 ? rate.toFixed(1) : "--";
}

export class HudController {
  constructor() {
    this.refs = {
      loading: document.getElementById("loading"),
      loadBar: document.getElementById("load-bar"),
      loadStatus: document.getElementById("load-status"),
      permissionError: document.getElementById("permission-error"),
      errorEyebrow: document.getElementById("error-eyebrow"),
      errorTitle: document.getElementById("error-title"),
      errorMessage: document.getElementById("error-message"),
      healthBanner: document.getElementById("health-banner"),
      healthState: document.getElementById("health-state"),
      healthDetail: document.getElementById("health-detail"),
      diagnosticsDrawer: document.getElementById("diagnostics-drawer"),
      diagnosticsButton: document.getElementById("diagnostics-button"),
      diagnosticsFov: document.getElementById("diagnostics-fov"),
      controlsToggleButton: document.getElementById("controls-toggle-button"),
      controlTray: document.getElementById("control-tray"),
      rideViewButton: document.getElementById("ride-view-button"),
      visionViewButton: document.getElementById("vision-view-button"),
      cameraModeLabel: document.getElementById("camera-mode-label"),
      backendValue: document.getElementById("backend-value"),
      frontModeButton: document.getElementById("front-mode-button"),
      rearModeButton: document.getElementById("rear-mode-button"),
      rearBanner: document.getElementById("rear-banner"),
      distanceValue: document.getElementById("distance-value"),
      vehicleCount: document.getElementById("vehicle-count"),
      fpsValue: document.getElementById("fps-value"),
      latencyValue: document.getElementById("latency-value"),
      observationAgeValue: document.getElementById("observation-age-value"),
      soundButton: document.getElementById("sound-button"),
      soundButtonValue: document.getElementById("sound-button-value"),
      hapticsButton: document.getElementById("haptics-button"),
      hapticsButtonValue: document.getElementById("haptics-button-value"),
      settingsButton: document.getElementById("settings-button"),
      radarLane: document.getElementById("radar-lane"),
      radarMarkers: document.getElementById("radar-markers"),
    };
  }

  setLoading(progress, message) {
    this.refs.loading.hidden = false;
    this.refs.loading.classList.remove("is-hidden");
    this.refs.loadBar.style.width = `${progress}%`;
    this.refs.loadStatus.textContent = message;
  }

  hideLoading() {
    document.body.classList.remove("starting");
    this.refs.loading.classList.add("is-hidden");
    window.setTimeout(() => {
      this.refs.loading.hidden = true;
    }, 260);
  }

  showPermissionError() {
    this.showFatalError({
      eyebrow: "Camera access required",
      title: "Point the phone toward traffic and allow camera access.",
      message:
        "BikSAFE needs the camera to watch for cars, trucks, buses, motorcycles, and bicycles around your bike.",
    });
  }

  showFatalError({ eyebrow, title, message }) {
    this.refs.loading.hidden = true;
    this.refs.errorEyebrow.textContent = eyebrow;
    this.refs.errorTitle.textContent = title;
    this.refs.errorMessage.textContent = message;
    this.refs.permissionError.hidden = false;
  }

  setMode(mode) {
    const meta = CAMERA_MODES[mode];
    this.refs.cameraModeLabel.textContent = meta.label;
    this.refs.rearBanner.hidden = mode !== "rear";
    this.refs.frontModeButton.classList.toggle("is-active", mode === "front");
    this.refs.rearModeButton.classList.toggle("is-active", mode === "rear");
    this.refs.frontModeButton.setAttribute("aria-pressed", String(mode === "front"));
    this.refs.rearModeButton.setAttribute("aria-pressed", String(mode === "rear"));
    document.getElementById("setup-front-button").setAttribute("aria-pressed", String(mode === "front"));
    document.getElementById("setup-rear-button").setAttribute("aria-pressed", String(mode === "rear"));
    document.body.classList.toggle("rear-mode", mode === "rear");
  }

  setControlsOpen(open) {
    this.refs.controlTray.hidden = !open;
    this.refs.controlsToggleButton.classList.toggle("is-active", open);
    this.refs.controlsToggleButton.setAttribute("aria-expanded", String(open));
    this.refs.controlsToggleButton.querySelector(".action-chip__value").textContent =
      open ? "Close" : "Menu";
    document.body.classList.toggle("controls-open", open);
  }

  setViewMode(viewMode) {
    const activeView = viewMode === "vision" ? "vision" : "ride";
    document.body.dataset.view = activeView;
    this.refs.rideViewButton.classList.toggle("is-active", activeView === "ride");
    this.refs.visionViewButton.classList.toggle("is-active", activeView === "vision");
    this.refs.rideViewButton.setAttribute("aria-pressed", String(activeView === "ride"));
    this.refs.visionViewButton.setAttribute("aria-pressed", String(activeView === "vision"));
    document.getElementById("camera-view-button").setAttribute("aria-pressed", String(activeView === "vision"));
    document.getElementById("camera-view-value").textContent = activeView === "vision" ? "On" : "Off";
  }

  setPaused(paused) {
    document.body.classList.toggle("paused", paused);
    document.getElementById("pause-button").setAttribute("aria-pressed", String(paused));
    document.getElementById("pause-label").textContent = paused ? "Resume" : "Pause";
    document.getElementById("pause-symbol").textContent = paused ? "▶" : "Ⅱ";
    document.getElementById("paused-notice").hidden = !paused;
    if (paused) {
      this.radarSignature = null;
      this.refs.radarMarkers.replaceChildren();
      this.refs.radarLane.classList.add("is-blocked");
      for (const key of ["distanceValue", "vehicleCount", "fpsValue", "latencyValue", "observationAgeValue"]) {
        this.refs[key].textContent = "--";
      }
    }
  }

  setSoundEnabled(enabled) {
    this.refs.soundButton.classList.toggle("is-off", !enabled);
    this.refs.soundButtonValue.textContent = enabled ? "On" : "Off";
    this.refs.soundButton.setAttribute("aria-pressed", String(enabled));
  }

  setHapticsEnabled(enabled, supported) {
    this.refs.hapticsButton.disabled = !supported;
    this.refs.hapticsButton.classList.toggle("is-off", !enabled || !supported);
    this.refs.hapticsButtonValue.textContent = supported
      ? enabled
        ? "On"
        : "Off"
      : "N/A";
  }

  setSettingsOpen(open) {
    document.body.classList.toggle("settings-open", open);
    this.refs.settingsButton.classList.toggle("is-active", open);
  }

  setDiagnosticsOpen(open) {
    this.refs.diagnosticsDrawer.hidden = !open;
    this.refs.diagnosticsButton.classList.toggle("is-active", open);
    document.body.classList.toggle("diagnostics-open", open);
  }

  update(snapshot, { health }) {
    const blocked = Boolean(health && BLOCKING_HEALTH_STATES.has(health.state));
    const zone = blocked ? (health.state === "UNSAFE" ? "close" : "medium") : snapshot.zone.toLowerCase();
    document.body.dataset.zone = zone;
    document.documentElement.style.setProperty("--zone-color",
      (ZONE_STYLES[zone.toUpperCase()] ?? ZONE_STYLES.CLEAR).color);
    this.updateRadar(snapshot, blocked);
    this.refs.distanceValue.textContent = !blocked && snapshot.primary
      ? `≈ ${formatMeters(snapshot.primary.distanceMeters)}` : "--";
    this.refs.vehicleCount.textContent = blocked ? "--" : String(snapshot.count);
    this.refs.fpsValue.textContent = formatRate(snapshot.inferenceFps);
    this.refs.latencyValue.textContent = blocked ? "--" : formatLatency(snapshot.latencyMs);
    this.refs.observationAgeValue.textContent = formatLatency(snapshot.observationAgeMs);
    this.refs.backendValue.textContent = snapshot.backend.toUpperCase();
    this.refs.diagnosticsFov.textContent = snapshot.primary?.calibrationSource === "tuned" ? "FOV tuned" : "FOV estimated";
  }

  updateRadar(snapshot, blocked) {
    this.refs.radarLane.classList.toggle("is-blocked", blocked);
    const vehicles = blocked || snapshot.stale ? [] : (snapshot.vehicles ?? [])
      .filter((vehicle) => Number.isFinite(vehicle.distanceMeters) && vehicle.distanceMeters >= 0)
      .slice(0, 5);
    // Reuse unchanged markers instead of rebuilding the meter on each UI refresh.
    const signature = JSON.stringify(vehicles.map((vehicle) => [vehicle.id,
      Math.round(vehicle.distanceMeters * 10), vehicle.zone, vehicle.label, vehicle.id === snapshot.primary?.id]));
    if (signature === this.radarSignature) return;
    this.radarSignature = signature;
    const markers = vehicles.map((vehicle) => {
      const marker = document.createElement("span");
      marker.className = "radar-marker";
      marker.classList.toggle("is-primary", vehicle.id === snapshot.primary?.id);
      marker.style.bottom = `${Math.max(2, Math.min(98, vehicle.distanceMeters / 60 * 100))}%`;
      marker.style.setProperty("--marker-color", (ZONE_STYLES[vehicle.zone] ?? ZONE_STYLES.CLEAR).boxColor);
      marker.setAttribute("aria-label", `${vehicle.label}, approximately ${formatMeters(vehicle.distanceMeters)}`);
      const label = document.createElement("span");
      label.className = "radar-marker__label";
      label.textContent = `≈ ${formatMeters(vehicle.distanceMeters)}`;
      marker.append(label);
      return marker;
    });
    this.refs.radarMarkers.replaceChildren(...markers);
  }

  updateHealth(health) {
    const visibleIssues = health.issues.filter(
      (issue) => issue.code !== "calibration.fov",
    );
    const calibrationIssue = health.issues.find(
      (issue) => issue.code === "calibration.fov",
    );
    const isReady = visibleIssues.length === 0;

    if (calibrationIssue) {
      this.refs.diagnosticsFov.textContent = calibrationIssue.title;
    }

    this.refs.healthBanner.hidden = isReady;

    if (isReady) {
      return;
    }

    const primary = visibleIssues[0];
    this.refs.healthBanner.dataset.healthState = primary.state;
    this.refs.healthState.textContent = primary.title || primary.state;
    this.refs.healthDetail.textContent = primary.detail || health.message;
  }
}
