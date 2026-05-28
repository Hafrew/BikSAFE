# BikSAFE UI Layout Research Draft

## Goal

Make BikSAFE readable in a moving, high-vibration, high-glare riding context. The rider should understand the current risk state in a glance without parsing camera boxes, diagnostics, or settings.

## Research Signals

- Garmin Varia uses a compatible head unit or phone app to show approaching rear vehicles, with current products detecting rear traffic out to about 140 meters and newer Garmin tracking adding vehicle size, lateral movement, and threat level.
- Wahoo TRACKR RADAR depends on ANT+ Radar-compatible bike computers or sport watches for ride alerts, which reinforces that radar-style information belongs on the riding display rather than buried in setup UI.
- Trek CarBack pairs with a smartphone or GPS cycling computer to alert the rider to detected vehicles, again pointing to a display-first alert model.
- ANT+ created a Bike Radar profile specifically to transmit live relative vehicle distance/speed to a display in front of the cyclist so the rider can keep attention on the road.
- NHTSA distraction guidance is for drivers, not cyclists, but the principle applies: anything that pulls eyes and cognition away from traffic is a safety cost.
- Watch and wearable design guidance emphasizes glanceable, single-screen interactions for motion contexts.

Sources:

- Garmin Varia: https://www.garmin.com/en-US/garmin-technology/cycling-science/cycling-awareness/varia-rear-view-radar/
- Garmin Advanced Vehicle Tracking: https://support.garmin.com/en-SG/?faq=70iFG0nsSD03On6ribQN18
- Wahoo TRACKR RADAR FAQ: https://support.wahoofitness.com/hc/en-us/articles/26243298964754-TRACKR-RADAR-Information-and-FAQ
- Trek CarBack: https://www.trekbikes.com/us/en_US/equipment/bike-accessories/bike-lights/bike-rear-lights/trek-carback-radar-rear-bike-light/p/44797/
- ANT+ Bike Radar profile announcement: https://www.thisisant.com/news/ant-wireless-releases-first-interoperable-device-profile-for-bike-radar-sen
- NHTSA distracted driving guidance: https://www.nhtsa.gov/risky-driving/distracted-driving
- Apple watchOS design guidance: https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

## Core Recommendation

Use a radar-first riding UI with the camera as context, not the main thing the rider must interpret.

The current app has a strong foundation: live camera, detection overlay, health state, front/rear modes, feedback toggles, diagnostics, and calibration settings. The next layout should reduce visible controls during riding and promote three pieces of information:

1. Current state: clear, approaching, warning, danger, recovering, unsafe.
2. Nearest relevant vehicle: type, direction, distance, and closing behavior when available.
3. Relative position: a vertical radar lane that maps vehicles by distance.

## Product Mode Decision

Do not maintain two equal consumer UIs. Fully switch the main product to the radar-first ride UI.

Keep a secondary view, but make it a support view rather than a competing mode:

- `Ride`: default, radar-first, minimal controls, designed for actual riding.
- `Vision`: camera-first view for setup, calibration, demos, and debugging.

This gives riders one obvious default while still preserving the raw camera/detection experience that is useful for trust, screenshots, tuning, and engineering.

Recommended behavior:

- Launch into `Ride` after onboarding.
- Show `Vision` behind a control-tray button, not as a same-weight front-page choice.
- Remember the last view for development builds, but always default normal users back to `Ride`.
- Keep `Front` and `Rear` as direction choices inside both views.
- Put diagnostics inside `Vision` and settings, not in the main ride screen.

Reasoning:

- A safety app should not ask the rider to choose between two interface philosophies before riding.
- App Store screenshots and onboarding become simpler: BikSAFE is a vehicle-awareness display, not a camera tech demo.
- Bike-computer and e-bike-display integrations map naturally to `Ride`, while `Vision` remains useful for support and proof.

## Main Ride View

Default riding screen:

```text
+------------------------------+
| Rear / Ready            92%  |  micro status, only essential
|                              |
|  full-screen camera preview  |
|                              |
|                       60m |  |
|                           |  |
|                       30m o  |  radar lane
|                           |  |
|                       10m #  |
|                              |
| +--------------------------+ |
| | DANGER              8 m  | |
| | Truck behind / closing   | |
| +--------------------------+ |
+------------------------------+
```

### Layout Rules

- Full-screen camera remains visible for trust and orientation.
- Radar lane sits on the right edge by default, with a setting to move it left for user preference or mounting position.
- Bottom alert slab is the primary text area. It should never contain more than two lines while riding.
- Top status becomes a small strip: mode, readiness, and battery/wake state if available.
- Controls collapse into a hidden control tray opened by one tap. The main ride view should not show five separate top buttons.
- Diagnostics stay out of the ride view unless the system is degraded, recovering, or unsafe.
- Settings stay in a bottom sheet and are not reachable by accidental swipe while riding.

## Alert States

### Clear

- Visual: calm camera view, thin green radar lane, no aggressive glow.
- Text: `CLEAR` with `Watching rear` or `Watching road`.
- Haptic/audio: silent.

### Vehicle Detected

