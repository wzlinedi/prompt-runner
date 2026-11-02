# Research: Prompt Runner

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-01

Every unknown that the specification deferred to planning is resolved here. Evidence that was measured during planning is marked **[measured]**; facts taken from documentation or the user's sample calls are marked **[documented]**; anything that can only be confirmed with a real API key is marked **[to verify live]** and is covered by the live check in [quickstart.md](quickstart.md).

---

## R1. Can the page call the NVIDIA API directly from the browser?

**Decision**: No. The app needs a small local relay that forwards the requests.

**Evidence [measured, 2026-11-01]**:

- A `curl` preflight (`OPTIONS`) to `https://integrate.api.nvidia.com/v1/chat/completions` with `Origin: http://localhost:8765` returned `HTTP 200` **without** any `access-control-allow-origin` header.
- The same preflight with `Origin: https://build.nvidia.com` returned `access-control-allow-origin: https://build.nvidia.com`, `access-control-allow-headers: Authorization, Content-Type`, `access-control-allow-methods: POST`.
- A real `fetch()` from a page served at `http://localhost:8765` in headless Chrome failed with `TypeError: Failed to fetch` (blocked by CORS).
- An unauthenticated `POST` returns `401` with the body ``Header of type `authorization` was missing`` (so the service is reachable and the auth header is `Authorization`).

**Rationale**: The platform only allows browser calls from NVIDIA's own origins. This confirms the assumption written in the spec ("Reaching the platform from the app").

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|--------------|
| Call the API directly from the page | Blocked by the browser (measured above). |
| Disable web security in the browser (a launch flag, or a CORS-unblocking extension) | Weakens the browser for every site; fragile; not something to ask the user to do. |
| Public CORS proxy services | The key and the data would pass through a third party; violates constitution Principle I and the spec's FR-016. |
| Desktop shell (Electron, Tauri) | Heavy dependencies and build tooling for a one-page tool. |
| Hosted relay | Out of scope: the clarified decision is "locally first" (spec, Clarifications). |

---

## R2. Language and stack for the page and the relay

**Decision**: JavaScript for everything. The page is a static page with ES modules (no framework, no bundler, no build step). The relay is a Node.js program that uses only built-in modules. Node.js 22 is already installed (`v22.23.4`).

**Rationale**:

- One language for the page and the relay; the earlier demo page (since removed) was plain JavaScript and its logic (parsing, placeholders, similarity, report building) moves into modules almost unchanged.
- Zero third-party dependencies: nothing to install, nothing that could log a key, a very small attack surface (constitution Principle I and II).
- Node 22 has `fetch`, `AbortController`, the `node:test` runner, and `node:assert`, which covers the relay and all tests.
- The pure logic (dataset, placeholders, config validation, similarity, judge answer parsing, report/CSV building, the run orchestration with an injected `fetch`) has no DOM access, so it is tested directly in Node.

**Alternatives considered**:

| Alternative | Why rejected |
|-------------|--------------|
| Python relay (standard library `http.server`, Python 3.14 is installed) | Equivalent, but a second language next to the page; the two sides could not share modules. |
| LangChain or a provider SDK | An abstraction layer is not needed for one chat request per row; it would add dependencies and hide what is sent (the spec requires exact control over the request and the data). |
| A framework (React, Vue) | The page is one screen with simple state; a framework adds a build step and dependencies. |
| Single `bash`/`curl` scripts | Cannot provide the interactive page; useful only as a reference for the contract (see [contracts/upstream-chat.md](contracts/upstream-chat.md)). |

---

## R3. Relay design and hardening

**Decision**: One Node process (`app/server.mjs`) that (a) serves the static page and (b) exposes `POST /api/chat`, which forwards one chat request and returns the upstream answer. Details are in [contracts/relay-api.md](contracts/relay-api.md).

Hardening rules (a local relay that forwards to any address could otherwise be abused by a malicious web page open in the same browser):

