# Mark III experimental web preview

This branch packages the Mark III browser pipeline and experimental model choices for iPhone-first evaluation. Main is unchanged. Native app scaffolding remains in the original local checkout and is not part of this web preview.

## Build and hosting

Run `npm run build`. Vercel builds this branch and serves `dist/app` over HTTPS. No automated tests run as part of this packaging command. The source fingerprint is available at `/build-manifest.json`.

Open the preview on iPhone Safari, then choose Start Detector and allow camera access. Use the ordinary default model first. The comparison hub is at `/tools/` and links to model choices, Worker smoke, public evaluation, and the baseline benchmark. Worker execution remains opt-in with `?worker=1`; EfficientDet-Lite0 and RF-DETR Nano remain experimental and may fall back to COCO in the ride app. Diagnostics identify requested and active models; public evaluation fails rather than silently substituting a different model.

## Verification status

The November 2 model and pipeline additions have only been packaged and reviewed as source. Tests, inference, browser validation, and iPhone measurements are deliberately deferred at the user's request. October 25 benchmark files are historical desktop/generated-fixture evidence, not verification of this branch or evidence of iPhone accuracy or latency.

Before promotion to main, verify camera start/recovery and front/rear switching, identify the actual active model, compare sustained frame age and responsiveness, and evaluate detection quality with complete public-data coverage. Export recordings and the matching build fingerprint. A deployed preview alone does not establish performance improvement.

## Proposed UI direction

The UI overhaul is a separate follow-up, not implemented in this preview:

- Setup: camera/mount orientation, sound preference, simple readiness checks, one Start ride action. Advanced model choices live under settings.
- Ride: one dominant traffic message, clearly marked estimated distance, explicit front/rear state, and a compact camera/detector health indicator. A camera view is optional. No supported detection reads Monitoring; camera or detector failure takes priority.
- Controls: large bottom controls for sound, camera view, and pause; keep diagnostics and tuning off the ride screen.
- Diagnostics: requested/active model, observation age, model-call timing, fallback reasons, and export, with experimental choices clearly labeled.
- Layout: high contrast, system fonts, safe-area padding, dynamic viewport sizing, readable text without clipping, and reduced animation. Keep range estimates visibly approximate and avoid implying that no detection means the road is safe.
