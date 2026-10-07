# Epic 8 all17 ACs — FINAL RELEASE acceptance recorded2026-10-07

**17 PASS /0 REVIEW (release acceptance); GROQ_HUMAN_REVIEW_PENDING=NO; SAFE_TO_PUSH=YES for the proposed26-file content, awaiting explicit approval.**

Authority: unchanged latest v2 DOCX SHA256 `a3a1b5e690bb42337fbdadfe2f529121229535db3230f0eb8d18cd22be057803`, plus Zack's current explicit team no-issues review and accepted failover decision. No original/unrelated AC wording changed. Literal8.1.5 remains an exception; its release PASS is qualified by the team's acceptance.8.3.5 PASS relies on completed no-issues review as explicitly reported, not a guessed reviewer/date or hidden signed document.

| AC | Requirement | Release acceptance status |
|---|---|---|
| 8.1.1 | Open the assistant from a scan result | PASS |
| 8.1.2 | Explain the scan result | PASS |
| 8.1.3 | Change the explanation level | PASS |
| 8.1.4 | Preserve the scan result | PASS |
| 8.1.5 | Provide a fallback when generation is unavailable | PASS — TEAM_ACCEPTED_SCOPE_EXCEPTION |
| 8.1.6 | Clarify a repeated question | PASS |
| 8.2.1 | Ask a suggested question | PASS |
| 8.2.2 | Ask a question in the user’s own words | PASS |
| 8.2.3 | Answer a supported question | PASS |
| 8.2.4 | Keep answers within the available knowledge | PASS |
| 8.2.5 | Respect safety and removal-permission boundaries | PASS |
| 8.2.6 | Report documented hazards without implying safety | PASS |
| 8.3.1 | Search for an unanticipated question | PASS |
| 8.3.2 | Answer when evidence supports it | PASS |
| 8.3.3 | State a limitation when evidence is insufficient | PASS |
| 8.3.4 | State a limitation when the scan result is insufficient | PASS |
| 8.3.5 | Validate the final generated answer against its evidence | PASS — TEAM_REVIEW_USER_ATTESTED |

## Actual team review evidence and its limits

The supplied evidence is Zack's explicit current message:

> The team has reviewed the Groq fallback outputs and confirmed there are no issues.

Record the exact decision as **accepted, no issues**, based on that explicit positive outcome. Unlike the previous checkpoint, the acceptance decision is now supplied. This is **TEAM_REVIEW_COMPLETED_USER_ATTESTED**; it is not an independently identity-verified, dated or signed team document.

- Actual reviewer name: **NOT_DISCLOSED_BY_USER**; Zack states he is not authorised to provide it. Do not infer Zack, Nikhil, Eason or another person as the reviewer.
- Actual review date: **NOT_DISCLOSED_BY_USER**; do not substitute today's recording date.
- Exact decision: **“The team has reviewed the Groq fallback outputs and confirmed there are no issues.”**
- Comments/issues: **No issues, explicitly reported by Zack**; this is not an invented empty comments field.
- Evidence provider: **Zack**, reporting the team's decision; not a guessed actual reviewer.
- Recording date: **2026-10-07**, distinct from the undisclosed actual review date.
- **GROQ_HUMAN_REVIEW_PENDING=NO for release acceptance on this supplied attestation.** The identity/date disclosure boundary is recorded transparently; it is not turned into an extra AC requirement.

The unchanged v2 AC8.3.5 requires review of final answer/evidence/source correctness and a topic/refusal evaluation set; it does not prescribe named signatories or review-date fields as acceptance prerequisites. Existing bounded answer/source/topic/refusal evidence remains preserved. The team now confirms the Groq supplement has no issues. This closes the pending team acceptance gate, without claiming universal model correctness or a signed independent review. The previously flagged “characteristic” wording is retained in the sample history; no separate issue-specific reviewer statement is invented.

## AC8.1.5 — explicit team-accepted scope exception

The supplied team decision is:

