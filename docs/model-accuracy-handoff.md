# Student33 classifier — accuracy handoff for the model developer

Prepared 2026-09-23, revised 2026-10-11. This is a **model-side** report: the
app's integration is verified correct, so the items below need the person who
trained/exported the model. Nothing here is a web-app bug.

## What changed in the 2026-10-11 revision

Two rows in the original table were wrong about *why* the model missed, and both
have been corrected below:

- **Mikania micrantha is not a model failure.** The original reference photo
  (Commons "Mikania micrantha 129.jpg") did not show Mikania's twining habit or
  heart-shaped leaves. It was replaced on 2026-10-08 (commit `24932bc`); the
  model scores the current photo **0.999 Mikania**. The old photo still scores
  Chromolaena 1.000, so a browser holding a cached copy of it reproduces the old
  result.
- **Lantana camara is not a model class.** It is absent from
  `student33_class_map.json`, so the model cannot answer "Lantana". The photo is
  a correct, unmistakable Lantana; the result (*Asclepias curassavica* 0.997) is
  an **out-of-vocabulary** failure, not an in-vocabulary confusion. It belongs
  with the fern cases under concern 2.

The measurements were also widened from 12 photos to every bundled reference
photo (32 in-vocabulary, 20 out-of-vocabulary).

## TL;DR

On single clean reference photos the model's top-1 is right for **27 of 32**
catalogue species, and only **one** of the five misses is confident. The serious
problem is the other direction: plants the model was never trained on are
**confidently labelled as a catalogue invasive** instead of falling to the
Unknown class.

1. **Unknown class does not catch out-of-vocabulary plants (safety-relevant).**
   8 of 20 out-of-vocabulary photos are returned as a confident catalogue
   species: *Lantana camara* → *Asclepias curassavica* **99.7%**, *Pteris
   vittata* → *Leucaena leucocephala* **91.9%**, *Dicranopteris linearis* →
   *Leucaena* **90.8%**, *Catharanthus roseus* → *Eichhornia crassipes*
   **88.2%**, *Centella asiatica* → *Mikania micrantha* **88.0%**. The Unknown
   probability on these is 0.1-5%. A native plant confidently flagged invasive
   is worse than an honest "unknown".
2. **The Unknown class was effectively never validated.** The export metadata
   reports Unknown support of **2** rows out of 4,827, precision 0.003,
   F1 0.006. There is no open-set evidence behind the shipped thresholds.
3. **Low recall on a few catalogue classes.** One confident-wrong reference
   photo (*Cecropia peltata* → *Leucaena* 77.3%) and four low-confidence wrong
   top-1s. The model's own validation shows recall below 0.50 for three classes.

## Model under test

From `public/models/invatrace-student33-v1/`:

- TinyViT-5M, ONNX FP16, `tinyvit5m_student33_320_fp16.onnx` (SHA in manifest).
- Input `images` `[1,3,320,320]` FP32; output `logits` over 33 classes; index 32
  = Unknown.
- Preprocess (runtime-manifest.json): resize short side → 366, centre-crop 320,
  RGB, normalize mean `[0.485,0.456,0.406]` std `[0.229,0.224,0.225]`.
- Decision: `softmax(logits / 1.4796)`, take max over classes 0–31; **confident
  ≥ 0.55**, handover ≥ 0.30, retake ≥ 0.15, else Unknown.

## Measured results (bundled reference photos, 2026-10-11)

One photo per species from `public/reference-images/`. "Band" is what the app
does with the score: `confident` (>= 0.55) shows the species, `handover`
(0.30-0.55) and `retake` (< 0.30) show an uncertain result.

### In-vocabulary (32 catalogue classes)

24 photos are correct and confident. The other 8:

