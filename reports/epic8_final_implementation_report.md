# Epic 8 FINAL RELEASE acceptance — recorded2026-10-07

**17 PASS /0 REVIEW under the team's recorded release decision. GROQ_HUMAN_REVIEW_PENDING=NO. SAFE_TO_PUSH=YES for the reviewed26-file proposal; commit/push approval still required.**

8.1.5 is an explicit team-accepted scope exception, not literal-v2 compliance.8.3.5 is accepted from Zack's explicit no-issues team-review attestation; reviewer name/date remain undisclosed. These qualifications are part of the result, not omitted conditions. Only three existing approved reports change in this release closure; all previous dirty code work remains intact.

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

## Provider/privacy implementation documentation

Gemini remains primary (`gemini-3.5-flash-lite`). Groq is the zero-cost fallback on the operator-confirmed free account with explicitly configured `openai/gpt-oss-120b`; billing remains an operator/account assertion, not code-proven. The distributable fallback default stays disabled; no missing-model guess, paid upgrade, third provider or alternative host is introduced.

Only eligible primary429/RESOURCE_EXHAUSTED, timeout/network or500/502/503/504 permit one Groq attempt within the unchanged role/shared18s budget. Supported/unsupported/uncertain semantic results are respected; malformed/schema/local failures and400/401/403 never seek a second opinion. Same strict schemas/validators and mandatory grounding remain in force.

The same bounded botanical role context may be sent to Groq: current question/aspects or depth where needed, canonical species, selected support-approved non-protected evidence/chunk IDs; grounding additionally receives original candidate sentences and used IDs. **No image, GPS, user ID, session credential, chat history, user/auth/rate-limit token, incoming auth header, event data, unrelated evidence or whole knowledge pack is sent.** Backend provider credentials authenticate the provider request only; they are excluded from botanical context, frontend and reports.

Citations/source URLs remain backend-controlled from stored metadata. Safety rules/protected paragraphs remain backend-controlled, bypass providers where required, and are unchanged in mixed responses. No retrieval/classifier/UI/safety/citation/grounding code change was made in this release closure.

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

## Final publication preflight — approved 26-file scope

**SAFE_TO_PUSH=YES for the reviewed proposed26-file content, pending Zack's explicit commit/push approval. This is readiness, not publication authorisation.** No actual outgoing commit exists; actual commit metadata and unchanged payload must be rechecked immediately before a later authorised push.

Only the previously approved26-file whitelist is reviewed as new publication content. No git add, commit, push, reset, discard, deploy or LeanKit write. Main/HEAD/index remain unchanged. `.env` remains ignored/untracked. Actual configured Gemini/Groq key values and provider-key patterns are absent from tracked/current candidate content and proposed diff; frontend contains no credential variables. Variable names in backend configuration are legitimate and do not expose values. Logs, screenshots, local data, dependencies, temporary files and unrelated dirty reports are excluded.

The user explicitly instructs distinguishing legitimate runtime provider/model names from prohibited development-assistant attribution. Accordingly, Gemini/Groq, official API namespaces and exact model/capability IDs in configuration, adapters, tests and product evidence are **runtime product references**, retained unchanged. CSS cursor is a normal UI property. Raw generic name hits are context-reviewed occurrence by occurrence; they are not automatically development-assistant attribution or secrets. No global skill rules, API names or model IDs were renamed, and no encoded/hidden match or committed exception allowlist was added.

A previous full-HEAD generic scan reported84 existing binary objects. Those are unchanged, already-shared objects outside this26-file change whitelist, not new outgoing artifacts; this scoped review neither claims to have inspected them nor treats them as newly introduced blockers. All26 proposed files are inspectable text with no unresolved object. A machine-specific tool-directory link in the historical report was replaced by neutral publication-policy wording; original report copies remain in ignored local evidence. No contributor identity, licence or application behavior changed.