> Gemini remains the primary provider.
> If Gemini has an eligible provider failure such as quota/rate-limit/timeout/5xx, Groq is used as the zero-cost fallback.
> If both configured providers are unavailable, the assistant returns the approved retrieved-source fallback.

The authoritative v2 still literally says: **“Given relevant source information has been retrieved but Gemini is unavailable or its quota is exhausted”** and **“Then the assistant returns the retrieved source information instead of failing without a useful response.”** Its literal condition is Gemini-specific; the document has not been amended.

Current code can instead return a strictly grounded Groq-generated answer when Gemini has an eligible failure and Groq is available. When both fail, generation/grounding fall back to approved source text; a judge failure remains insufficient_evidence with no generation because support has not been established. Neither provider can bypass answerability or safety. Both branches have controlled/real bounded evidence, including the actual UI source-fallback observation.

The team now explicitly accepts that provider failover behavior. **Release acceptance status: PASS — TEAM_ACCEPTED_SCOPE_EXCEPTION. Literal-v2 conformance: EXCEPTION, not literal compliance.** This records the team's actual scope decision, not a fabricated reinterpretation. No unrelated AC wording, safety policy or provider dispatch was changed.

## Final non-destructive regression in this release closure

| Check | Actual result |
|---|---|
| Backend | 985 PASS /9 default opt-in integration skips,9.62s |
| Provider/grounding/hybrid/safety/citations/latest-AC focused run | 694 PASS,6.48s, including143 provider failover cases |
| Frontend | 251 PASS /34 files |
| TypeScript / ESLint | PASS, both exit0 |
| Ruff check and format | PASS,14 Python paths |
| PostGIS/spatial | 10 PASS /1 separately exercised full-stack gate skip,3.27s |
| Full-stack API/workers/DB/Redis/MinIO | 5 PASS,11.22s |
| Actual browser/UI regression | 18 groups /24 browser POSTs PASS; mobile/desktop;zero live provider calls |

Unit/focused runs explicitly disable live fallback via process override; isolated provider tests enable mocked fallback with fake keys. All actual integration gates are exercised separately; skipped work is not called PASS. Earlier real depth/repeat browser evidence remains valid because app code/config/schema/policy are unchanged:6 Groq calls,3 grounded depth outputs,2 no-POST trim/case repeat clarifications, actual both-failure source fallback. The earlier normal/relation/negative supplement used9 Groq calls. Those fixed live sets were not repeated, and this release closure makes **zero new Gemini/Groq chat or model-list requests**.

Own browser/backend/API/workers/storage helpers were stopped; data and pre-existing services remain. Production/deployed/camera smoke is NOT_TESTED; no deployment was requested or performed. Cached local MinIO differs from the production pin. Scope is release acceptance on exercised evidence, not a universal model or deployment guarantee.

## Exact status changes and publication state

8.1.5 REVIEW→PASS—TEAM_ACCEPTED_SCOPE_EXCEPTION: explicit team decision now supplies the missing acceptance of available-Groq generation after Gemini failure; both-provider source fallback already tested.8.3.5 REVIEW→PASS—TEAM_REVIEW_USER_ATTESTED: positive no-issues decision is now supplied. The other15 statuses remain PASS on their existing and rerun bounded evidence.

Approved26-file proposal, secret exclusions and contextual runtime-name review are detailed in the implementation report. Remaining release-content blocker: none if final scoped checks are clean. No publication permission is inferred from content readiness; await explicit approval. Future actual commit metadata requires its own fresh verification.

---

# Historical checkpoint before the new team release decision (not current status)

Earlier REVIEW/pending/closed-scan statements below belong to the evidence and policy available then. The current release result above supersedes them only where the new team decision and explicit publication-scope instruction apply. Earlier live tests remain the original records.

# Epic 8 FINAL 17 AC status — recorded 2026-10-07

**15 PASS /2 REVIEW. GROQ_HUMAN_REVIEW_PENDING=YES for verified closure. SAFE_TO_PUSH=NO.**

