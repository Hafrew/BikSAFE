# BikSAFE Mark III runtime research — 2026-10-25

Scope: current primary-source research for an optimization plan. This is a candidate shortlist, not evidence that a replacement is faster or more accurate on BikSAFE devices. No runtime or model was changed by this research.

## Recommendation

User-selected platform priority: iPhone first, with browser support retained. Evaluate Safari and the iOS app's WKWebView separately; use actual iPhone results to select defaults. Preserve a validated browser fallback, keep Android as secondary compatibility coverage, and consider an iOS native adapter only if measured browser limitations justify it.

Keep the current COCO-SSD Worker path as the control. First repair its measurement, lifecycle, and fallback boundaries. Then run two bounded challenger experiments: (1) LiteRT.js with a compact Google detector, and (2) RF-DETR-Nano on an exported browser runtime. Use the official LiteRT.js RF-DETR sample to establish feasibility; use ONNX Runtime Web as an alternative runner if its export has a better supported operator path. A newer model is not a speed guarantee. Retain only candidates that improve frame age at unchanged or better small/distant-vehicle recall.

## What has changed or merits a fresh look

### LiteRT.js is now a concrete browser candidate

Google documents `@litertjs/core`, WebGPU and XNNPack/WASM execution, `.tflite` models, explicit tensor cleanup, and TensorFlow.js interoperability. The current repository adds an important qualification: unsupported WebGPU operations can delegate individually to WASM in JSPI environments, while other environments can fall back entirely to CPU. Record actual delegation rather than displaying “GPU” merely because it was requested. [Official guide](https://developers.google.com/edge/litert/web), [repository details](https://github.com/google-ai-edge/LiteRT/blob/main/litert/js/README.md).

The official sample collection includes RF-DETR-Nano image/webcam inference, using separate WebGPU and WASM graphs. This demonstrates an available implementation route, not performance on our phones. LiteRT repository licensing is Apache-2.0; preserve notices and separately record each model artifact's terms. [Sample portal](https://google-ai-edge.github.io/litert-samples/), [source and license](https://github.com/google-ai-edge/LiteRT).

### Safari WebGPU assumptions need updating

WebKit says Safari 26 introduced WebGPU across Apple platforms. Consequently, an old rule that all iPhone browsers lack WebGPU is obsolete. However, the ONNX Runtime browser table still lists Safari/iOS WebGPU as unsupported, while newer repository design notes acknowledge Safari shipping it. Treat this as a browser-API versus runtime-validation distinction. Probe the GPU adapter, compile/run the exact model, compare numerical output, and test the actual WKWebView build independently. Browser support alone does not certify an execution provider or embedded WebView. [WebKit announcement](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [later release confirmation](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [ORT matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [ORT design discussion](https://github.com/microsoft/onnxruntime/blob/main/docs/design/onnxruntime_web_remove_webgl_backend.md).

### ONNX Runtime Web is useful, with explicit limits

WASM is the broad compatibility baseline; GPU execution supports a subset of operators. ORT's WASM proxy Worker cannot be combined with its WebGPU provider, so a WebGPU session should be instantiated inside a dedicated Worker instead. WASM multithreading requires both browser support and cross-origin isolation. Graph capture is an experiment only for supported static-shape graphs fully running on WebGPU. None of these features guarantees an improvement for a small detector. [Web overview](https://onnxruntime.ai/docs/tutorials/web/), [Worker and threading flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html), [performance diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html).

### TensorFlow.js remains a valid control

The official project offers WebGL, WASM and WebGPU backends. A WASM benchmark is preferable to assuming vanilla JavaScript CPU is the best fallback. Keep package versions matched and test the complete COCO wrapper: changing the graph backend alone does not remove wrapper postprocessing. The COCO-SSD source uses synchronous output reads and CPU non-maximum suppression. Profile those costs separately from model execution before replacing a working engine. [TFJS project](https://tensorflow.github.io/tfjs/), [WASM guidance](https://www.tensorflow.org/js/guide/platform_environment), [COCO wrapper source](https://raw.githubusercontent.com/tensorflow/tfjs-models/master/coco-ssd/src/index.ts).

## Bounded challenger shortlist

| Challenger | Experiment | Why include it | Constraints |
| --- | --- | --- | --- |
| Compact Google detector | EfficientDet-Lite0 320-square, int8/WASM and float16/GPU where supported; compare MediaPipe's complete detector pipeline against a LiteRT.js adapter only if conversion/postprocessing is verified | Established mobile-oriented reference, fewer moving parts than a transformer export | Small-object recall may regress at 320; int8 need not be fastest on GPU; exact downloaded weight license must be recorded |
| Quality challenger | RF-DETR-Nano, initially using the official LiteRT.js sample/export; optionally ONNX Runtime Web with the same weights and preprocessing | Newer COCO detector with an explicit Apache-2.0 model card and existing browser example | Treat as a quality challenger rather than an assumed mobile latency winner; transformer conversion, GPU operator coverage, memory, download size and sustained mobile power may rule it out |

Google documents EfficientDet-Lite0 input shape and quantization options. Its published Pixel 6 numbers belong to Google's native task setup and must not be used as browser or BikSAFE predictions. MediaPipe web detection is synchronous; it still belongs in a Worker. [Model guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector), [web behavior](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js).

RF-DETR-Nano's first-party Hugging Face card identifies its model license as Apache-2.0. Roboflow's current licensing page specifically distinguishes Nano-to-Large object detectors from XL/2XL terms; pin the intended variant and artifact rather than generalizing the family license. [Nano model card](https://huggingface.co/Roboflow/rf-detr-nano/blob/main/README.md), [licensing details](https://roboflow.com/licensing), [official repository](https://github.com/roboflow/rf-detr).

Do not make an Ultralytics model the default by name recognition: the vendor offers AGPL-3.0 and Enterprise licensing. Assess the intended distribution against those terms before adding its code or weights. [Vendor license](https://www.ultralytics.com/license).

## Native route, only after web evidence

Android LiteRT's CompiledModel API provides a contemporary hardware-accelerated native route; execute model creation, runs and disposal on its owning background thread. For iOS perception, evaluate the established Core ML path separately rather than assuming LiteRT's newer Swift distribution has identical maturity. A Capacitor plugin would need to retain native camera frames, perform preprocessing/inference natively, and send compact detections to JavaScript. Sending camera pixels as base64 through a bridge would undermine the purpose. Native porting is a separate experiment and should follow measured browser limitations, not precede them. [Android integration](https://developer.android.com/agents/skills/device-ai/litert/litert-runtime/skill), [LiteRT overview and distribution notes](https://developers.google.com/edge/litert/overview).

## Required report for every experiment

- Pin runtime, model/export hash, precision, effective backend, preprocessing, thresholds and input dimensions.
- Compare current Worker control and one challenger on identical immutable public image/video slices.
- Report p50/p95/p99 source-frame-to-output age, frame-to-alert delay, preprocessing/transfer/inference/postprocessing spans, main-thread long tasks and dropped frames.
- Report per-class and small/distant-object recall, false alerts per time, and range/TTC error; synthetic fixtures establish plumbing only.
- Compare cold start, warm cached start, and 20–30 minute runs on representative Android Chrome/WebView and iOS Safari/WKWebView builds. Capture heat, battery and degradation over time.
- Promote only after the supported-device result is reproducible. Do not equate render FPS, detector FPS, inference duration and end-to-end alert latency.

Research limitations: no browser/device benchmark was run for this note; model conversion and exact EfficientDet weight licensing remain experiment-entry checks; primary-source compatibility tables can lag browser releases. Sources were checked during this session using the user-facing date above.
