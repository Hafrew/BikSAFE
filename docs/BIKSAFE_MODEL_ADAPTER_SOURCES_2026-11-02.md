# RF-DETR-Nano browser adapter source contract — 2026-11-02

Research only. User explicitly deferred tests and benchmarks until hosted testing. No runtime implementation or validation was performed for this note.

## Pinned source and assets

- Official sample repository revision inspected: `9467001474dc4e072ebc588e5eb9b5fdcf63abbc`.
- [Adapter sample](https://github.com/google-ai-edge/litert-samples/blob/9467001474dc4e072ebc588e5eb9b5fdcf63abbc/samples/web_demos/src/rfdetr/main.js), [host preprocessing/postprocessing](https://github.com/google-ai-edge/litert-samples/blob/9467001474dc4e072ebc588e5eb9b5fdcf63abbc/samples/web_demos/src/rfdetr/host.js), [COCO category map](https://github.com/google-ai-edge/litert-samples/blob/9467001474dc4e072ebc588e5eb9b5fdcf63abbc/samples/web_demos/src/rfdetr/coco.js).
- Runtime pinned by [official package.json](https://github.com/google-ai-edge/litert-samples/blob/9467001474dc4e072ebc588e5eb9b5fdcf63abbc/samples/web_demos/package.json): `@litertjs/core` version `2.5.3`.
- [Model card](https://huggingface.co/litert-community/RF-DETR-Nano-LiteRT) declares Apache-2.0. Inspected model repository revision: `388a9bb69eefac2efff19d5bb92cea49b7379a5a`.
- [Graph A](https://huggingface.co/litert-community/RF-DETR-Nano-LiteRT/resolve/388a9bb69eefac2efff19d5bb92cea49b7379a5a/rfdetr_graphA_fp16.tflite): approximately 48.6 MB.
- [Graph B](https://huggingface.co/litert-community/RF-DETR-Nano-LiteRT/resolve/388a9bb69eefac2efff19d5bb92cea49b7379a5a/rfdetr_graphB_fp16.tflite): approximately 7.6 MB.
- Runtime assets: `https://cdn.jsdelivr.net/npm/@litertjs/core@2.5.3/wasm/`. Runtime is Apache-2.0; adapted Google sample functions must retain their copyright/license notice.

## Backend constraint

The official browser sample deliberately executes Graph B on WASM because its WebGPU outputs differed materially from the Python reference. Request WebGPU for Graph A only, with WASM fallback after compile or execution failure. Inspect the compiled model's actual accelerator rather than displaying the requested backend as fact. Neither the model card's native-phone timings nor desktop-browser timings establish BikSAFE mobile performance.

## Model I/O and host steps

| Graph | Input | Output |
| --- | --- | --- |
| A | image `[1,3,384,384]` | encoder classes `[1,576,91]`, encoder coordinates `[1,576,4]`, memory `[1,576,256]` |
| B | memory `[1,576,256]`, reference coordinates `[1,300,4]` | boxes `[1,300,4]`, logits `[1,300,91]` |

Bind inputs and outputs using tensor shapes from `getInputDetails()` / `getOutputDetails()`; converter ordering is not stable. Resize the source image to a 384-square RGB image using antialiased bilinear sampling, divide by 255, normalize channelwise with ImageNet mean `[0.485,0.456,0.406]` and standard deviation `[0.229,0.224,0.225]`, and arrange as NCHW float32. The official host implementation reproduces Pillow bilinear precisely and uses float32 rounding for normalization.

After Graph A, rank all 576 proposals by each proposal's maximum class logit, preserving lower-index order on ties. Select the top 300 and gather their unmodified encoder coordinate vectors into Graph B reference input. Pass Graph A memory unchanged to Graph B.

For each of 300 decoder queries, take the highest of 91 logits, sigmoid it for confidence, and use its index as the sparse COCO category ID. Zero is unused. Relevant BikSAFE labels: 2 bicycle, 3 car, 4 motorcycle, 6 bus, 8 truck. Normalized boxes are center-X, center-Y, width, height; convert to top-left width/height and scale independently by the source image dimensions. The sample uses score above 0.45 followed by per-class NMS with IoU 0.6. An app-specific score argument may replace the example threshold, with its effect left for hosted evaluation.

## Runtime API

Initialize through `loadLiteRt(wasmBase, {threads:false})` for a portable non-isolated page. Threaded mode requires cross-origin isolation; threading and JSPI runtime options are mutually exclusive in the sample. Compile bytes with `loadAndCompile(bytes, {accelerator})`. Build ordered input tensors with `Tensor.fromTypedArray(values, shape)`, run `await model.run(inputs)`, and read outputs with `await tensor.data()`.

Delete every input/output tensor in `finally`; release both compiled models when replacing/stopping the adapter. Keep the inference work within the dedicated Worker. The package's raw `dist/index.js` has a bare package dependency, so direct browser loading requires a bundler, import map, or an ESM-resolving CDN URL. Keep package JavaScript and WASM runtime versions matched.

## Status

Contract assembled from official source and model metadata. No files were downloaded into the app, no model was run, and no correctness, recall, latency, or device-support claim is made by this note.