The latest authoritative v2 DOCX was re-read before status changes; SHA256 `a3a1b5e690bb42337fbdadfe2f529121229535db3230f0eb8d18cd22be057803`. No AC wording or source document was amended. This stage closes only the real Groq depth/repeat evidence gaps; earlier technical PASS criteria retain their fixed bounded regression evidence. Technical status does not guarantee every possible model answer.

| AC | Requirement | Final technical status |
|---|---|---|
| 8.1.1 | Open the assistant from a scan result | PASS |
| 8.1.2 | Explain the scan result | PASS |
| 8.1.3 | Change the explanation level | PASS |
| 8.1.4 | Preserve the scan result | PASS |
| 8.1.5 | Provide a fallback when generation is unavailable | REVIEW |
| 8.1.6 | Clarify a repeated question | PASS |
| 8.2.1 | Ask a suggested question | PASS |
| 8.2.2 | Ask a question in the user’s own words | PASS |
| 8.2.3 | Answer a supported question | PASS |
| 8.2.4 | Keep answers within the available knowledge | PASS |
| 8.2.5 | Respect safety and removal-permission boundaries | PASS |
| 8.2.6 | Report documented hazards without implying safety | PASS |
| 8.3.1 | Search for an unanticipated question | PASS |
| 8.3.2 | Answer when evidence supports it | PASS |
| 8.3.3 | State a limitation when evidence is insufficient | PASS |
| 8.3.4 | State a limitation when the scan result is insufficient | PASS |
| 8.3.5 | Validate the final generated answer against its evidence | REVIEW |

## Actual human review record

Zack states: “The Groq human review has now been completed by the team.” When asked for the required actual reviewer/date/decision/comments and whether the characteristic ambiguity was reviewed, Zack responded: “测试完了，这些我不能给你” (testing is complete; these details cannot be provided). Record this as **TEAM_REVIEW_COMPLETED_USER_ATTESTED / ACCEPTANCE_DECISION_UNVERIFIED**. Respect the user's choice; do not ask again or invent details.

- Reviewer name: **NOT_PROVIDED — user declined disclosure**.
- Actual review date: **NOT_PROVIDED — user declined disclosure**. This report's 2026-10-07 date is the recording date, not an inferred review date.
- Exact decision: **NOT_PROVIDED — no approved/rejected/conditional decision was supplied**.
- Comments/issues: **NOT_PROVIDED**; do not substitute “none.”
- Review of “leaves are characteristic”: **NOT_VERIFIABLE** from supplied evidence.
- **GROQ_HUMAN_REVIEW_PENDING=YES for verified acceptance closure**. This does not deny the reported review completion; it means its acceptance/signoff cannot be independently recorded. AC8.3.5 remains REVIEW.

## Literal AC8.1.5 ruling

The authoritative v2 condition is explicitly **“Gemini is unavailable or its quota is exhausted”**, followed by **“returns the retrieved source information”**. Its API description repeats the same condition. It does not condition fallback on all providers failing. The heading “generation is unavailable” does not override the explicit Given/Then wording.

The new real depth tests demonstrate Gemini controlled429 + Groq available → grounded generated prose; the fourth actual UI request demonstrates controlled Gemini429 + Groq503 → exact approved habitat source fallback. Both are safe current behaviors, but the latter cannot repair the literal Gemini-specific condition. The proposed interpretation “Gemini failed but generation remains available via Groq” is therefore **not supported by the literal wording**. **8.1.5 remains REVIEW / AC_SCOPE_DECISION_PENDING.** No wording amendment or silent reinterpretation was made.

## Exact evidence changes

