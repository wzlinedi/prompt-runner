# Implementation Plan: Prompt Runner

**Branch**: `001-simple-prompt-runner` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-simple-prompt-runner/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A single local web page, filled in from top to bottom after **New Session**: load a dataset (id, name, prompt input, expected result), edit the main prompt, review two ready-made QA judge prompts (Accuracy, Completeness), set one endpoint, key, and JSON (model and parameters), run the main prompt on 1–20 selected rows and then the judges, and read the report in its own full-width view (opened by itself when the run ends): a header band, cards with the averages as ring gauges, a summary table with bars and badges, a prompts/parameters/date table, the collapsed archive of the prompts, and one card per test case with the prompt input, expected result, actual output, similarity, and word differences side by side, long texts in boxes that scroll inside themselves, and below them the metrics one under the other with grade and rationale. The report exports to HTML and CSV; judges can be re-run alone, and failed requests can be re-run (only the requests that ended with an error, with the current judge prompts).

**Technical approach** (decisions and evidence in [research.md](research.md)):

- **Plain JavaScript, no dependencies.** A static page built from ES modules (no framework, no build step) plus a small Node.js program that serves it and relays chat requests. The earlier demo page (since removed) was the visual and behavioral reference; its logic was moved into testable modules.
- **A local relay is required** because the platform's API refuses browser calls from other origins. This was **measured** during planning: the preflight returns no allowed origin for `localhost`, and a real `fetch()` from a localhost page in headless Chrome fails ([research R1](research.md)). The relay listens on loopback only, requires a per-start token and a matching `Host`/`Origin`, forwards each chat request it receives (several can be in flight at once, as the runner keeps up to 4), and logs nothing that could contain a key ([contracts/relay-api.md](contracts/relay-api.md)). The relay also removes the API key from the platform's answer before the page receives it (FR-074): it searches the answer as bytes for the whole key in its plain, JSON, address, percent, and base64 forms, so that no encoded copy of the key becomes text in the process.
- **Judges answer in free text ending with a `SCORE:` line**; the app reads the grade from that line and shows the rest as the rationale with the fact lists ([contracts/judge-answer-format.md](contracts/judge-answer-format.md)).
- **Similarity** is the character-level edit-distance similarity of FR-024, computed with a bit-parallel algorithm so long texts stay fast ([research R6](research.md)). The **differences** shown in the report are a separate, word-level comparison ([research R13](research.md)).
- **The report** is plain HTML and CSS produced by one module and one style text shared by the page and the export: no framework, no charting library, no scripts; the gauges are CSS-only ([research R14](research.md)). It lives in its own full-width view that replaces the form while open ([research R15](research.md)).
- **Re-running failed requests** sends only the requests that ended with an error; the main requests use the archived main prompt, the judge requests the current judge prompts, and the report keeps track of the prompt versions behind the grades ([research R16](research.md)).
- **Corrections after the code review of 2026-11-01** (User Story 8, [research R17–R22](research.md)): a locked form while the confirmation is open and a run that works on its own deep copy; one definition of a failed row shared by the button, the count, the confirmation, and the requests sent; a report that derives the judge model from the archived parameters; keys held in one object that the run empties, with no run able to touch a newer session; Stop and the confirmation moved into step 5, which stays visible with a run (and step 4, with the keys, stays visible too); a content-security policy, an 8 MB limit on the platform's answer, spreadsheet-safe CSV values, stricter dataset parsing, and a more tolerant `SCORE` line. No dependency, no new component.
- **A modern application page** (User Story 9, [research R23–R29](research.md)): one shared token module for the page and the report (the server composes `/styles.css` from it); a header band with chips, a step indicator, steps as cards, and a sticky run panel with a live readiness list that all come from one pure module (`readiness.mjs`) so that they always agree with the checks that really block a run; a fixed bottom bar for narrow windows that delegates to the panel's buttons; motion written only inside a `prefers-reduced-motion: no-preference` block; a drop zone and a JSON-validity badge. No dependency; no change of behavior; the reference page is [example-form-modern.html](example-form-modern.html) and the contract is [contracts/page-ui.md](contracts/page-ui.md).
- **An automated acceptance walk-through** (User Story 10, [research R30–R35](research.md), [contracts/acceptance-run.md](contracts/acceptance-run.md)): `npm run accept` starts the real `node app/server.mjs` and the fake platform, drives a real Chrome through the DevTools protocol with a small client of its own (no dependency; Node 22's built-in `WebSocket`) using real pointer and keyboard events, downloads the exports for real, emulates the dark scheme and reduced motion, measures overflow, covered controls, focus rings, and the contrast of rendered text at 500/900/1100/1920 px, and writes a folder with a report, screenshots, and the downloaded files. A coverage map checks that every row of the quickstart has a check or an explicit human entry. It replaces the hand walk-through of the quickstart (tasks T105 and T123); the look, usability, and the live check with a real key stay with people, as the user decided.
- **An audit that a key is never stored** (User Story 11, [research R36–R43](research.md), [contracts/key-audit.md](contracts/key-audit.md)): `npm run audit:key` (a group `keyguard` of the walk-through) types a fake key into the page and lets seven ways of ending a run happen, each in its own sandbox (its own instance of the application started with the runtime's debugging port, its own fake platform, its own browser with a **persistent** profile), then searches everything a key could be left in: the files that changed, the profile on disk (read after a proper close of the browser), the log, the console, the whole network traffic, the address and history, the storage, the exports, and a **heap snapshot** of the page and of the application's process. The key is searched in nine forms (plain, escaped, percent-encoded, base64 in three alignments, two-byte). Before it trusts "not found" it plants a copy in each kind of place and checks that it is found (a copy in the page's real `localStorage` must be found in the profile on disk). The report is a matrix of places by ways with what was examined in each. No dependency; probes showed that snapshots of the page (4 MB, 0.4 s) and of the process (9 MB, 0.5 s) work and see a copy.
- **One re-run control and a New Session in every view** (User Story 12, [research R44–R49](research.md), [contracts/page-ui.md](contracts/page-ui.md)): a pure `rerunChoices` (new `rerun.mjs`) decides the four choices (re-run all, failing main prompts and their judges, all judges, only the failing judges), their counts, and the reason a choice is unavailable; one view draws the control, a native disclosure, in the run panel and in the toolbar of the report; the old failed-requests mode is split into `failed-main` and `failed-judges`; the header band moves out of the form view so that the one New Session button is visible in the report too; a choice made in the report leads to the form for the key. No dependency, no storage.
- **Pacing** is about 37 requests a minute with at most 4 in flight, no automatic retries, and a Stop that aborts in-flight requests ([research R7](research.md)).
- Everything that can be tested without a key is automated (unit, relay contract, real-page end-to-end against a fake platform); the few facts that need a real key are checked by one standalone script that the user runs on their own computer, which prints only non-secret facts so nothing sensitive has to be pasted anywhere ([quickstart.md](quickstart.md), [research R12](research.md)).

## Technical Context

**Language/Version**: JavaScript (ES2022 modules) on Node.js 22 for the relay and the tests (installed: v22.23.4); the page targets current Chromium-based browsers and Firefox.

**Primary Dependencies**: None. Node.js built-ins only (`http`, `fetch`, `node:test`, `node:assert`); no bundler, no framework, no `package-lock`.

**Storage**: None. All data lives in page memory for one session; the only output is a user-initiated download (HTML or CSV). No cookies, no browser storage, no files written by the relay.

**Testing**: `node --test` for unit and relay contract tests; a Node script that drives headless Chrome against the relay and a fake platform for end-to-end tests; a short live check with a real key that the user runs locally with a standalone script (`tests/live/check.mjs`, already run once, so the key is never shared in a chat). The unit and contract tests also run in GitHub Actions (`.github/workflows/test.yml`) on every push and pull request; the suites that need Chrome stay local.

**Target Platform**: A desktop computer with Node.js 22+ and a modern browser; one user, running locally.

**Project Type**: Local web application (static front end + a small local relay), one repository, no separate deployment.

**Performance Goals**: A 20-row run (60 requests) finishes in about 3–6 minutes at the platform's reported limit; similarity of two 16,000-character texts in under 100 ms; the page stays responsive during a run; Stop prevents any new request immediately and nothing arrives later than 5 s afterwards.

**Constraints**: Keys only in memory and never logged or exported; relay on loopback only; at most about 40 requests a minute; between 1 and 20 rows per run; all text in English; values up to 100,000+ characters sent complete; no automatic retries.

**Scale/Scope**: One user; at most 20 rows per run; one screen with six sections plus the report.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

Source: `.specify/memory/constitution.md` v1.0.0.

| Principle / rule | Assessment | Evidence |
|------------------|-----------|----------|
| **I. Security & Privacy by Default (NON-NEGOTIABLE)** | **Pass** | Keys live in memory only, never come back from the relay to the page (FR-074), are cleared when a run, re-run, or stop ends (spec FR-016), and are excluded from exports, snapshots, URLs, and messages. The relay holds nothing between requests, logs only method/path/status/duration, binds to loopback, and requires a token and matching Host/Origin ([relay-api.md](contracts/relay-api.md), R3). Requests are sent only after the user confirms; no automatic retries (R4, R7). |
| **II. Minimal MVP Scope (YAGNI)** | **Pass** (one justified addition, see Complexity Tracking) | No accounts, no saved libraries, no dependencies, no build step, no framework. The relay is the only extra component and its necessity is measured (R1). |
| **III. Explicit User Consent & Transparency** | **Pass** | A confirmation states request counts, models, and data per endpoint before any send (FR-017), and the relay's presence is named on the page; every failure becomes a specific per-row message ([upstream-chat.md](contracts/upstream-chat.md)); no silent skips (rows without output show a state). |
| **IV. Technology & Architecture Agnosticism** | **Pass** | The specification stays provider- and stack-neutral. The stack is chosen here with documented reasons (R1, R2); the platform-specific facts are isolated in `chat.mjs` and the default parameters, so another endpoint with the same request format works unchanged. |
| **V. Observability & Testability of Outcomes** | **Pass** | Every requirement has Given/When/Then scenarios and measurable criteria in the spec; progress is shown per phase while running; the test plan maps to the user stories (R10, [quickstart.md](quickstart.md)). |
| **Data Handling & Retention** | **Pass** | Nothing persists beyond the session; exports are explicit and contain no credentials ([export-formats.md](contracts/export-formats.md)). |
| **Spec-driven workflow** | **Pass** | Spec quality checklist 16/16, five clarifications recorded, this plan includes the check. |

**Result**: no violations. Proceeding to Phase 0. The key audit (User Story 11) was checked against the same table: it is the verification of Principle I itself (a key is never persisted, logged, or kept after its operation), it adds no dependency (the debugging connections that Chrome and Node already offer, and the existing client), it uses a fake key and never the real platform, it writes no snapshot or traffic record to disk, and it searches its own folder for the key at the end (Principles I, II, V). The automated acceptance walk-through (User Story 10) was checked against the same table: it is a development tool next to the tests, adds no dependency (a small protocol client of our own instead of a browser-automation library, Principle II), never calls the real platform and uses a fake key that is searched for in everything the run writes (Principle I), changes nothing in the application, and makes the acceptance of every requirement testable by one command (Principle V). The modern application page (User Story 9) was checked against the same table: it changes appearance and arrangement only; chips, badges, the step indicator, and the readiness list never carry a key or an endpoint (Principle I); the confirmation, the lock, and the consent stay (Principle III); there is no dependency and no new storage, and one small module (`theme.mjs`) replaces a second copy of the colours (Principle II); the requirements stay technology-neutral and the choices are made here (Principle IV); every new requirement has acceptance scenarios and success criteria (Principle V). The corrections of User Story 8 were checked against the same table: they strengthen Principle I (a run cannot send what was not disclosed; no copy of a key outlives the run; redaction covers more forms of the key; a content-security policy and a size limit on the relay), add no persistence, no dependency, and no automatic send (Principle II), and keep every failure readable (Principle III).

## Project Structure

### Documentation (this feature)

```text
specs/001-simple-prompt-runner/
├── plan.md                    # This file (/speckit-plan command output)
├── research.md                # Phase 0 output
├── data-model.md              # Phase 1 output
├── quickstart.md              # Phase 1 output
├── contracts/                 # Phase 1 output
│   ├── dataset-format.md      #   dataset input the user provides
│   ├── relay-api.md           #   the local relay's endpoint and protections
│   ├── upstream-chat.md       #   request built for the platform and how the answer is read
│   ├── judge-answer-format.md #   the SCORE line and unreadable answers
│   ├── export-formats.md      #   HTML report and CSV layout
│   ├── page-ui.md             #   the application page: regions, step states, readiness, bottom bar, motion, tokens
│   ├── acceptance-run.md      #   the acceptance walk-through: command, exit codes, run folder, checks, report
│   └── key-audit.md           #   the key audit: places, ways of ending a run, forms, permitted uses, planted copies, report
├── references/                # Platform facts supplied or researched earlier
├── checklists/requirements.md # Spec quality checklist
├── example-report-modern.html # Reference appearance of the report (FR-037; simulated data)
├── example-form-modern.html   # Reference appearance of the application page (FR-048 – FR-057; simulated data)
└── tasks.md                   # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
package.json                    # scripts: start, test, test:e2e, accept, audit:key; no dependencies
README.md                       # how to start, the flow, tests, privacy guarantees
app/
├── server.mjs                  # exports startServer(); serves public/, prints the address, starts the relay
├── relay.mjs                   # POST /api/chat handler and request guards (token, Host, Origin, URL checks)
├── output.mjs                  # the only two terminal writes: the access-log line and the startup address
└── public/
    ├── index.html              # the single page (token injected by the server)
    ├── styles.css              # light and dark theme of the page
    └── src/
        ├── main.mjs            # wires the sections together, session start and reset
        ├── state.mjs           # in-memory session state and change notifications
        ├── html.mjs            # HTML escaping and the shortened, expandable long value
        ├── defaults.mjs        # default prompts, default parameters JSON, sample dataset
        ├── dataset.mjs         # separator detection, tokenizer, validation, row selection rules
        ├── placeholders.mjs    # find, check, and fill placeholders; literal braces
        ├── theme.mjs           # the design tokens (light and dark) written once; used by the report CSS and by /styles.css
        ├── problems.mjs        # what blocks a run, a judge re-run, and a failed-requests re-run (moved out of run-view; structured items with step and field)
        ├── readiness.mjs       # readiness list, step states, and session facts derived from the session (pure)
        ├── config.mjs          # endpoint and parameters-JSON validation, effective judge configuration, describeParams
        ├── chat.mjs            # build the request, call the relay, map the answer and errors
        ├── judge.mjs           # append the answer-format instruction, read the SCORE line
        ├── similarity.mjs      # character-level similarity (bit-parallel edit distance)
        ├── diff.mjs            # word-level differences between the expected result and the actual output
        ├── runner.mjs          # phases, pacing, concurrency, stop, judge re-run, the two failed-requests modes, judge prompt versions
        ├── rerun.mjs           # the four re-run choices with their counts, availability, and reasons (pure)
        ├── report.mjs          # report data structure and the HTML renderer
        ├── report-style.mjs    # the report's CSS (tokens, light and dark, cards, gauges), shared by the page and the export
        ├── exports.mjs         # CSV renderer and file download helpers
        └── ui/
            ├── dataset-view.mjs
            ├── prompts-view.mjs
            ├── config-view.mjs
            ├── chrome-view.mjs  # header chips and the step indicator
            ├── panel-view.mjs   # the run panel: readiness list, ready summary, bottom bar
            ├── run-view.mjs     # confirmation, progress, stop; starts a run in a given mode
            ├── rerun-view.mjs   # the re-run control (run panel and report toolbar) and the header band's New Session
            └── report-view.mjs  # report view (full width, toolbar, auto open, back), exports, unload guard

tests/
├── unit/                       # node:test: one test per logic module (dataset, placeholders, config, chat, judge, similarity, runner, report, state), plus runner-rerun-judges, runner-failed-rows, selection, no-storage, english-only, contrast
├── contract/                   # server.test.mjs (static files, token, loopback) and relay.test.mjs (guards, forwarding, no key in logs, timeout, limits) against a fake upstream
├── e2e/
│   ├── run.mjs                 # drives headless Chrome through the user stories
│   ├── driver.mjs              # script injected into the page; reports results back through the DOM
│   └── scenarios/              # us1.mjs … us9.mjs (plus us5b, us5c, us7b, us9b) and a11y-phone/a11y-desktop
├── accept/                     # the automated acceptance walk-through (npm run accept; a development tool, no dependency)
│   ├── run.mjs                 # entry: starts the app and the fake, runs the groups, writes the folder, sets the exit status
│   ├── cdp.mjs                 # minimal DevTools-protocol client over Node's WebSocket
│   ├── browser.mjs             # launches and stops Chrome (own profile, free debugging port)
│   ├── driver.mjs              # real input: click (checks that the control is not covered), type, press, tab; screenshots; downloads; media emulation
│   ├── contrast.mjs            # colour parsing, blending, worst gradient stop, ratio (pure) + the script that measures the rendered page
│   ├── checkers.mjs            # pure checkers: exports, relay log, tab order, overflow, motion (the ones tested with broken fixtures)
│   ├── rows.mjs                # quickstart row name -> check id or { human: reason }
│   ├── leak.mjs                # the forms of a key (plain, escaped, percent, base64 x3, two-byte) and the search (pure)
│   ├── scanners.mjs            # what is examined in each place and what counts as examined (pure): files, snapshots, network, console, history, storage
│   ├── sandbox.mjs             # one way of ending a run: own application (with the debugging port), fake, browser with a persistent profile, recorders
│   ├── report.mjs              # report.html, results.json, the terminal table, the gallery, the matrix of the key audit
│   └── checks/                 # flow.mjs, exports.mjs, privacy.mjs, keyboard.mjs, appearance.mjs, keyguard.mjs
├── live/
│   ├── check.mjs               # standalone live check with the user's own key (output contains no key)
│   └── check.selftest.mjs      # tests the live check against a fake platform; no key needed
└── fixtures/
    ├── fake-upstream.mjs       # a fake chat platform (success, failures, rate limit, cut-off, bad score)
    └── datasets/               # tab, semicolon, comma, quoted, broken, >20 rows
```

**Structure Decision**: One repository with a static front end under `app/public/` and a tiny relay under `app/`. The pure logic modules (`dataset`, `placeholders`, `config`, `chat`, `judge`, `similarity`, `runner`, `report`, `exports`) do not touch the page, so they are imported directly by the Node tests; only `ui/` and `main.mjs` depend on the DOM.

## Phase 0: Research (summary)

All unknowns from the specification are resolved in [research.md](research.md): the CORS question (measured), the stack, relay hardening, the request and answer mapping, the judge answer format, the similarity algorithm, pacing and limits, dataset parsing, report and export design, the test strategy, and the small items the clarify pass left open (date format, unload warning, test thresholds). The four points that needed a real key (R12) were verified on 2026-11-01 by the user's own run of a standalone script; all four held, and no default had to change. The only residual unknown is the behavior on long real inputs. R17–R22 (code review of 2026-11-01) settle the technical form of each correction; none of them needs outside information. R23–R29 (modern application page) do the same for User Story 9, and R30–R35 for the acceptance walk-through of User Story 10, and R36–R43 for the key audit of User Story 11 and the key removed from the platform's answer (two probes of heap snapshots, of the page and of the application's process, were made while planning).

## Phase 1: Design (summary)

- [data-model.md](data-model.md): entities, validation rules, and state transitions (row, judge verdict, run).
- [contracts/](contracts/): the dataset input format, the relay API, the platform request/response mapping, the judge answer format, and the export formats.
- [quickstart.md](quickstart.md): how to start the app, run the automated tests, validate each user story without a key, run the live check, and verify privacy.

### Mapping from user stories to the design

| Spec story | Main modules | Verified by |
|------------|--------------|-------------|
| 1 Session and dataset | `main`, `dataset`, `dataset-view` | unit (`dataset`), e2e |
| 2 Main prompt with example | `placeholders`, `prompts-view` | unit (`placeholders`), e2e |
| 3 Judges | `defaults`, `judge`, `placeholders` | unit (`judge`), e2e |
| 4 Configuration | `config`, `config-view` | unit (`config`), e2e |
| 5 Run and report | `runner`, `chat`, `similarity`, `report`, `exports`, `relay` | unit, contract, e2e, live check (`tests/live/check.mjs`) |
| 6 Re-run judges | `runner`, `report` | unit (`runner`), e2e |
| 7 Row selection and failed-requests re-run | `dataset`, `runner`, `run-view`, `report` | unit (`runner`, `selection`), e2e (`us7`, `us7b`) |
| 5 (report appearance and view) | `report`, `report-style`, `diff`, `report-view` | unit (`report`, `report-style`, `diff`), e2e (`us5`, `a11y-phone`, `a11y-desktop`) |
| 12 Re-run choices and New Session (FR-075 – FR-077, SC-042 – SC-044) | `rerun`, `runner` (`failed-main`, `failed-judges`), `problems`, `index.html`, `styles.css`, `rerun-view`, `run-view`, `report-view`, `chrome-view`, `main`, `quickstart.md` | unit (`rerun`, `runner-failed-rows` renamed, `problems`), e2e (`us12`; `us5`–`us9` adapted), acceptance (`flow.rerun-choices`, `flow.new-session-everywhere`; `flow.judge-rerun`, `flow.failed-rerun`, `flow.back-to-form`, keyboard, and the audit ways 4–5 adapted) |
| 11 Key audit | `tests/accept/{leak,scanners,snapshot,sandbox}.mjs`, `checks/keyguard.mjs`, `browser.mjs` (persistent profile, graceful close), `report.mjs` (matrix), `run.mjs` (group), `package.json` (`audit:key`), `quickstart.md` | unit (`accept-leak`, `accept-scanners`, `accept-keyguard`), and the run itself (`npm run audit:key`) |
| 10 Automated acceptance walk-through | `tests/accept/*` (`cdp`, `browser`, `driver`, `contrast`, `checkers`, `rows`, `report`, `checks/*`), `package.json` (`accept`), `quickstart.md` | unit (`accept-coverage`, `accept-contrast`, `accept-checkers`, `accept-report`), and the run itself (`npm run accept`) |
| 9 Modern application page | `theme`, `problems`, `readiness`, `config` (`describeParams`, detailed validation), `index.html`, `styles.css`, `chrome-view`, `panel-view`, `run-view`, `dataset-view`, `config-view`, `main`, `report-style`, `server` (`/styles.css`) | unit (`readiness`, `theme`, contrast, motion rule, `config`), contract (`server`: styles), e2e (`us9`, `us1`, `us7`, `a11y-phone`, `a11y-desktop`) |
| 8 Faithful and safe behavior | `run-view` (locked form, second check, copy, warning, reachability), `index.html`, `main`, `runner` (one failed-row definition, credentials, run token), `dataset`, `judge`, `chat` (redaction), `config` (local-address check), `report`, `exports` (CSV), `diff` (cache), `relay`, `server` (headers) | unit (`dataset`, `judge`, `runner*`, `report`, `exports`, `chat`, `config`, `no-storage`), contract (`server`, `relay`), e2e (`us8`: locked form, stop after a broken load, abandoned run) |

## Constitution Check (re-evaluated after Phase 1 design)

No change. The design adds no persistence, no dependency, and no automatic send. The relay's rules (loopback, token, Host/Origin, no logging of content, no redirects, no retained state) are written as contract tests, which makes Principle I verifiable rather than assumed. **Result: Pass, no violations.**

## Constitution Check, User Story 12

FR-075 – FR-077 and SC-042 – SC-044. The re-run choices and the persistent header band change arrangement and add one pure module; they add no dependency, no storage, and no automatic send. Principle I: keys are still typed only in the fields of the form; a choice made in the report leads to those fields and the report view gets no input (R47). Principle II: the code that already decides what a failed request is is reused, `failed-rows` is removed instead of kept beside its replacements, and no second New Session button is added (R45, R46). Principle III: every choice shows its number of requests before anything is sent and keeps the confirmation of FR-017; an unavailable choice says why in words. Principle IV: the spec names the four choices and their outcomes, not the disclosure element. Principle V: each acceptance scenario of User Story 12 has a check (R49). Result: no violations.

## Complexity Tracking

> Filled because one addition goes beyond a single static page.

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|-------------------------------------|
| A word-difference module, a style module, and a separate report view (no dependency) | The user asked for a modern, professional report in which two test cases can be compared and the differences can be read (spec FR-023, FR-037, FR-038, clarifications of 2026-11-01). | A charting or diff library would add dependencies and a build step against Principle II; showing only the plain texts gives no way to see the differences; keeping the report inside the narrow form column makes the five fields unreadable. |
| A small DevTools-protocol client and a driver (`tests/accept/`) | FR-060 and FR-061 need real pointer and keyboard events, real downloads under the page's security policy, and the system's dark and reduced-motion settings; the virtual-time harness cannot do any of them. | Puppeteer or Playwright (a large dependency and a browser download, against Principle II and the project's no-dependency rule); keeping the manual walk-through (the user asked for it to be automated). |
| A separate application instance with the debugging port and a persistent browser profile per way (`keyguard`) | FR-067 and FR-071 need the memory of the application's own process and what a real browser writes to disk; the in-memory browser contexts of the walk-through write nothing, and the real command has no debugging port. | Searching only the page and the logs (the present checks: they miss the profile and both memories); reading process memory from outside (not portable, not reachable-only); one shared browser for all ways (a leak could not be tied to a way). |
| A shared token module (`theme.mjs`) and a `/styles.css` composed by the server | FR-048 requires that the page and the report cannot drift apart; one definition of the colours is the only way to guarantee it without a build step, and composing the file in the server avoids a flash of unstyled content. | Two copies of the values (they drift, which is what the requirement forbids); injecting the tokens from a script (flash of unstyled content, and the contrast test would need a browser). |
| A local relay program next to the page | The platform answers browser calls from other origins without the permission header, so a page that only runs in the browser cannot reach it (measured: preflight without an allowed origin, and a real `fetch()` failing in headless Chrome; [research R1](research.md)). | Calling the platform directly from the page does not work; browser-security switches and third-party proxies would weaken the browser or send the key through someone else's server, which the constitution (Principle I) forbids. A hosted relay is out of scope (clarified: local first). |