The final scoped check uses the existing scanner primitives on all26 exact file contents/paths plus proposed neutral commit metadata and branch. It reports raw names separately from the user-authorised context decision. It is not falsely presented as the generic full-snapshot CLI returning exit0. Exact hashes, occurrence contexts, metadata proposal and secret results are retained locally; a fresh hash check confirms no selected file changed after review. Future commit metadata remains a proposal until an actual commit is authorised.

**Remaining release-content blocker: NONE**, provided the final scoped secret/context/manifest checks remain clean. Reviewer identity/date are undisclosed evidence limitations;8.1.5 is an expressly accepted scope exception, not a hidden literal-conformance claim. Neither is represented as an unprovided signed record. Await Zack's explicit approval; no publication action now.

## Exact proposed commit files (repository-relative)

```text
application/backend/.env.example
application/backend/app/api/routers/plant_assistant.py
application/backend/app/config.py
application/backend/app/data/plant-assistant-knowledge.json
application/backend/app/domain/plant_assistant.py
application/backend/app/services/assistant_generation.py
application/backend/app/services/assistant_judge.py
application/backend/tests/test_assistant_bounded_safety.py
application/backend/tests/test_assistant_hybrid.py
application/backend/tests/test_epic8_latest_ac.py
application/backend/tests/test_plant_assistant.py
application/data/assistant-reviewed-evidence.json
application/data/knowledge_coverage_matrix.csv
application/scripts/build-assistant-knowledge.py
application/scripts/check-epic8-local-ui.mjs
application/scripts/check-epic8-live-ui.mjs
application/src/features/scan/PlantAssistantPanel.tsx
application/src/features/scan/ScanResultPage.tsx
application/tests/fixtures/epic8_original_knowledge.json
application/reports/epic8_final_implementation_report.md
application/reports/epic8_live_generation_validation.md
application/reports/epic8_17_ac_final_status.md
application/backend/app/services/assistant_grounding.py
application/backend/tests/test_assistant_grounding.py
application/backend/app/services/assistant_provider.py
application/backend/tests/test_assistant_provider_failover.py
```

---

# Historical checkpoint before the new team release decision (not current status)

Earlier REVIEW/pending/closed-scan statements below belong to the evidence and policy available then. The current release result above supersedes them only where the new team decision and explicit publication-scope instruction apply. Earlier live tests remain the original records.

# Epic 8 FINAL controlled closure — recorded 2026-10-07

**15 PASS /2 REVIEW. GROQ_HUMAN_REVIEW_PENDING=YES (verified acceptance not available). SAFE_TO_PUSH=NO.**

This final section supersedes status checkpoints retained below. No application code/policy/schema/AC wording was changed in this closure; only the three existing approved reports were updated. All previous dirty work remains intact.

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

## Current provider and privacy documentation

**Gemini is primary; Groq is the configured zero-cost fallback on the operator-confirmed free account.** Cost status is the operator's statement, not a programmatic billing proof. No paid upgrade, automatic model upgrade, alternative host or third provider is added. Gemini model remains `gemini-3.5-flash-lite`; explicitly configured Groq model is `openai/gpt-oss-120b`. Current local fallback is enabled; the distributable default remains false and no Groq model is selected when absent.

Only an eligible Gemini provider failure (429/RESOURCE_EXHAUSTED, network/timeout,500/502/503/504) can route the current judge/generation/grounding role to Groq, at most once. Successful supported/unsupported/uncertain results, malformed/schema/local failures and400/401/403 do not trigger another opinion. Same role/shared deadline and strict backend validators apply. A Groq-generated candidate still requires mandatory final grounding before display.

The **same bounded botanical context may be sent to Groq**: judge receives current question/aspects, canonical species and selected evidence/IDs; generation receives current question, canonical species, requested depth and selected non-protected evidence/IDs; grounding receives canonical species, original generated sentences, support-approved evidence and used IDs. Never send a photograph/image, GPS, user ID, session credential, chat history, user/auth/rate-limit token, incoming Authorization header, event data, unrelated chunks or the whole knowledge pack. Provider authentication uses only its backend-held API credential; that credential never enters botanical context, frontend or reports. Production logs contain only safe provider metadata, not bodies/headers/secrets.