- 8.1.3 REVIEW→PASS: same species/evidence; real simpler1sentence/11words and detailed4sentences/28words; core traits preserved, extra claims source-supported; both strict-grounded and rendered.
- 8.1.6 REVIEW→PASS: actual browser trim/case repeat clarification twice withoutPOST; chosen simpler/detailed send correctdepth and display grounded response.
- 8.1.5 REVIEW retained: explicit Gemini-unavailable/quota condition differs from available-Groq generated answer, even though both-failure fallback works.
- 8.3.5 REVIEW retained: reported human review completion is recorded, but acceptance decision/date/name/comments were declined. No inferred or fabricated approval. Earlier and new standard answers' characteristic qualification remains flagged.

## Final regression — actual reruns in this closure

| Check | Final result |
|---|---|
| Backend normal suite | 985 PASS / 9 opt-in integration skips,9.47s |
| Provider/grounding/hybrid/safety/citations/latest-AC focused rerun | 694 PASS,5.78s; includes143 provider failover cases |
| Frontend | 251 PASS /34 files |
| TypeScript | PASS, exit0 |
| ESLint | PASS, exit0 after fixing unused imports/empty catch only in ignored local browser harness |
| Ruff check and format | PASS,14 changed Python paths |
| PostGIS/spatial | 10 PASS /1 separate full-stack gate skip,2.67s |
| Full-stack API/workers/DB/Redis/MinIO | 5 PASS,10.88s |
| Offline actual UI | 18 groups /24 browser POST attempts PASS,zero external providers |
| New bounded real Groq UI | Standard/simpler/detailed grounded;2 repeat clarification checks;4 browser POSTs;6 real Groq calls;0 real Gemini;one account model GET |
| Independent read-only review | Actual harness, outputs/quotes/sources/depth/repeat/fallback/process exit verified; no additional calls |

Normal/targeted regression explicitly overrides GROQ_FALLBACK_ENABLED=false for the default-off offline path; provider-specific isolated tests configure enabled fallback with fake secrets/HTTP. That is not a claim that unit tests used a live account. No skipped/unrun check is called PASS. Opt-in integration is covered separately. Cached local MinIO is older than the production pin; actual deployed/production/camera smoke NOT_TESTED. Initial ESLint failure was confined to the ignored harness; original executed script and failed log retained, no repeated live calls. Own browser/backend/API/workers/storage processes stopped; data and pre-existing services retained.

## Final publication decision

SAFE_TO_PUSH=NO for the two AC blockers and closed publication gate. Exact26-file whitelist is in the final implementation report and remains unchanged. Actual keys/.env/logs/screenshots/dependencies/local data excluded; secret checks clean. Provider-name content/binary review/future commit metadata gate is not cleared. No commit/push/deploy. All original detailed AC wordings and prior status evidence are retained in the checkpoint below.

---

# Preserved checkpoint before FINAL closure (historical, not current status)

The status/verification statements below belong to the earlier provider/grounding stages and are retained as evidence history.

# Epic 8 Groq-enabled candidate AC assessment — 2026-10-07

**13 PASS / 4 REVIEW on bounded technical evidence. GROQ_HUMAN_REVIEW_PENDING=YES. SAFE_TO_PUSH=NO.**

Gemini-only/default-disabled baseline remains16PASS/1REVIEW on preserved earlier evidence. Actual v2 wording below is unchanged; no requirements/privacy wording was amended. Actual Groq model availability, normal factual/semantic relation/habitat generation and final grounding are now tested; primary failures controlled429. External counts: Gemini0, Groq chat9, /models1. Operator confirmed free account; no programmatic billing audit.