1. Bind to loopback only (`127.0.0.1`); never `0.0.0.0`.
2. Generate a random token at every start and inject it into the served page; every `/api/chat` call must send it in `X-Relay-Token`. A page from another origin cannot read it.
3. Check `Host` (must be `127.0.0.1:<port>` or `localhost:<port>`) and, when present, `Origin` (must equal the relay's own origin); reject everything else with `403`. This also blocks DNS-rebinding.
4. Accept only `http:` and `https:` endpoint addresses, no credentials in the URL, and do not follow redirects (return the redirect status as an upstream error), so a forwarded request cannot be bounced to an unexpected host.
5. Allow only `POST`, a JSON body, and a size limit (default 64 MB; values may be up to 100,000 characters × 20 rows).
6. Never log request bodies, headers, endpoint URLs with query strings, or answers. The access log contains only: time, method, path, status, duration. No key can reach a log.
7. Abort the upstream request when the page disconnects (the Stop button), and apply a per-request timeout (default 180 s, because reasoning models can be slow).
8. Hold nothing between requests: no cache, no session store, no files written.

**Rationale**: These rules keep Principle I intact even though the relay sees the key in transit, and they make the relay useless to any other site.

**Alternatives considered**: forwarding the key as a request header instead of in the JSON body (rejected: the body is the simpler contract and both are equally invisible to logs under rule 6); allow-listing only `integrate.api.nvidia.com` (rejected: the spec lets the user choose any endpoint with the same format; the loopback + token + origin rules already protect the relay).

---

## R4. Upstream request and response handling (chat format)

**Decision**: Build the request from the user's parameters JSON plus the two fields the app owns; read the answer from `choices[0].message.content`; treat `finish_reason: "length"` as "cut off". Full mapping in [contracts/upstream-chat.md](contracts/upstream-chat.md).

- Request body = `{ ...parametersJson, "messages": [{"role": "user", "content": <resolved prompt>}], "stream": false }`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`, `Accept: application/json`. [documented: the user's sample calls]
- No system message, no tools, no streaming (spec: "What a request contains").
- Output text = `choices[0].message.content` (string). The reasoning trace arrives in a separate field, `message.reasoning_content`, and is ignored; `content` holds only the final answer. **[verified live, 2026-11-01]**
- `finish_reason === "length"` → the output is shown with the "cut off at the length limit" note (spec edge case).
- Empty or missing `content` is a valid (empty) output for the main prompt, with the note "no answer text returned" when `finish_reason` is `length` (the budget was used up by reasoning). For a judge it is an unreadable answer.
- HTTP errors become row errors with plain wording: `401/403` → key or model not permitted; `404` → unknown model or address; `422/400` → the platform rejected a parameter (message includes the platform's text, never the key); `413` or a context-length message → input too long; `429` → rate limit (with `Retry-After` when present); `5xx`, timeouts, and network failures → platform or network problem. Nothing is retried automatically (constitution Principle I).

**Rationale**: Mirrors the sample calls the user confirmed and the spec's per-row error rules.

---

## R5. Judge answer format and parsing

**Decision**: The app appends a fixed instruction to every judge prompt and reads the grade from a final marker line. Details in [contracts/judge-answer-format.md](contracts/judge-answer-format.md).

- Appended instruction (English): the judge must end its answer with one final line exactly in the form `SCORE: <number from 0 to 100>`; everything before that line is the rationale (including the lists of facts).
- Parsing: take the **last** line that matches `^\s*SCORE\s*:\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*$` (case-insensitive); the number must be within 0–100, otherwise it is an "unreadable answer" (raw text kept for display). The grade is rounded to a whole percent.
- Rationale = the answer text without the marker line, trimmed.

**Rationale**: Free-text answers with fact lists from a reasoning model are hard to read as strict JSON; a single marker line at the end is easy for models to follow and unambiguous to parse, and the lists stay human-readable in the rationale (spec FR-031). It needs no model feature (no JSON mode).

**Alternatives considered**: strict JSON answer (rejected: models often wrap or truncate JSON, and long fact lists inside JSON strings are unreadable); asking for the percentage anywhere in the text and taking the first number (rejected: ambiguous because the rationale contains many numbers).

---

## R6. Similarity algorithm (spec FR-024)

**Decision**: Levenshtein distance computed with the bit-parallel Myers/Hyyrö algorithm in 32-bit blocks, on the two texts after trimming surrounding whitespace, case-sensitive. `similarity = round((1 − distance / max(len a, len b)) × 100)`; two empty texts → 100; one empty text → 0.

**Rationale**: A plain two-row dynamic programme is `O(n·m)`; two 16,000-character texts (the answer limit of 4096 tokens is about that long) would be 256 million cell updates and could freeze the page. The bit-parallel version does the same work in about `n·m/32` steps (milliseconds). It is verified in tests against the naive implementation, including the spec's example (`"abcd"` vs `"abce"` → 75%).

**Characters**: the comparison is over UTF-16 code units (JavaScript strings). The difference from counting visible characters appears only for emoji and rare scripts and does not matter for this tool; this is documented in the unit test.

---

## R7. Pacing, concurrency, stopping, and limits

**Decision**:

- **Row limit**: 1–20 selected rows (spec FR-034), enforced in the page before anything is sent.
- **Concurrency**: at most 4 requests in flight; **pacing**: the start of consecutive requests is at least 1.6 s apart (about 37 requests a minute, below the reported free limit of 40). Both are constants in one place (`runner.mjs`).
- **Phases**: all main-prompt requests first, then all judge requests, each phase with its own progress counter (spec FR-018).
- **Stop**: one `AbortController` per run; Stop aborts in-flight requests (the relay aborts upstream), starts no new ones, and marks unfinished rows "not run". Target: nothing arrives later than 5 s after Stop (the unquantified "few seconds" of SC-009 is fixed to 5 s for test purposes; the spec wording is unchanged).
- **No automatic retry**, ever. A failed row can only be re-run by the user ("re-run failed requests").
- **Estimated duration**: 60 requests (20 rows × 3) ≈ 100 s of pacing plus model latency; with 4 in flight and the **measured** latencies (a trivial request 0.3 s; a judge request about 10 s on the first model and about 27 s on the second), a 20-row run takes roughly 2.5–3 minutes when the judges use the first model and 5–6 minutes with the second model as judge. **[measured live, 2026-11-01]**

**Rationale**: Sequential requests would make a 20-row run last far too long with reasoning models; unbounded parallelism would hit the 40-per-minute limit at once and produce rate-limit errors.

---

## R8. Dataset loading

**Decision**: A small own tokenizer (no CSV library), ported from the demo, in `dataset.mjs`:

1. Separator detection from the first line: try tab, semicolon, comma; the first one for which the header contains all four column names wins.
2. Tokenizer: a double quote opens a quoted value only at the start of a value; `""` inside is a quote; separators and line breaks inside quotes are kept; `\r\n` and `\r` are line breaks.
3. Checks, in order: header recognized → record column counts equal the header (report the first bad record and the count of similar ones; load nothing) → at least one row → empty id / duplicate id / empty name / empty `prompt_input` listed per record. A row with an empty `expected_result` is accepted and flagged.
4. Values are stored exactly as parsed (only the four fields are kept; ids, names, and `prompt_input` are trimmed, the `expected_result` is trimmed for comparison only).

**Rationale**: Keeps the exact behavior shown in the demo, which was tested in Chrome with tab-, semicolon-, and comma-separated input and with broken records. Messages are in [contracts/dataset-format.md](contracts/dataset-format.md).

---

## R9. Report and exports

**Decision**: One module (`report.mjs`) builds a plain data structure (summary rows, prompt/parameter rows, the rows of the results table with their word differences, averages) and two renderers: an HTML string (used both for the on-screen report and for the self-contained export, with inline CSS and no scripts) and a CSV string. The CSV is UTF-8 with a byte-order mark and CRLF line breaks, every field quoted with `""` escaping, so spreadsheets open Polish characters and multi-line values correctly. Layout and columns: [contracts/export-formats.md](contracts/export-formats.md).

**Date and time format** (an item the clarify pass left open): local time as `YYYY-MM-DD HH:MM:SS` with the UTC offset shown once in the report header (`UTC+01:00`); in the CSV, ISO 8601 with offset (`2026-11-01T14:12:31+01:00`) so spreadsheets and scripts can sort and compare.

**Rationale**: One data structure for both renderers guarantees that the HTML and CSV never disagree (SC-007), and the HTML export is exactly what the page shows.

---

## R10. Testing strategy

**Decision**:

| Level | Tool | What it covers |
|-------|------|----------------|
| Unit | `node --test` | placeholders, dataset parsing and errors, parameters-JSON validation, similarity (against a naive reference), judge answer parsing, request building and response mapping, runner (phases, pacing with a fake clock, abort, failed-rows re-run, judge re-run) with a fake `fetch`, report and CSV builders |
| Contract | `node --test` | the relay against a fake upstream server: forwards body and `Authorization`, strips nothing it should not, rejects wrong token/Host/Origin, never logs the key (the test captures the log output), aborts upstream on client disconnect, maps upstream and network errors |
| End to end | headless Chrome (installed) driven by a Node script, against the relay and a fake upstream | the user stories on the real page: load a dataset, run, report, exports, judge re-run, failed-rows re-run, row limit, stop, New Session. No real key and no network access |
| Live check | manual, by the user, with a real key | the facts that need a real key (done once on 2026-11-01, results in R12; the script can be re-run); steps in [quickstart.md](quickstart.md) |

**Rationale**: Everything that can be checked without the platform is automated; the few facts that need a real key are isolated in one short manual check. An automated browser test was already used successfully on the demo.

---

## R11. Unload warning and small decisions from the clarify pass

- **Closing or reloading with unexported results** (now also a requirement in the spec, FR-029): the page registers a `beforeunload` handler while a report exists that has not been exported since its last change; the browser shows its own generic confirmation. Nothing is stored.
- **Quantifications** (first decided here, then written into the spec after the analysis of 2026-11-01): SC-009 "a few seconds" = 5 s; SC-014 "readable on one page" = the 20-row summary table is fully visible without scrolling at a 1920×1080 viewport.
- **Keys in the page**: held in a JavaScript variable inside the run controller, never written to the DOM after being read (the input is cleared), never put in a URL, never in `localStorage`/`sessionStorage`/IndexedDB, and removed when the run ends, fails, or is stopped (spec FR-016).
- **Port**: the relay picks `8787` by default and falls back to any free port; the chosen address is printed at start. Nothing is opened automatically.

---

## R12. Points that needed a real key: results of the live check (2026-11-01)

Run by the user with their own key (`tests/live/check.mjs`; the key never left their computer and the output contained none). Status of each point:

| # | Point | Result |
|---|-------|--------|
| 1 | Where a reasoning trace appears and what `content` is with thinking on | **Confirmed.** The message has the fields `content`, `role`, and `reasoning_content`; `content` contains no `<think>` tags and only the final answer. The app reads `content` and ignores `reasoning_content`. |
| 2 | Whether `max_tokens: 4096` leaves room for reasoning and the answer (first model) | **Confirmed for a short judge request**: `finish_reason: stop`, 523 completion tokens, the `SCORE:` line was read (`66.67`, shown as 67 %). Not yet confirmed for a long real summary (about 1.6 thousand characters of input); the first real run in the app will show it, and the "cut off at the length limit" note exists for that case. |
| 3 | Real latencies | A trivial request 0.3 s (2 completion tokens, so the model skipped reasoning); a judge request about 10 s (523 tokens) on the first model and about 27 s (2,545 completion tokens, mostly reasoning) on the second. Used in R7. |
| 4 | The second model accepts its parameters as written | **Confirmed.** `reasoning_budget: 16384` and `max_tokens: 16384` were accepted; `finish_reason: stop`; the `SCORE:` line was read. |

Also confirmed: the key format is `nvapi-` plus 64 characters (70 in total); the answer includes `usage` (prompt, completion, total tokens); **no rate-limit headers** were returned, so the platform's limit (reported at about 40 requests a minute) cannot be read from the answers and stays an assumption, which is why the pacing of R7 and the per-row "rate limit" error remain.

No default parameter and no mapping had to change. The only residual unknown is the behavior on long real inputs.

### How to verify R12 without exposing the key

`tests/live/check.mjs` is a standalone script (no dependencies, no import from the app) that the user runs locally. It reads the key from `NVIDIA_API_KEY` or from a hidden prompt, never from a command-line argument (shell history), sends three short requests, and prints only non-secret facts, with the key (and anything shaped like one) removed from every line, so the output is safe to paste into a chat. Its behavior is covered by `tests/live/check.selftest.mjs`, which runs it against a fake platform, including a platform that echoes the key back in an error message, and by a run in a pseudo-terminal that confirms the hidden prompt does not echo the key. (Those four points have now been verified this way.) A later alternative is a real run in the app followed by sharing the exported report/CSV, which by contract contain no key and no endpoint. The key is never needed in the chat in either case.

### Measured behavior of the platform's key check (2026-11-01)

| Request | Answer |
|---------|--------|
| `GET /v1/models`, no key, a fake key, or garbage | `200` with the list of models (85): the list is public and proves nothing about a key |
| Chat with `Authorization: Bearer nvapi-<anything>` (right prefix, fake) | `403 Authorization failed` |
| Chat with a token that does not start with the lowercase `nvapi-` (uppercase prefix, no prefix, doubled `Bearer`) | `401 Invalid JWT serialization: Missing dot delimiter(s)` |
| Chat with no `Authorization` header | `401 Header of type authorization was missing` |

Consequence for the app: the per-row error messages distinguish exactly these cases ("the platform did not recognise the key; a key starts with nvapi-" for the `401 JWT` case, "the key was refused" for `403`), and the page may hint, before a run, when a pasted key does not start with `nvapi-` (a hint, not a block, because another endpoint may use another key format).

## R13. Differences between the expected result and the actual output (spec FR-023)

**Decision**: A separate word-level comparison, `diff.mjs`: both texts are cut into words (a word with the whitespace after it), compared without the whitespace, the common start and end are removed, and a longest common subsequence of the rest gives the unchanged, removed (`del`), and added (`ins`) parts; neighbouring parts of one kind are merged and the text of the actual output is kept. Above 4,000,000 table cells the comparison is not made and the report says so.

**Rationale**: Words are what a reader compares in long free text; the character-level distance of R6 would mark almost every character of a differently worded answer. The table is small for the texts of a report (one 1,650-character row is a few thousand cells) and the limit keeps the page responsive for 100,000-character values.

**Alternatives considered**: the character-level alignment of the similarity (rejected: unreadable for free text, and a different purpose); a diff library (rejected: dependency); sentence-level marks (rejected: too coarse to find a changed number).

## R14. Report appearance (spec FR-037)

**Decision**: One CSS text in `report-style.mjs`, scoped under `.rpt`, with colour tokens (a light set and a dark set that follows `prefers-color-scheme`), used by the page (injected once) and by the HTML export (inlined). Gauges are `conic-gradient` rings driven by a custom property; bars are plain elements; levels are green from 80, amber from 50, red below, and the number is always written. System font stack, no image, no external font, no script. A unit test parses both token sets and asserts a contrast of at least 4.5:1 for every pair.

**Rationale**: The export must stay self-contained (R9) and the page and the export must look the same; CSS-only gauges need no library. Colour is never the only carrier of meaning, which also covers colour-blind readers.

**Alternatives considered**: an SVG chart library (rejected: dependency, and the export would need it too); images or an icon font (rejected: external or heavy); styling the page and the export separately (rejected: they would drift).

## R15. Report view and the form (spec FR-038)

**Decision**: The report is shown in its own view over the full width of the window, replacing the form (`#formView`) while open; the view opens by itself when a run, a judge re-run, or a failed-requests re-run ends, and step 5 has "Open report". The toolbar has "Back to the form" and the two exports; progress, Stop, confirmations, and the re-run actions stay in step 5 because they need the form's prompts and keys. Going back keeps the form untouched; New Session closes the view.

**Rationale**: Five fields side by side need more than the 1000 px column of the form; a second window or a widening of the whole page would hurt the form. The two views share one page and one in-memory session, so nothing is stored.

**Alternatives considered**: widening only step 5 out of the column (rejected by the user in favour of a separate view); a full-width page for everything (rejected: forms become very wide); a pop-up window (rejected: blockers, no shared state guarantee).

## R16. Re-running only the failed requests (spec FR-035)

**Decision**: "Re-run failed requests" computes the list of requests that ended with an error or were not run (`failedRequests`), uses the same list for the count and for the itemised confirmation, and sends only those. Main requests use the main prompt, model, and parameters of the snapshot; judge requests use the current judge prompt text with the archived judge model and parameters. The snapshot keeps `judgePromptVersions` and every verdict the index of the version it came from; the report notes how many grades come from an earlier version and archives that version.

**Rationale**: The user wants to repeat only what failed; a failure caused by a judge prompt (unreadable answer) can only be fixed by changing that prompt, and repeating it with the archived text would fail again. Keeping the versions keeps the report honest.

**Alternatives considered**: always the archived prompts (rejected: cannot fix a prompt-caused failure); re-running all judges (rejected: repeats successful requests, which the user does not want); silently mixing versions (rejected: the report would not say what produced a grade).

## R17. What is confirmed is what is sent (spec FR-039, FR-044)

**Decision**: When the user presses Run or a re-run action, the page enters a *confirming* state: the steps 1–4 are made `inert` (nothing can be typed, ticked, or clicked there; they are dimmed) and only "Confirm and send" and "Cancel" act; Cancel lifts the state. On "Confirm and send" the page checks every blocking condition again (`blockingProblems` and its re-run variants), builds one **run request** (a deep copy of the selected dataset rows, the prompt texts, endpoints, keys, and parameters texts), and hands only that copy to `startRun`. The runner copies the prompt strings it receives, so nothing it uses is a live object that the editors change on every keystroke (the review reproduced a half-typed judge prompt being sent). The confirmation text gets one more line per endpoint when the address uses `http` and is not on this computer (host `localhost`, `127.0.0.0/8`, or `::1`): "the key and the data travel unencrypted"; it never blocks.

**Rationale**: The user chose a locked form (clarification of 2026-11-01, option B) over closing the confirmation on any edit. Locking prevents the mismatch, the second check protects against states the lock cannot cover (for example a dataset removed meanwhile), and the copy protects the run from edits during the run (the review's finding 3).

**Alternatives considered**: closing the confirmation when a field changes (rejected by the user); sending the values as they were at the click without a lock (rejected: the user would not see why a later edit has no effect); disabling the controls one by one (rejected: easy to miss one, `inert` covers a whole region).

## R18. One definition of a failed row (spec FR-035, FR-040)

**Decision**: The question "is this row complete?" is answered by one function, used by `failedRows`, `failedRequests`, the confirmation list, `countRequests`, `canRerunFailed`, and the job list that is really sent. A row is complete when the main outcome is `ok` and every judge verdict is `ok`; a row with a main output whose verdict is `error`, `not-run`, `pending`, `running`, **or `nothing-to-judge`** is failed for that judge. `nothing-to-judge` is valid only while the row has no output. When the main request of a row succeeds (in any mode), its judge verdicts are reset to `pending` before the judge phase, and Stop turns whatever is still `pending` or `running` into `not-run`, so a stopped re-run can never leave "nothing to judge" next to a real output.

**Rationale**: The review reproduced a re-run stopped between the main answer and the judges: the row kept `nothing-to-judge`, the "Re-run failed requests" button vanished, and the confirmation list differed from what was sent. All of those came from separate, slightly different checks.

**Alternatives considered**: patching only the one check that failed (rejected: the same drift would return); deriving the state from timestamps (rejected: more state, not less).

## R19. A truthful report and keys that leave no trace (spec FR-016, FR-042, FR-045)

**Decision**:
- *Judge model in the report*: "same model" is derived from the archived parameters (the main and judge JSON texts compared as parsed objects), never from the check box; the archive lists the judge JSON whenever it differs from the main JSON, and the facts, the prompts table, and the CSV use the judge parameters of the latest judge run.
- *Redaction*: `redact` also removes the trimmed key, the key without a pasted `Bearer ` prefix, and the host name of the endpoint, in addition to the exact key, the endpoint, and anything shaped like `nvapi-…`; the same pattern is applied to the parameters text when the report and the CSV are built (replaced by `[key]`).
- *Key lifetime*: the frozen copy behind a confirmation (which holds the keys) is dropped as soon as the run starts or the confirmation is cancelled. The runner keeps the endpoint and key of its two targets in its own closure and empties both when the run ends; `clearKeys` empties the page fields and the session's keys, and no closure created for Stop or for the job queue keeps its own reference to a key. Every continuation of a run (`done`, progress, `clearKeys`) first checks that the run is still the current one (a token), so a run abandoned by New Session cannot clear the keys or move the progress of the new session.

**Rationale**: Each of these makes an existing promise (FR-016, FR-026, FR-033) true in the cases the review found, with no new component.

**Alternatives considered**: storing a "judges used the same model" flag next to the snapshot (rejected: it can drift from the parameters again); clearing keys by replacing the whole session object (rejected: the page holds other references to it).

## R20. Stop and the confirmation always reachable (spec FR-043)

**Decision**: The Stop button, the progress, and the confirmation box move into step 5 (the "Result" step). Step 4 (which holds the key fields) is shown whenever a dataset is loaded **or a run exists**, and step 5 whenever a run exists **or a confirmation is open** (so that the confirmation of the first run has a place); a failed dataset load therefore hides only the dataset preview and steps 2–3, not the controls of a run in progress. The key fields stay in step 4 (a second place for secrets is rejected). While a confirmation is open, steps 1–4 are made `inert` and only Confirm and Cancel act; Run and the re-run actions are disabled.

**Rationale**: The review reproduced a paid run that could not be stopped after a broken dataset was loaded, and a judge re-run for which the key field was hidden.

**Alternatives considered**: repeating the key fields and Stop in step 5 (rejected: duplicate secret inputs); forbidding dataset loading during a run (rejected: the lock would only cover one path).

## R21. Hardening of the local server (spec FR-046)

**Decision**: Every page response carries `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` and `X-Frame-Options: DENY`. `'unsafe-inline'` is allowed for styles only, because the page and the report gauges use style attributes; there is no inline script. The HTML export carries `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`, so it cannot load anything even if opened from disk. The relay reads the upstream answer as a stream with a byte counter and gives up at 8 MB (the upstream request is aborted) with `502 upstream_too_large`; the page shows "The platform's answer is too large (more than 8 MB)".

**Rationale**: It is a second line of defense for a page that handles keys; no injection path was found, so this costs a header and a counter and changes no behavior. The download of an export uses a `blob:` link and navigation, which this policy does not restrict; the end-to-end test checks it.

**Alternatives considered**: no policy because escaping is complete (rejected: one missed escape later would be exploitable); a nonce-based policy for styles (rejected: it would mean rewriting the style attributes for no gain here).

## R22. Spreadsheet-safe CSV, dataset parsing, and score reading (spec FR-003, FR-004, FR-012, FR-026)

**Decision**:
- *CSV*: in the text columns (ID, Scenario, Prompt input, Actual output, Expected result, both Rationales, Status, models, parameters) a value whose first character is `=`, `+`, `-`, `@`, a tab, or a carriage return gets a leading `'` before quoting; the numeric columns (similarity, grades) and the date columns are written as before. The HTML export is unchanged.
- *Dataset*: the tokenizer reports "quote still open at the end" with the number of the record in which it was opened, and the loader turns that into an error; the separator detection takes the first record from the same tokenizer (so quoted header names work) and recognizes the three kinds of line break everywhere.
- *Score line*: the reader accepts, case-insensitively, a line of the shape `[heading/quote/emphasis marks] SCORE [emphasis] : [emphasis] number [% or /100] [emphasis]`; the last such line counts; the range check is unchanged ([judge-answer-format.md](contracts/judge-answer-format.md)).
- *Responsiveness*: the word differences of a row are cached by the pair (expected result, output), so the 150 ms refresh of an open report recomputes nothing for rows that did not change (FR-047).

**Rationale**: Each is the smallest change that satisfies the amended requirement; none adds a dependency.

**Alternatives considered**: prefixing a tab or a space instead of `'` (rejected: invisible, harder to test, and some programs still evaluate); rejecting values that start with a trigger character (rejected: it would drop legitimate output); making the score reader a free-text search (rejected: a sentence containing the word "score" must not be mistaken for the marker).

## R23. One set of design tokens for the page and the report (spec FR-048, SC-027)

**Decision**: The colours, the shadow, and the gradient of the header band are defined once in a new pure module `theme.mjs` as a list of tokens with a light value and a dark value, plus a function `tokensCss(selector)` that writes them as custom properties for a selector (and, under `prefers-color-scheme: dark`, the dark values). `report-style.mjs` uses `tokensCss('.rpt')` (so the HTML export stays self-contained and unchanged in look), and the server answers `GET /styles.css` with `tokensCss(':root')` followed by the content of `styles.css` (the page's own rules), so the page has its tokens before the first paint and there is no second copy of any value. The page's old, differently named tokens (`--card`, `--bad`, `--ok`, …) are replaced by the names of the report (`--surface`, `--low`, `--good`, …). A test compares the token lists of the page's CSS and of `REPORT_CSS` and runs the contrast check over the shared list.

**Rationale**: "Cannot drift apart" (FR-048) is only true when there is one definition. Composing the file in the server avoids a flash of unstyled content that injecting the tokens from a script would cause, and needs no build step.

**Alternatives considered**: copying the values into `styles.css` (rejected: two copies); injecting a `<style>` element from the page's script (rejected: unstyled flash, and the contrast test would need a browser); a CSS `@import` of the report's CSS (rejected: the report's rules are scoped to `.rpt` and live in a module).

## R24. Structure of the page: header band, step indicator, steps, run panel, bottom bar (spec FR-049 – FR-051, FR-057)

**Decision**: `index.html` becomes: a `<header>` with the band (product name, chips, New Session), a `<nav aria-label="Steps">` with an ordered list of five links, a two-column grid with `<main>` (the cards of steps 1–4, ids unchanged: `secData`, `secMain`, `secJudge`, `secCfg`) and `<aside id="secRes">` (the run panel, step 5), and a fixed `<div id="runBar">` for windows narrower than 1100 px. The grid is `minmax(0,1fr) 360px` from 1100 px; the aside is `position: sticky`; below 1100 px the aside is static after the steps and `#runBar` is shown; below 900 px the cards stack and the buttons are at least 40 px high. The existing element ids that the scenarios and the views use (`run`, `stop`, `runConfirm`, `confirmYes`, `confirmNo`, `phase`, `prog`, `prog2`, `openReport`, `expHtml`, `expCsv`, `rerun`, `rerunFailed`, `runMsg`, `resMsg`, …) are kept. The run panel is shown from the start of a session (it holds the readiness list from the first moment), so `secRes` is no longer hidden until a run exists; steps 2–4 still unlock in order, and step 4 stays visible while a dataset is loaded or a run exists (research R20). The run bar has two controls: the state text (a button that scrolls to the panel) and one action button that delegates to the panel's real button (`run`, `stop`, or `openReport`) so that the confirmation, the lock, and every check stay in one place (research R17).

**Rationale**: Grid, sticky, and a fixed bar are plain CSS; keeping the ids keeps the views and most end-to-end scenarios working; delegating from the bar avoids a second implementation of Run.

**Alternatives considered**: a bottom drawer (rejected by the user), a separate Run button with its own handler in the bar (rejected: two paths to keep equal), moving the panel with script on resize (rejected: CSS does it).

## R25. Readiness, step states, and session facts as one pure module (spec FR-049, FR-050, FR-052)

**Decision**: A new pure module `readiness.mjs` derives everything the new chrome shows from the session, without touching the page: `readiness(session)` returns the problems as objects `{ step, field, text }` grouped by step (1 dataset and selection, 2 main prompt, 3 judges, 4 configuration) with `available` per group (a step is available when the steps before it are unlocked, i.e. a dataset is loaded for steps 2–4); `stepStates(session)` returns for each of the five steps `locked | current | done | attention`, a short fact (`5 rows, 3 selected`, `valid`, `2 prompts valid`, `ready`, `2 problems`), and its number of problems; `sessionFacts(session)` returns the chips (rows loaded, rows selected out of 20, model of the main prompt, judges "same model" or their model, report exists or not) and never a key or an endpoint. To give a problem its step and field, the three checkers return structured items next to their strings: `validateConfigDetailed` in `config.mjs` (block and field), `checkPrompt` already knows its kind, and the dataset checks know their field; `blockingProblems` becomes `problemList(session).map((p) => p.text)`, so every existing test and message keeps its text. The functions that decide what blocks a run (`blockingProblems`, `judgeRerunProblems`, `failedRerunProblems`) move from `run-view.mjs` into a pure `problems.mjs` and are re-exported from `run-view.mjs`.

**Rationale**: The readiness list, the step indicator, the chips, and the bottom bar must always agree with each other and with the checks that really block a run; one source gives that and makes all of it unit-testable without a browser.

**Alternatives considered**: reading the problems back from the messages already on the page (rejected: text parsing, and the messages do not exist for locked steps); a second set of checks for the panel (rejected: it would drift from the real blocking rules).

## R26. The run panel and its bottom bar: behavior (spec FR-052, FR-054, FR-055)

**Decision**: A new view `ui/panel-view.mjs` renders the readiness list (grouped by step; groups of steps that are not available are dimmed, their items are not links), the "ready" summary (request counts per endpoint and models, the same numbers as the confirmation but without the consent), the state badge, and the bottom bar. It refreshes on every change of the session and on every `input` event of the page (collected in one animation frame), and it rewrites the list only when the list of problems really changed, so an assistive technology is not told the same thing at every keystroke (`aria-live="polite"`). **Run** is disabled while any problem exists and the reasons stay visible beside it (`aria-describedby` on the button points to the list); an item of an available step moves the focus to its field (`id` from the item). A second view `ui/chrome-view.mjs` renders the chips and the step indicator from `sessionFacts` and `stepStates` and scrolls to a step when its link is pressed. During a confirmation the bar shows "Confirmation waiting" with its action disabled; during a run it shows the phase and the progress with **Stop**; after a run it offers **Open report**.

**Rationale**: Keeping rendering in two thin views over the pure module of R25 keeps the logic testable; "rewrite only when changed" is what makes a live list usable with a screen reader.

**Alternatives considered**: updating the list on `change` only (rejected: not live); leaving Run enabled and explaining on click (rejected by the spec: Run unavailable, reasons visible).

## R27. Motion (spec FR-055, SC-030)

**Decision**: Every `transition` and `animation` of the page CSS (and of the report's CSS) is written inside one `@media (prefers-reduced-motion: no-preference)` block, so that with reduced motion nothing runs without any override to maintain; durations are at most 250 ms and use `ease-out`. Used for: a step unlocking (opacity and a 4 px slide), a readiness item appearing, the confirmation opening, the progress fill, the ring gauge fill, and hover and press states of buttons. A unit test reads the generated CSS and fails when a `transition` or `animation` declaration appears outside that block or has a duration over 250 ms.

**Rationale**: Declaring motion only where it is allowed is the simplest rule to check mechanically.

**Alternatives considered**: a global `@media (prefers-reduced-motion: reduce){*{transition:none!important}}` override (rejected: easy to forget a rule, and `!important` hides mistakes); no motion at all (rejected: the user asked for animations).

## R28. Inputs: file drop, JSON badge, character counts (spec FR-053)

**Decision**: The dataset card gets a drop zone that accepts a dropped file with the same reading code as the file chooser (no second parser) and keeps the paste area and the sample button. `config.mjs` gets `describeParams(text)` returning `{ ok: true, model }` or `{ ok: false, problem }` from the same `parseParams` that blocks a run, and the configuration view shows it as a badge next to each JSON field on every input. The editors keep their textarea-over-highlight design (research R2/R8 of the first version) with the new borders and radii, and each shows the number of characters. Keys stay `type="password"`; no "show the key" control is added.

**Rationale**: The badge uses the very function that blocks the run, so it cannot say "valid" for something that blocks.

**Alternatives considered**: a code-editor component (rejected: a dependency); a "show key" toggle (rejected: not asked for, and the constitution's care for keys).

## R29. Effect on the tests (spec SC-031)

**Decision**: The behavior is unchanged, but three kinds of existing checks change because the arrangement does: (1) `tests/e2e/scenarios/us1.mjs` no longer expects the Result card to be hidden before a dataset is valid (the run panel is shown from the start of a session, with its list of problems; steps 2–4 still unlock in order); (2) the scenarios that pressed **Run** to read "Run blocked: …" (`us7.mjs` for 0 and 21 selected rows) assert instead that Run is disabled and that the readiness list names the problem; the messages next to the editors (`us2`, `us3`) stay; (3) `tests/unit/contrast.test.mjs` reads the shared token list instead of parsing `styles.css`. All other scenarios keep passing unchanged and are the proof of SC-031. New checks: unit tests of `readiness.mjs`, `theme.mjs`, the motion rule, and `describeParams`; a contract test that `/styles.css` starts with the shared tokens; an end-to-end scenario `us9` (step indicator, readiness list live, bottom bar at 500 px, reduced motion, keyboard-only flow) and the existing accessibility scenarios extended with the new landmarks.

**Rationale**: Saying which tests change and why keeps "all earlier scenarios give the same results" honest.

**Alternatives considered**: keeping Run clickable so that the old scenarios pass unchanged (rejected: contradicts FR-052).

## R30. Driving a real browser without a dependency (spec FR-058, FR-060)

**Decision**: The walk-through talks to Chrome through the DevTools protocol itself: a small client (`tests/accept/cdp.mjs`, a few dozen lines) over the `WebSocket` that Node 22 provides, plus a launcher (`browser.mjs`) that starts Chrome headless with `--remote-debugging-port=0` and a temporary profile, reads the address from the line "DevTools listening on ws://…" that Chrome prints, and kills the process (and removes the profile) at the end, also after a failure. Each group of checks gets its own browser context (separate storage, as a fresh browser) and its own tab. The existing virtual-time end-to-end harness stays untouched: it is fast and runs in the normal test command.

**Rationale**: No dependency is the rule of this project (Principle II); the protocol needs only five domains (`Page`, `Runtime`, `Input`, `Emulation`, `Browser`/`Target`), and Node 22 already has the client. Real time (no virtual clock) is what lets the real pointer, keyboard, downloads, and media settings be used.

**Alternatives considered**: Puppeteer or Playwright (rejected: a large dependency and a browser download, against the project's rule); extending the virtual-time harness (rejected: it cannot press keys, download files, or emulate media); Selenium (rejected: needs a driver program).

## R31. Real input events (spec FR-060)

**Decision**: `driver.mjs` offers `click(selector)`, `type(text)`, `press(key)`, and `tab(n)`. A click scrolls the element into view, reads its centre with `getBoundingClientRect` (checking that the element at that point is the element itself, so a covered control fails the check instead of being clicked through), and sends `Input.dispatchMouseEvent` (`mouseMoved`, `mousePressed`, `mouseReleased`). Short texts are typed with `Input.dispatchKeyEvent` (`keyDown`/`char`/`keyUp`); a pasted dataset uses `Input.insertText` (what a paste does). `press` knows Tab, Shift+Tab, Enter, Space, Escape, Backspace, and the arrow keys with their `key`, `code`, and `windowsVirtualKeyCode`. The keyboard-only check never calls `click`: it presses Tab and reads `document.activeElement` after every key (id, role, name, outline), activates with Enter or Space, and fails if the next stop is not the expected control (a list of the expected order per state, with the order read from the page, not hard-coded to positions) or if the focus is not visible.

**Rationale**: A control that works with `element.click()` but is covered, outside the tab order, or without a focus ring is exactly what the walk-through must catch.

**Alternatives considered**: `element.click()` and `element.focus()` through `Runtime.evaluate` (rejected: that is what the end-to-end scenarios already do, and it hides these faults).

## R32. Real downloads, the dark setting, reduced motion, and widths (spec FR-061, FR-062)

**Decision**: Downloads: `Browser.setDownloadBehavior({ behavior: 'allow', downloadPath, eventsEnabled: true })` per context; a check presses the real Export buttons, waits for `Browser.downloadProgress` with `state: completed`, and reads the files back (so the page's security policy is exercised for real). Appearance: `Emulation.setEmulatedMedia` with the features `prefers-color-scheme` (`light`/`dark`) and `prefers-reduced-motion` (`no-preference`/`reduce`); widths with `Emulation.setDeviceMetricsOverride` (500, 900, 1100, 1920; heights 900/1000/1200/1080). For each combination of width and scheme the check takes screenshots (`Page.captureScreenshot`) of the start screen, the filled form, the open confirmation, and the report, and measures in the page: horizontal overflow (`scrollWidth - innerWidth`), controls covered by the bottom bar (the element at the centre of each control is the control), the focus ring of each kind of control (after a Tab press, the computed outline or box shadow), and the transition durations with reduced motion. The reference page is rendered the same way (light and dark) for the gallery.

**Rationale**: Emulated media features are what the page reacts to, so the dark appearance and reduced motion are exercised for real, which the virtual-time harness could not do.

**Alternatives considered**: a forced-dark flag of the browser (rejected: it changes colours with an algorithm instead of the page's own dark set); pixel-by-pixel comparison with the reference page (rejected: the real page is not meant to be identical; the gallery is for a glance).

## R33. Contrast of rendered text (spec FR-062, SC-027)

**Decision**: A script run in the page walks every element that directly holds text, takes its computed `color` and the effective background (walking up the ancestors, blending semi-transparent backgrounds over what is below; for a gradient it uses the worst of its colour stops; text over an image is reported as not measurable, and the page has none), applies the contrast formula of the existing test, and returns the elements below 4.5:1 with their selector, colours, and ratio. The pure parts (colour parsing, blending, ratio, the worst-stop rule) live in `tests/accept/contrast.mjs` and are unit-tested with fixtures (a pair at 4.4:1 must be reported, at 4.5:1 must pass).

**Rationale**: The token-level test proves that the pairs the CSS names are readable; the measurement on the rendered page proves that the pairs that really meet on the screen are (a transparent chip over a gradient, a disabled button, a dimmed locked step).

**Alternatives considered**: an accessibility library such as axe (rejected: a dependency); only the token test (rejected by the spec: FR-062 asks for the rendered text).

## R34. Time, isolation, and what the run starts (spec FR-058, FR-063, FR-064)

**Decision**: The run starts (1) the application **as the real command** (`node app/server.mjs` as a child process on a free port, its standard output written to the run folder as `relay.log`, exactly the privacy check of the quickstart), and (2) a fake platform in the same process (`startFake`, several instances with different rules, as the checks need: failing row, score forms, a text starting with `=`, held requests for Stop). The page paces requests at least 1.6 s apart, so the walk-through uses one or two rows per run (3 to 6 requests, 5 to 10 s) and takes the full sample only where the whole dataset matters; the budget is about 3 minutes for the checks plus about 1 minute for the appearance matrix. Every check runs in its own context with a time limit (60 s by default, longer for a run that needs it), a failure is caught per check, and the screenshot is taken before the check is closed. The fake key is `nvapi-FAKE-ACCEPT-` plus random characters, generated per run; the run folder is searched for it at the end (the folder must not contain it, SC-035).

**Rationale**: Running the real command makes the log check honest; one browser with a context per group keeps the cost low and the isolation real.

**Alternatives considered**: starting the server in the same process (rejected for the log check: it would test a different path than the quickstart's); one shared browser context for all checks (rejected: a failed check could leave state that fails the next).

## R35. Coverage of the quickstart, the report, and what stays human (spec FR-059, FR-064, FR-065)

**Decision**: `tests/accept/rows.mjs` maps the **name of every row** of the quickstart's tables (read from `quickstart.md`) to a check id or to `{ human: reason }`; a unit test (`tests/unit/accept-coverage.test.mjs`) parses the quickstart and fails when a row has no entry or an entry has no row, and the run itself fails the same way (so the check cannot be forgotten in either place). The report (`report.mjs`) writes `report.html` (self-contained: inline CSS, the screenshots as relative files, the evidence per check) and `results.json`, and prints the table in the terminal; at the top it lists the human items with the decisions of the user (the look judged by the implementer from the gallery, usability waived, the live check by the user with real data once the system is declared ready). The gallery places each screenshot of the page next to the rendered reference page of the same scheme.

**Rationale**: A map that is checked against the document in both directions is the only way a new quickstart row cannot silently fall outside the run.

**Alternatives considered**: reading the quickstart at run time and executing it (rejected: the rows are prose); a hand-kept list without a coverage test (rejected: it drifts).

## R36. Where the audit lives and how it is started (spec FR-066, FR-073)

**Decision**: The audit is a new group, `keyguard`, of the acceptance walk-through (`tests/accept/checks/keyguard.mjs`), started by `npm run audit:key` (= `node tests/accept/run.mjs --only keyguard`) and also by `npm run accept`. It has two checks: `keyguard.self-test` (the planted copies, R40) and `keyguard.audit` (the ways of ending a run, R41, the row "Key is never stored" of the quickstart). The pure parts live in `tests/accept/leak.mjs` (the forms of the key and the search) and `tests/accept/scanners.mjs` (what is examined in each place and what "examined" counts), so that they are tested without a browser. Each way of ending a run gets its own sandbox (`sandbox.mjs`): its own instance of the application, its own fake platform, its own browser with its own profile, and the recorders of R38 and R39; it is torn down, with the profile read before it is removed, at the end of that way.

**Rationale**: The tool already has the browser, the driver, the fake platform, the folder, the report, and the exit statuses; a group is the smallest addition, and a separate alias gives the one command that the spec asks for. A sandbox per way of ending a run keeps one run's leftovers from hiding in, or being blamed on, another.

**Alternatives considered**: a separate tool next to `accept` (rejected: duplicates the browser handling and the report); one browser for all ways (rejected: a profile on disk would hold the traces of all runs together, and a leak could not be tied to the run that caused it).

## R37. The browser's profile on disk, and the other files (spec FR-067 a, b)

**Decision**: The audit's browser uses the **default browser context** of a **persistent profile** (`--user-data-dir`), not the in-memory contexts that the rest of the walk-through uses (those are never written to disk, so they could not show what a real browser keeps). At the end of a way of ending a run the audit closes the browser with `Browser.close` (so that it flushes its databases), waits for the process to exit, scans every file of the profile as bytes, and only then removes the profile. The "files changed during the run" are found by walking the project folder, the run's folder, the temporary folder of the computer, and the usual configuration and cache folders of the browser (`~/.config` and `~/.cache`), keeping the files whose modification time is later than the start of that way of ending a run (not the files of the audit's own sandbox, which are accounted for separately, and not `node_modules` or `.git`). A file above 50 MB is not read and is listed as skipped with its size; the number of files and bytes examined is the evidence. The audit itself writes no snapshot and no network record to disk: they stay in memory and are dropped.

**Rationale**: A leak to disk is the meaning of "stored". Writing it down needs a profile that is really written, a clean flush, and a search of everything that changed; the planted copy in the real `localStorage` of the page (R40) proves that this chain sees a page's writes.

**Alternatives considered**: scanning only the temporary profile (rejected: misses files written elsewhere); the in-memory contexts (rejected: nothing reaches the disk); polling the profile while the browser runs (rejected: its databases are not flushed).

## R38. Memory: the page and the application's process (spec FR-071)

**Decision**: The page: `HeapProfiler.collectGarbage`, then `HeapProfiler.takeHeapSnapshot` with the chunks collected from `HeapProfiler.addHeapSnapshotChunk`; only the `strings` table of the snapshot is searched (probe: a snapshot of the page is about 4 MB, takes 0.4 s, shows the typed key as one string and no string after the field is cleared). The application's process: the audit starts its instance as `node --inspect=0 app/server.mjs` (the real application, plus the debugging port that Node offers), reads the address from the "Debugger listening on ws://…" line of its error output, and takes the same snapshot through the same client (probe: 9 MB, 0.5 s, no string holding the key after two requests that carried it; a copy planted through the debugger is found). A snapshot lists only what is still reachable. Limit: the contents of binary buffers are not part of a snapshot, so a key held only inside a buffer is not seen; this is stated in the report.

**Rationale**: "Reachable in memory" is the property that FR-016 states and that a script can know about; the probes show that both snapshots are cheap and that they see a copy.

**Alternatives considered**: reading the memory of the process from outside (rejected: not portable and not reachable-only); searching the whole page for the value only through script (rejected: it cannot see closures or the heap).

## R39. Traffic, console, address, and storage (spec FR-067 d–g, FR-070)

**Decision**: Before the first action the audit enables `Network`, `Runtime`, and `Log` for the page and keeps in memory: every request (address, headers, body through `Network.getRequestPostData`), every response (headers; the body of fetch and script requests through `Network.getResponseBody`), every console message and exception, the navigation history (`Page.getNavigationHistory`), the cookies (`Network.getAllCookies`), the storage of the page (local, session, the list and the contents of the databases, the names of the caches), and the text and the field values of the page. The only permitted places are the body of the request from the page to the local relay and, on the platform's side (the fake), the `Authorization` header of the relay's request; the audit confirms both happened (at least one request with the key in its body; at least one request at the fake with `Bearer <key>`), and any other place is a finding. The fake's record of the request is checked for the key in its address and in its body.

**Rationale**: It is the exact statement of FR-070; the confirmation of the two uses is what keeps the check from passing because nothing happened.

**Alternatives considered**: a proxy between the page and the relay (rejected: another program; the browser reports the same facts); reading only the page's own storage lists (rejected: the profile scan of R37 shows what the browser really wrote).

## R40. The forms of the key and the planted copies (spec FR-069, FR-072)

**Decision**: The key of a run is `nvapi-FAKE-AUDIT-` plus 12 random hex characters (the distinctive part). `leak.mjs` builds the forms as byte strings: the whole key and the distinctive part, each as UTF-8, as JSON-escaped text, as percent-encoded text, as base64 in the three alignments (the base64 of the text preceded by 0, 1, and 2 filler bytes, without the characters at the edges that depend on the neighbours), and as UTF-16 little and big endian; duplicates are removed, and the search is `Buffer.indexOf` over bytes. The **planted-copy self-test** runs in a sandbox of its own before the real audit and plants the key once in each kind of place, in the way that kind can really be written to: a file in the run's folder, a file in the temporary folder, a file in the profile folder, `localStorage`, a cookie, an IndexedDB entry, an address (`history.replaceState`), a console message, a request header and a request body, a log line of the application (`console.log` through the debugger), a variable of the page, a variable of the application's process, and a download file. Each place is then examined by the very function that the audit uses; each planted copy must be found (the one in `localStorage` must be found in the profile on disk after the browser is closed, which proves the chain of R37); a copy that is not found fails `keyguard.self-test`, and `keyguard.audit` then reports that it cannot be trusted.

**Rationale**: A search that has never been seen to find anything proves nothing; planting in the real place also tests how the browser writes.

**Alternatives considered**: tests of the scanners with fixtures only (kept as the unit tests, but they do not exercise the browser's real writing); trusting the absence of hits (rejected by the spec).

## R41. The ways of ending a run, and what is permitted in each (spec FR-068, SC-037)

**Decision**: Seven ways, each in its own sandbox, each with one row of the dataset (so that a way takes 5 to 12 seconds at the page's pace): (1) *normal*: run, export HTML and CSV; (2) *platform echoes the key*: a rule of the fake answers the main request with an error whose message contains the key (the page must show it redacted, in the row and in the exports); (3) *stopped*: held requests, Stop; (4) *judges re-run*: after a run, the key is typed again and the judges are re-run; (5) *failed requests re-run*: a row fails once, the key is typed again, the failed requests are re-run; (6) *abandoned*: New Session while a run is in progress (the held requests are then released); (7) *typed, never used*: the key is typed and the page is reloaded; before the reload the key may be in the field's value and in the page's memory and nowhere else, after the field is cleared and a garbage collection it must be nowhere, and after the reload nowhere at all. In ways 1–6 the key fields are empty at the end and the memory of both processes holds no string with the key. After each way the places of FR-067 are examined as in R37 to R39, and the observation (place, way, what was examined, hits, skipped files) goes into the evidence.

**Rationale**: They are the ways in which the code that handles a key can end, each on a different path of `runner.mjs` and `run-view.mjs`; the echo is the one in which the platform itself brings the key into the page.

**Alternatives considered**: a random sequence of actions (rejected: not reproducible); only the normal run (the present state of the checks).

## R42. The report and the limits of the audit (spec FR-073, SC-039)

**Decision**: `keyguard.audit` adds to its verdict a matrix of places by ways of ending a run: each cell says what was examined (for example "12 files, 3.1 MB", "9 requests", "2 snapshots, 41,200 strings", "0 entries: nothing can exist"), and the report page shows the matrix as a table; a hit appears as a finding with the place, the way, the form that matched, and a masked excerpt (the first 8 characters and "…"), never the whole key. The report lists what is out of scope (the user's terminal and shell history, the clipboard, swap files and crash dumps, other programs, the user's everyday browser, the platform's side) and what was skipped (files above the limit, the contents of binary buffers in memory). The folder of the run is searched for the key at the end, as before (the report and the results file are among what is searched).

**Rationale**: The evidence is what makes "nothing found" mean something, and the limits are what keep it honest.

**Alternatives considered**: a verdict line only (rejected by SC-039).

## R43. The key is removed from the platform's answer, as bytes (spec FR-074, SC-041)

**Decision**: The relay removes the whole key from the answer of the platform before it sends the answer to the page. It searches the answer as bytes for the key in its plain, JSON-escaped, address-escaped, percent-byte (both cases), and base64 forms (three alignments, without the characters that depend on neighbouring bytes) and replaces each hit with `[key removed]`. The derived forms are built from bytes, without making text of them. Only the whole key is searched for; a bare piece of it is not (the relay cannot know which piece an audit calls distinctive).

**Rationale**: The page already redacts what it shows, but the answer itself would still travel back to the browser with the key in it, where its network layer and its memory could keep it; Principle I asks that the key goes nowhere beyond the two permitted uses. A first version that made the forms as JavaScript strings left an encoded copy among the strings of the process, which the audit (R38) saw; bytes avoid that, and a heap snapshot does not show buffer contents (R42's limit).

**Alternatives considered**: redacting only in the page (the key still travels back, rejected); searching for pieces of the key (false hits on ordinary text, and the relay cannot know the pieces, rejected); dropping the body of an error answer altogether (loses the platform's message, which Principle III wants readable, rejected).

## R44. One re-run control with four choices, as a disclosure (spec FR-075, FR-076)

**Decision**: One pure function `rerunChoices(session)` (new module `rerun.mjs`) returns the four choices (`all`, `failedMain`, `judges`, `failedJudges`), each with its label, the number of requests it would send (per endpoint where it matters), whether it is available, and the one-line reason when it is not. One view (`ui/rerun-view.mjs`) draws the control in two places from that result: the run panel (`#rerunBox`) and the toolbar of the report (`#rvRerunBox`). The control is a native `<details>` disclosure ("Re-run" with a caret) that holds four buttons (`data-rerun="all|failedMain|judges|failedJudges"`); an unavailable choice is a disabled button followed by its reason as visible text (not a tooltip). Escape closes the disclosure and returns the focus to its summary; choosing a choice closes it.

**Rationale**: The user asked for one place and a list of four choices. A native disclosure works with the keyboard and screen readers without a menu role, needs no positioning code, and takes one row in the narrow toolbar and in the sticky run panel. One function for both places and one definition of "available" keep the two places from drifting apart (the situation that caused this story: two buttons with two visibility rules).

**Alternatives considered**: four always-visible buttons (too wide for the report toolbar, and returns to the clutter the user complained about); a `<select>` with a Go button (two actions for one intent, and a closed select hides the counts); a split button with a menu role (arrow-key handling and focus management for little gain); a popover API element (support differs between browsers).

## R45. Splitting the re-run of failed requests into two modes (spec FR-075)

**Decision**: `Run.mode` becomes `full | judges-only | failed-main | failed-judges` (`failed-rows` is removed). `failedRequests(rows, kind)` takes `'main'` (rows without an output: the main request, then both judges) or `'judges'` (rows with an output: the judge requests that lack a valid grade); the union of the two is what `failed-rows` was. `countRequests` and `startRun` accept the two modes; the pacing, the stop, the archived main prompt and parameters, the current judge prompts, the kept grades, and the itemised confirmation are those of the old mode, applied to the chosen part. "Re-run all" is `full` with `rowIds` taken from the archived snapshot of the last run (rows that are no longer in the dataset are left out; with none left it is unavailable with the reason "The rows of the last run are no longer loaded") and with the settings now on the form, as Run does. "Re-run all judges" is the existing `judges-only`.

**Rationale**: The two failed kinds are already separate inside `failedRequests`; exposing them separately is a few lines, and it keeps one definition of a failed request (R17 and the code review). A kept `failed-rows` mode would have no caller.

**Alternatives considered**: keeping `failed-rows` next to the two new modes (dead code, Principle II); a flag on one mode (the mode name appears in the report header and the tests, so two names read better).

## R46. The header band stays in the report view, so New Session is one button everywhere (spec FR-077)

**Decision**: The header band (`<header>` with the name, the chips, and `#newSession2`) moves out of `#formView` to the top level of the body, directly above `#formView` and `#reportView`, with its own `hidden` set from `session.started` (today `#app` carries that). In the report view the band shows the same chips and the same single New Session button. The button keeps its handler, its confirmation (`#resetConfirm`), and its "heavy" weight when there is something to lose. The confirmation moves with it (it must be reachable in both views); on confirm it closes the report view first, then resets the session as today (which already stops a running run and drops late answers, User Story 8 scenario 12). Cancel returns the focus to the button.

**Rationale**: "Exactly one New Session button, visible on every screen" (FR-077) is met by showing the one existing button in both views, not by adding a second one to the report toolbar. The report view is a view of the same session, so the session's header belongs to both.

**Alternatives considered**: a second New Session button in the report toolbar (two buttons for one action, against FR-077 and SC-043); hiding the band and showing only a button in the toolbar (loses the chips that tell which session this report belongs to).

## R47. Choosing a re-run from the report (spec FR-076)

**Decision**: A choice made in the report closes the report view and runs the same pre-checks as the same choice in the run panel (`problemsFor(session, mode)`): when the key is missing, the message "API key is empty" appears in the run panel (`#resMsg`) and the focus moves to the key field that is needed; when everything is present, the confirmation opens (`openConfirmation(mode)`). Keys are never typed in the report view.

**Rationale**: Keys live only in the fields of the form (FR-016, FR-043), and the report view stays free of inputs. The route is the one the user takes by hand today (Back to the form, enter the key, press the button), shortened to one choice.

**Alternatives considered**: a key field in the report toolbar (a new place that holds a key, against the smallest-surface rule); opening the confirmation in the report (it would need the key fields beside it).

## R48. Availability, counts, and reasons (spec FR-076, SC-043)

**Decision**: The reason of an unavailable choice is the first that applies: "A run is in progress" (status `running` or `stopping`, or a confirmation is open), "No run yet" (no run in the session), then the choice's own: "Nothing failed" for the two failing-only choices, "No row has an output" for "Re-run all judges", "The rows of the last run are no longer loaded" for "Re-run all". Each available choice shows its number of requests ("1 request", "3 requests"); the failing-only choices show it also when they are unavailable ("0"). The control's summary shows the total number of failed rows (the sum of the two failed kinds) as a small badge when it is not zero, so that a failure is visible without opening it.

**Rationale**: The reasons are the ones the user sees in the spec; the order makes the line stable while a run is in progress. The badge answers "is something to repeat?" at a glance, the daily question behind this story.

**Alternatives considered**: hiding unavailable choices (the user complained that buttons appear and disappear); counting only in the confirmation (the user could not tell in advance that "only the failing judges" means one request).

## R49. Tests for User Story 12 (spec SC-042 – SC-044)

**Decision**: Unit: `rerun.mjs` (every state of the table above, row by row; the counts for a 10-row run with one failed judge request: failing judges 1, failing main 0, all judges 20, all 30), `runner` (the two new modes: which requests are sent, the grades kept, the archived main prompt used; `failed-rows` is gone), `problems` (the checks per mode). End to end (`us12`): a fake platform that fails one judge request of one of five rows, the choice "Re-run only the failing judges" sends exactly one request, then New Session from the report. Acceptance walk-through: new checks `flow.rerun-choices` (the control in the panel and the report, counts and reasons, one request for one failed judge, the other results unchanged) and `flow.new-session-everywhere` (one visible New Session on the form, during a run, and in the report; it clears the report); the existing checks `flow.judge-rerun`, `flow.failed-rerun`, `flow.back-to-form`, the keyboard walk, and the audit's ways 4 and 5 use the new choices instead of `#rerun` and `#rerunFailed`.

**Rationale**: The behaviour behind most choices exists and is covered; the risk of this story is in the arrangement (two places, one definition of availability), so the checks drive the real page with real clicks.

**Alternatives considered**: only unit tests of `rerunChoices` (they would not see a header band hidden in the report view, the bug this story fixes).

## Implementation notes (recorded at the end of the implementation)

- **Automated acceptance walk-through (User Story 10, tasks T127–T141)**: `npm run accept` (`tests/accept/`): a protocol client of ~100 lines over Node's WebSocket, a launcher, a driver with real pointer and key events, pure checkers tested on broken fixtures, a coverage map checked against `quickstart.md`, and 33 checks in five groups. The whole run takes about 1.5 minutes. Its first runs found **five real faults** that the script-level end-to-end scenarios had not seen, all fixed: (1) after Enter on Run the confirmation did not take the focus (7 Tab presses to reach "Confirm and send"); it now takes it, Cancel returns it to the opener, and Confirm moves it to Stop; (2) the sticky step indicator changed its spacing when it stuck, so the content under the pointer jumped by 12 px and a click missed its target; only the band and the shadow change now; (3) the `mark` elements in the transparent layer under the prompt editors painted black glyphs in the dark appearance; (4) the light chips in the report's header had 4.28:1 (below 4.5:1); they use the darker overlay of the page; (5) the page's class `.meta` (a flex row for the editors) collided with the report's prompts table, which has the same class, and pulled its headings away from its values (the same collision as in the first version; the page class is now `.fieldmeta`, and the walk-through checks that every heading sits over its values). A deliberately wide page and a deliberately reintroduced `.meta` rule were each caught by the matching check.
- **Hardening of the walk-through (tasks T142–T147)**: found by testing the tool itself with real signals: a stop on Ctrl+C ended the process (status 1) before the application and the browser were stopped, leaving both running; the stop is now one shared promise that every path waits for, the loop stops between checks, and the status is 130 or 143 (checked with real SIGINT and SIGTERM and by `tests/unit/accept-run.test.mjs`). A timer left behind by the time limit kept test processes alive and is cleared. A scheme or motion setting that the browser does not apply is reported as "not run" with the reason, the focus-ring walk must meet every kind of control (button, link, text, password, file, check box, select, editor, text area, summary), the keyboard walk uses Shift+Tab and Escape, and the evidence shows file sizes. The wording of FR-061 about prompt text was corrected (the exports hold prompts by design).
- **Limits of the walk-through**: it needs Chrome or Chromium; the contrast measurement treats text of inactive controls (disabled, locked, `aria-disabled`) and text that is hidden from people as exempt, uses the worst colour stop of a gradient, and knows the disc that a gauge draws with `::before`; the pointer clicks only a control that nothing covers; the dark appearance and reduced motion are the browser's own emulated settings, not a screenshot of a real system change. The look of the page is judged by the implementer from the gallery (the user's decision): the form, the confirmation, the start screen, and the report were reviewed at 500, 1100, and 1920 px in the light and the dark appearance and match the reference page (header band with chips, step indicator, cards, run panel), after the faults above were fixed. The usability check is waived, and the live check with a real key is left to the user.

- **Modern application page (User Story 9, tasks T109–T123)**: `theme.mjs` holds the tokens once (the report CSS and `GET /styles.css` both come from it); `problems.mjs` (structured items with step and field) and `readiness.mjs` (list, step states, chips) feed `ui/chrome-view.mjs` and `ui/panel-view.mjs`; `run-view.mjs` disables Run while anything blocks it and re-checks at confirmation. The panel and the bar refresh synchronously on every `input`/`change` of the page (a deferred refresh would leave Run disabled for a moment after a key is typed, which the end-to-end scenarios and a fast user would notice). Page CSS rules that could leak into the report are scoped to `.stepcards`, `.panel`, and `.preview`; every transition and animation is inside the one `no-preference` block (`tests/unit/motion.test.mjs`). End to end: `us9` (wide window) and `us9b` (500 px, reduced motion forced with `--force-prefers-reduced-motion`); `us1`, `us5c`, `us7`, and `a11y-phone` were adapted to the new arrangement (the panel is shown from the start, Run waits for a key after a run clears it, the readiness list names the problem instead of "Run blocked", the side margins belong to `.wrap`).
- **Limits of the checks (User Story 9)**: the dark appearance is verified by the contrast test over the shared token values, not by a screenshot (headless Chrome here has no switch for the system's dark setting that `prefers-color-scheme` follows); the comparison with the reference page [example-form-modern.html](example-form-modern.html) was made on screenshots of the light appearance at 1440, 1100, and 500 px.

- **Code review of 2026-11-01 (User Story 8, tasks T086–T105)**: the corrections are in `run-view.mjs` (locked form, frozen copy compared again at "Confirm and send", judge-prompt check for the failed-requests re-run, `http` warning, run token), `runner.mjs` (own copy of the prompts, one definition of a failed row, judges reset to `pending` when a re-run's main request succeeds, targets emptied at the end), `dataset.mjs` (open quote reported before the column count; header read with the tokenizer), `judge.mjs`, `exports.mjs`, `report.mjs` (judge model from the archive, key-shaped text hidden, CSP in the export, difference cache keyed by the row's `main` object), `chat.mjs` (wider redaction), `relay.mjs` and `server.mjs` (security headers on every response, 8 MB limit read as a stream). The end-to-end harness widens `connect-src` for its fake platform only (`securityHeaders` option of `startServer`); the real page never talks to another origin.
- **Limits of the checks**: a JavaScript string cannot be wiped, so "no copy of a key remains" is checked on what is reachable (the run, the handle, the session) and implemented by emptying the objects that hold keys; the download of an export is captured by the e2e driver, so a content-security policy that blocked a real `blob:` download would show only in a real browser (the manual walk through [quickstart.md](quickstart.md) covers it).

- **Judge answer format**: the reader tolerates markdown emphasis or backticks around the `SCORE:` line, because models add them; see [contracts/judge-answer-format.md](contracts/judge-answer-format.md).
- **Relay**: besides the status and the body, a harmless `Retry-After` is passed on (needed for the rate-limit message); no other header is echoed.
- **404 from the platform** can also mean a hosted model that is briefly unavailable (seen in a first real run: one row's judges got 404 and 500 while the same request worked for another row). The message says so and shows the platform's text; the failed rows can be re-run (User Story 7). Nothing is retried automatically.
- **SC-008 (3 actions for a judge re-run)** is counted as: edit the prompt, enter the key, trigger; the mandatory consent click (FR-017) belongs to the trigger. The end-to-end scenario `us6.mjs` follows that count.
- **End-to-end technique**: headless Chrome with a virtual clock; the clock stands still while a request is pending, so Stop is pressed from a `fetch` hook (`us5c.mjs`), and the smallest window width Chrome allows is 500 px, which `a11y-phone.mjs` uses as the phone width.
- **Open for the user**: the live check (`tests/live/check.mjs`) has a fifth request that sends the full Poland table to the default main prompt and the Accuracy judge (R12.5); run it once with your own key. The hand check of [quickstart.md](quickstart.md) sections 3 and 5 and the usability check (SC-011) need a person.
- **Live check, 2026-11-01 (user's own key)**: R12.5 settled: the full Poland table (1649 characters) with the default main prompt finished normally (`stop`, 513 completion tokens), and the default Accuracy judge on that answer finished normally (1622 completion tokens) with a readable `SCORE` line (100); `max_tokens` 4096 is enough. No `<think>` tags in `content`; the reasoning is in `reasoning_content`. The second model accepts its parameters but is slow (63 s, 4403 completion tokens). The first two short requests got an immediate empty `404` and the same model answered the next ones: a temporary `404` is possible, nothing is retried automatically, and failed rows can be re-run.
- **Final validation (T065), 2026-11-01, by the user**: `npm test` (226 tests) and `node tests/e2e/run.mjs` (12 scenarios) passed on the user's machine; the whole flow of [quickstart.md](quickstart.md) section 3 was tried by hand against the fake platform (including "Re-run failed requests" after the one-time failure of the row `HU`); the privacy check of section 5 gave 0 hits for the key, the prompt text, and the endpoint in the relay log and in nine exported files, and the browser storage lists hold no values (an empty origin entry in the developer tools is expected); the usability check (SC-011) was done by the user. No difference from the specification was reported.

- **Key audit (User Story 11, tasks T149–T159)**: `npm run audit:key` (group `keyguard`, about 100 s: `keyguard.self-test` about 8 s, `keyguard.audit` about 90 s). Modules: `tests/accept/leak.mjs` (key forms, search, mask), `scanners.mjs`, `snapshot.mjs` (heap-snapshot strings of the page and, through `--inspect=0`, of the application's process; nothing written to disk), `sandbox.mjs` (one application, fake platform, and persistent-profile browser per way), `checks/keyguard.mjs`. The report holds only masked excerpts; encoded forms are reported by name and place.
- **First real finding of the audit**: when the platform repeated the key in an error answer, the relay passed that body to the page unchanged, so the key travelled back over the loopback connection (the page redacted it before showing it, but the response was still visible to the browser's network layer). Fixed in `app/relay.mjs` (`withoutKey`: the key, plain or JSON-escaped, is replaced by `[key removed]` before the answer is sent on); contract test 14 in `tests/contract/relay.test.mjs`.
- **Proof that the audit catches a stored key (SC-040, T158)**: with `KEYGUARD_APP_ROOT` pointing at a test copy of the application with one deliberate leak, `keyguard.audit` failed each time and named the place: a file written by the relay (`files`), a `console.log` of the key (`app log`, also `meta.no-key-in-folder`), the key kept in a global variable of the process (`app memory`), and `localStorage.setItem` in the page (`storage` and, from disk after `Browser.close`, `profile` → `Local Storage/leveldb`). The real code was not changed for these runs.
- **Details learnt while building it**: a download can finish before the next line of the driver listens (the driver now listens from before the click); a finished download is first a `.crdownload` file, so the exports are scanned after it is renamed; `Target.createTarget` without a context uses the default context, whose storage is written to the profile.
- **Final validation of User Story 11 (T159), 2026-11-02**: `npm test` 359 passed; `npm run accept` 35 checks passed in 2 min 57 s (the key audit 82 s; report `test-results/acceptance-20261102-001816`, matrix of 12 places by 7 ways, all clean); `node tests/e2e/run.mjs` 15 scenarios passed on a repeat, but one of three runs failed `us9` ("the band is gone at the top of the page"). Cause found afterwards (T160): the test waited a fixed 50 ms for the class `stuck`, which the page sets in a scroll event delivered with the next frame; it now waits for the condition, and five runs in a row passed (the application was not at fault).
- **The key removed from the platform's answer in every form (T162, T163, FR-074)**: `withoutKey` in `app/relay.mjs` now removes the whole key as plain text, JSON-escaped, escaped for an address, as percent bytes (both cases), and as base64 in three alignments. A first version that made these forms as JavaScript strings was caught by the audit itself: an encoded copy of the key (base64 at alignment 2) stayed among the strings of the application's process after the run, in every way. The forms are therefore built as bytes, without making text of them, and the answer is searched and cut as bytes. The audit's way "the platform repeats the key" now repeats it in all these forms (built with `keyForms` of the audit). Contract tests 14–17 cover the forms, a look-alike text, short keys, and a key with characters that an address escapes. Result: `npm test` 362 passed, `npm run accept` 35 passed in 3 min 11 s, e2e 15 scenarios passed.
- **Re-run choices and New Session in every view (User Story 12, T165–T174, R44–R49)**: `rerun.mjs` (pure) and `ui/rerun-view.mjs` give the one control with four choices in the run panel and in the toolbar of the report; `runner.mjs` has `failed-main` and `failed-judges` instead of `failed-rows`; the header band moved out of the form view and is compact and sticky in the report view, so the one New Session button is there too (its confirmation lives in the band). Result: `npm test` 376 passed, `node tests/e2e/run.mjs` 16 scenarios passed three times in a row, `npm run accept` 37 checks passed in 3 min 33 s (report `test-results/acceptance-20261102-001816`), including the audit of the key.
- **What the walk-through and a screenshot found while building it (User Story 12)**: (1) moving the header band above the form view changed the Tab order after the start screen, so the start screen now precedes the band in the document; (2) after "Back to the form" the focus was lost to the page, so the focus now goes to "Open report"; (3) the contrast walk measured text inside a closed disclosure mid-transition (1.01:1), so it now skips what a closed `<details>` hides and the new check measures the open list in both appearances; (4) in the narrow run panel the open list stuck out to the right, which only a screenshot showed, so the panel's list is full width and `flow.rerun-choices` checks that the open list stays inside the panel and the page does not scroll sideways.
- **Last gaps of User Story 12 (T175–T177)**: every choice now shows its number of requests in every state (`choiceNote` in `rerun.mjs`, tested); the README names the one Re-run control; `canRerunFailed` was removed (its tests use `rerunChoices`). Result: `npm test` 377 passed, e2e 16 scenarios passed, `npm run accept` 37 checks passed in 3 min 41 s (report `test-results/acceptance-20261102-001816`).