| Input photo | Top catalogue class | Conf | Unknown-class | Band | Verdict |
|-------------|---------------------|------|---------------|------|---------|
| Cecropia peltata | **Leucaena leucocephala** | 77.3% | 2.3% | confident | confident-wrong |
| Urochloa mutica | **Megathyrsus maximus** | 50.8% | 22.2% | handover | wrong, not shown as a species |
| Striga asiatica | **Asclepias curassavica** | 45.6% | 3.8% | handover | wrong, not shown as a species |
| Paspalum vaginatum | **Eleusine indica** | 45.2% | 11.2% | handover | wrong, not shown as a species |
| Cleome rutidosperma | **Calopogonium mucunoides** | 33.0% | 26.2% | handover | wrong, not shown as a species |
| Acacia auriculiformis | Acacia auriculiformis | 30.4% | 21.9% | handover | right species, under-confident |
| Pennisetum polystachyon | Pennisetum polystachyon | 27.5% | 37.2% | retake | right species, under-confident |
| Rottboellia cochinchinensis | Rottboellia cochinchinensis | 19.1% | 63.6% | retake | right species, under-confident |

Spot values for the species in the original table: Mikania micrantha 99.9%,
Mimosa pigra 83.7%, Eichhornia crassipes 100%, Chromolaena odorata 100%, Bidens
pilosa 88.8%, Leucaena leucocephala 100%, Mimosa diplotricha 95.4%, Parthenium
hysterophorus 100%, Salvinia molesta 99.7%.

### Out-of-vocabulary (20 species that are not model classes)

| Input photo | Top catalogue class | Conf | Unknown-class | Band |
|-------------|---------------------|------|---------------|------|
| Lantana camara | Asclepias curassavica | **99.7%** | 0.1% | **confident** |
| Pteris vittata | Leucaena leucocephala | **91.9%** | 4.9% | **confident** |
| Dicranopteris linearis | Leucaena leucocephala | **90.8%** | 5.3% | **confident** |
| Catharanthus roseus | Eichhornia crassipes | **88.2%** | 1.3% | **confident** |
| Centella asiatica | Mikania micrantha | **88.0%** | 4.7% | **confident** |
| Imperata cylindrica | Pennisetum polystachyon | **82.2%** | 13.2% | **confident** |
| Monochoria vaginalis | Eichhornia crassipes | **77.1%** | 13.7% | **confident** |
| Ageratina adenophora | Chromolaena odorata | **58.6%** | 1.5% | **confident** |
| Colocasia esculenta | Mikania micrantha | 50.7% | 44.2% | handover |
| Cocos nucifera | Limnocharis flava | 47.1% | 13.2% | handover |
| Carica papaya | Asclepias curassavica | 46.4% | 1.6% | handover |
| Macaranga tanarius | Chromolaena odorata | 36.4% | 44.9% | handover |
| Miconia crenata | Psidium guajava | 36.0% | 50.0% | handover |
| Clitoria ternatea | Eichhornia crassipes | 25.2% | 44.8% | retake |
| Mimosa pudica | Mimosa diplotricha | 25.2% | 71.8% | retake |
| Pistia stratiotes | Eichhornia crassipes | 25.0% | 46.9% | retake |
| Neptunia oleracea | Leucaena leucocephala | 19.7% | 73.8% | retake |
| Alternanthera philoxeroides | Asclepias curassavica | 12.8% | 53.9% | retake |
| Sphagneticola trilobata | Bidens pilosa | 10.9% | 88.7% | retake |
| Ageratum conyzoides | Mimosa pigra | 4.4% | 90.4% | retake |

**8 of 20** are presented to the user as a confident catalogue species. The
Unknown class only exceeds 50% for 5 of the 20.

These are single photos, so treat them as a smoke test, not an accuracy figure.

### What the export's own validation says

From `student33_model_metadata.json` (`onnx_fp16.fp16_metrics`, 4,827 rows):

- `accuracy_33` 0.878, `macro_f1_core32` 0.875.
- **Unknown class: support 2, precision 0.003, recall 0.50, F1 0.006.** With two
  Unknown rows the validation set cannot measure open-set behaviour, and the
  precision means roughly 320 catalogue photos were predicted as Unknown.
- Lowest catalogue recall: index 8 *Cleome rutidosperma* 0.43, index 31
  *Urochloa mutica* 0.44, index 25 *Rottboellia cochinchinensis* 0.46, index 18
  *Mimosa diplotricha* 0.59, index 19 *Mimosa pigra* 0.62. Three of these are
  the same species that miss in the table above.