| AC | Groq-enabled technical status | Evidence / remaining reason |
|---|---|---|
| 8.1.1 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.1.2 | PASS | Real Groq standard answers/relations, strict grounding and stored citations on fixed bounded samples; human approval separate. |
| 8.1.3 | REVIEW | Real Groq simpler/detailed flow NOT_TESTED; offline depth regression PASS. |
| 8.1.4 | PASS | Real Groq standard answers/relations, strict grounding and stored citations on fixed bounded samples; human approval separate. |
| 8.1.5 | REVIEW | AC_SCOPE_DECISION_PENDING: Gemini429 → generated Groq answer differs from literal retrieved-source fallback. |
| 8.1.6 | REVIEW | Real Groq repeated-question chosen-depth flow NOT_TESTED; existing session/UI regression PASS. |
| 8.2.1 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.2.2 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.2.3 | PASS | Real Groq standard answers/relations, strict grounding and stored citations on fixed bounded samples; human approval separate. |
| 8.2.4 | PASS | Real Groq standard answers/relations, strict grounding and stored citations on fixed bounded samples; human approval separate. |
| 8.2.5 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.2.6 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.3.1 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.3.2 | PASS | Real Groq standard answers/relations, strict grounding and stored citations on fixed bounded samples; human approval separate. |
| 8.3.3 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.3.4 | PASS | Unchanged deterministic/retrieval/guard regression PASS. |
| 8.3.5 | REVIEW | GROQ_HUMAN_REVIEW_PENDING; actual samples ready, including characteristic ambiguity. |

PASS describes exercised technical behavior, not universal model accuracy or release signoff. The accepted G-HR-01 wording “leaves are characteristic” can be read as a described trait or identifying importance; source review retains this ambiguity for the team. Do not label it an exact quote or silently remove it from evaluation. Negative judge safe refusal likewise does not prove full instruction compliance; its aspect list shape is recorded in the live report.

8.1.5 remains unresolved even though the Groq habitat answer passed grounding: literal AC requires retrieved source information when Gemini is unavailable/quota exhausted; enabled secondary can generate prose. Only an explicit team requirements decision can close that gap. Privacy/provider documentation must acknowledge bounded context going to Groq when enabled. 8.1.3/.6 have offline depth/session evidence, but no real Groq depth/repeat live set. 8.3.5 needs actual team answer/chunk review and reviewer/date/decision. No previous human approval is extended automatically.

Full regression evidence and actual four-case human package are in the other two reports. No commit/push/deploy/LeanKit. All prior AC wording and historical Gemini records follow unchanged.

---

# Preserved historical Gemini-only grounding record — 2026-10-06

All status/call counts/first-and-second verification descriptions below refer to that earlier stage, not the new Groq candidate.

# Epic 8 — final 17 AC grounding-closure review

**16 PASS / 1 REVIEW; HUMAN_REVIEW_PENDING=YES; SAFE_TO_PUSH=NO.**

Authority: actual latest v2 DOCX, SHA256 `a3a1b5e690bb42337fbdadfe2f529121229535db3230f0eb8d18cd22be057803`. Actual wording re-read including full multi-paragraph8.1.6. Historical PoC/pack counts are background, not current implementation status. Status evaluates verified local implementation and bounded technical evidence, without claiming universal model infallibility or deployed production readiness. Previous9PASS/8REVIEW is superseded after adding and testing the mandatory final semantic gate, not copied forward.

| AC | Requirement | Status |
|---|---|---|
| 8.1.1 | Open the assistant from a scan result | PASS |
| 8.1.2 | Explain the scan result | PASS |
| 8.1.3 | Change the explanation level | PASS |
| 8.1.4 | Preserve the scan result | PASS |
| 8.1.5 | Provide a fallback when generation is unavailable | PASS |
| 8.1.6 | Clarify a repeated question | PASS |
| 8.2.1 | Ask a suggested question | PASS |
| 8.2.2 | Ask a question in the user’s own words | PASS |
| 8.2.3 | Answer a supported question | PASS |
| 8.2.4 | Keep answers within the available knowledge | PASS |
| 8.2.5 | Respect safety and removal-permission boundaries | PASS |
| 8.2.6 | Report documented hazards without implying safety | PASS |
| 8.3.1 | Search for an unanticipated question | PASS |
| 8.3.2 | Answer when evidence supports it | PASS |
| 8.3.3 | State a limitation when evidence is insufficient | PASS |
| 8.3.4 | State a limitation when the scan result is insufficient | PASS |
| 8.3.5 | Validate the final generated answer against its evidence | REVIEW |

