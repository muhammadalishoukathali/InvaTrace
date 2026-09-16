# Manual QA harness

These are the one-off Playwright scripts I wrote while building InvaTrace, mostly
to look at the app rather than to assert things about it. They are not part of the
graded test suite and they do not run in CI.

**The real end-to-end suite is `e2e/`**, wired to `npm run test:e2e` (plus the
`:model-ui`, `:real` and `:pwa` variants). Start there.

Everything in this folder has its own `playwright.*.config.ts` because each script
needs a different dev server, viewport or mock setup, and I found that easier to
keep straight than one config with a pile of projects in it.

What is here:

| Script | What I used it for |
|---|---|
| `image-harness.spec.ts` | Ran the seven WhatsApp field photos through the capture -> inference flow with and without EXIF. Wrote up in `docs/image-pipeline-report.md`. |
| `known-species-harness.spec.ts` | Same flow with clean Wikimedia photos of catalogue species. |
| `cluttered-species-harness.spec.ts` | Same species again, but photographed in situ with competing plants. |
| `qa-screenshots.spec.ts` | Screenshots of every main screen for supervisor meetings and the writeup. |
| `overflow-audit.spec.ts` | Walks each screen at three widths and flags anything overflowing the viewport. |
| `verify-end-to-end-flow.spec.ts` | Full journey against a real backend, checking the POST response body. |
| `verify-permission-gate.spec.ts` | The permission radio gate on the scan result page. |
| `verify-unsupported-target.spec.ts` | A 31-class species with no catalogue detail entry. |

Run one like this, with the dev server already up:

```bash
npx playwright test --config=e2e-harness/playwright.qa-shots.config.ts
```

Output (screenshots, JSON results) goes to `e2e-harness/.scratch/`, which is
gitignored. Set `QA_OUTPUT_DIR` if you want the screenshots somewhere else.
