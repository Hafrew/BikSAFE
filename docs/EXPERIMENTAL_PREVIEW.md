# Mark III experimental web preview

This branch packages the Mark III browser pipeline and experimental model choices for iPhone-first evaluation. Main is unchanged. Native app scaffolding remains in the original local checkout and is not part of this web preview.

## Build and hosting

Run `npm run build`. Vercel builds this branch and serves `dist/app` over HTTPS. No automated tests run as part of this packaging command. The source fingerprint is available at `/build-manifest.json`.

Open the preview on iPhone Safari, then choose Start Detector and allow camera access. Use the ordinary default model first. The comparison hub is at `/tools/` and links to model choices, Worker smoke, public evaluation, and the baseline benchmark. Worker execution remains opt-in with `?worker=1`; EfficientDet-Lite0 and RF-DETR Nano remain experimental and may fall back to COCO in the ride app. Diagnostics identify requested and active models; public evaluation fails rather than silently substituting a different model.

## Verification status

The November 2 model and pipeline additions have only been packaged and reviewed as source. Tests, inference, browser validation, and iPhone measurements are deliberately deferred at the user's request. October 25 benchmark files are historical desktop/generated-fixture evidence, not verification of this branch or evidence of iPhone accuracy or latency.

Before promotion to main, verify camera start/recovery and front/rear switching, identify the actual active model, compare sustained frame age and responsiveness, and evaluate detection quality with complete public-data coverage. Export recordings and the matching build fingerprint. A deployed preview alone does not establish performance improvement.

## Implemented UI direction

The UI uses charcoal surfaces and lime Start ride and loading accents with reduced corner rounding. Mark III appears at the bottom of setup. Plus Jakarta Sans is bundled as a local Latin variable WOFF2 (weights 400–700, font-display swap); its SIL Open Font License is beside the font in src/assets/fonts.

- Normal ride view shows only Front watch or Rear watch at the top. No marketing headline, readiness chip, Monitoring label, or Watching road card is shown.
- Primary lime/yellow/red border glow reflects the current warning state. The right-side estimated-distance scale shows live vehicle markers, with nearer vehicles toward the bottom. Paused, stale, and blocking failure states clear the markers; faults retain explicit text.
- Bottom controls expose sound, camera view, pause/resume, and Menu. Diagnostics and tuning remain separate sheets.
- Pause stops inference and new alerts, clears readings, and leaves the camera stream active. Camera recovery and visibility changes must respect manual pause.
- These UI changes are source-reviewed and packaged only. Browser/layout checks and iPhone testing remain deferred at the user's request.

Home-screen direction selection and illustration use neutral colors. The direction note explains that it can be adjusted during rides. The border glow, detection markers, and meter gradient share the primary lime endpoint, with yellow and red warning endpoints.

Help is available on the home screen and in the ride menu as an in-app dialog, preserving the active session. End ride pauses detection, stops the camera and screen wake lock, and reloads setup. Timing recordings must be exported before ending.