**Citations remain backend-controlled** from stored source metadata. **Safety rules and protected paragraphs remain backend-controlled**, bypass providers where required, and are appended unchanged for mixed answers. The authoritative AC document itself was not amended; this implementation documentation adds the Groq provider/privacy scope only.

## AC8.1.3 and8.1.6 evidence closure

Actual ScanResultPage/browser → real local FastAPI router → controlled Gemini429 → real Groq generation → real Groq grounding → backend citation/safety → actual rendered answer. Standard/simpler/detailed are three real API requests with the same selected Mikania identification evidence. Simpler has1 sentence/11 whitespace-separated words; detailed4 sentences/28 words. Detailed preserves form and leaf traits and adds explicitly sourced slender/ribbed stems and clustered small white flower heads. All three returned supported strict grounding with exact same-species IDs/source quote substrings. Two trim/case repeats displayed the existing clarification prompt without sending a POST; chosen simpler/detailed each sent the corresponding depth and displayed its grounded response. No repeated-question behavior was replaced by an API-only simulation.

Current closure stage external calls: **Gemini0; Groq chat6 (3 generation+3grounding), all HTTP200; account /models1 HTTP200**. Prior provider stage remains9 chat/1models/0Gemini, so combined Groq verification15chat/2models/0Gemini. No Gemini quota intentionally consumed; no retries/new calibration. Bounded technical verification does not establish universal model truth or team approval. Standard output again uses interpretive “characteristic of the species”; preserve it in the review record, not an exact source quote.

## Literal AC8.1.5 ruling

The authoritative v2 condition is explicitly **“Gemini is unavailable or its quota is exhausted”**, followed by **“returns the retrieved source information”**. Its API description repeats the same condition. It does not condition fallback on all providers failing. The heading “generation is unavailable” does not override the explicit Given/Then wording.

The new real depth tests demonstrate Gemini controlled429 + Groq available → grounded generated prose; the fourth actual UI request demonstrates controlled Gemini429 + Groq503 → exact approved habitat source fallback. Both are safe current behaviors, but the latter cannot repair the literal Gemini-specific condition. The proposed interpretation “Gemini failed but generation remains available via Groq” is therefore **not supported by the literal wording**. **8.1.5 remains REVIEW / AC_SCOPE_DECISION_PENDING.** No wording amendment or silent reinterpretation was made.

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

## Final publication preflight and exact blockers

The approved candidate whitelist remains **26 paths**, listed below. Actual `.env`, logs, screenshots, local data, dependencies and unrelated dirty reports are excluded; no git add was performed. Git index remains empty, branch main and HEAD `e1ecae3ab98be17a0530a10dc3e530dbb0d052d5` unchanged. Read-only remote check found the same main SHA; no fetch/pull/commit/push/deploy/LeanKit change.

Current tracked-file and whitelist/diff secret scan: **zero actual configured key values / provider-key pattern matches**. Backend `.env` remains ignored and untracked. Frontend has zero secret-variable references. `GEMINI_API_KEY` / `GROQ_API_KEY` variable names legitimately appear in backend configuration/example/tests; their actual credential values do not. Do not remove those required variable names to satisfy a mistaken literal reading of “keys absent.” Final signature manifests and Git status/diff records are local-only.

The local publication content check gate remains **CLOSED (exit2)**. It says: “Do not perform any GitHub write until the exact outgoing payload has passed a fresh, full preflight with zero prohibited matches and zero unresolved files.” It also says: “If cleanup could affect code behavior, APIs, tests, data formats, attribution, licensing, or meaning, explain the hit and ask before editing.”