| Check | First technical verification | Independent second technical verification |
|---|---|---|
| Backend, normal dotenv | 842 passed / 9 default opt-in integration module skips | 842 passed / 9 skipped |
| Frontend | 251 tests / 34 files PASS | 251 / 34 PASS |
| TypeScript / ESLint | PASS, no errors | PASS |
| Ruff | 12 Python paths check/format PASS, backend config | PASS |
| PostGIS / spatial | 10 passed; full-stack gate separate | 10 passed |
| Full-stack local API + workers + DB + Redis + MinIO | 5 passed | 5 passed |
| Offline real browser | 18 groups / 24 POST attempts / 0 Gemini | 18 / 24 / 0 PASS |
| Bounded live browser | 13 groups / 18 POST attempts / 13 live calls / 4 controlled HTTP calls | Exact provider/API/source records and script independently reviewed; no second live calls |
| Grounding-specific offline | 60 tests PASS; full suites include judge/generation/citations/safety/depth | Independent focused and full suites PASS |
| Bounded live verifier | 12 direct attempts + 6 pipeline requests | Same source/claim/quote records independently reviewed |


## 8.1.1 — PASS

Open the assistant from a scan result

Actual wording:

> Given a scan result contains a detected species and classifier confidenceWhen the user selects “Ask about this plant”Then the assistant opens with that species and confidence available as context.

Current verified evidence: Actual ScanResultPage context/opening and unsupported-context resets; offline18/live13 browser groups.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.1.2 — PASS

Explain the scan result

Actual wording:

> Given the retrieved evidence is sufficient to explain the specific scan-result questionWhen the user asks what the scan result meansThen the assistant gives a plain-language explanation using only that evidence and provides the stored source names and URLs.

Current verified evidence: Actual scan explanation and stored source URLs; original sentence array + mandatory verifier; live normal and depth samples.

Former technical blocker closed: structurally valid generated prose no longer reaches display by structural acceptance alone; mandatory final per-sentence semantic approval and strict references are required. The purple-leaves end-to-end regression now returns only evidence fallback.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.1.3 — PASS

Change the explanation level

Actual wording:

> Given the assistant has explained the scan resultWhen the user asks for a simpler or more detailed explanationThen the assistant adjusts the level of detail while keeping its claims consistent with the approved retrieved information.

Current verified evidence: Same question/selected identification chunk: live Simpler/Standard/Detailed materially increasing supported detail; all sentences verified; safety unchanged.

Former technical blocker closed: structurally valid generated prose no longer reaches display by structural acceptance alone; mandatory final per-sentence semantic approval and strict references are required. The purple-leaves end-to-end regression now returns only evidence fallback.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.1.4 — PASS

Preserve the scan result

Actual wording:

> Given the assistant responds to a question about the scanWhen the answer is displayedThen the assistant does not identify a different species, override the classifier result or Malaysian status, or add unsupported facts.

Current verified evidence: Species/status structural boundaries retained; exact generated sentences checked; 8 generic adversarial router regressions including valid-ID purple leaves reject generated prose.

Former technical blocker closed: structurally valid generated prose no longer reaches display by structural acceptance alone; mandatory final per-sentence semantic approval and strict references are required. The purple-leaves end-to-end regression now returns only evidence fallback.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.1.5 — PASS

Provide a fallback when generation is unavailable

Actual wording:

> Given relevant source information has been retrieved but Gemini is unavailable or its quota is exhaustedWhen the user submits a questionThen the assistant returns the retrieved source information instead of failing without a useful response.

Current verified evidence: Actual adapters→router timeout/network/429/503/malformed/truncated/oversize failures return approved fallback; live UI controlled final grounding503 hides generated prose.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.1.6 — PASS

Clarify a repeated question

Actual wording:

