# RF-DETR host preprocessing and postprocessing

`rfdetr-host.js` is adapted from the Google AI Edge LiteRT samples, copyright 2026 The Google AI Edge Authors, under Apache-2.0. The original copyright/license header is retained; the license is included in `LICENSE-google-litert-samples.txt`.

Source revision: `9467001474dc4e072ebc588e5eb9b5fdcf63abbc`.

Source: https://github.com/google-ai-edge/litert-samples/blob/9467001474dc4e072ebc588e5eb9b5fdcf63abbc/samples/web_demos/src/rfdetr/host.js

Modification: `decode()` accepts an explicit score threshold while retaining the original default. The resizing, normalization, proposal selection and per-class suppression algorithms are retained. No numerical parity or runtime tests were run for this integration pass.

RF-DETR model graphs are downloaded from the pinned model revision at runtime and are not stored in this repository. Model provenance: https://huggingface.co/litert-community/RF-DETR-Nano-LiteRT/tree/388a9bb69eefac2efff19d5bb92cea49b7379a5a . That model card declares Apache-2.0.

EfficientDet-Lite0 weights are fetched from Google's versioned MediaPipe model URL. They are not copied into this repository. MediaPipe runtime package: `@mediapipe/tasks-vision@1.2.0` (Apache-2.0). Model guide: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector . Both adapters record their model SHA-256 hashes in diagnostics.
