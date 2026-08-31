# ML integration boundaries

## Browser E1 plant model

The supplied `PULIH_Model1_v4_FP16_Web_Kit` stays outside Git and is not
modified. Set `PULIH_MODEL_KIT_PATH` to that kit directory and run
`npm run prepare:model`; the script verifies the published SHA-256 value before
creating local runtime assets under `public/models/pulih-model1-v4/`. That
generated directory is ignored by Git. The model is an EfficientNetV2-S
31-class classifier with FP16 internal weights, FP32 `[1,3,384,384]`
input/output, and calibrated open-set rejection.

The browser reproduces the kit's centre crop, normalization, temperature,
MSP/margin/energy/entropy combiner, threshold, and class order. An Unknown result
never exposes the top candidate as an identity or removal permission. The 38.6
MiB ONNX file is split into two verified static chunks for Cloudflare Pages; the
browser reassembles it and checks the original digest before local inference.
WebGPU is preferred with WASM fallback. No external inference API is used.

The scan route and runtime are lazy-loaded. Model chunks are streamed into one
preallocated buffer to avoid holding both chunk arrays and a second full model
copy, and concurrent load calls share one initialization promise and session.
Versioned model files and the hashed WASM runtime use cache-first storage after
their first successful download. A failed download resets the loader so the
same photo can be retried. Browser performance entries named
`invatrace:model-download`, `invatrace:model-load`, and
`invatrace:model-inference` expose the latest timings without collecting image
or identity data.

Input preparation accepts JPEG, PNG, and WebP source photos up to 10 MiB and
converts them to a bounded JPEG. A result can continue to reporting only when
the model catalogue explicitly marks the class as invasive in Malaysia and the
backend independently returns a reviewed, reportable invasive species record.
Missing or conflicting status data stays fail-closed. Gallery photos can be
identified, but the backend contract requires a fresh camera capture for a
field report.

## Iteration 1 E2 deterministic screening

E2 uses a durable worker that reads the private JPEG and applies versioned,
inspectable deterministic rules:

- exact SHA-256 and capture-ID replay rejection;
- multi-view difference hashes for resized and common cropped-photo replays;
- minimum dimensions plus brightness, contrast, and edge-detail checks;
- GPS accuracy within 100 metres;
- a supported E1 model version and a reportable E1 target result;
- same-species spatial and time-window merging; and
- Redis limits of 10 reports per profile per ten minutes and 50 per day.

Passing reports use API status `screened`, policy version
`deterministic-rules-v1.0`, and reason `automated_rule_screened`. The API returns
`screeningMethod: deterministic_rules`. The E1 result is client-supplied
evidence and is not described as an independent server identification.

Database, Redis, or private-storage failure remains fail-closed: the report stays
private and the job retries before moving to `validation_unavailable`.
