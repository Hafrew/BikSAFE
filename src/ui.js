import { CAMERA_MODES, ZONE_STYLES } from "./config.js";

const BLOCKING_HEALTH_STATES = new Set(["RECOVERING", "UNSAFE"]);
const RADAR_MAX_DISTANCE_METERS = 60;

function formatMeters(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return value >= 10 ? `${value.toFixed(0)}m` : `${value.toFixed(1)}m`;
}

function formatCarLengths(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${value.toFixed(1)} cars`;
}

function formatLatency(latencyMs) {
  return latencyMs > 0 ? `${latencyMs}ms` : "--";
}

function buildThreatDetail(snapshot, mode) {
  if (!snapshot.primary) {
    return mode === "rear" ? "Watching rear" : "Watching road";
  }

  const subject = snapshot.primary.label;
  const direction = CAMERA_MODES[mode].directionLabel;
  const closingSpeed = snapshot.primary.closingSpeedMps;

  if (Number.isFinite(closingSpeed) && closingSpeed > 1.2) {
    return `${subject} ${direction} / closing`;
  }

  return `${subject} ${direction}`;
}

function buildStatusMessage(snapshot, mode, thresholds) {
  if (!snapshot.primary) {
    return `Danger under ${formatMeters(thresholds.dangerMeters)}. Warning under ${formatMeters(thresholds.warningMeters)} in ${mode} mode.`;
  }

  const label = ZONE_STYLES[snapshot.zone]?.displayLabel ?? snapshot.zone;
  const direction = CAMERA_MODES[mode].directionLabel;
  return `${label}. ${snapshot.primary.label} ${direction} at about ${formatMeters(snapshot.primary.distanceMeters)}.`;
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
      radarLane: document.getElementById("radar-lane"),
      radarMarkers: document.getElementById("radar-markers"),
      zoneContext: document.getElementById("zone-context"),
      zoneValue: document.getElementById("zone-value"),
      heroDistance: document.getElementById("hero-distance"),
      threatDetail: document.getElementById("threat-detail"),
      riskFill: document.getElementById("risk-fill"),
      heroThresholds: document.getElementById("hero-thresholds"),
      rearBanner: document.getElementById("rear-banner"),
      distanceValue: document.getElementById("distance-value"),
      vehicleCount: document.getElementById("vehicle-count"),
      fpsValue: document.getElementById("fps-value"),
      latencyValue: document.getElementById("latency-value"),
      soundButton: document.getElementById("sound-button"),
      soundButtonValue: document.getElementById("sound-button-value"),
      hapticsButton: document.getElementById("haptics-button"),
      hapticsButtonValue: document.getElementById("haptics-button-value"),
      statusMessage: document.getElementById("status-message"),
      settingsButton: document.getElementById("settings-button"),
    };
  }

  setLoading(progress, message) {
    this.refs.loading.hidden = false;
    this.refs.loading.classList.remove("is-hidden");
    this.refs.loadBar.style.width = `${progress}%`;
    this.refs.loadStatus.textContent = message;
  }

  hideLoading() {
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
    this.refs.zoneContext.textContent = meta.zoneLabel;
    this.refs.rearBanner.hidden = mode !== "rear";
    this.refs.frontModeButton.classList.toggle("is-active", mode === "front");
    this.refs.rearModeButton.classList.toggle("is-active", mode === "rear");
    document.body.classList.toggle("rear-mode", mode === "rear");
  }

  setControlsOpen(open) {
    this.refs.controlTray.hidden = !open;
    this.refs.controlsToggleButton.classList.toggle("is-active", open);
    this.refs.controlsToggleButton.setAttribute("aria-expanded", String(open));
    this.refs.controlsToggleButton.querySelector(".action-chip__value").textContent =
      open ? "Close" : "Open";
    document.body.classList.toggle("controls-open", open);
  }

  setViewMode(viewMode) {
    const activeView = viewMode === "vision" ? "vision" : "ride";
    document.body.dataset.view = activeView;
    this.refs.rideViewButton.classList.toggle("is-active", activeView === "ride");
    this.refs.visionViewButton.classList.toggle("is-active", activeView === "vision");
  }

  setSoundEnabled(enabled) {
    this.refs.soundButton.classList.toggle("is-off", !enabled);
    this.refs.soundButtonValue.textContent = enabled ? "On" : "Off";
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

  update(snapshot, { mode, fps, health, viewMode }) {
    const style = ZONE_STYLES[snapshot.zone] ?? ZONE_STYLES.CLEAR;
    const thresholds = snapshot.thresholds;
    const healthBlocksVision = health && BLOCKING_HEALTH_STATES.has(health.state);

    this.updateRadar(snapshot, {
      healthBlocksVision,
      mode,
      viewMode,
    });

    document.body.dataset.zone = healthBlocksVision
      ? health.state === "UNSAFE"
        ? "close"
        : "medium"
      : snapshot.zone.toLowerCase();
    document.documentElement.style.setProperty(
      "--zone-color",
      healthBlocksVision
        ? health.state === "UNSAFE"
          ? ZONE_STYLES.CLOSE.color
          : ZONE_STYLES.MEDIUM.color
        : style.color,
    );

    if (healthBlocksVision) {
      this.refs.zoneValue.textContent =
        health.state === "UNSAFE" ? "UNSAFE" : "RECOVER";
      this.refs.heroDistance.textContent = "--";
      this.refs.threatDetail.textContent = health.message;
      this.refs.heroThresholds.textContent =
        "Do not rely on vehicle detection until recovery completes.";
      this.refs.distanceValue.textContent = "--";
      this.refs.vehicleCount.textContent = "--";
      this.refs.fpsValue.textContent = fps > 0 ? String(fps) : "--";
      this.refs.latencyValue.textContent = "--";
      this.refs.backendValue.textContent = snapshot.backend.toUpperCase();
      this.refs.statusMessage.textContent = health.message;
      this.refs.riskFill.style.transform =
        health.state === "UNSAFE" ? "scaleX(1)" : "scaleX(0.62)";
      return;
    }

    this.refs.zoneValue.textContent = style.displayLabel;
    this.refs.heroDistance.textContent = snapshot.primary
      ? formatMeters(snapshot.primary.distanceMeters)
      : "--";
    this.refs.threatDetail.textContent = buildThreatDetail(snapshot, mode);
    this.refs.heroThresholds.textContent =
      `Warning under ${formatMeters(thresholds.warningMeters)}. Danger under ${formatMeters(thresholds.dangerMeters)}.`;
    this.refs.distanceValue.textContent = snapshot.primary
      ? formatMeters(snapshot.primary.distanceMeters)
      : "--";
    this.refs.vehicleCount.textContent = String(snapshot.count);
    this.refs.fpsValue.textContent = fps > 0 ? String(fps) : "--";
    this.refs.latencyValue.textContent = formatLatency(snapshot.latencyMs);
    this.refs.backendValue.textContent = snapshot.backend.toUpperCase();
    this.refs.statusMessage.textContent = buildStatusMessage(snapshot, mode, thresholds);
    this.refs.riskFill.style.transform = `scaleX(${Math.max(snapshot.risk, 0.03)})`;

    const calibrationSource = snapshot.primary?.calibrationSource;
    this.refs.diagnosticsFov.textContent =
      calibrationSource === "tuned" ? "FOV tuned" : "FOV estimated";
  }

  updateRadar(snapshot, { healthBlocksVision }) {
    const markerHtml = (snapshot.vehicles ?? [])
      .slice(0, 5)
      .map((vehicle) => {
        const distance = Number(vehicle.distanceMeters);
        const safeDistance = Number.isFinite(distance)
          ? Math.max(0, Math.min(distance, RADAR_MAX_DISTANCE_METERS))
          : RADAR_MAX_DISTANCE_METERS;
        const bottom = Math.max(
          6,
          Math.min(94, 100 - (safeDistance / RADAR_MAX_DISTANCE_METERS) * 88),
        );
        const style = ZONE_STYLES[vehicle.zone] ?? ZONE_STYLES.CLEAR;
        const isPrimary = snapshot.primary?.id === vehicle.id;
        const shape = vehicle.class === "truck" || vehicle.class === "bus"
          ? "large"
          : vehicle.class === "motorcycle" || vehicle.class === "bicycle"
            ? "narrow"
            : "standard";
        const label = Number.isFinite(distance) ? formatMeters(distance) : vehicle.label;

        return `
          <span
            class="radar-marker radar-marker--${shape}${isPrimary ? " is-primary" : ""}"
            style="--marker-bottom: ${bottom}%; --marker-color: ${style.boxColor};"
            aria-label="${vehicle.label} ${label}"
          >
            <span class="radar-marker__label">${label}</span>
          </span>
        `;
      })
      .join("");

    this.refs.radarMarkers.innerHTML = markerHtml;
    this.refs.radarLane.classList.toggle("is-empty", !markerHtml);
    this.refs.radarLane.classList.toggle("is-blocked", Boolean(healthBlocksVision));
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
