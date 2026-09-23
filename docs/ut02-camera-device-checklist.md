# UT-02 — camera capture: real-device test checklist

The automated side of UT-02 is covered by
`e2e/mobile-robustness.spec.ts` (Pixel 5 project):

- camera stops on interruption and stays within the viewport;
- **a failed `getUserMedia` shows the error and a gallery fallback, and a
  library photo still produces a usable, large preview.**

What automation cannot cover is a real camera on real hardware. Run this
manual pass on the deployed PWA (https://invatrace.pages.dev/scan) before
sign-off. Tick each cell; note the browser build.

| Device / browser | Open camera works | Rear camera used | Capture → preview large & clear | Deny permission → gallery fallback offered | Gallery photo → quality check + Analyse |
|------------------|-------------------|------------------|----------------------------------|--------------------------------------------|------------------------------------------|
| iPhone · Safari  |                   |                  |                                  |                                            |                                          |
| iPhone · Chrome  |                   |                  |                                  |                                            |                                          |
| Android · Chrome |                   |                  |                                  |                                            |                                          |
| Android · Firefox|                   |                  |                                  |                                            |                                          |
| Laptop · Chrome  |                   | (front ok)       |                                  |                                            |                                          |
| Laptop · Safari  |                   | (front ok)       |                                  |                                            |                                          |

Things to watch:
- On iOS Safari the camera only starts from a user gesture and only over
  HTTPS — the deployed PWA is HTTPS, a local `http://` preview is not.
- Denying the permission must land on the error state with **"Choose from
  library"**, never a dead spinner.
- The captured/selected preview should be large (min-height ~70vh / 560px),
  not a thumbnail.
- After backgrounding the tab mid-capture, the camera light must go off
  (stream stopped).