- Visual: vehicle marker appears in radar lane.
- Text: `CAR 34 m` or `TRUCK 41 m`.
- Color: neutral/cyan or green until inside warning threshold.
- Haptic/audio: optional single soft tick when first detected.

### Warning

- Visual: amber alert slab, amber radar lane segment, larger vehicle marker.
- Text: `WARNING 18 m`; subline `Car behind`.
- Haptic/audio: repeating medium interval.

### Danger

- Visual: red alert slab, edge flash/pulse, radar marker pinned near bottom.
- Text: `DANGER 8 m`; subline `Truck behind / closing`.
- Haptic/audio: strongest repeat pattern.

### Recovering / Unsafe

- Visual: replace normal CLEAR/DANGER language with system state.
- Text: `RECOVERING` or `UNSAFE`; subline says the camera/detector is unavailable.
- Do not show `CLEAR` while stale or blind.

## Radar Lane Detail

The radar lane should be the signature UI element.

- It uses distance ticks: `60m`, `30m`, `10m`, plus bottom danger threshold.
- Vehicle markers encode type with shape, not color alone:
  - car: circle or small rounded marker
  - truck/bus: tall rectangle
  - motorcycle/bicycle: narrow diamond or slim marker
- Marker color encodes risk:
  - clear/far: green or cyan
  - warning: amber
  - danger: red
- Multiple vehicles stack by distance; the nearest/riskiest vehicle gets emphasis.
- If lane position estimate exists later, split the radar lane into left/center/right sublanes. Do not add that until the data is trustworthy.

## Camera Overlay

Keep boxes, but make them secondary.

- Only draw labels on the primary vehicle and vehicles inside warning/danger.
- Use thin boxes in clear/far states.
- Use thicker corner brackets for warning/danger.
- Remove decorative grid and scanlines during actual ride mode; they add visual noise and may reduce camera readability in sun.
- Keep a subtle edge tint for state, but avoid heavy glow over the road image.

## Control Model

Visible during riding:

- mode: `Front` / `Rear`
- engine state: `Ready`, `Recovering`, `Unsafe`
- optional battery/wake state

Hidden in tap-open control tray:

- front/rear switch
- audio toggle
- haptic toggle
- settings
- diagnostics

This keeps the ride screen from looking like a dashboard setup page.

## Settings Sheet

Use tabs or segmented sections:

- `Zones`: front/rear warning and danger thresholds.
- `Camera`: FOV tuning and calibration status.
- `Feedback`: audio/haptic choices and intensity.
- `Diagnostics`: FPS, latency, backend, model, camera health.

Settings should use plain language:

- `Warning starts`
- `Danger starts`
- `Camera field of view`
- `Alert sound`
- `Vibration`

## Color And Type

Use a dark, high-contrast system because the camera feed is unpredictable.

- Text should meet WCAG contrast minimums where possible.
- Do not rely on color alone; combine color with words, marker shape, pulse rhythm, and haptics.
- Replace tiny all-caps telemetry text with larger, calmer labels where the rider needs to read it.
- Keep the big state word, but avoid making every part of the UI feel like a sci-fi cockpit.

Recommended palette:

- clear: `#2EE6A6`
- far/detected: `#37C8FF`
- warning: `#FFB84D`
- danger: `#FF3B5F`
- panel: `rgba(5, 10, 14, 0.74)`
- text: `#F6FAF8`

## Mobile Orientation

### Portrait

- Radar lane on right.
- Alert slab bottom.
- Status strip top.
- Control tray slides up from bottom.

### Landscape / Bike Display

```text
+--------------------------------------------+
| Rear / Ready                               |
|                                            |
| full camera                 | 60m          |
|                             o 32m          |
|                             # 12m          |
|                                            |
| DANGER 8m / Truck behind                   |
+--------------------------------------------+
```

- Alert text becomes a bottom bar rather than a card.
- Radar lane remains on the side.
- Controls become a compact side drawer.

## MVP Implementation Sequence

1. Done in Mark II Phase 1: refactor current topbar into a compact status strip plus hidden control tray.
2. Done in Mark II Phase 1: add the vertical radar lane using existing `snapshot.vehicles` and `distanceMeters`.
3. Done in Mark II Phase 1: simplify bottom HUD to state, distance, and one short detail line.
4. Partially done in Mark II Phase 1: keep diagnostics behind the control tray and automatically switch diagnostics into Vision.
5. Done in Mark II Phase 1: add alert-state camera overlay rules so Ride shows fewer labels and Vision keeps fuller labels.
6. Next: test on small phones, landscape phones, and high-glare color contrast.

Implementation notes live in `docs/BIKSAFE_MARK_II_PHASE_1.md`.

## Success Criteria

- Rider can identify risk state in under one glance.
- No riding-critical text wraps awkwardly on small phones.
- The app never displays `CLEAR` when the camera/detector is stale.
- Main ride view has no more than three persistent UI regions: status strip, radar lane, alert slab.
- Controls are reachable but not visually competing with alerts.
- The layout can later map cleanly to a bike computer, e-bike display, helmet display, or BLE/ANT+ companion display.