Concrete semantic hits include `backend/.env.example` (`GEMINI_API_KEY`/Gemini), `backend/app/config.py` (Gemini environment alias), `backend/app/services/assistant_provider.py` (required model IDs/API host/provider dispatch), and provider descriptions in the three approved reports. Removing/renaming them would alter configuration/contracts or contradict this task's required provider documentation, so no cleanup or obfuscation was attempted. Raw hits also include ordinary pagination/CSS cursor occurrences; raw match counts are not a count of confirmed tool-origin traces. There are **84 unresolved existing binary objects** in the HEAD snapshot, e.g. `application/docs/image-pipeline/cluttered/cluttered-1.png` (git object `c7b40333bd733cfc50b4f01851b9665d1e07fe9d`). None is a new whitelist change. No blanket object/match approvals or shared-history rewrite were made.

Scan scope is current HEAD snapshot plus all26 exact current proposed file contents and main/ref metadata. A future outgoing commit does not exist yet; future commit metadata still requires a fresh check. This scan is not publication authorization or a claim of a complete clean outgoing commit.

**SAFE_TO_PUSH=NO.** Exact remaining blockers: (1) literal8.1.5 conflict; (2)8.3.5 verified acceptance details not disclosed, including unresolved human assessment of characteristic wording; (3)publication naming/binary/metadata gate not cleared. Technical depth/repeat gaps are closed. Stop and wait for Zack; no further provider calls or publication action.

## Exact proposed commit files (repository-relative)

```text
application/backend/.env.example
application/backend/app/api/routers/plant_assistant.py
application/backend/app/config.py
application/backend/app/data/plant-assistant-knowledge.json
application/backend/app/domain/plant_assistant.py
application/backend/app/services/assistant_generation.py
application/backend/app/services/assistant_judge.py
application/backend/tests/test_assistant_bounded_safety.py
application/backend/tests/test_assistant_hybrid.py
application/backend/tests/test_epic8_latest_ac.py
application/backend/tests/test_plant_assistant.py
application/data/assistant-reviewed-evidence.json
application/data/knowledge_coverage_matrix.csv
application/scripts/build-assistant-knowledge.py
application/scripts/check-epic8-local-ui.mjs
application/scripts/check-epic8-live-ui.mjs
application/src/features/scan/PlantAssistantPanel.tsx
application/src/features/scan/ScanResultPage.tsx
application/tests/fixtures/epic8_original_knowledge.json
application/reports/epic8_final_implementation_report.md
application/reports/epic8_live_generation_validation.md
application/reports/epic8_17_ac_final_status.md
application/backend/app/services/assistant_grounding.py
application/backend/tests/test_assistant_grounding.py
application/backend/app/services/assistant_provider.py
application/backend/tests/test_assistant_provider_failover.py
```

---

# Preserved checkpoint before FINAL closure (historical, not current status)

The status/verification statements below belong to the earlier provider/grounding stages and are retained as evidence history.

# Epic 8 controlled provider failover — 2026-10-07

**Offline implementation and bounded Groq live routing verified. GROQ_HUMAN_REVIEW_PENDING=YES. SAFE_TO_PUSH=NO.**

This section supersedes current-state conclusions in the preserved 2026-10-06 record below; that record remains historical evidence. Gemini-only/default-disabled baseline retains its recorded 16 PASS / 1 REVIEW. The Groq-enabled candidate is **13 PASS / 4 REVIEW** on bounded technical evidence, including a literal AC 8.1.5 scope conflict. No requirement wording or privacy policy was amended. Prior approval, if separately recorded by the team, does not approve the new Groq behavior.

## A. Files changed in this stage

- `backend/.env.example`
- `backend/app/config.py`
- `backend/app/services/assistant_provider.py`
- `backend/app/services/assistant_generation.py`
- `backend/app/services/assistant_judge.py`
- `backend/app/services/assistant_grounding.py`
- `backend/tests/test_assistant_provider_failover.py`
- `reports/epic8_final_implementation_report.md`
- `reports/epic8_live_generation_validation.md`
- `reports/epic8_17_ac_final_status.md`

