# Student33 classifier — accuracy handoff for the model developer

Prepared 2026-09-23. This is a **model-side** report: the app's integration is
verified correct, so the items below need the person who trained/exported the
model. Nothing here is a web-app bug.

## TL;DR

On clean, single-plant catalogue photos the model gets **8/10 in-vocabulary
species right**, but the failures are **confident and wrong**, and
out-of-vocabulary native plants are **confidently labelled as invasives** instead
of falling to the Unknown class. Two concerns:

1. **Over-confident misclassification.** *Mikania micrantha* → *Chromolaena
   odorata* at **100.0%** (Mikania itself ≈0%); *Lantana camara* → *Asclepias
   curassavica* at **99.9%**. The temperature scaling (T=1.48) is not preventing
   near-saturated softmax on wrong answers.
2. **Unknown class not catching out-of-vocabulary inputs (safety-relevant).**
   Native ferns the model was never trained on are classified as an invasive
   with high confidence: *Dicranopteris linearis* → *Leucaena leucocephala*
   **89.9%** (Unknown class only 6.5%); *Pteris vittata* → *Leucaena* **95.3%**.
   A native plant confidently flagged invasive is worse than an honest "unknown".

## Model under test

From `public/models/invatrace-student33-v1/`:

- TinyViT-5M, ONNX FP16, `tinyvit5m_student33_320_fp16.onnx` (SHA in manifest).
- Input `images` `[1,3,320,320]` FP32; output `logits` over 33 classes; index 32
  = Unknown.
- Preprocess (runtime-manifest.json): resize short side → 366, centre-crop 320,
  RGB, normalize mean `[0.485,0.456,0.406]` std `[0.229,0.224,0.225]`.
- Decision: `softmax(logits / 1.4796)`, take max over classes 0–31; **confident
  ≥ 0.55**, handover ≥ 0.30, retake ≥ 0.15, else Unknown.

## Measured results (clean catalogue photos)

| Input photo | Top-1 predicted | Conf | Unknown-class | Verdict |
|-------------|-----------------|------|---------------|---------|
| Mikania micrantha | **Chromolaena odorata** | **100.0%** | 0.0% | ✗ confident-wrong |
| Mimosa pigra | Mimosa pigra | 76.3% | 2.4% | ✓ |
| Eichhornia crassipes | Eichhornia crassipes | 100.0% | 0.0% | ✓ |
| Chromolaena odorata | Chromolaena odorata | 100.0% | 0.0% | ✓ |
| Bidens pilosa | Bidens pilosa | 86.4% | 12.5% | ✓ |
| Leucaena leucocephala | Leucaena leucocephala | 100.0% | 0.0% | ✓ |
| Lantana camara | **Asclepias curassavica** | **99.9%** | 0.0% | ✗ confident-wrong |
| Mimosa diplotricha | Mimosa diplotricha | 95.9% | 1.3% | ✓ |
| Parthenium hysterophorus | Parthenium hysterophorus | 100.0% | 0.0% | ✓ |
| Salvinia molesta | Salvinia molesta | 98.7% | 1.1% | ✓ |
| *Dicranopteris linearis* (native, **not a class**) | Leucaena leucocephala | 89.9% | 6.5% | confident OOV → invasive |
| *Pteris vittata* (native, **not a class**) | Leucaena leucocephala | 95.3% | 3.2% | confident OOV → invasive |

In-vocabulary top-1: **8/10**. (An earlier internal note said "4/7" — that was a
bad test set that counted two non-class species as misses; ignore it.)

## What is NOT the problem (ruled out on the app side)

- **Class-index → label mapping is correct.** `student33_class_map.json` (what
  the model was trained against, per `student33_model_metadata.json`) and
  `student33_species.json` agree on 32/33 indices; the only difference is index
  23, a synonym (Pennisetum polystachyon = Cenchrus setosus). So a wrong label is
  not a mapping shuffle.
- **Preprocessing matches the app.** The numbers above were produced by
  replicating the app's exact pipeline (short-side 366 → centre-crop 320 →
  manifest mean/std). 8/10 landing correct at high confidence confirms the
  pipeline is essentially right — a broken preprocess would fail everything.

## Questions / asks for the model developer

1. **Are the two confident-wrong pairs a model problem or a labelling problem?**
   Please confirm the training labels — and specifically that our reference
   photos `public/reference-images/mikania_micrantha.jpg` and
   `lantana_camara.jpg` actually depict Mikania and Lantana. Mikania↔Chromolaena
   are both white-flowered scrambling Asteraceae; if the training set has label
   noise between them, that would explain a 100%-confident swap.
2. **Calibration.** Temperature 1.48 still yields 100% softmax on wrong answers.
   Is the temperature fit on a held-out set? Would a higher T (or proper
   calibration) push these into the handover/retake band instead of a confident
   wrong identity?
3. **Open-set / Unknown behaviour.** The Unknown class (index 32) is not firing
   for genuine out-of-vocabulary natives (3–6% when it should dominate). Was the
   Unknown class trained with negative/background examples? Should the open-set
   rule be strengthened (e.g. energy/OOD score) rather than relying on the
   softmax of a 33rd class?
4. **Eval set.** Do you have a held-out validation set + per-class confusion
   matrix you can share? We only have single clean catalogue images per species.

## How to reproduce

The app already ships a manual QA harness. The exact numbers in this doc came
from an offline script that runs the shipped ONNX directly (short-side 366 →
centre-crop 320 → manifest normalize → `softmax(logits/T)`), using the reference
photos in `public/reference-images/`. Any framework that loads the ONNX and
follows the manifest preprocessing will reproduce these figures. In the app, the
same behaviour is visible by scanning a Mikania photo on
https://invatrace.pages.dev/scan — it reports "Invasive in Malaysia: Siam weed".

## Impact / interim mitigation

- In-app, a wrong invasive→invasive label still routes the user to the same
  conservative "report, do not remove" guidance, so the field action is safe even
  when the species label is wrong.
- The OOV native → invasive case is the one to prioritise: it can present a
  native plant as invasive with high confidence.
- On the app side there is no safe one-line fix: the manifest thresholds could be
  retuned, but that is a UX trade-off that needs the confidence distribution and
  a proper eval — i.e. it belongs with this model work, not a blind config edit.
