# UT-07 — native look-alike images: content backlog

## Status

The **mechanism** is done and live: when a species has a `native_twin` with a
`referenceImageUrl`, the scan result shows the reviewed look-alike side by side;
when it does not, the UI shows an honest "no reviewed photo yet" state and leans
on the written differences (never a broken image).

What remains is **content**: most invasives still have `native_twin = null`.
Adding each pairing is a botanical + licensing task, not a code change — a wrong
pairing or an unlicensed image is worse than an honest empty state, so each
entry needs sign-off.

Done so far:
- **Mikania micrantha** → *Dicranopteris linearis* (resam fern), image
  `public/reference-images/dicranopteris_linearis.jpg` (Wikimedia · Starr
  Environmental). Live.

## How to add one pairing

Each pairing touches three places and must stay consistent:

1. **Image** — a correctly-licensed photo of the *native* look-alike in
   `public/reference-images/<name>.jpg`. Record the credit.
2. **Backend seed** — `backend/app/seed.py`, the species' `native_twin`:
   ```python
   "native_twin": {
       "id": "<native-species-slug>",
       "name": "<common name>",
       "latinName": "<Latin name>",
       "distinguishingTraits": ["<trait 1>", "<trait 2>", "<trait 3>"],
       "referenceImageUrl": "/reference-images/<name>.jpg",
       "referenceImageCredit": "<attribution>",
   },
   ```
3. **Frontend mock** — the matching entry in `src/mocks/handlers.ts` so the
   demo/offline path matches the API (`NativeTwin` type in `src/types/index.ts`).

The API deploy re-seeds (upsert) automatically — see
`invatrace-deploy-mechanics` memory.

## Candidate pairings — NEED VERIFICATION before use

These are **prompts for a botanist**, not approved facts. For each, confirm the
native look-alike is genuinely the plant people confuse it with in Malaysia,
write the distinguishing traits, and source a licensed image. Do **not** ship
any row until it is verified.

| Invasive | Candidate native look-alike | To confirm |
|----------|-----------------------------|-----------|
| Chromolaena odorata (Siam weed) | ? | is there a commonly-confused native Asteraceae? |
| Lantana camara | ? | native Clerodendrum / Duranta confusion? |
| Mimosa pigra / M. diplotricha | native *Mimosa*/Neptunia | which native congener, and how to tell apart |
| Sphagneticola trilobata (Singapore daisy) | ? | native Wedelia? |
| Leucaena leucocephala | native Falcataria / Adenanthera | seedling/foliage confusion |
| Eichhornia crassipes (water hyacinth) | native *Monochoria* | leaf/flower differences |

Until a row is verified and shipped, that species keeps the honest no-photo
state — which is correct behaviour, not a bug.
