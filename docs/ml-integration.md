# ML integration boundaries

## Browser E1 plant model

The model that actually ships is **Student33**, a TinyViT-5M classifier exported
to ONNX with FP16 weights. It takes a `[1,3,320,320]` FP32 input named `images`
and produces `logits` over 33 classes, where the last index is a dedicated
Unknown class rather than a thresholded reject. Everything the browser needs to
run it - input size, normalisation mean/std, temperature, and the four decision
thresholds - lives in `public/models/invatrace-student33-v1/runtime-manifest.json`,
so the adapter never hardcodes a number the training side could change.

The 11.5 MiB ONNX file is served as one response and its SHA-256 is checked
against the manifest before any inference runs. WebGPU is preferred with a WASM
fallback. No external inference API is involved: the photo never leaves the
device during identification.

Confidence is turned into one of four outcomes using the manifest thresholds -
confident (>= 0.55), handover to the PlantNet second opinion (>= 0.30), retake
(>= 0.15), and unknown below that. An Unknown result never exposes the top
candidate as an identity or as a removal permission.

The scan route and runtime are lazy-loaded, and concurrent `load()` calls share
one initialization promise and session so a fast double-tap cannot download the
model twice. Versioned model files and the hashed WASM runtime use cache-first
storage after their first successful download. A failed download resets the
loader so the same photo can be retried. Browser performance entries named
`invatrace:model-download`, `invatrace:model-load`, and
`invatrace:model-inference` expose the latest timings without collecting image
or identity data.

### The earlier PULIH kit

The first iteration used the supplied `PULIH_Model1_v4_FP16_Web_Kit`: an
EfficientNetV2-S 31-class classifier with a `[1,3,384,384]` input, 38.6 MiB of
ONNX split into two chunks for Cloudflare Pages' upload limit. It was replaced by
Student33 because the newer model is roughly a third of the size, covers two more
classes, and has a real Unknown class instead of an open-set rejection rule
tuned by hand. The kit is still vendored under `assets/runtime-packed/vendor/` so
the iteration-1 results stay reproducible, but nothing in the running app loads
it.

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
