# Touchpoint audit — interactive controls in `src/`

Ranking: **BROKEN** = wrong behaviour or traps user, **DEAD** = intentionally inert, **WORKS** = wired to real logic.

## BROKEN

1. **Scan back button wiped state** — `ScanFlowLayout.tsx` did `reset(); navigate(-1)`. On `/scan/result`, `navigate(-1)` jumps to `/map` because capture uses `replace: true`, and `reset()` runs first so the photo/result are gone. Fix: from `/scan/result` go to `/scan` with state kept, from `/scan` go to `/map` and clear. Fixed.
2. **Camera-denied traps prod users** — `ScanCapturePage.tsx:112-159`. Hidden `capture="environment"` fallback input is only used when `getUserMedia` is undefined. Deny → toast, no fallback, gallery upload gated behind `import.meta.env.DEV`. Prod user is stuck.
3. **Restore "Back to private access" reloaded page** — raw `<a href>` in `RestorePrivateAccessPage.tsx:57` bypassed React Router. Switched to `<Link>`. Fixed.
4. **`PrivateAccessLink` was raw anchor** — same reload symptom on landing → restore hop. Internal hrefs now use `<Link>`. Fixed.
5. **`ScanResultPage` has no back + no non-destructive retake** — only "Scan again" (wipes) and the layout back arrow (was broken per #1). Item #1's fix means back arrow returns to `/scan` with state intact.
6. **`ReportWizardPage` first-step back could strand** — `if (isFirst) navigate('/scan/result')` sent you to a page that redirected to blank camera when `useScan.result` was empty. Falls back to `/map` now. Fixed.
7. **`openCamera` requests GPS before camera permission** — `captureScanLocation()` fires unconditionally. GPS prompt shows even if user denies camera. Minor privacy regression.
8. **`startReport` silently no-ops on missing preconditions** — `ScanResultPage.tsx:22-31`. `canReport` only gates on `captureSource === 'camera'`; blob GC or gallery source lets Report button render but click does nothing.
9. **`ReportExtentStep` Continue has no disabled gate** — store defaults `extent: 'small_patch'`, so user advances without actively choosing.
10. **Visibility handler closes camera on any tab hide** — `ScanCapturePage.tsx:48-56`. Any brief backgrounding kills the stream.
11. **`NotificationsPanel` navigates to `n.linkTo` unvalidated** — absolute URLs become `/foo/https:/…`. No `replace` policy.
12. **`ReportTrackingPage` has no back button.**
13. **`PrivateAccessNotice` aria-live only after first render** — screen readers miss first error.
14. **Recovery kit "Save installation again" hidden behind stale `syncMessage`** — no manual retry when `syncMessage` is empty.
15. **`ReportSubmissionResult` "View screening status" trusts server URL** — no validation; absolute URL 404s the SPA.

## DEAD (intentional)

- Sidebar / bottom-tab items for `/trail`, `/sessions`, `/impact` render as disabled `<span role="link" aria-disabled="true">` — no route exists.
- `AppShell` catch-all `<Navigate to="/map" replace />` swallows accidental hits.
- `SightingDetailsSheet` retry — only when query errored.
- `PrivateAccessLandingPage` "Check storage again" — only in `storage-error`.
- `MapLegend` hide button — desktop hides it intentionally.
- DEV-only gallery upload on `ScanCapturePage.tsx:309-322`.
- Access management "Cancel" buttons on rotate/revoke.

## WORKS

Navigation: sidebar "New scan", user chip → `/access`, bottom-tab Scan FAB, mobile `Manage private access`, skip-link.

Report wizard: back arrow (with #6 guard), location step retry + 100 m accuracy gate, consent step checkboxes, preview submit, submission result buttons (modulo #15).

Map: search + clear, filter chips + mobile sheet, pin click, MapLibre controls, sr-only accessible list.

Sighting sheet: close, directions to Google Maps, error retry, a11y focus return.

Recovery kit: copy ID / recovery info, download, ack checkbox, generate replacement codes.

Restore: form submit, `restorePrivate`, redirect to `/map`.

Access management: copy ID, save name, replace codes + confirm, revoke installation + confirm.

Notifications: toggle, mark all read, per-item mark + navigate (modulo #11).

Report queue: banner drawer, retry, retry sync; drawer close, discard, retry.

Report tracking: auto-refetch on `processing` / retryable.

Scan capture: capture, close, retake, discard, analyse, quality pill.

PWA: `ReportQueueStatusBanner` is the only offline surface — retry wired.