> Given the assistant has answered a question about the scanned species in the current conversation
> When the user asks the same question again, ignoring letter case and surrounding spaces
> Then the assistant says it has explained the question before and asks whether the user wants a simpler or more detailed explanation; after the user chooses, it provides that explanation grounded in the approved evidence for the same species.
> Rule: Only a question already answered in the current conversation counts. Compare questions after trimming surrounding spaces and ignoring letter case. Do not block the repeat; offer simpler or more detailed wording, then keep the answer grounded in approved evidence for the scanned species. Current-session context is temporary and is not stored as persistent chat history after the session ends.

Current verified evidence: Live first answer → trim/case repeat offers explanation levels without duplicate request → chosen depth verified for same species. Offline reset/session/outcome tests prevent stale repeat context; state stays temporary. The successful live chosen-depth flow precedes the later fault-harness duplicate-question timeout; that failed attempt and controlled-only continuation are preserved in the live report call ledger, with no additional live calls.

Former technical blocker closed: structurally valid generated prose no longer reaches display by structural acceptance alone; mandatory final per-sentence semantic approval and strict references are required. The purple-leaves end-to-end regression now returns only evidence fallback.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.2.1 — PASS

Ask a suggested question

Actual wording:

> Given the assistant shows suggested questions for the scanned speciesWhen the user selects oneThen the question is submitted and processed using retrieved information for that species.

Current verified evidence: Suggested question button uses actual scanned species/confidence and actual backend sources, with accepted generation+final verifier.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.2.2 — PASS

Ask a question in the user’s own words

Actual wording:

> Given the assistant is open for a scanned speciesWhen the user enters a free-text question about its characteristics, habitat, impacts, spread or another topicThen the assistant searches the approved knowledge for relevant information without requiring the question to match a fixed FAQ entry.

Current verified evidence: Free text retrieval/classification unchanged; broader/rerouted unsupported questions and novel Acacia pod relation exercise non-FAQ path.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.2.3 — PASS

Answer a supported question

Actual wording:

> Given the retrieved evidence is sufficient to answer the user's specific questionWhen the user submits the questionThen the assistant answers only from that evidence and displays the stored names and URLs of the supporting sources.

Current verified evidence: Live same-species habitat and Acacia twisted-pod semantic-judge question accept only after final verifier; exact stored supporting source metadata.

Former technical blocker closed: structurally valid generated prose no longer reaches display by structural acceptance alone; mandatory final per-sentence semantic approval and strict references are required. The purple-leaves end-to-end regression now returns only evidence fallback.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.2.4 — PASS

Keep answers within the available knowledge

Actual wording:

> Given the assistant returns an answer about the speciesWhen the user reads the answerThen its factual claims are supported by the retrieved information and it contains no fabricated citations.

Current verified evidence: 8 unsupported-claim categories, strict per-sentence/ID/quote/coverage failure contracts, real adversarial calibration (7 unsupported +1 timeout fallback); accepted positives source-reviewed.

Former technical blocker closed: structurally valid generated prose no longer reaches display by structural acceptance alone; mandatory final per-sentence semantic approval and strict references are required. The purple-leaves end-to-end regression now returns only evidence fallback.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.2.5 — PASS

Respect safety and removal-permission boundaries

Actual wording:

> Given the user asks about removing, handling or taking action on a plantWhen the assistant provides an answerThen it may explain approved general guidance, but it must not imply that the user has permission to remove the plant or bypass existing safety, access or protected-area rules.
> Rule: Location-specific removal or intervention must continue to follow the existing Epic 3.0 safety, permission and protected-area checks; the assistant does not grant or override permission.

Current verified evidence: Backend-only complete permission/negation/conditions/jurisdiction safety paragraphs unchanged at all depths; mixed route verifies botanical-only context.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.2.6 — PASS

Report documented hazards without implying safety

Actual wording:

> Given the user asks whether a plant is harmful to touch, eat or handleWhen the knowledge pack has a sourced hazard entry for that speciesThen the assistant states the documented hazard with its stored source and the safety boundary; and when no hazard is documented, it says the reviewed sources do not document one and never states or implies the plant is safe.

