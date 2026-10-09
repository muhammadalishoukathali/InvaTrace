# Final integrated candidate — Option 2, Scan / Map / Plant Guide

Updated 2026-10-09. Current worktree: `InvaTrace-botany-final`, branch
`feat/general-botany-release`, verified team baseline
`f65a68990a5d6c7d0faed9d2e7ca6b281c091957`.

Zack owns all three entry points. Map and Plant Guide now open the same
`PlantAssistantPanel` and shared botanical pipeline as Scan Result. Scan retains
genuine classifier fields and confidence checks. Map accepts only a genuine public
sighting ID which the backend resolves to a consistent approved catalogue mapping;
Guide accepts an exact approved catalogue reference. Neither creates a scan or
provides confidence. Unsupported Map/Guide contexts give an honest limitation.
Map without a selection offers deterministic help for the existing map controls.

General Knowledge supports **Simpler and Standard only**. The router and generation
service both reject General Detailed; no silent downgrade or provider request occurs.
If an eligible Detailed question needs unresolved semantic review, the backend
returns an explicit evidence-check limitation without claiming a verified gap.
Demonstrably supported Grounded Detailed remains available. Grounded answers retain
all three depths, strict answerability, final grounding and stored citations.
General repeats offer Simpler/Standard, and General output has its own label with
empty sources. Context changes and Map/Guide modal reopening clear conversation state.

LOCKED safety/location/privacy checks have priority; Gemini primary and zero-cost
Groq eligible-failure fallback, models and deadlines remain unchanged. No images,
GPS, marker IDs, private records, identities, credentials, chat history, event data
or whole knowledge pack are sent to providers. No live web retrieval is added.

The integration and UI regressions used **zero real external inference requests**.
The later, separately authorised six-request key validation is recorded below.
After the Event fixture correction, backend regression recorded 1,253 PASS /
11 SKIP, PostGIS 12 PASS and isolated full stack 5 PASS. These are prior run results,
not new executions on this documentation update. Latest UI verification: frontend
308 PASS; 37 Scan and 29 entrypoint browser groups PASS; TypeScript, ESLint and
production build PASS. Baseline formatting and the earlier test-data preservation
caveat remain disclosed in `reports/assistant_final_integration.md`.

Option 2 feature scope is approved. On 2026-10-09 Zack confirmed that the General
Knowledge AC exceptions, Map/Guide entrypoint acceptance criteria and General
Knowledge real-answer human review have already been confirmed. The confirmation
record below supersedes earlier pending statements for those specific decisions.
No commit, push, merge or deployment is authorised or performed by that confirmation.
Historical Detailed results remain traceable and do not describe the supported
release depths. Curated captured-output fixtures are regression inputs, not
approved botanical sources or a substitute for actual live-output records.

## Current acceptance confirmation — 2026-10-09

Evidence: Zack quoted the two outstanding items (General Knowledge AC exceptions
and Map/Guide entrypoint criteria; General Knowledge real-answer human review),
then stated: "这个现在是确认过了的" (these have now been confirmed).
This records Zack's direct confirmation of completed acceptance and review.
Separate review minutes, reviewer identity and the actual review date were not
supplied; none is inferred from the date this confirmation was received.

| Decision / evidence field | Current value | Scope |
|---|---|---|
| AC_SCOPE_APPROVED | YES — confirmed by Zack | The limited AC 8.3.3 / 8.3.5 General Knowledge exceptions and Map/Guide entrypoint criteria discussed above; General Simpler/Standard only, with the existing grounded, safety and privacy rules retained. |
| HUMAN_REVIEW_COMPLETE | YES — confirmed by Zack | General Knowledge real-answer review; confirmation is supplied by Zack, rather than independently inspected review minutes. |
| GENERAL_KNOWLEDGE_HUMAN_REVIEW_PENDING | NO | Supersedes earlier pending-review statements for the supported General Knowledge scope. |
| Actual reviewer name | NOT_PROVIDED | Zack is the confirmation source; this does not identify him as the reviewer. |
| Actual review date | NOT_PROVIDED | 2026-10-09 is the confirmation receipt date only. |
| Exact confirmation | 这个现在是确认过了的 | No additional decision wording or review comments are invented. |
| SAFE_TO_COMMIT / SAFE_TO_PUSH | PENDING | Current candidate whitelist, publication preflight and explicit Git-action authorisation still required. |
| DEPLOYED | NO | No deployment authorisation. |

This confirmation does not approve General Detailed, allocate new story/AC IDs,
rewrite the authoritative DOCX or convert historical source-only 17/17 acceptance
into a new extension-wide 17/17 result. It does not change the recorded technical
outcomes of the separate five-key validation.

### Separate five-key live validation — 2026-10-09

The authorised round consumed exactly 6/6 external inference requests, with no
automatic retries. Direct requests for configured slots 1, 2, 4 and 5 returned
accepted General Simpler answers. Slot 3 timed out; key validity was not determined.
A controlled local Gemini 429 dispatched a real request to slot 2, which timed out:
switch dispatch PASS, complete-answer result REVIEW_TIMEOUT. These observed timeouts
remain technical limitations; they are not rewritten as successful responses by
the acceptance confirmation. No further live request is authorised by this record.

---

## Optional Gemini project failover — 2026-10-09

Zack confirmed that the five keys belong to different projects and that all five
projects have paid billing disabled. This is operator confirmation, not an API
billing audit. No live inference or quota-exhaustion experiment was performed.

The backend accepts five keys **in total** in the existing private `.env`:
`GEMINI_API_KEY` (the existing primary), then `GEMINI_API_KEY_2` through
`GEMINI_API_KEY_5`. Optional entries may remain blank. Set
`GEMINI_KEY_POOL_ENABLED=true` only after verifying every configured project;
`ASSISTANT_GENERATION_FREE_TIER=true` remains required for pool use. The default
is disabled, preserving the existing single-key configuration. Model names and
generation/judge switches are unchanged. Restart the backend after changing its
configuration; a running process does not reload `.env` automatically.

When enabled, the provider adapter keeps using the currently working key. Only
HTTP 429 or an explicit `RESOURCE_EXHAUSTED` result permits the next unique,
nonempty key. Each role is bounded to one attempt per configured Gemini key
(at most five), followed by at most one eligible Groq attempt, within the
unchanged role and overall request deadlines. `allow_fallback=False` also
disables additional-key attempts. Timeout/network/eligible 5xx failures keep
the existing direct Groq route. Invalid content, safety blocks, authentication
errors, schema failures and failed final grounding do not trigger key rotation
as a second opinion. Both providers unavailable still returns the approved
source fallback, or the existing evidence limitation for a failed judge.

Quota cooling is shared across roles using the same pool and model in one
backend process. The minimum is 60 seconds; longer `Retry-After` or structured
`RetryInfo` delays are respected. A recognised daily-quota violation cools until
midnight Pacific time; without timezone data it conservatively waits 25 hours.
Successful keys stay preferred until a quota failure; restarting clears local
cooldown state. Separate server processes do not share that state. Empty and
duplicate keys cannot increase the attempt count. This is not quota monitoring,
and does not promise that all configured projects support the selected model.