Ten publication-candidate paths changed in this stage (seven implementation/config/test paths and three existing reports). The ignored local `.env` was also updated at Zack’s request, preserving Gemini and adding the supplied Groq configuration. Prior dirty work is preserved. The ignored local key-free template is `.local-data/epic8-failover-20261007/groq.env.example`; it is not a publication candidate. No dependency, knowledge pack, retrieval, router/domain, frontend, safety, citation or grounding policy/validator changes were made in this stage.

## B. Provider architecture

Retrieval → hard guards → answerability → generation → mandatory grounding → backend safety/citations → display. Each of the three provider-backed roles calls one shared HTTP transport: **one Gemini primary attempt**, then **at most one Groq secondary attempt only for an eligible primary failure**. Primary model remains `gemini-3.5-flash-lite`; no Groq model default or automatic model substitution exists. Missing/disabled/incomplete Groq config preserves the original Gemini-only path. Missing/invalid primary credentials/model fail safely without Groq.

Backend-only settings are `GROQ_API_KEY` (SecretStr), `GROQ_MODEL` (explicit), `GROQ_FALLBACK_ENABLED` (false by default). Official host is fixed to `https://api.groq.com/openai/v1`; no optional third-party base URL, SDK, tools, third provider or retry loop. Each role retains its existing timeout and the existing shared 18-second deadline. Only when fallback is ready, primary receives half the role cap, leaving the remaining time for the secondary. Disabled fallback retains the original primary cap.