- Small supports: *Cecropia peltata* 7, *Pennisetum polystachyon* 10.

## What is NOT the problem (ruled out on the app side)

- **Class-index → label mapping is correct.** `student33_class_map.json` (what
  the model was trained against, per `student33_model_metadata.json`) and
  `student33_species.json` agree on 32/33 indices; the only difference is index
  23, a synonym (Pennisetum polystachyon = Cenchrus setosus). So a wrong label is
  not a mapping shuffle.
- **Preprocessing matches the app.** The numbers above were produced by
  replicating the app's pipeline (short-side 366 → centre-crop 320 → manifest
  mean/std). 24 of 32 catalogue photos landing correct at high confidence
  confirms the pipeline is essentially right — a broken preprocess would fail
  everything.
- **The two disputed reference photos are the right species.** Mikania was a
  bad photo and has been replaced; the Lantana photo was checked by eye and is
  clearly Lantana camara. The remaining photos come from the provenance importer
  and were not individually re-reviewed for this revision.

## Questions / asks for the model developer

1. **Open-set / Unknown behaviour (highest priority).** The Unknown class
   (index 32) does not fire for genuine out-of-vocabulary plants. Was it trained
   with negative/background examples, and how many? Should the open-set rule be
   strengthened (e.g. an energy/OOD score; the runtime already supports an
   optional `energyThreshold` in the manifest) rather than relying on the
   softmax of a 33rd class?
2. **Open-set eval set.** The validation set has 2 Unknown rows. Can a held-out
   out-of-vocabulary set be built (the 20 species above are a starting list,
   Lantana first) so the thresholds can be fit against real negatives?
3. **Lantana camara.** It is a widely listed invasive, is in the app's legacy
   species list, and is not a model class. Should it be added as a class
   in the next training round? Today a Lantana scan is reported as tropical
   milkweed at 99.7%.
4. **Calibration.** Temperature 1.48 still yields near-100% softmax on
   out-of-vocabulary inputs. Is the temperature fit on a held-out set?
5. **Low-recall classes.** Cleome, Urochloa and Rottboellia are under 0.50
   recall in validation and miss on the reference photos. Is that a data-volume
   problem or label noise? Cecropia has only 7 validation rows.

## How to reproduce

The numbers came from an offline script that runs the shipped ONNX directly with
onnxruntime (Python, CPU): EXIF-transpose → RGB → bilinear resize short side to
366 → centre-crop 320 → manifest mean/std → `softmax(logits / T)`, over the
photos in `public/reference-images/` (underscore-named files; the hyphen-named
ones are legacy duplicates). Any framework that loads the ONNX and follows the
manifest preprocessing will reproduce these figures to within a few points.

In the app the same behaviour is visible on https://invatrace.pages.dev/scan:
scanning the Lantana reference photo reports "Invasive in Malaysia: Tropical
milkweed" (confirmed live 2026-10-11, no PlantNet request sent). When testing in a browser, fetch reference photos with
`cache: 'no-store'`: a browser that cached the pre-2026-10-08 Mikania photo will
otherwise feed the old image to the model and report Siam weed.

## Impact / interim mitigation

- In-app, a wrong invasive→invasive label still routes the user to the same
  conservative "report, do not remove" guidance, so the field action is safe even
  when the species label is wrong.
- The out-of-vocabulary → invasive case is the one to prioritise: it can present
  a native or unlisted plant as a catalogue invasive with high confidence.
- The PlantNet second opinion does not cover this. Since 2026-10-11 every
  *uncertain* result is cross-checked with PlantNet, which helps the 12
  out-of-vocabulary photos that land in the handover/retake bands. The 8
  confident ones never reach PlantNet, because the app trusts a confident
  on-device result.
- On the app side there is no safe one-line fix: the manifest thresholds could be
  retuned, but that is a UX trade-off that needs the confidence distribution and
  a proper eval — i.e. it belongs with this model work, not a blind config edit.