[Google's quota documentation](https://ai.google.dev/gemini-api/docs/rate-limits)
applies limits per project, not per key; this feature does not promise five times
the capacity. Operators must comply with
[Google API limitations](https://developers.google.com/terms#d_api_limitations)
and obtain any required provider authorisation; this configuration is not
permission to circumvent provider limits.

All credentials remain `SecretStr` settings and backend request headers. No key
is sent in the model URL, response, frontend bundle, documentation or provider
logs. The same bounded context, backend citations, final grounding and locked
safety/privacy rules remain in force. Local preview remains inference-disabled;
this change does not enable a deployment or modify any AC wording.

---

## Historical validation records (superseded depth scope)

# Safe general botanical knowledge — final bounded live validation

Recorded 2026-10-08, actual calls at 21:28:42–21:28:48 Asia/Kuala_Lumpur
(13:28 UTC). Worktree `InvaTrace-assistant-general-knowledge`, branch
`feat/assistant-general-knowledge`, unchanged HEAD
`f65a68990a5d6c7d0faed9d2e7ca6b281c091957`.

**All three live flows pass structure, routing and empty-source checks. Factual
quality remains REVIEW; integration is not ready.** Exactly **4/4 authorized real
external inference requests** were consumed, including the semantic judge. The
round is stopped. The preceding 13-inference round remains separate and stopped.
No inference retries, metadata requests, credits, billing changes, model changes,
implementation edits, staging, commit, push, merge, deployment or team-main edits
occurred. Authentication stayed in memory and was excluded from captures.

Zack explicitly authorized this four-call round. The existing accounts retain
Zack's 2026-10-08 confirmation of free use with paid billing disabled; the
configuration/model checks match the prior round. This is human confirmation,
not a programmatic account billing audit. Models/timeouts/configuration were
preserved: Gemini `gemini-3.5-flash-lite` (generation and judge), Groq
`openai/gpt-oss-120b`; generation 10s, judge 6s, request 18s.

## Release decisions

| Requested decision | Result | Evidence / limitation |
|---|---|---|
| GENERAL_KNOWLEDGE_LIVE_QUALITY | REVIEW | Structure passes, but entity/site wording and a frequency qualification remain unresolved. |
| GEMINI_DETAILED | REVIEW | Actual detailed output is accepted intact and adds detail; sentence3's modifier scope needs review. This is not another format failure. |
| WAXY_LEAVES | PASS | Two real Gemini calls: strict valid unsupported verdict, then accepted general explanation. Core explanation is reference-consistent; actual human release approval remains pending. |
| GROQ_DETAILED | REVIEW | Automatic fallback and structured output pass; crown claim absent. Sentence2/site scope and sentence4/qualification remain review items. |
| FAILOVER | PASS | Controlled local Gemini429 caused the existing provider router to call real Groq exactly once. |
| SAFETY | PASS | No species assertions, handling/medical/legal/location advice or false citations in the three answers; relevant locked/safety regressions pass. Bounded evidence, not a universal guarantee. |
| HUMAN_REVIEW_PENDING | YES | Actual new reviewer/date/decision/comments remain NOT_PROVIDED. Reference audit is not human approval. |
| AC_SCOPE_APPROVED | PENDING | No new approval for 8.3.3/8.3.5 exceptions or added general depth/repeat acceptance. |
| INTEGRATION_READY | NO | Quality and new approval gates remain open. |

Continuing technical gates: `IMPLEMENTATION_READY=YES` and
`OFFLINE_VALIDATION_READY=YES` mean code/regression readiness only;
`LIVE_PROVIDER_VALIDATED=NO` for the complete factual-quality gate, despite both
providers now working; `HUMAN_REVIEW_COMPLETE=PENDING`, `DEPLOYMENT_READY=NO`.
The released source-only Epic8 retains historical **17 PASS /0 REVIEW**. Its
report, authoritative v2 AC wording and release approval were not altered.

## Actual live requests and validation

The existing FastAPI router ran in an in-process test client with real HTTPS
provider transport. This was not a test of the deployed website. Each real
request was counted and persisted before transport; the exclusive run marker
prevents accidental repetition. Global cap=4 and T2 cap=2 were tested offline
before live execution. No fifth call or budget-blocked extra attempt occurred.
Gemini's T3 429 was a controlled provider failure result, never an external
request; automatic dispatch to real Groq used the normal application router.

| Test | Exact question / depth | Real requests | Provider HTTP / role latency | Local API result / latency |
|---|---|---:|---|---|
| T1 | What is a rhizome? / detailed | 1 | Gemini general: 200 /2074ms | 200; `status=answer`, `answerMode=general_knowledge`; 2088ms |
| T2 | Why do some plants have waxy leaves? / standard | 2 | Gemini judge: 200 /1329ms; Gemini general: 200 /1338ms | 200; same answer status/mode; 2682ms |
| T3 | What is a rhizome? / detailed | 1 | Controlled Gemini429 (0 external); real Groq general: 200 /1877ms | 200; same answer status/mode; 1888ms |

All three have `sources=[]`, `coveredTopics=[]`, no cited source IDs, and the
existing backend safety boundary. Provider parsing and final general output
checks accept each answer unchanged. Gemini finishes STOP; Groq finishes stop.
Only general question/topic/depth or the existing bounded judge context is sent.
No image, GPS, identity, auth/session token, chat history, event or whole pack
was added. The keys authenticate transport only, not model context.

## Concise human review package — exact outputs

The separate local shareable packet is retained at
`.local-data/general-knowledge/bounded-live-20261008/human-review.txt`.
It includes the four exact provider outputs, displayed answers, timings,
concerns and blank/unprovided human-review fields. It is ignored local evidence,
not a new publication candidate. Nothing was sent to a teammate.

Below are the exact provider JSON texts. The API displayed the sentence entries
joined unchanged; the complete exact API bodies and raw texts remain in the
ignored `results.json` ledger. These are recorded outputs, not approved facts.

### T1 — What is a rhizome? (detailed)

gemini / `gemini-3.5-flash-lite`, general_knowledge, HTTP 200:

```json
{
  "topic": "rhizome",
  "sentences": [
    "A rhizome is a modified underground stem that grows horizontally beneath the soil surface.",
    "This specialized stem structure stores nutrients and energy for the plant.",
    "Nodes along the rhizome produce roots and shoots that grow upward into new stems.",
    "It differs from a true root by possessing distinct nodes, internodes, and scale-like leaves."
  ]
}
```

### T2 — Why do some plants have waxy leaves? (standard)

gemini / `gemini-3.5-flash-lite`, judge, HTTP 200:

```json
{
  "decision": "unsupported",
  "species": "Mikania micrantha",
  "supporting_chunk_ids": [],
  "aspect_support": []
}
```

gemini / `gemini-3.5-flash-lite`, general_knowledge, HTTP 200:

```json
{
  "topic": "waxy leaves",
  "sentences": [
    "Waxy leaves feature a protective outer layer composed of cutin that can reduce the loss of internal moisture.",
    "The specialized surface layer also helps repel excess water and protects the underlying tissues from environmental damage."
  ]
}
```

The judge's exact four fields, canonical species, unsupported decision and
both empty arrays pass `explicit_evidence_gap`; no malformed result was
reinterpreted. Local inspection of the unchanged bounded input found one
identification paragraph about vine habit, heart-shaped leaves, stems and flower
heads, with no waxy-leaf cause. Generation followed only that valid verdict.
Provider acceptance of the closed-negative schema is now actually demonstrated.

### T3 — What is a rhizome? (detailed)

groq / `openai/gpt-oss-120b`, general_knowledge, HTTP 200:

```json
{"topic":"rhizome","sentences":["Rhizome is a horizontal underground stem that grows parallel to the soil surface.","It bears nodes and internodes from which roots and shoots can emerge.","Nodes along the rhizome can develop buds that give rise to new shoots, enabling vegetative spread.","Its thickened tissue often stores carbohydrates, helping the plant survive adverse conditions."]}
```

## Sentence-by-sentence independent factual assessment

Every one of the ten answer sentences was checked against already reviewed
botanical references. Six of those public pages were re-read for this audit;
no reference retrieval or content was introduced into production or sent to a
provider. This is a source-based assessment, never model self-evaluation or
actual human release approval. CONSISTENT is preliminary reference consistency,
not source grounding against InvaTrace chunks.

| Test / sentence | Assessment | Reason and supporting reference |
|---|---|---|
| T1 /1 | CONSISTENT | Horizontal modified underground stem matches the reviewed definition. [UMN rhizome anatomy](https://open.lib.umn.edu/horticulture/chapter/1-3-plant-parts-we-eat/), [OpenStax stems](https://openstax.org/books/biology-2e/pages/30-2-stems) |
| T1 /2 | CONSISTENT | Nutrient/energy storage is consistent with fleshy rhizome storage descriptions; it is general education, not a scanned-species claim. [UMN rhizome anatomy](https://open.lib.umn.edu/horticulture/chapter/1-3-plant-parts-we-eat/) |
| T1 /3 | REVIEW | The relative clause may refer only to shoots (plausible), or to roots and shoots together (misleading: roots do not become new stems). This is attachment ambiguity, not a conclusively proven false claim. The intended nodal root/shoot distinction needs clearer wording before factual approval. [OpenStax stems](https://openstax.org/books/biology-2e/pages/30-2-stems), [OSU plant anatomy](https://extension.oregonstate.edu/catalog/em-9904-vegetative-plant-parts) |
| T1 /4 | CONSISTENT | Stem nodes/internodes and scale leaves distinguish rhizomes from true roots. Technical terms are not explained, so comprehensibility still needs human review. [OSU plant anatomy](https://extension.oregonstate.edu/catalog/em-9904-vegetative-plant-parts), [UMN rhizome anatomy](https://open.lib.umn.edu/horticulture/chapter/1-3-plant-parts-we-eat/) |
| T2 /1 | CONSISTENT | The simplified protective cutin-layer/water-loss account is supported by the reviewed educational references. It does not say cutin is the sole component; a reviewer may prefer explicit cuticle/wax terminology. [OSU plant anatomy](https://extension.oregonstate.edu/catalog/em-9904-vegetative-plant-parts), [OpenStax leaves](https://openstax.org/books/biology-2e/pages/30-4-leaves) |
| T2 /2 | CONSISTENT | Water repellence and protection from dehydration/disease are described in the references. Environmental damage is broad wording; do not interpret it as protection against every hazard or permission to handle a plant. [OSU plant anatomy](https://extension.oregonstate.edu/catalog/em-9904-vegetative-plant-parts), [OpenStax leaves](https://openstax.org/books/biology-2e/pages/30-4-leaves) |
| T3 /1 | CONSISTENT | Horizontal underground stem is consistent with the standard general definition. [UMN rhizome anatomy](https://open.lib.umn.edu/horticulture/chapter/1-3-plant-parts-we-eat/), [OpenStax stems](https://openstax.org/books/biology-2e/pages/30-2-stems) |
| T3 /2 | REVIEW | The from-which clause groups nodes and internodes as emergence sites. Reviewed descriptions distinguish nodal buds from intervening internodes. OSU also describes adventitious buds at internodes, so the wording is not universally false; those special stem cases do not independently establish this as a general rhizome explanation. Site/scope qualification remains unresolved. [OSU plant anatomy](https://extension.oregonstate.edu/catalog/em-9904-vegetative-plant-parts), [OpenStax stems](https://openstax.org/books/biology-2e/pages/30-2-stems) |
| T3 /3 | CONSISTENT | Nodal buds, new shoots and vegetative spread are consistent with reviewed accounts. [OSU rhizomes/stolons](https://forages.oregonstate.edu/regrowth/how-does-grass-grow/developmental-phases/vegetative-phase/rhizomes-and-stolons), [UMN forage biology](https://extension.umn.edu/agriculture/crop-production/forages/forage-legumes) |
| T3 /4 | QUALIFICATION_REVIEW | Storage and persistence are supported, including species examples. The material does not establish a cross-species frequency for often or universal thickening. This is not rejected merely for the word often; factual scope must be reviewed. [UMN rhizome anatomy](https://open.lib.umn.edu/horticulture/chapter/1-3-plant-parts-we-eat/), [UMN forage biology](https://extension.umn.edu/agriculture/crop-production/forages/forage-legumes) |

The prior rhizome-to-crown sentence did **not** recur. This does not certify the
new Groq answer. In particular, possible adventitious development prevents
calling its internode wording universally false, but the cited material does not
establish that generic rhizome explanation. Gemini's roots/shoots clause likewise
has a plausible intended reading, but its attachment is ambiguous. Neither is
presented as a conclusively proven false botanical claim. These wording/scope
concerns are why detailed quality is REVIEW rather than forced PASS.

T1 and T3 each contain four sentences/53 words. Saved actual simpler/standard
rhizome samples from the preceding round contain one sentence/16 words and two
sentences/36 words. The new detailed samples retain the horizontal-stem/storage
core and add structure/bud/root distinction or survival detail. Meaningful extra
detail is observed, but useful *accurate* detailed release quality remains under
review. Simpler/standard were not newly regenerated in this four-call round;
new three-level live consistency has not been claimed. The technical depth/repeat
controls pass the relevant offline UI checks.

## Relevant regression and unchanged baseline

No product code changed, so only relevant offline checks ran:

- **817 backend PASS**: general190, failover143, grounding60, bounded safety101,
  hybrid/depth182 and plant-assistant/citations141. These add to817, not817 plus subsets.
- **31 browser groups PASS**, 42 actual local API POSTs, zero real provider calls:
  labels, citations, depth/repeat/reset, locked paths and controlled failover.
- **3 actual-output UI replays PASS**, 5 local replay POSTs, zero extra inference:
  exact new T1/T2/T3 API answers appear intact in the current React panel with the
  general disclaimer/empty sources; 375px and1280px have no overflow/page errors.
  Replays are not new live end-to-end generations.

No PostGIS/full-stack infrastructure or unrelated frontend/build suite was
rerun. The earlier **PostGIS8 PASS /3 FAIL** remains separate baseline evidence:
`test_host_cap_ownership_and_activity_locking`,
`test_event_workers_complete_and_auto_cancel_once`,
`test_event_create_publish_discovery_and_private_host_identity`. These had
already reproduced on unchanged main at the safety-notes publication gate.
No Event policies or teammate fixtures were edited.

## Release recommendation and next human decision

Do not weaken validation or launch another implementation cycle to force a
quality PASS. The smallest proposed release reduction is to **withhold the new
General Knowledge detailed mode** until its entity/site/qualification concerns
are approved; keep the source-only released Epic8 and grounded detail untouched.
Shorter general answers would still need actual human review and AC scope
approval. This proposal was not implemented and does not authorize integration.
The current isolated feature remains unchanged.

Actual new reviewer name/date/decision/comments: **NOT_PROVIDED**. Human reviewers
must inspect the exact outputs for clear entity relationships, factual precision,
readability, useful extra detail, empty citations and correct general labels.
They should explicitly decide the two detailed wording concerns and the cutin/
environmental-protection simplifications. No approval or reviewer identity/date
was inferred from successful generation or references.

AC8.3.3's general evidence-gap exception and AC8.3.5's separate factual-quality
gate remain pending, as does added general depth/repeat acceptance. Existing
source-only wording and17/17 historical approval remain intact. The authoritative
v2 document hash remains
`a3a1b5e690bb42337fbdadfe2f529121229535db3230f0eb8d18cd22be057803`.

Final safety inspection: only this document changed among the11 candidates in
this stage; product files/configuration/models and HEAD are unchanged. Zero files
staged; no Git publication or deployment. Active-key and credential-pattern scans
find zero matches in tracked/candidate content, diff and sanitized review packet.
The actual `.env` remains ignored/untracked in its original location; local
ledgers/logs/screenshots/helpers/dependencies/build output are excluded. Original
main retains its same seven unrelated changes. No external Git fetch occurred.

Remaining blockers: detailed factual/comprehensibility review; actual new human
review evidence; explicit new AC scope decision; separate disposition of known
Event/PostGIS failures and later deployment/combined rollout validation. The
four-call budget is fully consumed and stopped. Any further live request would
require separate explicit authorization; none is proposed or executed here.

---

## Historical checkpoint — offline quality fixes and earlier live evidence

The full preceding offline report and its retained13-inference checkpoint follow.
Its zero-call task count and previously proposed four-call round are historical;
that proposal has now been explicitly authorized and executed as recorded above.
No old failed output or prior gate has been rewritten into a success.

### Historical offline quality fixes

Recorded 2026-10-08 in `InvaTrace-assistant-general-knowledge`, branch
`feat/assistant-general-knowledge`, unchanged HEAD
`f65a68990a5d6c7d0faed9d2e7ca6b281c091957`.

**Offline implementation and validation are ready for a proposed bounded live
round. Integration and deployment remain pending.** This task made **zero real
Gemini/Groq inference calls, zero model-metadata calls and zero web searches**.
The previous 13-inference round stays stopped. No stage, commit, push, merge,
rebase, cherry-pick, PR, deployment or original-checkout edit occurred.

### Current decisions

| Gate | Status | Meaning / remaining evidence |
|---|---|---|
| IMPLEMENTATION_READY | YES | Small offline fixes and permanent regression fixtures are implemented. This is technical readiness for validation, not a factual-quality or release guarantee. |
| OFFLINE_VALIDATION_READY | YES | Intended assistant changes pass full unit, UI, tooling and actual local full-stack checks. Known failing Event/PostGIS cases are reported separately; that suite is not PASS. |
| LIVE_PROVIDER_VALIDATED | PENDING | No post-fix real outputs. Prior Gemini detailed/waxy failures and unapproved Groq sentence remain historical facts; new negative-schema provider compatibility also needs bounded verification. |
| AC_SCOPE_APPROVED | PENDING | New 8.3.3 evidence-gap exception and 8.3.5 quality scope lack actual approval; additional general depth/repeat acceptance also remains pending. |
| HUMAN_REVIEW_COMPLETE | PENDING | No actual new reviewer name, date, decision or comments supplied. General factual accuracy is not inferred from mock/schema success. |
| INTEGRATION_READY | PENDING | Live quality, scope and human-review gates remain open; known Event/PostGIS regression failures require separate disposition. |
| DEPLOYMENT_READY | NO | Integration prerequisites are open; nothing was deployed. |

`GENERAL_KNOWLEDGE_HUMAN_REVIEW_PENDING=YES`.
The earlier approved **source-only Epic 8 result remains 17 PASS / 0 REVIEW**.
Neither its status report nor the authoritative v2 AC document was modified.
These results do not approve the new general-knowledge scope.

### A. Exact Gemini detailed rejection diagnosis

The exact saved L07, L07-recheck and L07-format-recheck payloads were replayed
before changes. All three decoded JSON objects had the required `topic` and
`sentences`, exact topic echo, valid string/count/length checks, distinct entries
and one sentence per entry. The failure occurred in `generate_general`'s final
`safe_general_output` call, not provider JSON parsing or the output envelope.

The original `SUBJECT` expression omitted `Nodes` and `This`; its failed
sentence-start check short-circuited the final validator. Independently,
`CAPITAL_WORDS` also omitted both words and would reject the same ordinary
sentence-initial capitals as potential proper names.

| Saved record | Exact rejected sentence(s), one-based index | Actual rule / structural assessment | Separate factual concern |
|---|---|---|---|
| L07 | 3: “Nodes along the rhizome produce roots below and vertical shoots above.” 4: “This specialized stem structure enables many perennial species to survive unfavorable seasonal conditions.” | `SUBJECT` rejects both starts; capital filter independently rejects `Nodes`, `This`. Both are grammatical generic botanical sentences; they violate the old subject whitelist, not JSON or one-sentence structure. | Root/shoot directions are an oversimplification across plants; survival claims need qualification. Sentence 2's “primarily” asserts an unverified ranking of functions; sentence 5 uses unnecessary jargon. |
| L07-recheck | 3: “Nodes along the stem produce roots pointing downward and new green shoots pointing upward.” | `SUBJECT` rejects `Nodes`; capital filter independently rejects `Nodes`. Valid ordinary sentence structure, disallowed old start. | Directions are simplified; sentence 4's “spread rapidly” is not established generally. |
| L07-format-recheck | 3: “Nodes along the stem produce roots and new upward shoots to form independent individuals.” | Same two `Nodes` rules. Valid ordinary sentence structure, disallowed old start. | New shoots may remain connected; “independent individuals” overstates that relationship. Sentence 4's rapid spread also needs qualification. |

The previous generation instructions demanded the restricted starts, while the
schema's string description only guided them and did not enforce sentence-start
semantics. These model outputs did not obey that old prompt contract. The
application rule was also unnecessarily restrictive for independently reasonable
generic educational subjects. Strengthening instructions alone had already
failed in two rechecks. The small fix therefore corrects the subject false
positive, with matching prompt/schema descriptions and adversarial tests.

The new starts apply only to **later** sentences: rhizome/stolon explanations may
use `Nodes along a/the rhizome/stolon/stem` or `This [specialized] stem structure`;
photosynthesis/pollination may use `This process` or `This [vital] mechanism`.
The first sentence still uses the original subject rules. `Nodes`/`This` are
allowed ordinary capitalized words, while all remaining topic, proper-name,
species, private-detail, restricted-content, citation and structure checks still
run. Arbitrary `This plant`, scanned-stem references, unsafe nodes statements,
URLs and catalogue species are still rejected. This correction follows generic
English grammar and the previously reviewed botanical node/stem descriptions;
no new external reference check or species permission was inferred.

All three exact saved payloads now pass the actual mocked provider/envelope/API
pipeline **without editing, omitting or ignoring any sentence**, and render
intact in the actual React panel with empty sources and the general label.
This resolves the structural defect; it does **not** approve their factual claims.

### B. Waxy-leaves routing and negative judge contract

L04 records a judge call and refusal but does not contain its raw judge payload.
That missing record is preserved as `payload_recorded=false`; it was not
reconstructed. L04-diagnostic contains the actual captured verdict:

```json
{"decision":"unsupported","species":"Mikania micrantha","supporting_chunk_ids":[],"aspect_support":[{"aspect":"Why do some plants have waxy leaves","supporting_chunk_ids":[],"evidence_quotes":[]}]}
```

Actual retrieval classifies the question `NEEDS_SEMANTIC_REVIEW`, reason
`action_condition_or_comparison`. `validate_judgement` does not accept an
unsupported verdict as positive evidence; the extension's separate
`explicit_evidence_gap` then requires the exact four fields, canonical species,
`decision=unsupported` and **both arrays exactly empty**. The nonempty
`aspect_support` is the exact rejection cause. It is not a successful evidence
gap and cannot authorize general generation.

**Option A was selected.** The old policy said to account for each aspect and
then said unsupported/uncertain use empty lists; the old schema permitted
per-aspect records on negative decisions. A general-eligible request now appends
an explicit clarification and a conditional `anyOf` schema: only `supported`
permits per-aspect records; `unsupported`/`uncertain` constrain both arrays to
`maxItems=0`. All four required fields and existing supported-evidence structure
remain. Source-only requests use the unchanged original policy/schema/context;
a direct comparison to the pre-task saved builder proves payload equality.
Application verdict validation was not relaxed and malformed results are never
normalized. Local Ajv checks confirm the old schema accepts the diagnostic
shape, the new schema rejects it, valid unsupported/uncertain/supported shapes
remain structurally accepted, and Groq receives the identical schema. A valid
`uncertain` shape still cannot authorize generation. Provider acceptance of the
conditional schema is **not live-tested**; an API/schema error must remain closed,
not prompt a weaker-schema retry.

**Option B was evaluated and declined here.** Whole-question grammar proves
species-independent educational intent, but lexical absence does not prove that
retrieved evidence lacks a causal/paraphrased answer. This run found related leaf
chunks. No new independently reliable deterministic evidence-gap proof was
available for that semantic case, so bypassing the judge could preempt valid RAG
support. The existing deterministic path for successful retrieval classified as
a normal hard evidence gap remains; it was not expanded.

Offline actual malformed verdict replay still refuses, with zero general calls.
A valid strict negative followed by mocked general generation succeeds, using
one judge plus one generator call. Judge failure/timeout/None/uncertainty/invalid
shape, unsupported species or mixed intent, privacy, locations and injection do
not become generation permission. Successful retrieval with zero matches is
separately tested as a normal gap; retrieval creation/search/classification
exceptions return the existing failure with zero model calls. Synthetic valid
source support wins and still requires source generation plus grounding.

During test preparation, a synthetic source sentence containing `cuticle` was
rejected by the **unchanged** RAG `cut\w*` safety expression, so that test correctly
fell back before grounding. Only the synthetic test phrase was corrected to
“It has waxy leaves that reduce water loss.” The existing RAG guard, botanical
knowledge pack, Event policy and teammate fixtures were not changed. This shows
an existing lexical false positive, not a reason to weaken the grounded lane.

### C. Groq detailed factual quality and limits

The actual L12-detailed sentence remains **unapproved / quality REVIEW**:

> Rhizome often emerges at the soil surface as a crown, from which leaves may arise in some species.

It joins a rhizome/crown relationship with an unestablished “often” frequency.
Previously reviewed [OSU plant anatomy](https://extension.oregonstate.edu/catalog/em-9904-vegetative-plant-parts)
and [OSU rhizome development](https://forages.oregonstate.edu/regrowth/how-does-grass-grow/developmental-phases/vegetative-phase/rhizomes-and-stolons)
distinguish the structures and describe relationships that do not establish that
general model sentence. No new web access occurred in this offline task.
The core underground-stem, node/root/shoot, storage and vegetative reproduction
concepts are consistent with the prior reference audit, but every new sentence
still requires quality review. Schema acceptance is not factual proof.

Generation policy now explicitly prefers concise, well-established structure and
function details, plain words and fewer reliable details. It discourages
speculative elaboration, unsupported frequency/ranking/universal claims and
conflating stems, roots, nodes, shoots and crowns. Detailed mode requests distinct
supported-by-established-botany concepts without padding to five entries;
simpler/standard/detailed caps remain 1/2/5. No word-specific crown ban, citation
fabrication, new knowledge source, factual-verifier model, retry, timeout/token
increase or model substitution was added.

Controlled fixtures cover acceptable explanations, unsafe output, named species,
fabricated citations and URLs. They also deliberately demonstrate the current
limit: the actual crown sentence, “A rhizome is always the most important plant
structure.” and “A rhizome is a root that becomes a crown.” can pass the structural
and safety checks. Those tests explicitly mark the statements **unapproved**;
acceptance is a limitation test, not a correctness label. The validator detects
its defined envelope/format/topic/privacy/species/unsafe/citation boundaries.
It cannot reliably detect botanical entailment, component conflation, incorrect
frequency or universal claims in arbitrary general model text. Better prompts
reduce risk but cannot guarantee factual correctness. This limitation and the
separate human gate remain release blockers.

### D. Mode-specific fallback and lane preservation

Only an opted-in, fully eligible general concept that fails generation or its
semantic-gap verdict uses this neutral message:

> General botanical information is unavailable right now. This is not an answer about the plant in your scan. You can still ask about its approved source information.

It retains `status=insufficient_evidence`,
`answerability=insufficient_evidence`, `answerMode=fallback`, covered topics and
empty sources; it makes no false citation claim. Old clients and locked/species
refusals retain their exact previous messages and citations. Supported RAG
failures retain approved source fallback. A refusal is not relabelled as a
successful general answer. No response status was added or changed.

LOCKED guards still run first. GROUNDED evidence retains priority, same-species
filtering, backend citations and mandatory grounding. GENERAL_KNOWLEDGE remains
an opted-in whole-question concept plus an independently established normal gap,
never a species/safety alternative. Gemini remains primary; configured free Groq
is attempted only on eligible provider failure. Successful invalid/unsafe Gemini
output never triggers Groq. Existing settings, deadlines, budgets and models are
unchanged. General context remains only question/topic/depth; the optional judge
uses its existing bounded evidence context. No image, GPS, identity, token,
auth/session credential, event data, chat history or whole pack was added.

### E. Exact changed-file scope

Eight candidate files were edited/created in this offline task:

1. `backend/app/api/routers/plant_assistant.py` — opt-in judge contract and neutral general failure message.
2. `backend/app/domain/assistant_general_knowledge.py` — narrow generic follow-up subject correction.
3. `backend/app/services/assistant_general_knowledge.py` — aligned sentence guidance and factual-restraint/depth policy.
4. `backend/app/services/assistant_judge.py` — optional closed negative schema/instructions; legacy default preserved.
5. `backend/tests/test_assistant_general_knowledge.py` — 39 additional offline regressions, now 190 total.
6. `backend/tests/fixtures/assistant_general_captured_outputs.json` — permanent exact captured-output fixtures; explicit missing L04 payload.
7. `scripts/check-epic8-local-ui.mjs` — captured detailed output and valid/invalid waxy judge browser cases.
8. `docs/assistant-general-knowledge.md` — current report and retained historical evidence.

Three earlier candidates were preserved byte-for-byte during this task:
`backend/app/services/assistant_provider.py`,
`src/features/scan/PlantAssistantPanel.tsx`,
`scripts/check-epic8-live-ui.mjs`.
Total accumulated extension candidate scope is **11 files**, all unstaged.
Ignored local runners, logs, screenshots, schema/replay evidence, dependencies,
build output and isolated service data are excluded.

### F–H. Executed offline regression and baseline failures

Backend subsets are included in the 1212 total, not additional cases.

| Check | Actual result | Scope / limits |
|---|---|---|
| Full backend unit/default suite | 1212 PASS / 0 FAIL / 10 SKIP | Default opt-in integration module skips; final policy changes included. |
| General knowledge | 190 PASS | Captured three Gemini outputs, strict waxy contract, source priority, errors, eligibility, factual-limit fixtures and all prior adversarial cases. |
| Existing provider failover | 143 PASS | Gemini/Groq HTTP/envelope/configuration guards, mocked only. |
| Existing grounding | 60 PASS | Included; grounded verification unchanged. |
| Existing bounded safety | 101 PASS | Included. |
| Existing hybrid/depth | 182 PASS | Included. |
| Existing plant-assistant API/citations | 141 PASS | Included. |
| Existing latest-AC source-only regressions | 75 PASS | Included; does not approve new scope. |
| Existing suggestions/catalogue | 7 PASS | Included. |
| Frontend | 307 PASS / 43 files | No failures. |
| Offline browser / actual local API | 31 groups PASS / 42 POSTs | Actual ScanResultPage/panel/CSS; captures intact; repeat/depth/reset/locked/failover; mobile 375 and desktop 1280, no overflow/page errors. |
| Saved-output service replay | 4 payloads accepted structurally; malformed judge blocked | All three Gemini plus actual Groq intact; factual approval remains pending. |
| Closed-negative schema audit | All six checks pass | Ajv using existing local dependency; old/new malformed verdict, supported/unsupported/uncertain, identical Groq schema. |
| TypeScript / ESLint | PASS / PASS | Full commands executed. |
| Ruff check / format | PASS / PASS | Six changed/new Python candidates. |
| Production build | PASS | Local build only, no publication. |
| Browser scripts syntax / diff whitespace | PASS / PASS | Live browser script syntax only; not executed. |
| Nine opt-in PostGIS modules | **8 PASS / 3 FAIL** | 11 actual tests; exit 1. This suite is not PASS. |
| Actual API/workers/Postgres/Redis/S3 full-stack | 5 PASS | Actual services with generation/judge disabled and blank provider keys. |
| Literal current Compose build / pinned deployment images | NOT_TESTED | Cached 2024 S3-compatible image used; no full deployment-image build. |

The PostGIS failures are the same three Event publishing cases identified and
reproduced on an unchanged archived team main in the previous task:

- `test_host_cap_ownership_and_activity_locking`
- `test_event_workers_complete_and_auto_cancel_once`
- `test_event_create_publish_discovery_and_private_host_identity`

This run again fails the publication gate with HTTP 422; the latter two report
`safety_notes_required`. No Event safety rule, test fixture or teammate feature
was altered to force green results. The previous unchanged-main reproduction is
retained below; it was not rerun or described as newly executed here.

Infrastructure used a fresh isolated DB
`invatrace_general_qualityfix_20261008`, cloned from the previous isolated release
DB and migrated to current head, Redis test DB 14 and a new S3 test container
`invatrace-general-qualityfix-storage-20261008` with its own bucket/ports.
The source DB and existing service configuration were preserved. Only this
run's API/workers/storage were stopped; its database/container/data were retained.
No storage cleanup or deletion occurred. Existing manual test servers were left
running; they are not claimed to be reloaded with these fixes.

Local evidence is retained under `.local-data/general-knowledge/quality-fix/`:
`before-replay.json`, `after-replay.json`, `schema-validation.json`,
`backend.xml`, command exit records/logs, `browser.log`, UI screenshots and
`infrastructure.json`. All remain ignored. Permanent sanitized regression
fixtures are the sole captured-output publication candidate.

### I. Proposed new bounded live round — NOT EXECUTED

This is a **proposal requiring Zack's explicit approval**, separate from the
stopped previous 13-of-16 round. Proposed maximum: **4 actual external inference
requests total**, including judge calls and any natural provider failover.
No read-only metadata/provider calls or web searches are needed for this proposal.

| Future case | Proposed external allocation | Required observations |
|---|---:|---|
| Real Gemini detailed rhizome | 1 | Actual updated prompt output; valid envelope/format; intact general label, no citations/species claims; independently review factual accuracy and meaningful extra detail against saved simpler/standard samples. |
| Real waxy-leaves flow | 2 | One real semantic judge with closed negative schema; only a valid unsupported verdict permits one real general answer. Supported RAG evidence must still win. Invalid/uncertain verdict refuses. Verify response and factual qualification, no false sources. |
| Controlled Gemini 429 → real Groq detailed rhizome | 1 | Gemini failure simulated locally, not external. Existing router must dispatch one real configured Groq request, with the same bounded general policy. Check intact labels/empty sources and review all added detail, especially structure/frequency claims. |
| Extra call | 0 | No unused fifth-call allowance: waxy-leaves requires two inferences, so the three proposed cases already consume all four. |

Use a shared hard counter **before every outbound inference**; no retry and no
new model. Unexpected natural fallback consumes that same four-call budget and
may leave later cases NOT_TESTED. Waxy supported evidence needing an additional
grounding call cannot overrun its reservation or the total budget: stop/retain
the existing closed source fallback and report the incomplete general test.
A malformed negative verdict is never rewritten merely to obtain a second call.
Preserve current free-only configuration and role/request deadlines; no billing
changes. Capture sanitized outputs only, never authentication headers/keys.
No runner for this proposed live round was executed in this task.

**Demonstrated with zero external calls:** exact saved Gemini structural fixes,
malformed waxy refusal, valid negative plus mock generation, source-only payload
compatibility, strict schema cases, source evidence priority, locked/mixed/private/
location/injection boundaries, eligible-only failover, neutral fallback wording,
UI labels/citations, repeat/depth/reset interactions, full unit/tooling/build
checks and actual isolated infrastructure integration. Mocked detail differences
and replayed past content do not demonstrate future live factual quality.

### J–K. Approval note and remaining blockers

Proposed note for Nikhil, prepared only; **not sent and not approved**:

> The extension adds a clearly labelled General botanical information mode for
> a small set of harmless, species-independent concepts after a verified normal
> evidence gap. Species answers retain approved evidence, grounding and citations;
> safety, medical/legal, handling, permission, location and scan/classifier rules
> stay locked. General output has no source citations and is not verified against
> our knowledge pack. Its checks do not guarantee botanical accuracy. Please
> approve the narrow 8.3.3 generation-on-general-gap exception and a separate
> 8.3.5 factual-quality release gate, with appropriate general depth/repeat
> acceptance. Review the actual post-fix Gemini/waxy/Groq outputs for accuracy,
> useful detail and correct labels before approving release. Existing source-only
> wording and the already accepted provider failover decision remain unchanged.

No reviewer information was invented. Actual new reviewer name/date/decision/
comments remain NOT_PROVIDED; previous source-only review is not extended to this
feature. The authoritative v2 AC hash remains
`a3a1b5e690bb42337fbdadfe2f529121229535db3230f0eb8d18cd22be057803`.

Remaining blockers are: explicit permission for the proposed live round and its
successful quality/schema evidence; separate new AC scope decision; actual human
review of accuracy/depth including the crown and independence/frequency concerns;
separate disposition of the three known Event/PostGIS failures; and deployment
image/combined rollout validation before deployment. Prompt changes alone cannot
close the factual-quality gate. No release, integration or publication approval
has been inferred.

Final local Git/content inspection: expected branch and HEAD preserved, **11
candidate files / 0 staged**. **0 active Gemini/Groq key matches** across all tracked
and candidate files or candidate diff; **0 credential-pattern matches** in
candidates/diff; **0 development-assistant attribution matches** in candidates.
Actual `.env` remains ignored/untracked at its original location, with none copied
into this worktree. Dependencies, build output, logs, screenshot evidence, local
data and temporary helpers are ignored and excluded. The original main checkout
retains its seven pre-existing unrelated changes; prior integration checkout stays
clean. No external Git fetch was performed in this offline task; the previously
fetched `team/main` still equals HEAD, so this does not assert current remote
freshness. Re-check remote changes only at an authorized later integration step.

---

### Historical checkpoint — preceding hardening and 13-inference round

The complete preceding report is retained below as historical evidence. Its
“current/final” wording, nine-file scope, old gate values and failed L07/L04
results refer to that earlier checkpoint; the offline results above supersede
its local implementation checks. No past live result, factual concern, source-only
AC decision or human-review status was rewritten into a success.

#### Historical hardening review

Recorded 2026-10-08. Worktree `InvaTrace-assistant-general-knowledge`, branch
`feat/assistant-general-knowledge`, HEAD and latest fetched team main
`f65a68990a5d6c7d0faed9d2e7ca6b281c091957`.

**The extension is not ready for integration or deployment.** Safety and routing
regressions pass, and real Gemini/Groq generation is demonstrated. Required live
quality checks remain unsuccessful, three existing PostGIS tests fail on both
this branch and unchanged main, the new AC scope is unapproved, and the new
human review is pending. No commit, staging, push, merge, PR or deployment occurred.

#### Initial audit and concrete changes

The nine candidate files and their unchanged dependencies were inspected:
`plant_assistant` retrieval/classification/private-detail/hazard logic,
`assistant_generation` depth limits, `assistant_judge` protocol/validation,
`assistant_grounding` final evidence verification, provider dispatch, API schema,
rate limiter, catalogue mapping and temporary React scan state.

The actual defects found were:

1. General generation passed `allow_fallback=False`, bypassing the approved
   Gemini-primary/Groq-secondary router. Removed only that per-call suppression.
2. The complete-question grammar accepted “a simple leaf and a compound leaf”
   but missed the required “simple and compound leaves” form. Added the optional
   first leaf noun while retaining `fullmatch` of the entire question.
3. Real general outputs did not consistently obey the existing sentence-start
   contract. Strengthened the general prompt and sentence item description,
   preserving all validators, provider settings, schemas' required fields and
   sentence limits. Photosynthesis subsequently passes formatting; Gemini
   detailed rhizome still fails. This remains an unresolved quality gap.

Added bounded failure/configuration/exception/output regression cases, general
repeat/scan-reset/locked-repeat/browser failover checks, and actual live failure
fixtures. Initial browser extension failed because its test selector used the
visible “Simpler” text instead of its accessible “Simpler explanation” name;
the corrected harness passes. Initial ESLint found an empty catch in the ignored
manual test helper; a comment documents that bounded readiness poll, and the
complete lint rerun passes. Neither required a product-policy change.

Exactly five of the existing nine publication candidates were edited in this
stage: domain eligibility, general service, general tests, local browser script
and this document. Existing router, provider adapter, panel and live browser
script retain the earlier extension changes. Ignored local scripts/evidence are
not publication candidates. No classifier, species mapping, knowledge pack,
retriever, semantic judge, grounding, auth, event, permission or production
configuration file was changed.

#### Final routing, policy and provider contract

Safety/rate/scan/confidence/species/privacy checks run first. Supported RAG
always wins. Retrieval and answerability precede general generation.

- **LOCKED:** existing deterministic privacy, hazard, safety, medical/legal,
  permission, handling/removal, local-presence, identification and species
  restrictions retain their controlled sourced answer or refusal.
- **GROUNDED:** supported species evidence uses the existing generator, protected
  paragraphs, backend-owned citations and mandatory final grounding. A generation
  or grounding failure retains approved source fallback, never general knowledge.
- **GENERAL_KNOWLEDGE:** an opted-in client, a normal evidence gap and a fully
  eligible species-independent concept may receive model education. It has
  `status=answer`, `answerability=answerable`, `answerMode=general_knowledge`,
  empty `sources`/`coveredTopics`, and no `used_chunk_ids`.

Other responses retain `answerMode=fallback`. Validated RAG generation uses
`answerMode=grounded`. General output safety is **not source grounding or proof
of botanical accuracy**. Its model facts are never attributed to catalogue chunks.

General now calls the existing provider router with its normal fallback default:
Gemini success returns that payload without Groq; only 429, quota exhaustion,
timeout/network or supported transient 500/502/503/504 can attempt configured
Groq once. The same general policy, context and schema reach Groq and the same
application validator accepts or rejects its output. HTTP 400/401/403/404/422,
missing/invalid primary configuration and successful but policy-invalid output
cannot obtain a second provider opinion. Missing/invalid/disabled Groq means no
secondary call. Both-provider failure retains `insufficient_evidence` for the
normal general evidence gap. Existing supported-source fallback remains unchanged.

No retry loop, model substitution, longer deadline or new provider was added.
The configured generation cap remains 10 s, judge cap 6 s and total request cap
18 s. When Groq is configured the existing router reserves half the role budget
for Gemini and the remaining time for Groq. Output budget stays 1200 tokens,
temperature 0, sentence counts simpler 1 / standard 2 / detailed 5.

#### Eligibility and failure boundaries

The entire English question must match a closed concept grammar: definitions
of rhizomes, stolons, annual/perennial/biennial plants, photosynthesis, pollination,
simple/compound leaves or waxy leaves; the specified why/how explanations for
waxy leaves, photosynthesis, climbing and flowers; and only annual/perennial or
simple/compound comparisons. Case/whitespace variants are permitted. This is
intentionally conservative; arbitrary paraphrases, greetings, new concepts,
species comparisons, locations, scanned-plant references, appended instructions
and multi-intent questions do not qualify.

Only `missing_evidence` or `missing_requested_topic_evidence` normally qualify.
`excluded_or_undocumented_aspect` qualifies solely for the two fully matched
concept comparisons. Twelve other forced hard-block reasons, concept definitions
under that exclusion, and all requested mixed/negative examples were exercised
and remain blocked. A shared word such as “leaf”, “flower” or “difference” is
never sufficient.

If the upstream classifier requires semantic review, only the strict completed
`unsupported` verdict for the exact species with both empty arrays grants a gap.
Disabled/missing judge, error, timeout, uncertainty or malformed verdict does not.
Actual waxy-leaves output says unsupported but includes a nonempty
`aspect_support` array; it is rejected rather than normalized into permission.
Retrieval/configuration/knowledge corruption and transport failures are not
normal evidence gaps. Supported-answer grounding failures also cannot route to
this lane.

Schema/topic echo, sentence length/count, duplicates, one sentence per entry,
restricted content, proper names/catalogue species, private details, links and
citation markers remain checked. They can reject harmless prose and cannot
prove semantic factual correctness. The real detailed Groq sample below
illustrates the need for the separate human-quality gate.

#### API, UI and compatibility

`allowGeneralKnowledge` remains optional and defaults false for old clients.
The new panel opts in. Backend tests show an old request without the flag retains
source-only behaviour. Existing response fields/statuses are preserved and
`answerMode` is additive. An old backend rejects the new flag (`extra=forbid`),
so the planned order remains: backend capability first; old frontend/new backend
verification; updated frontend; combined verification. No deployment occurred.

The panel shows **General botanical information** and exactly:

> This explanation uses general model knowledge. It has not been verified against InvaTrace sources and makes no claim about the plant in your scan.

General responses have no citation list; the panel also suppresses misleading
sources if a malformed general server response contains them. Source-supported
answers keep real citations and licence/attribution. Failure messages retain the
existing behaviour and no raw provider errors are displayed. Real React scan
components were tested at 375 and 1280 px with no horizontal overflow/page errors.

Trim/case repeats produce a clarification without a POST. Choosing a level sends
only that question/depth/current classifier fields and capability flag, no chat
history. Scan/species/confidence changes clear answer/repeat state; locked repeats
remain refused with zero model calls. Existing current-session bounds are unchanged.
Plant Guide and Map remain out of scope.

#### Executed regression

Counts below are actual executions. Named backend subsets are included in the
1173 total, not additional cases.

| Suite | PASS | FAIL | SKIPPED / limits |
|---|---:|---:|---|
| Complete backend after final hardening | 1173 | 0 | 10 default opt-in integration module skips |
| General-knowledge subset | 151 | 0 | 0 |
| Existing provider failover subset | 143 | 0 | 0 |
| Existing grounding subset | 60 | 0 | 0 |
| Existing bounded safety subset | 101 | 0 | 0 |
| Existing hybrid/depth subset | 182 | 0 | 0 |
| Plant-assistant API subset, including citations | 141 | 0 | 0 |
| Latest-AC source-only regression subset | 75 | 0 | 0; not new AC approval |
| Suggestions/catalogue subset | 7 | 0 | 0 |
| Frontend unit tests | 307 | 0 | 0; 43 files |
| Offline browser + actual local API | 26 groups | 0 | 0; 34 local POSTs, 0 live model calls |
| Exact real-output replay through current UI | 17 records | 0 | 0; 22 local POSTs, 0 new model calls |
| Nine opt-in PostGIS modules | 8 | 3 | 0; 11 tests |
| Unmodified main reproduction of three failing PostGIS cases | 0 | 3 | 0 |
| Real API/workers/Postgres/Redis/MinIO full-stack suite | 5 | 0 | 0 |
| Literal current Compose build and pinned deployment images | — | — | NOT_TESTED |
| TypeScript | PASS | 0 | executed |
| ESLint after local helper correction | PASS | 0 | full command executed |
| Ruff check and format | PASS | 0 | five changed/new Python files |
| Frontend production build | PASS | 0 | executed |
| Both browser scripts' syntax; diff whitespace | PASS | 0 | live browser script not executed |

The three PostGIS failures are unchanged event fixtures publishing without
required safety notes: `test_host_cap_ownership_and_activity_locking`,
`test_event_workers_complete_and_auto_cancel_once`, and
`test_event_create_publish_discovery_and_private_host_identity`. The latter two
explicitly return `safety_notes_required`, HTTP 422; the first fails at the same
publish gate. All three reproduce on an isolated `git archive` of unmodified
HEAD/main. No event policy or teammate fixture was changed to make them pass.

The existing isolated PostGIS/Redis containers were reused. A new test database
`invatrace_general_hardening_20261008` cloned the previous isolated release DB;
only that copy migrated 20261002_23→20261007_24. Redis test DB 14 and a new local
S3-compatible container/bucket isolated this run. The five full-stack cases use
actual API/workers, DB, Redis and object storage, including upload, validation,
private access, report/sighting lifecycle and installation restoration. Models
were disabled throughout infrastructure tests. This is actual service integration,
not a literal build of the current Compose project: cached local MinIO
`RELEASE.2024-12-18T13-15-44Z` differs from the pinned 2026 Compose images.
That image/orchestration check remains NOT_TESTED; it is not counted as PASS.

Only this run's API/workers/storage were stopped. Its DB/container/data were
retained. Existing services, user test pages and the original checkouts were
preserved. No storage cleanup or deletion occurred.

Historical pre-hardening local evidence (before this task): 93 focused cases
included in 1115 backend passes/10 skips, 307 frontend passes, 22 browser groups
with 29 local POSTs. Those model outputs were mocked. The current results above
supersede that checkpoint for this local extension; neither set proves release
approval.

#### Bounded real-provider validation

Zack explicitly confirmed on 2026-10-08 that both current accounts are free and
paid billing is disabled. This is operator confirmation, not an API billing audit.
Existing credentials were loaded only in memory from the existing ignored local
configuration. No config, key, model or account was changed or copied here.
Read-only model metadata GETs both returned 200 and confirmed the configured
models. These two metadata GETs are not inference calls.

- Gemini generation/judge: `gemini-3.5-flash-lite`.
- Groq: `openai/gpt-oss-120b`, enabled, strict existing JSON-schema mode.
- Actual external inference requests: **13 / 16 cap**, comprising 11 Gemini
  (including 2 semantic-judge calls) and 2 Groq general calls.
- Four controlled provider failures were local simulations, not external calls.
- No intentional quota exhaustion, provider retry loop, external inference
  after this bounded set, or answering-model self-judgement was used.

All requested L01–L13 categories were exercised, with scenarios combined where
possible. L04 and Gemini L07 remain **FAIL for useful-answer delivery / safe
rejection PASS**. L02 initially failed formatting and finally delivers a labelled
answer after the item-description clarification. L12 real Groq output passes the
same schema/application boundary after controlled Gemini429. Its detailed
supplement has a factual question for human review. L13 both-controlled-failure
returns the normal limitation. L08–L10 send zero provider requests.

API output text below was replayed byte-for-text through the current panel;
17 records display exactly their returned answer with the correct label/source
rules. This replay uses recorded real output and makes no inference request.
It verifies rendering, not a new live browser/provider end-to-end session.
All general answers below have empty sources and no used chunk IDs; refusal
sources, where present, are related sources and do not claim to answer the question.

| Case | Depth | Final mode/status | External requests | API latency ms | Eligibility / retrieval reason | Provider outcomes |
|---|---|---|---:|---:|---|---|
| L01/L06/L11 | standard | general_knowledge / answer | 1 | 1150 | rhizome; missing_evidence | gemini general_knowledge HTTP 200 (real, 1143 ms) |
| L02 | standard | fallback / insufficient_evidence | 1 | 1332 | photosynthesis; missing_evidence | gemini general_knowledge HTTP 200 (real, 1328 ms) |
| L03 | standard | general_knowledge / answer | 1 | 1226 | annual and perennial plants; excluded_or_undocumented_aspect | gemini general_knowledge HTTP 200 (real, 1219 ms) |
| L04 | standard | fallback / insufficient_evidence | 1 | 1250 | waxy leaves; action_condition_or_comparison | gemini judge HTTP 200 (real, 1245 ms) |
| L05 | simpler | general_knowledge / answer | 1 | 1011 | rhizome; missing_evidence | gemini general_knowledge HTTP 200 (real, 1006 ms) |
| L07 | detailed | fallback / insufficient_evidence | 1 | 1564 | rhizome; missing_evidence | gemini general_knowledge HTTP 200 (real, 1560 ms) |
| L08 | standard | fallback / insufficient_evidence | 0 | 4 | ineligible; excluded_or_undocumented_aspect | none |
| L09 | standard | fallback / insufficient_evidence | 0 | 3 | ineligible; excluded_or_undocumented_aspect | none |
| L10 | standard | fallback / insufficient_evidence | 0 | 4 | ineligible; excluded_or_undocumented_aspect | none |
| L12 | standard | general_knowledge / answer | 1 | 942 | rhizome; missing_evidence | gemini general_knowledge HTTP 429 (controlled, 0 ms); groq general_knowledge HTTP 200 (real, 935 ms) |
| L13 | standard | fallback / insufficient_evidence | 0 | 7 | rhizome; missing_evidence | gemini general_knowledge HTTP 429 (controlled, 0 ms); groq general_knowledge HTTP 503 (controlled, 0 ms) |
| L02-recheck | standard | fallback / insufficient_evidence | 1 | 1573 | photosynthesis; missing_evidence | gemini general_knowledge HTTP 200 (real, 1565 ms) |
| L07-recheck | detailed | fallback / insufficient_evidence | 1 | 1220 | rhizome; missing_evidence | gemini general_knowledge HTTP 200 (real, 1214 ms) |
| L04-diagnostic | standard | fallback / insufficient_evidence | 1 | 1419 | waxy leaves; action_condition_or_comparison | gemini judge HTTP 200 (real, 1415 ms) |
| L02-format-recheck | standard | general_knowledge / answer | 1 | 1813 | photosynthesis; missing_evidence | gemini general_knowledge HTTP 200 (real, 1802 ms) |
| L07-format-recheck | detailed | fallback / insufficient_evidence | 1 | 1265 | rhizome; missing_evidence | gemini general_knowledge HTTP 200 (real, 1259 ms) |
| L12-detailed | detailed | general_knowledge / answer | 1 | 1509 | rhizome; missing_evidence | gemini general_knowledge HTTP 429 (controlled, 0 ms); groq general_knowledge HTTP 200 (real, 1501 ms) |

##### Exact response records and failures

**L01/L06/L11 — What is a rhizome? (standard)**

Displayed answer:

> A rhizome is a modified plant stem that grows horizontally underground, typically producing roots and shoots at its nodes. It serves as a storage organ for nutrients and enables perennial plants to propagate vegetatively over time.

**L02 — What is photosynthesis? (standard)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Rejected provider output, preserved for review:

```json
{
  "topic": "photosynthesis",
  "sentences": [
    "Photosynthesis is the biochemical process by which green plants, algae, and some bacteria convert light energy into chemical energy.",
    "This process typically uses sunlight, water, and carbon dioxide to produce oxygen and energy-rich sugars."
  ]
}
```

**L03 — What is the difference between annual and perennial plants? (standard)**

Displayed answer:

> Annual plants complete their entire life cycle from germination to seed production within a single growing season. Perennial plants persist through multiple growing seasons, often going dormant during unfavorable conditions and resuming growth when the environment improves.

**L04 — Why do some plants have waxy leaves? (standard)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Related source links (not answer support): [Mikania vine](https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/biosecurity/plants/invasive/restricted/mikania-vine), [National Action Plan on Invasive Alien Species 2021–2025](https://www.doa.gov.my/doa/resources/aktiviti_sumber/sumber_awam/penerbitan/buku/national_action_plan_on_invasive_alien_species_2021-2025.pdf)

**L05 — What is a rhizome? (simpler)**

Displayed answer:

> A rhizome is a modified underground plant stem that grows horizontally and produces roots and shoots.

**L07 — What is a rhizome? (detailed)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Rejected provider output, preserved for review:

```json
{
  "topic": "rhizome",
  "sentences": [
    "A rhizome is a modified plant stem that typically grows horizontally underground.",
    "It functions primarily as a storage organ for starches, proteins, and other nutrients.",
    "Nodes along the rhizome produce roots below and vertical shoots above.",
    "This specialized stem structure enables many perennial species to survive unfavorable seasonal conditions.",
    "It also facilitates vegetative propagation and lateral colony expansion across the soil matrix."
  ]
}
```

**L08 — When does Mikania micrantha flower? (standard)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Related source links (not answer support): [Mikania vine](https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/biosecurity/plants/invasive/restricted/mikania-vine)

**L09 — Can I eat this plant? (standard)**

Displayed answer:

> The reviewed sources do not document this hazard. This does not establish that the plant is safe to touch, eat or handle.

Related source links (not answer support): [Mikania vine](https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/biosecurity/plants/invasive/restricted/mikania-vine)

**L10 — What is a rhizome, and is my scanned plant poisonous? (standard)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Related source links (not answer support): [Mikania vine](https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/biosecurity/plants/invasive/restricted/mikania-vine)

**L12 — What is a rhizome? (standard)**

Displayed answer:

> A rhizome is a horizontal underground stem that produces roots and shoots. It enables vegetative spread and serves as a storage organ for nutrients.

**L13 — What is a rhizome? (standard)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

**L02-recheck — What is photosynthesis? (standard)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Rejected provider output, preserved for review:

```json
{
  "topic": "photosynthesis",
  "sentences": [
    "Photosynthesis is the biological process by which green organisms convert light energy into chemical energy.",
    "This vital mechanism typically uses sunlight, water, and carbon dioxide to produce oxygen and energy-rich sugars."
  ]
}
```

**L07-recheck — What is a rhizome? (detailed)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Rejected provider output, preserved for review:

```json
{
  "topic": "rhizome",
  "sentences": [
    "A rhizome is a specialized underground stem that typically grows horizontally beneath the soil surface.",
    "It stores starches, proteins, and other nutrients to help the plant survive unfavorable seasonal conditions.",
    "Nodes along the stem produce roots pointing downward and new green shoots pointing upward.",
    "Its growth pattern allows many perennial plants to spread rapidly and colonize adjacent areas over time."
  ]
}
```

**L04-diagnostic — Why do some plants have waxy leaves? (standard)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Related source links (not answer support): [Mikania vine](https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/biosecurity/plants/invasive/restricted/mikania-vine), [National Action Plan on Invasive Alien Species 2021–2025](https://www.doa.gov.my/doa/resources/aktiviti_sumber/sumber_awam/penerbitan/buku/national_action_plan_on_invasive_alien_species_2021-2025.pdf)

Rejected provider output, preserved for review:

```json
{
  "decision": "unsupported",
  "species": "Mikania micrantha",
  "supporting_chunk_ids": [],
  "aspect_support": [
    {
      "aspect": "Why do some plants have waxy leaves",
      "supporting_chunk_ids": [],
      "evidence_quotes": []
    }
  ]
}
```

**L02-format-recheck — What is photosynthesis? (standard)**

Displayed answer:

> Photosynthesis is the biological process by which organisms convert light energy into chemical energy. It uses sunlight, water, and carbon dioxide to produce oxygen and energy-rich sugars.

**L07-format-recheck — What is a rhizome? (detailed)**

Displayed answer:

> The approved sources for this plant do not answer that question. Try asking what it looks like, where it grows, what its impacts are or how to respond safely.

Rejected provider output, preserved for review:

```json
{
  "topic": "rhizome",
  "sentences": [
    "A rhizome is a modified underground stem that grows horizontally just beneath the soil surface.",
    "It stores starches and proteins to help the plant survive unfavorable seasons.",
    "Nodes along the stem produce roots and new upward shoots to form independent individuals.",
    "Its growth habit allows certain species to spread rapidly across large areas over time."
  ]
}
```

**L12-detailed — What is a rhizome? (detailed)**

Displayed answer:

> Rhizome is a horizontal underground stem that produces roots and shoots from its nodes. Rhizome stores nutrients such as carbohydrates, allowing the plant to survive adverse conditions. Rhizome enables vegetative propagation, so new plants can arise without seeds. Rhizome often emerges at the soil surface as a crown, from which leaves may arise in some species.

#### Independent factual assessment and depth quality

This is a preliminary reference check, **not human approval or source grounding**.
The reviewed references below were used only for this audit. No website/search
or external botanical API was added to runtime, no reference text was sent to a
provider, and no knowledge-pack fact/citation was added.

The horizontal modified-stem, nodes/shoots, storage and vegetative-reproduction
core in rhizome samples is consistent with [University of Minnesota plant
anatomy](https://open.lib.umn.edu/horticulture/chapter/1-3-plant-parts-we-eat/)
and [UMN forage biology](https://extension.umn.edu/agriculture/crop-production/forages/forage-legumes).
Waxy cuticle/water loss and leaf structure are covered by [OpenStax leaves](https://openstax.org/books/biology-2e/pages/30-4-leaves).
Photosynthetic light-to-chemical-energy conversion is consistent with
[OpenStax photosynthesis](https://openstax.org/books/biology-2e/pages/8-1-overview-of-photosynthesis).
Annual/perennial longevity is compared in [University of Maryland Extension](https://extension.umd.edu/resource/perennials-selection-planting-and-care).
These checks provide limited independent plausibility evidence, not exhaustive
support for every model clause.

Questions retained for human review:

- Actual Groq detailed sentence: **“Rhizome often emerges at the soil surface as
  a crown, from which leaves may arise in some species.”** This mixes rhizome/crown
  relationships and an unestablished “often” frequency. [Oregon State plant
  anatomy](https://extension.oregonstate.edu/catalog/em-9904-vegetative-plant-parts)
  distinguishes compressed crown stems from underground rhizomes;
  [OSU grass rhizomes](https://forages.oregonstate.edu/regrowth/how-does-grass-grow/developmental-phases/vegetative-phase/rhizomes-and-stolons)
  describes shoots arising from rhizomes and rhizomes arising in the crown zone.
  That does not verify the sample's general claim. **Quality REVIEW; not approved.**
- Final photosynthesis sentence: **“It uses sunlight, water, and carbon dioxide
  to produce oxygen and energy-rich sugars.”** Appropriate as a simplified account
  of plant/oxygenic photosynthesis, but the preceding “organisms” is broader;
  qualification is worth reviewing. No universal-correctness claim is made.
- Actual annual/perennial sample says **“Perennial plants persist through multiple
  growing seasons”** rather than explicitly distinguishing perennials from
  two-season biennials. The general explanation is plausible but needs a reviewer
  to assess whether the distinction is sufficiently clear.
- Rejected Gemini detailed sentence: **“Nodes along the stem produce roots and
  new upward shoots to form independent individuals.”** Rejected for sentence
  form; its wording about independent individuals also merits qualification.

None of the displayed general samples claims a property of the scanned species,
local presence, legal permission, medical use or handling safety. No fabricated
sources or IDs were observed. That bounded observation is not a semantic
safety guarantee for future outputs.

The common rhizome topic produces a 16-word, one-sentence simpler answer and
36-word, two-sentence standard answer with additional storage/propagation concepts.
The Groq detailed supplement has 56 words/four sentences and adds survival,
seedless reproduction and the questionable crown claim. These are substantive
changes, but **the full three-level quality requirement is not PASS**: the Gemini
detailed answer is consistently refused, and Groq's additional detail still needs
factual review. Technical repeat/controls/reset tests pass; live educational-depth
quality remains unresolved. No repeat sends conversation history to a provider.

#### Authoritative AC review and minimum proposed clarification

Re-read the latest v2 document
`InvaTrace_Iteration_3_Epics_User_Stories_ACs_Epic8_Updated_v2.docx`, SHA256
`a3a1b5e690bb42337fbdadfe2f529121229535db3230f0eb8d18cd22be057803`, and
`reports/epic8_17_ac_final_status.md`. Neither document/status record was changed.
The historical source-only release retains **17 PASS / 0 REVIEW** with its
explicit team-accepted 8.1.5 failover exception and prior Groq review attestation.
That approval does **not** cover these new general outputs.

Literal wording and new scope:

| AC | Original v2 wording | Proposed additional scope / reason | Evidence needed | New-scope approval |
|---|---|---|---|---|
| 8.1.3 | Given the assistant has explained the scan result; when the user asks for a simpler or more detailed explanation; then it adjusts detail while keeping claims consistent with approved retrieved information. | Keep this species rule. For labelled general education, levels must remain on the same concept and differ usefully without implying scanned-species facts. This is an added educational-quality requirement, not permission to alter RAG claims. | Useful accurate real simpler/standard/detailed answers; current detailed quality unresolved. | PENDING |
| 8.1.5 | Given relevant source information has been retrieved but Gemini is unavailable or its quota is exhausted; when a question is submitted; then return retrieved source information. | Retain the already accepted team exception: eligible Gemini failure → available configured Groq; both unavailable → approved source fallback where support exists. A general gap has no supported source answer and retains its limitation if both fail. No new reinterpretation or wording change. | Existing source-only tests plus general failover/both-failure cases; executed. | Existing exception retained; new extension not automatically approved |
| 8.1.6 | Given an answered question about the scanned species in the current conversation; repeat ignoring case/spaces; offer simpler/detailed then provide approved-evidence-grounded explanation for the same species. | Preserve this species-specific rule. Extend the temporary repeat interaction to labelled general concepts with the same mode, no invented citations and no classifier/history change. | Repeat/clarification/reset/locked-repeat tests pass; useful live general depth remains pending. | PENDING for additional scope |
| 8.2.4 | Given an answer about the species; when read; factual claims are supported by retrieved information and contain no fabricated citations. | No exception: species claims remain evidence-bound; general education explicitly disclaims being about the scanned species. | Grounded priority, grounding, source controls, species-output rejection and UI label tests; executed. | Existing scope preserved |
| 8.3.2 | Given sufficient evidence for the specific unanticipated question; return only evidence-grounded answer and stored source names/URLs; a shared keyword is not enough. | No exception: sufficient evidence always takes priority. | Existing answerability/grounding/citation and positive-priority tests; executed. | Existing scope preserved |
| 8.3.3 | Given insufficient retrieved evidence; backend skips answer generation and returns a limitation with insufficient_evidence status, retrieved sources and covered species topics. | Narrow educational exception may generate a labelled general answer only after complete-question eligibility and a valid normal gap; otherwise retain refusal. Direct literal conflict requires approval. | Conservative whole-question and hard-block tests, actual output set, scope decision; approval missing. | REVIEW / PENDING |
| 8.3.5 | Given a generated answer before release; answer and supporting chunks are reviewed; it passes only when factual claims are supported by those chunks and displayed sources match. | Preserve for GROUNDED. General education has no RAG chunks and needs a distinct factual/comprehensibility/safety release gate, with empty sources and explicit label. Direct literal conflict requires approval. | Independent quality checks, actual human review, accepted depth/failover samples; not complete. | REVIEW / PENDING |

Proposed addition, **not approved and not applied to the authoritative document**:

> Species-specific and safety-sensitive answers retain reviewed evidence,
> backend citations, grounding and all locked policies. Only clearly eligible
> species-independent botanical education, after a validated ordinary evidence
> gap, may receive an explicitly labelled general-knowledge explanation with no
> source citations or scanned-species claim. Retrieval/judge failures do not
> authorize it. Such general facts must pass separate eligibility/output safety
> and release-quality review; they are never called source-verified. General
> explanation levels and temporary repeat clarification must preserve the concept
> and mode, differ usefully, and carry no invented evidence or changed scan state.
> The already accepted Gemini/Groq source-fallback exception remains unchanged.

The two direct evidence-policy exceptions are 8.3.3 and 8.3.5. General depth and
repeat have explicit added quality scope, while the species-scoped 8.1.3/8.1.6
wording remains intact. The extension's acceptance is **REVIEW/PENDING**, not a
new 17/17 claim. Other source-only AC regressions remain separately evidenced;
no historical approval is revoked or extended by inference.

#### Human release review supplement

**GENERAL_KNOWLEDGE_HUMAN_REVIEW_PENDING=YES**.
Actual new reviewer name/date/decision/comments: **NOT_PROVIDED**. No human review
has been inferred from the previous source-only Groq review, this report's date,
model success, or an automated plausibility check.

Small proposed packet, using the exact samples above:

1. Definition: L01/L06/L11 standard rhizome and final L02 photosynthesis.
2. Comparison: L03 annual/perennial.
3. Depth: L05 simpler, L01 standard, rejected L07 final Gemini and L12-detailed Groq.
4. Failover: L12 controlled Gemini429 + actual Groq standard output.
5. Locked/refused: L09 ingestion and L10 mixed question, with zero calls.
6. Failure: L13 both-controlled-provider failure and rejected L07 model output.
7. Semantic gap: L04 diagnostic envelope, showing no permission from invalid shape.

For each, reviewers must record factual correctness/qualification,
comprehensibility, absence of scanned-species assertions, correct general label,
empty/factual source treatment, locked boundaries and useful depth differences.
Specifically resolve the crown sentence and persistent detailed/waxy failures.
Only actual subsequently supplied reviewer/date/decision evidence may close this
new gate. The samples have not been automatically approved.

#### Latest-main integration and privacy review

Read-only fetch from `muhammadalishoukathali/InvaTrace` updated `team/main`.
Latest SHA equals base/HEAD above; `HEAD..team/main` changes zero files.
No newly introduced upstream overlap/conflict exists. The extension touches the
shared scan assistant panel and API router, so any later main changes there must
be rechecked before integration. No merge/rebase/switch/cherry-pick occurred.
The original main checkout retains its same seven unrelated dirty/untracked paths;
the previous Epic 8 integration checkout remains clean. They were not edited.

Provider general context was observed to contain only `depth`, `question` and
`topic`. The two real judge calls contain only the existing `aspects`, bounded
botanical `evidence`, `question` and canonical `species`. No image, precise GPS,
user ID, credential, auth token, event, scan image data, persistent chat history or
whole knowledge pack is sent. Keys are only provider authentication headers and
are never embedded in model context, candidate code, logs or this report.
Backend controls safety/citations. Legitimate runtime Gemini/Groq/model names
are required configuration/integration facts, not development-tool attribution.

Actual `.env` remains ignored/untracked in the original location; none was copied
here. Final scan: **0 active Gemini/Groq key matches** across all tracked files,
the nine candidates and their diff; **0 credential-pattern matches** in the
candidates/diff; **0 development-assistant attribution-name matches** in the nine
candidates. No key values or headers were printed. Actual `.env` is ignored and
untracked, candidate count is exactly nine, and staged count is zero. Dependencies, dist, logs, screenshot replay files, test DB data and temporary
helpers remain excluded. No file was staged; no `git add` was used.

The exact nine-file candidate scope remains:

1. `backend/app/api/routers/plant_assistant.py`
2. `backend/app/domain/assistant_general_knowledge.py`
3. `backend/app/services/assistant_general_knowledge.py`
4. `backend/app/services/assistant_provider.py`
5. `backend/tests/test_assistant_general_knowledge.py`
6. `src/features/scan/PlantAssistantPanel.tsx`
7. `scripts/check-epic8-local-ui.mjs`
8. `scripts/check-epic8-live-ui.mjs`
9. `docs/assistant-general-knowledge.md`

#### Final quality gates

| Gate | Decision | Reason |
|---|---|---|
| IMPLEMENTATION_READY | NO | Bounded safety/routing works; required useful detailed and waxy answers remain unsuccessful. |
| LIVE_PROVIDER_VALIDATED | NO | Both configured providers demonstrated; required full quality set/depth not successful; questionable detailed sentence remains. |
| REGRESSION_COMPLETE | NO | Unit/UI/tooling pass; three reproducible main PostGIS failures and literal current Compose image/orchestration check not passed. |
| AC_SCOPE_APPROVED | PENDING | No exact team approval for new educational evidence/quality scope. |
| HUMAN_REVIEW_COMPLETE | PENDING | No review evidence for this new real-output set. |
| INTEGRATION_READY | PENDING | No current upstream conflict, but quality, regression and scope/review gates remain open. |
| DEPLOYMENT_READY | NO | Prerequisites open; backend-first compatibility sequence not deployed. |

Next action: review this concrete output packet and proposed scope with Zack,
resolve the remaining generation/judge compliance and factual-quality issues
without weakening checks, and route the already-existing event fixture failures
for separate bounded resolution. Any further provider inference needs a new
explicitly bounded validation plan; this 13-call set is stopped. Integrate only
once quality, scope and human gates are closed, then follow backend-first rollout.
No further work/publication is performed by this report.