The existing policy, selected context and JSON schema are translated into Groq messages. Documented strict schema models use strict JSON Schema, the documented best-effort model uses schema with strict=false, and other explicitly configured models use JSON object mode with the same schema in the policy. These capability IDs never select a default model. Existing strict backend validators remain mandatory in all modes. References: [official OpenAI compatibility](https://console.groq.com/docs/openai), [structured outputs](https://console.groq.com/docs/structured-outputs), checked 2026-10-07.

## C. Exact failover triggers

HTTP 429, 500, 502, 503, 504; outer provider `RESOURCE_EXHAUSTED`; transport/network failure; provider timeout. Failover occurs only with complete enabled Groq configuration and positive remaining role budget.

## D. Conditions that never trigger failover

Valid supported/unsupported/uncertain responses; malformed/truncated/oversized responses; schema/local validation failure; HTTP 400/401/403 and other unlisted statuses; evidence insufficiency; hard guards; protected-only safety; permission/legal/medical exclusions; Unknown/Other; low confidence. Groq cannot overturn a semantic refusal. A valid grounding rejection ends candidate processing. Protected-only replies bypass both providers. Mixed replies exclude protected text from provider context and append the exact backend safety paragraph afterward.

## E. Offline verification

F01 primary success; F02 quota; F03 timeout; F04 503; F05 unsupported; F06 uncertain; F07 401/403; F08 both failures; F09 hard guards; F10 protected safety; F11 mandatory grounding after Groq generation; F12 purple-leaf rejection; F13 supported pod relation; F14 rejected flower property transfer; F15 timing/frequency/ranking/causality/locality rejection; F16 stored-metadata citations: **all PASS**, plus expanded malformed envelopes/config/privacy/time-budget cases, 143 parametrized tests total. Semantic verdicts in these tests are controlled fixtures: they prove routing and validation, not real Groq answer quality.

## F–H. Bounded live checks and request counts

Zack supplied the local Groq key and exact `openai/gpt-oss-120b` model, and explicitly confirmed the account is free. A single account GET /models returned HTTP200 and confirmed that exact model before inference. The local fallback switch is now true. Billing confirmation is an operator statement, not a programmatic account audit.

LIVE-G1 supported pod judge, LIVE-G2 evidence-only generation, LIVE-G3 mandatory supported grounding, LIVE-G4 purple-leaf rejection: **bounded technical PASS**. LIVE-G5 uses controlled failures on both providers under the same real adapter/router/configuration: judge returned insufficient_evidence; generation and grounding returned approved evidence fallback. These controlled calls are not real outage observations.

**This stage: Gemini external requests=0; Groq external chat requests=9; Groq /models requests=1.** Nine real chat responses all HTTP200: two judge, three generation, four grounding. Every primary failure was injected HTTP429; no Gemini quota was spent or exhausted. There were 17 additional controlled adapter invocations: 13 primary429, three secondary503 and one replay of an earlier actual Groq candidate. No retries, alternative models or expanded calibration. Exact phase/model/status/latency/outcome records and four human samples are in the live-validation report. An independent read-only agent checked all actual sentences, exact evidence quotes, mandatory grounding, stored source pairs and failure records without making additional provider calls; this is technical review, not team signoff. Historical Gemini counts remain separate.

Three real generated answers were accepted by mandatory grounding with stored citations. Purple-leaf and flower-property-transfer inputs returned unsupported and were withheld. The negative judge had a nonempty aspect_support array with empty support lists despite the policy requesting empty lists for negative decisions; the backend rejects every unsupported decision and did not accept or generate from it. One displayed phrase, “leaves are characteristic,” is ambiguous against the exact source; human review must resolve whether it is merely a plant trait or implies identifying importance. Do not assert a zero-error universal accuracy metric from this set.

## I. Both-provider failure

Judge fails closed to insufficient evidence and no generation. Generation failure after support yields approved evidence fallback. Grounding failure/rejection hides the entire generated candidate and yields approved evidence fallback. No third attempt/provider or unhandled HTTP/response-parsing exception in exercised cases.

## J. Secrets and privacy

Actual backend `.env` now contains the user-supplied local Groq settings and enabled switch; it remains ignored and excluded; no key was printed or placed in frontend, example, reports or publication candidates. Groq key remains backend-only. Metadata logs contain role/provider/model/fixed result category/status/latency only; no response/request bodies, exception text or authorization headers. Tests also reject accidentally using a configured key as the logged model. Both providers receive only the existing role-bounded botanical context; no image/GPS/user/session/credential/history/event/whole-pack data. Same bounded data now may go to Groq when enabled: team privacy/provider documentation must acknowledge that before release. The checked candidate files have zero key-pattern/configured-secret matches; this is a local check, not a GitHub publication gate.

## K. Full regression

| Check | Current failover-stage result |
|---|---|
| F01–F16 and expanded provider tests | 143 PASS, controlled HTTP only |
| Backend normal suite | 985 PASS / 9 opt-in integration skips |
| Frontend | 251 PASS / 34 files |
| TypeScript / ESLint | PASS, zero errors |
| Ruff check and format | 14 changed Python paths PASS |
| PostGIS / spatial | 10 PASS; separate full-stack gate skipped in this run |
| Full-stack API/workers/DB/Redis/MinIO | 5 PASS |
| Offline browser | 18 groups / 24 POST attempts / zero external provider requests |
| Independent read-only review | No concrete defect; 385 related tests PASS, including all 143 provider tests |
| Real Groq judge/generation/grounding | Bounded live PASS: 9 HTTP200 responses; details/ambiguity retained |

After live preparation, a repeat backend run also gave 985 PASS / 9 opt-in skips (7.22s). That repeat explicitly overrides GROQ_FALLBACK_ENABLED=false for the default-off offline path; all 143 isolated provider tests configure enabled fallback with fake keys/HTTP. It is not a claim that every unit test ran against a live enabled account. The independent current review is a focused 385-test rerun, not a second complete regression. Nine normal opt-in skips are covered by separate local integration runs. Cached MinIO differs from the production pin; production Docker/cloud/deployment/camera smoke remain NOT_TESTED. Test data retained; own helper processes stopped; pre-existing services left unchanged.

## L. Previous 17-AC status

Gemini-only/default-disabled baseline remains 16 PASS / 1 REVIEW on its preserved evidence. Groq-enabled candidate is **13 PASS / 4 REVIEW** on exercised technical evidence. Actual standard-depth Groq judge/generation/grounding/source records close the missing-live-evidence reason for 8.1.2/.4, 8.2.3/.4 and 8.3.2, without asserting universal truth or human signoff. Human package retains the “characteristic” ambiguity.

Remaining REVIEW: 8.1.3 and 8.1.6 have no real Groq simpler/detailed or repeat-depth run (offline schema/depth/UI regressions remain PASS); **8.1.5 AC_SCOPE_DECISION_PENDING**, because actual Gemini429 → generated Groq habitat prose differs from its literal retrieved-source fallback condition; and **8.3.5 GROQ_HUMAN_REVIEW_PENDING**. No AC wording was amended. Provider/privacy documentation must explicitly acknowledge the same bounded data going to Groq before release. Eight unchanged deterministic/retrieval/guard criteria retain regression PASS.

## M. Human review

**GROQ_HUMAN_REVIEW_PENDING=YES.** Four small cases are prepared in `epic8_live_generation_validation.md`. Three actual Groq answers, their evidence/strict grounding/source mappings, plus one replay-based controlled verifier-failure fallback are ready for review. The fourth row reuses a captured real candidate rather than claiming a new live generation. Team reviewer/name/date/decision must be recorded after bounded real calls; automated verdicts do not supply signoff.

## N. Publication decision

**SAFE_TO_PUSH=NO.** Remaining: Groq depth/repeat verification; new human review including the recorded wording ambiguity; explicit AC 8.1.5 and provider privacy-documentation decisions; fresh publication preflight and Zack's publication authorization. Nothing was committed, pushed, deployed or sent to LeanKit. Branch `main`, HEAD `e1ecae3ab98be17a0530a10dc3e530dbb0d052d5`, empty index. Future candidate whitelist has 26 paths; it is a review list, not permission to publish.

---

# Preserved historical Gemini-only grounding record — 2026-10-06

All status/call counts/first-and-second verification descriptions below refer to that earlier stage, not the new Groq candidate.

# Epic 8 final grounding closure — 2026-10-06

**16 PASS / 1 REVIEW. HUMAN_REVIEW_PENDING=YES. SAFE_FOR_TEAM_HUMAN_REVIEW=YES. SAFE_TO_PUSH=NO.**

No commit, push, deployment, LeanKit update, handover document, model/billing/account change or key publication was performed. HEAD remains `e1ecae3ab98be17a0530a10dc3e530dbb0d052d5`; index remains empty. Knowledge/retrieval architecture, knowledge pack, catalogue, frontend app behaviour, source metadata and frozen fixtures were unchanged in this stage. Previous uncommitted work is preserved. Ignored local test data is retained; own integration/browser processes stopped, pre-existing services left alone.

## Implementation and failure behaviour

Mandatory post-generation grounding is implemented after structure and before display. The generator retains its original validated sentence array; joined answer equality prevents substituted prose. Verifier policy/schema are separate from answerability and generation. Input contains only canonical species, original sentences, approved non-safety chunks (ID/topic/content), and used IDs. It receives no question, unrelated top-k evidence, protected safety paragraphs, photos, GPS, user/session/header/credential/history metadata.

Every sentence index appears exactly once, is supported=true, and has nonempty known same-species IDs and paired exact source quotes. Cited ID union equals generation used IDs. Invalid/incomplete/uncertain/unsupported/provider error/timeout/429/503 rejects the entire generated candidate and serves only support-approved evidence. Legacy results lacking the original sentence array also fall back. There is no switch to bypass this gate. The verifier reuses the configured approved generation model/key/free-tier flag and existing judge timeout cap; it is bounded by min(6s, remaining shared18s). No new provider/configuration, retries, paid fallback, or timeout increases.

Protected-only and documented-hazard paths bypass all providers; mixed answers verify only botanical prose and append complete backend safety paragraphs unchanged. Sources and URLs always derive from stored backend evidence metadata. The semantic model is an additional fail-closed gate, not mathematical proof of all possible truth; technical PASS is limited to implementation and exercised regressions. Human release review remains distinct.

## Exact files changed in this closure stage

- `backend/app/services/assistant_grounding.py`
- `backend/app/api/routers/plant_assistant.py`
- `backend/app/services/assistant_generation.py`
- `backend/app/domain/plant_assistant.py`
- `backend/tests/test_assistant_grounding.py`
- `backend/tests/test_assistant_hybrid.py`
- `backend/tests/test_plant_assistant.py`
- `scripts/check-epic8-live-ui.mjs`
- `reports/epic8_final_implementation_report.md`
- `reports/epic8_live_generation_validation.md`
- `reports/epic8_17_ac_final_status.md`

This list is the stage delta, not the complete existing dirty worktree. The future inclusion whitelist has24 files (previous22 plus grounding service/test); it grants no publication permission. Actual `.env`, local data/logs/screenshots/dependencies and unrelated reports remain excluded.

## Verification

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


Normal unit environments retain dotenv/classifier configuration; individual test fixtures prevent accidental external requests. Nine skipped opt-in modules in normal unit run are all exercised by separate PostGIS/full-stack runs (15 local integration tests). Cached local MinIO is older than the production image; exact production Docker/cloud/Render readiness, real camera classifier and deployed smoke remain NOT_TESTED. The local operator free-tier acknowledgement is not programmatic billing verification. GEMINI_API_KEY_PRESENT=true; approved model `gemini-3.5-flash-lite` unchanged.

## Live source review and bounded metrics

New closure stage only: **25 live provider attempts = 18 grounding attempts + 6 generation + 1 pre-generation answerability judge**. The direct verifier set has 12 attempts: eight adversarial and four positive groups (seven positive relations). Seven adversarial requests returned unsupported; one local-presence adversarial timed out at 6.008s, with no verdict or provider status recorded by that direct harness. It safely fell back and is not counted as a successful model rejection. Eleven direct strict responses plus six browser verifier HTTP200 responses confirm 17 grounding responses; the 18th is the timed-out adapter attempt, not a claimed confirmed provider response. Browser records confirm all13 live HTTP200 requests. Four controlled fake HTTP calls are excluded from live counts. The initial browser run completed all13 real provider calls and11 groups, then the new fault case repeated an answered question and correctly triggered the repeat prompt; the harness incorrectly waited for a POST and timed out. Its failed record remains intact. An equivalent non-repeated question fixed the harness, and a controlled-only continuation completed the remaining2 groups without additional live calls. Final18 browser POST attempts combine those two sessions.

**Observed false acceptances=0; observed false refusals=0** on this fixed bounded set. Eight negatives were withheld; seven had model verdicts and one failed closed on timeout. Four direct positive groups (7 relations) and all6 browser generated candidates were accepted. No false-negative metric is inferred for the timed-out negative. Historical59 requests remain preserved and separate; combined attempted total84 includes one unconfirmed timeout. No historical set was repeated to improve metrics.


First source review checked every direct positive clause, adversarial unsupported relation and each browser sentence against selected source paragraphs; supporting IDs/paired quotes/displayed citations matched. Independent reviewer repeated code/contracts/full regressions and reviewed those same exact live records, with no new model calls. These are technical reviews, not team human approval.

## Actual 17 AC re-evaluation and human release gate

Latest v2 DOCX re-read, SHA256 `a3a1b5e690bb42337fbdadfe2f529121229535db3230f0eb8d18cd22be057803`. Full original wordings and per-AC evidence are in `epic8_17_ac_final_status.md`.

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

Only8.3.5 remains REVIEW: Zack/Nikhil/Eason have not reviewed the final generated samples and supporting chunks, and Zack has not recorded reviewer/decision/date. The small targeted human package in `epic8_live_generation_validation.md`, section **Team human review package — HUMAN_REVIEW_PENDING**, is ready for that review. It is sampled release evidence, not exhaustive natural-language topic coverage. Automated/model reviews cannot supply human signoff. Preserve the pending status until actual team evidence review and Zack's recorded decision; no automatic PASS transition.
