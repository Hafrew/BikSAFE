import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  updateCameraProfileSetting,
} from "../src/preferences.js";

test("malformed numeric settings fall back to safe finite defaults", () => {
  const settings = normalizeSettings({
    calibration: {
      carLengthMeters: "not-a-number",
      cameraProfiles: {
        front: { horizontalFovDegrees: "bad" },
      },
    },
    distanceTuning: {
      front: { dangerMeters: "bad", warningMeters: null },
    },
  });

  assert.equal(settings.calibration.carLengthMeters, DEFAULT_SETTINGS.calibration.carLengthMeters);
  assert.ok(Number.isFinite(settings.calibration.cameraProfiles.front.horizontalFovDegrees));
  assert.ok(Number.isFinite(settings.distanceTuning.front.dangerMeters));
  assert.ok(Number.isFinite(settings.distanceTuning.front.warningMeters));
});

test("manual FOV adjustment remains an estimate", () => {
  const settings = updateCameraProfileSetting(DEFAULT_SETTINGS, "front", "horizontalFovDegrees", 72);

  assert.equal(settings.calibration.cameraProfiles.front.horizontalFovDegrees, 72);
  assert.equal(settings.calibration.cameraProfiles.front.calibrated, false);
  assert.equal(settings.calibration.cameraProfiles.front.calibrationMethod, "estimate");
});

test("only known-reference calibration can be trusted", () => {
  const settings = normalizeSettings({
    calibration: {
      cameraProfiles: {
        front: {
          horizontalFovDegrees: 70,
          calibrated: true,
          calibrationMethod: "known-reference",
        },
      },
    },
  });

  assert.equal(settings.calibration.cameraProfiles.front.calibrated, true);
});
