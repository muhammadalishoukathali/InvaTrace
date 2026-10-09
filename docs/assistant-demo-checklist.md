# Plant Assistant local demonstration checklist

Use the isolated candidate `InvaTrace-botany-final` on
`feat/general-botany-release`. This is a **local candidate demonstration**, not a
claim about `invatrace.pages.dev`. No new real Gemini/Groq call is authorised.
For a recording, use the existing offline harness with mocked provider transport;
label any fixture scan, map records and model outputs as test fixtures. A genuine
app scan must retain its actual classifier output and confidence. Never manufacture
scan context in the product to make a demo work.

Suggested recording, about two minutes:

1. Open an existing supported Scan Result and select **Ask about this plant**.
2. Ask **Where does it grow?** Show the approved source link and safety boundary.
3. Select **More detail**; explain that source-grounded Detailed remains available.
4. Ask **What is a rhizome?** Show **General botanical information**, its unverified
   general-information notice, and empty sources. Show **Simpler** and **Standard**;
   explain that General Detailed is excluded from this release.
5. Ask **Can I eat it?** Show the code-controlled sourced hazard/limitation and
   safety boundary. Do not imply that absence of a documented hazard means safe.
6. Open **Map** and select **Ask Plant Assistant** without a selection. Show the
   deterministic map-help prompt; it does not offer unrestricted general chat.
7. Close it, select a supported public plant marker or record in **Reports**, then
   select **Ask Plant Assistant** in its details. Ask **Where does it grow?** Show
   stored citations and reference-context wording. This is not scan identification
   or confirmation that a plant is near the user.
8. Close the assistant. Show the map still works: Reports plant filter, places
   toggle, legend and zoom. Open another supported marker and show a fresh answer
   state. Show an unsupported record gives an honest limitation.
9. Open a supported **Plant Guide** detail page and select **Ask Plant Assistant**.
   Show the same UI, a grounded answer/citation and Grounded Detailed. Close it and
   show the original guide content; reopen or change guide species and show reset.
10. Briefly show the modal at **375px mobile** and **1280px desktop**. End with:
    “Local implementation is complete; General Knowledge human factual review and
    proposed AC wording remain pending. Nothing has been committed or deployed.”

Offline verification commands (local ports; inference always mocked):

```sh
EPIC8_TEST_PYTHON=/path/to/test/python node scripts/check-epic8-local-ui.mjs
EPIC8_TEST_PYTHON=/path/to/test/python node scripts/check-assistant-entrypoints-ui.mjs
```

These scripts finish and stop their own servers. A persistent recording session has
not been started. Do not execute `check-epic8-live-ui.mjs` for this task. Any later
real-provider recording requires separate bounded-call authorisation and the
pending release decisions; do not present mocked output as a real provider result.
