# BikSAFE Mark II Phase 1

## Summary

Mark II Phase 1 switches BikSAFE's main riding experience to a radar-first layout while keeping the original camera-first experience as a secondary Vision view.

The detector engine did not change in this phase. The upgrade is a presentation layer on top of the existing camera, tracking, range, health, feedback, and settings runtime.

## Views

### Ride

Ride is the default view for normal use.

- Full-screen camera remains in the background for trust and orientation.
- The right-side radar lane maps detected vehicles by distance.
- The bottom alert slab shows the current state, nearest vehicle distance, and one short detail line.
- The top bar is reduced to mode, engine status, and a menu button.
- Camera boxes are simplified so the rider is not forced to parse the raw detector overlay.

### Vision

Vision is the secondary support view.

- Keeps the camera-first detector overlay.
- Shows the focus lane and fuller detection labels.
- Used for setup, calibration, demos, troubleshooting, and confidence checks.
- Opening diagnostics automatically switches to Vision.

## Controls

The old always-visible control row is now a tap-open control tray.

The tray includes:

- `Ride` / `Vision`
- `Front` / `Rear`
- zone settings
- audio toggle
- haptic toggle
- diagnostics

This keeps the ride screen focused on alerts instead of setup controls.

## Radar Lane

The radar lane is driven by the existing `snapshot.vehicles` detector output.

- Markers are positioned from `distanceMeters`.
- Vehicles cap at the current 60m display range.
- Primary vehicle markers pulse.
- Marker shape indicates broad vehicle type:
  - standard marker: car/default
  - tall marker: truck/bus
  - narrow marker: motorcycle/bicycle
- Marker color follows the existing zone style: clear/far, warning, danger.

## Safety Behavior

Mark II keeps the previous reliability rule: the HUD must not display normal `CLEAR` behavior when the camera or detector is stale, recovering, or unsafe.

When health blocks normal vision:

- radar lane switches to blocked styling
- bottom HUD shows `RECOVER` or `UNSAFE`
- distance fields are suppressed
- feedback alerts are not driven by stale detector zones

## Files Changed

- `index.html`: added `Ride`/`Vision` view switch, control tray, radar lane, and default `data-view="ride"`.
- `styles.css`: added Mark II layout styles, radar markers, compact topbar, control tray, and view-specific overlay behavior.
- `src/app.js`: added view state, control tray state, and view switching.
- `src/ui.js`: added radar-lane rendering and Mark II HUD state handling.
- `src/overlay.js`: added Ride/Vision rendering behavior for the camera overlay.

## Follow-Up Work

- Add synthetic demo mode for screenshots and store previews.
- Add radar lane side preference: left or right.
- Add distance range preference: 40m, 60m, or 100m.
- Add a first-run safety/onboarding screen before camera permission.
- Test real-device WebView camera and TensorFlow.js performance for the app-store port.