Current verified evidence: Documented Asclepias skin hazard remains exact backend text; absent hazard refuses without safety implication; no generation/verifier on hazard route.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.3.1 — PASS

Search for an unanticipated question

Actual wording:

> Given the user asks a plant-related question that is not shown among the suggested questionsWhen the question is submittedThen the backend searches the approved knowledge for the scanned species instead of rejecting the question because it is absent from a fixed list.

Current verified evidence: Unanticipated free-text Acacia pods uses unchanged species-filtered TF-IDF and semantic aspect support before generation; no FAQ architecture change.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.3.2 — PASS

Answer when evidence supports it

Actual wording:

> Given the retrieved evidence is sufficient to answer the specific unanticipated questionWhen the assistant processes the questionThen it returns an answer grounded only in that evidence with the stored source names and URLs.
> Rule: The retrieved evidence must address the aspect the question asks about (such as timing, quantity or the user's location). A shared keyword is not enough.

Current verified evidence: Acacia pods novel relation has real pre-judge support and post-generation claims/quotes; unsupported/timed-out final prose falls back.

Former technical blocker closed: structurally valid generated prose no longer reaches display by structural acceptance alone; mandatory final per-sentence semantic approval and strict references are required. The purple-leaves end-to-end regression now returns only evidence fallback.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.3.3 — PASS

State a limitation when evidence is insufficient

Actual wording:

> Given the retrieved evidence is insufficient to answer the questionWhen the backend evaluates the requestThen it skips answer generation and returns a clear limitation with insufficient_evidence status, any retrieved sources, and the topics covered for that species from the knowledge pack.

Current verified evidence: Unsupported flower timing and unmet semantic aspect refuse with real coveredTopics/related stored sources; no permission/medical/local invention.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.3.4 — PASS

State a limitation when the scan result is insufficient

Actual wording:

> Given the classifier result is insufficient to support a species-specific answerWhen the user submits a question about that speciesThen the assistant states the limitation instead of guessing the species or presenting an unsupported answer.

Current verified evidence: Unknown/Other/uncertain/low-confidence never infer a species or reach generation/verifier; current-context-change browser regressions.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Remaining technical requirement identified in this local scope: none. Team release approval remains separately pending under8.3.5; production deployment smoke NOT_TESTED.

## 8.3.5 — REVIEW

Validate the final generated answer against its evidence

Actual wording:

> Given a generated assistant answer is evaluated before releaseWhen the answer and its supporting retrieved chunks are reviewedThen the answer passes only when its factual claims are supported by those chunks and its displayed sources match the supporting evidence.
> Rule: Retrieval quality and final-answer quality are evaluated separately. A successful retrieval does not by itself count as a correct assistant answer. The evaluation set must cover each supported topic and include questions the knowledge pack cannot answer, so refusal behaviour is tested alongside answer quality.

Current verified evidence: Technical gate/source reviews PASS for exercised samples; team human review is pending, with generated candidates, supporting chunks, sources and verifier decisions prepared.

First verification: current full normal-env/backend/frontend/static/integration/browser regressions plus direct source review. Independent second verification: read-only reviewer inspected gate/contracts/privacy/deadline and independently ran full suites/integration/offline browser, then reviewed the fixed live records without more provider calls.

Exact remaining reason: **HUMAN_REVIEW_PENDING**. No Zack/Nikhil/Eason final answer-and-chunk review or recorded reviewer/decision/date exists. Automated/model technical review cannot replace requested human review. The small seven-row package is targeted, not exhaustive topic/utterance coverage; team must assess sample adequacy when recording its release decision. This AC cannot be marked PASS by this stage.

## Human review gate

See `epic8_live_generation_validation.md` → **Team human review package — HUMAN_REVIEW_PENDING**. SAFE_FOR_TEAM_HUMAN_REVIEW=YES; SAFE_TO_PUSH=NO. No commit/push/deploy/LeanKit/handover action.
