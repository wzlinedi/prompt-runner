# Specification Quality Checklist: Prompt Runner

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-01
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Spec rewritten to the new top-to-bottom flow (Nowa Sesja → dataset → main prompt → judges → configuration → run → HTML report). It replaces the previous version in place.
- Removed compared with the previous version: match status and filters, multiple input columns and arbitrary placeholders, scoring-rules field, reference columns, endpoint list with names, per-metric recomputation with history.
- Interpretations to confirm: (1) similarity to expected output is computed by the app from the two texts, not by a model; (2) judges use only `{prompt_input}` and `{output}` (not the expected result); (3) the main prompt runs on all rows first, then the judges; (4) the result is shown as HTML and exported as HTML and CSV; (5) re-running only the judges was kept because it was requested earlier, though the latest description does not mention it.
- The earlier demo page was removed (2026-11-02); the two `example-*-modern.html` files remain as appearance references.
- Update (2026-11-01): added export of the result to HTML (archive, includes the three prompts and averages) and CSV (one line per row; nine fields + expected result + error/state). Prompts and averages are not part of the CSV.
- Update (2026-11-01): data loading made robust to commas: separator auto-detected (tab/semicolon/comma), quoting rules, wrong column count reported by record number. Recommended way to paste: copy cells from a spreadsheet (tab-separated).
- Update (2026-11-01): added `references/nvidia-nemotron-3_5-bolt-e4b.md` (confirmed facts and open gaps from the NVIDIA model page) and one Assumption pointing to it. Resolved in the next update: a model identifier field was added.
- Update (2026-11-01): NVIDIA-hosted models set as the test platform. Configuration blocks now: endpoint (pre-filled), model identifier, API key. Added `references/nvidia-hosted-models-api.md`, an intermediary clause (keys/content never stored or logged), a rate-limit edge case, and platform assumptions. To verify at planning: browser CORS, exact auth header and request body, model identifier of the chosen model.
- Update (2026-11-01): user supplied the Shell sample call; confirmed URL, bearer header, model identifier `nvidia/nemotron-3.5-bolt-e4b`, and request body. Spec now states what a request contains (single user message, no tools, no streaming) and handles answers cut off at the length limit. Still to verify at planning: browser CORS, reasoning-trace field, fixed request settings (max tokens, reasoning mode, seed).
- Update (2026-11-01): second judge model added. Configuration: per-judge model (Accuracy default `nvidia/nemotron-3.5-bolt-e4b`, Completeness default `nvidia/nemotron-3.5-lightning-30b-a3b`), main prompt model default `nvidia/nemotron-3.5-bolt-e4b`, option to reuse the main prompt's endpoint and key (one key for all). Assumption to confirm: the "second judge" is Judge 2 = Completeness, and Judge 1 defaults to the first model.
- Update (2026-11-01): reversed the earlier "no parameters" rule at the user's request: each of the three models has a collapsed Settings part (temperature, top_p, max tokens, reasoning budget, reasoning on/off, seed) with presets for both known models so that both run unedited. Assumption to confirm: bolt preset uses max tokens 4096 instead of the sample's 1024.
- Update (2026-11-01): simplified at the user's request: the six-field Settings form was replaced by one optional JSON text per model (pre-filled with ready-made JSON; reserved keys `model`, `messages`, `stream` rejected; no range checks, the platform validates). Preset auto-fill on model change removed.
- Update (2026-11-01): demo sample data reworked to one row per country with the whole Eurostat "Selected indicators" table (18 indicators). Poland is real (from the user's sample); other countries are marked as invented examples. Spec Assumptions describe a typical row. Open point: how a user gets a copied multi-line web table into a dataset cell conveniently.
- Update (2026-11-01): configuration simplified: per block only endpoint, API key, and one JSON that also names the model; judges use the same model by default (option "Same model as the main prompt"), their own fields appear only when it is switched off, and then one set serves both judges (separate models per judge removed). Ready-made QA prompts for Accuracy and Completeness specified (fact lists inside the rationale).
- Update (2026-11-01): report now starts with a compact summary table (test case, similarity, Accuracy score, Completeness score, averages), also in the HTML export; FR-032 and SC added.
- Update (2026-11-01): report now has, right below the summary table, a table of the prompts used (model, parameters, generation date/time) and the report's own date; CSV gets parameters and dates. FR-033, scenarios 5b-5c.
- Update (2026-11-02, key audit): added User Story 11 (7 acceptance scenarios), FR-066 – FR-073, SC-037 – SC-040, four edge cases, one Clarifications entry, and one Assumption. The places that the audit cannot see (the user's terminal, swap files, the user's everyday browser, the platform's side) are listed as out of scope. No clarification markers.
- Update (2026-11-02, correction): FR-061 and scenario 5 of User Story 10 said that the exported files must hold no prompt text; the exports legitimately hold the prompts used and the prompt input, so the rule is now: no key, endpoint, or relay address in the exports; no key and no prompt text in the relay's log (as the quickstart always said).
- Update (2026-11-02, automated acceptance): added User Story 10 (8 acceptance scenarios), FR-058 – FR-065, SC-033 – SC-036, edge cases, one Clarifications entry, and one Assumption. The three items that stay with a human (look, usability, live check with a real key) are listed explicitly (FR-065). No clarification markers.
- Update (2026-11-02, clarify): two questions on User Story 9 answered: the readiness list shows all problems of all steps grouped by step with locked steps dimmed (C), and a bottom bar with the state and the primary action serves narrow windows (A). FR-051, FR-052, scenarios 4 and 8, SC-029, and the edge cases were updated.
- Update (2026-11-02, reference page accepted): the user accepted example-form-modern.html; the three layout points that were open (run panel at the side, horizontal step indicator, subtle motion) are settled and recorded in Clarifications and Assumptions. No open points remain for User Story 9.
- Update (2026-11-01, code review): the findings of the independent code review were written as User Story 8 (12 acceptance scenarios), FR-039 – FR-047, amendments of FR-003, FR-004, FR-012, FR-016, FR-026, FR-038, 7 success criteria (SC-020 – SC-026), edge cases, and one Assumption listing the defaults chosen. No clarification markers remain; the defaults are recorded in the Clarifications section.
- Update (2026-11-02, modern application page): added User Story 9 (10 acceptance scenarios), FR-048 – FR-057, SC-027 – SC-032, edge cases, one Clarifications session, and one Assumption with the open layout points (run panel place, step indicator direction, amount of motion). Reference page: example-form-modern.html. No clarification markers; the open points are recorded as assumptions to settle with /speckit-clarify after the reference page has been seen.
- Update (2026-11-01): the expected result moved up in every row block (and in the CSV), directly after the actual output, shown in full instead of collapsed; row blocks now have ten fields.
- Update (2026-11-02, after the analysis): added FR-074 and SC-041 (the app never sends the API key back to the page, found by the key audit), the waiver note of SC-032, and the status line; no clarification markers; no implementation detail in the new text.
- Update (2026-11-02, clarify): FR-074 and SC-041 now cover every form of the whole key that the audit searches for (answer A); the code still removes only the plain and the JSON-escaped form, so a convergence pass must append a task.
- Update (2026-11-02, analysis): FR-074 and FR-069 now agree on the platform's answer (only the whole key is expected to be removed from it); no clarification markers.
- Update (2026-11-02, re-run choices): added User Story 12 (9 acceptance scenarios), FR-075 – FR-077, SC-042 – SC-044, two edge cases, two Clarifications entries, and one Assumption. The user's list of four re-run choices and a separate New Session button settled the open point about "Re-run judges only"; no clarification markers remain.
- Update (2026-11-02, analysis of User Story 12): the older texts that named the former buttons (FR-035, FR-041, SC-019, SC-025, FR-043) now name the four choices; SC-042 counts four actions; SC-043 leaves its 5-second part to a human; no clarification markers.
