# Quickstart: Prompt Runner

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [contracts/](contracts/) | **Data model**: [data-model.md](data-model.md)

A run-and-validate guide. It does not contain implementation code.

## Prerequisites

- Node.js 22 or newer (`node -v`).
- A current Chromium-based browser or Firefox.
- For the live check only: a personal API key for the NVIDIA-hosted models (free sign-up, see [references/nvidia-hosted-models-api.md](references/nvidia-hosted-models-api.md)).
- No `npm install` is needed: the project has no third-party dependencies.

## 1. Start the app

```bash
node app/server.mjs
```

The program prints the local address (default `http://127.0.0.1:8787`). Open it in the browser; the start screen offers one action, **New Session**. Nothing is opened automatically and nothing listens outside the computer.

## 2. Run the automated tests

```bash
npm test    # = node --test "tests/unit/**/*.test.mjs" "tests/contract/**/*.test.mjs" tests/live/check.selftest.mjs ; no network, no key
node tests/e2e/run.mjs                      # real page in headless Chrome against a fake platform
```

Expected: all pass. The e2e run starts the relay and a fake chat platform on local ports, drives the page through the user stories, and needs neither internet nor a key.

## 3. Try the whole flow without a real key (fake platform)

```bash
node tests/fixtures/fake-upstream.mjs       # prints http://127.0.0.1:9911/v1/chat/completions (another free port if 9911 is taken)
```

The first main request about Hungary (the sample row `HU`) fails once with a rate limit, so that "Re-run failing main prompts and all related judges" can be tried; start the script with `FAKE_FAIL_ONCE=` (empty) to switch that off, or with `FAKE_FAIL_ONCE=Slovakia` to fail another row.

In the page: **New Session** → **Insert sample** → keep the default prompts → set the Main prompt **Endpoint** to the printed address → enter any text as the key → **Run** → confirm. Check against the spec:

| Check | Where | Expected |
|-------|-------|----------|
| Start screen offers only New Session | start screen | User Story 1, scenario 1 |
| Wrong dataset gives a specific message | load `id,name` only | names the missing columns; nothing runs |
| Placeholder check | remove `{prompt_input}` from the main prompt | run blocked with a message |
| Judges share the model by default | configuration | judge fields hidden; confirmation names one model |
| Confirmation before sending | Run | counts per endpoint and the model names; nothing sent until confirmed |
| Report view | after the run | the page switches by itself to the report, which uses the full width of the window: a header band, cards with the averages (rings), the summary table with bars and badges, the prompts table, the collapsed archive, then one card per test case |
| Test case card | in the report | a heading (ID, name, scores), then prompt input, expected result, actual output, similarity, and differences side by side, long texts in boxes that scroll inside themselves, and below them Accuracy and Completeness one under the other with grade and rationale; narrow the window below 900 px and the fields stack |
| Differences | in the report | struck-through words exist only in the expected result, underlined words only in the actual output |
| Back to the form | toolbar of the report | the steps are shown exactly as left; step 5 offers Open report, the exports, and the re-run control |
| Failed row and re-run | the fake platform fails the row with id `HU` once | "Re-run failing main prompts and all related judges" offers 3 requests; only that row's requests are sent |
| Row selection | untick rows / tick more than 20 | run covers selected rows; more than 20 is refused with the count |
| Judge re-run | edit the Accuracy prompt → "Re-run all judges" | only judge requests; `previously N%` shown for changed grades; main date unchanged |
| Stop | press Stop during a run | no new requests; unfinished rows `not run`; nothing arrives after 5 s |
| Exports | Export HTML / Export CSV | files open without the app; no key; CSV opens in a spreadsheet with correct characters |
| Closing with unexported results | try to close the tab | the browser asks for confirmation |
| Locked form while confirming | press Run, then try to change the endpoint, a prompt, or a row | nothing can be changed; Cancel makes the fields editable again; Confirm sends exactly what was shown (User Story 8, scenario 1) |
| Edits during a run | start a run, edit the Accuracy prompt while it runs | the running run is unaffected; the archive shows the prompt it used (scenario 2) |
| Unclosed quote | load `id,name,prompt_input,expected_result` and a record with an opening `"` and no closing one | an error naming that record; no row is loaded (scenario 3) |
| Judge score forms | fake platform answers `**SCORE:** 85`, `SCORE: 85/100` | the grade is 85 in both cases (scenario 5) |
| Stop after a failed load | during a run, load a broken dataset | Stop, the progress, and the confirmation are still on the screen (scenario 10) |
| Plain `http` warning | set the endpoint to `http://example.com/v1/chat/completions` (do not confirm) | the confirmation says the key and the data travel unencrypted; the local fake platform address shows no such line (scenario 11) |
| CSV formulas | a fake answer that starts with `=SUM(1,1)`; export the CSV | the cell starts with `'` and a spreadsheet shows it as text (scenario 9) |
| Modern page, look | open the page at 1920, 1100, 900, and 500 px, in the light and in the dark setting of the system, next to [example-form-modern.html](example-form-modern.html) | same visual language as the report and the reference page; no horizontal scrolling; all text readable (User Story 9, scenarios 8, 9) |
| Step indicator and chips | load the sample, select 3 rows, enter a key | chips show `5 rows loaded`, `3 of 20 selected`, the model, `Judges: same model`; the steps show ✓ with a fact, the current step is marked (scenarios 2, 3) |
| Live readiness list | start a session, then fill the page step by step | at the start all problems are listed by step with steps 2–4 dimmed; they become normal as steps unlock; typing a key removes its item; an item moves the focus to its field; Run is disabled until the list is empty and says `Ready to run.` (scenario 4) |
| JSON badge | break the JSON, then repair it | the badge says `not valid JSON` or the problem, then `valid · <model>` (scenario 5) |
| Bottom bar | narrow the window to 500 px | a bar fixed to the bottom shows `N problems`/`Ready` and Run; during a run Stop; afterwards Open report; it never covers a control (scenario 8) |
| Reduced motion | set the system to reduce motion, repeat a run | no transition or animation runs (scenario 7) |
| Key is never stored | `npm run audit:key` (or `npm run accept`) | the audit reports no copy of the fake key in any place (files, the browser's profile on disk, logs, console, network, history, storage, exports, memory of the page and of the application) after any of the seven ways of ending a run; the planted copies are found; the report says what was examined |
| Re-run choices | the fake platform fails one judge request of one row out of five; open the control in the panel and in the report | four choices with counts; "Re-run only the failing judges" shows 1 request, sends exactly 1 after the confirmation, and every other result is unchanged; unavailable choices give their reason; during a run all are unavailable (User Story 12) |
| New Session everywhere | look for New Session on the form, during a run, and in the report; press it in the report and confirm | one New Session button on each screen; after the confirmation the report, the dataset, and the keys are gone and the session is empty (User Story 12) |
| Keyboard only | go from New Session to the report without the mouse | every action is reachable; the focus is always visible (SC-029) |

## 4. Live check with a real key (the points the plan could not verify)

A short script checks the four points of [research R12](research.md) against the real platform (**already run once on 2026-11-01 with all four confirmed**; run it again after changing the default parameters or the endpoint, or when the key stops working). **The key stays on your computer**: it is read silently, sent only to the platform, never printed, never written to a file, and removed from every line of output, so the output can be pasted into a chat without exposing the key.

```bash
# Option A: the key is read without echo and does not enter the shell history
read -rs NVIDIA_API_KEY && export NVIDIA_API_KEY && node tests/live/check.mjs

# Option B: run it and paste the key at the hidden prompt
node tests/live/check.mjs
```

Do **not** put the key on the command line (`NVIDIA_API_KEY=nvapi-… node …`): it would be stored in the shell history. To forget the key afterwards: `unset NVIDIA_API_KEY`.

The script first prints the *shape* of the key (starts with `nvapi-`, length, stray spaces; it removes a pasted `Bearer ` prefix or quotes) and checks that the platform is reachable (the model list is public and does **not** test the key), then sends three short requests (a minute or two, mostly waiting for the model): the main prompt with its default parameters, a judge-style prompt with the `SCORE:` instruction, and the second model with its default parameters. It prints, per request, only non-secret facts: status, latency, `finish_reason`, the names of the fields in the answer message (this shows where a reasoning trace appears), whether `<think>` tags appear inside the answer, the length and first 120 characters of the answer to a trivial prompt, token counts, any rate-limit headers, and whether the `SCORE:` line was read. It ends with a verdict for each point:

| Point | What a good result looks like |
|-------|-------------------------------|
| R12.1 answer text only | no `<think>` tags in the content; extra fields (for example a reasoning field) are listed separately |
| R12.2 room for reasoning plus answer | `finish_reason` is `stop` (not `length`) and the `SCORE:` line was read |
| R12.3 latencies | a number per request, used for the run-duration estimate |
| R12.4 second model | status 200 with the default parameters |

**If the chat requests fail, the script's "Diagnosis of the key" tells you why**, based on the platform's answers (measured on 2026-11-01):

| Platform answer | Meaning | What to do |
|-----------------|---------|------------|
| `401 Invalid JWT serialization: Missing dot delimiter(s)` | The platform did not recognise the pasted text as an API key. It recognises a key **only** by the lowercase prefix `nvapi-`; anything else (uppercase `NVAPI-`, an old-style key, another credential, a cut or wrong clipboard) is read as a login token and fails like this | Copy the key again from the "Get API Key" window on build.nvidia.com; it starts with `nvapi-` |
| `403 Authorization failed` | The key has the right shape and was recognised, but is refused: revoked, deleted, a copy of an old key, or the account lacks the "Public API Endpoints" permission (reports on the NVIDIA developer forum, no confirmed fix) | Generate a new key and delete the old one; check Developer Program and verification status; ask NVIDIA to enable "Public API Endpoints" if it persists |
| `429` | Request limit | Wait a minute and run again |
| `200` | The key works | — |

The model list is public (it answers `200` without any key), so it cannot be used to test a key. A wrongly pasted `Bearer Bearer …` also gives `401`.

Paste the output back to confirm or adjust the plan; if a default changes, update the spec's Assumptions and `research.md` (section R12). The script itself is tested without a key against a fake platform (`node --test tests/live/check.selftest.mjs`), including that the key never appears in its output.

Once the app exists, a second way needs no script at all: do a real run in the page and share the **exported report or CSV**. Those files never contain the key or the endpoint (spec FR-026), so they are safe to paste or attach.

## 5. Privacy check

After any run (normal, failed, or stopped):

Use a fake key such as `nvapi-FAKE-1234` for this check (never type a real key into a shell command: it would stay in the shell history).

```bash
# 1) the relay log contains no key and no prompt text. Start the server with the log in a file:
node app/server.mjs > relay.log 2>&1          # then, after a run:
grep -c "nvapi-FAKE-1234" relay.log            # expect 0
grep -c "Selected indicators" relay.log        # expect 0 (no prompt text)

# 2) the exports contain no key and no endpoint (the browser saves them with the date in the name, usually in ~/Downloads)
cd ~/Downloads
grep -c "nvapi-FAKE-1234" prompt-runner-report-*.html prompt-runner-report-*.csv     # expect 0 for every file
grep -c "127.0.0.1" prompt-runner-report-*.html prompt-runner-report-*.csv           # expect 0 for every file
```

In the browser: the key fields are empty after the run; nothing is stored (DevTools → Application → storage lists are empty).

## 6. Automated acceptance walk-through

Everything of section 3 and the privacy check of section 5 can be run by one command, in a real Chrome driven with real clicks and key presses, against the fake platform (no key, no internet):

```bash
npm run accept
```

It takes about 3 minutes and prints a table with a verdict for every row of this document. The result is in `test-results/acceptance-<date>-<time>/`: open `report.html` (verdicts, evidence, and a gallery of screenshots at 500, 900, 1100, and 1920 px in the light and the dark setting next to the reference page), `downloads/` (the files that Export HTML and Export CSV really downloaded), and `relay.log` (the log of the run).

Exit status: 0 all checks passed, 1 a check failed (or a quickstart row has no check), 2 it could not run (for example, no Chrome: set `CHROME_BIN`) or stopped on an unexpected error, 130 it was interrupted with Ctrl+C, 143 it was asked to terminate (in both cases everything it started is stopped first). Options: `--only flow,exports,privacy,keyboard,appearance,keyguard` and `--headed` (watch the browser).

What the run does **not** decide, and lists at the top of its report: whether the page looks as professional as the reference page (judged from the gallery), usability with a first-time user (waived), and the live check with a real key (section 4, run by the user with real data once the system is declared ready).

### Which check answers which success criterion

The older success criteria that no task names by number are answered by these checks (the rows of section 3 map to checks in `tests/accept/rows.mjs`):

| Success criterion | Checked by |
|-------------------|------------|
| SC-002 wrong datasets | `flow.dataset-errors` |
| SC-003 unknown places in prompts | `flow.placeholder` |
| SC-004 the example below the main prompt | `flow.placeholder` (the example shows the text the model receives) |
| SC-005 every row once, with fields or an explicit state | `flow.report-view`, `flow.stop`, `flow.failed-rerun` |
| SC-006 fields of a case in its own lines, prompts at the top | `flow.case-card`, `flow.report-view` |
| SC-007 exports open without the app | `exports.real-downloads` |
| SC-009 nothing arrives 5 s after Stop | `flow.stop` |
| SC-010 no key in exports, messages, or storage | `privacy.exports`, `privacy.relay-log`, `privacy.storage`, `keyguard.audit` |
| SC-012 compare all cases from the summary table | `flow.report-view` |
| SC-032 first-time user (waived by the user) | no check; listed as left to a human in the report |

### The key audit

`npm run audit:key` runs only the audit that the API key is never stored ([contracts/key-audit.md](contracts/key-audit.md)): a fake key, seven ways of ending a run (normal, the platform repeating the key in an error, stopped, judges re-run, failed requests re-run, abandoned by New Session, typed but never used), and every place where a key could be left (files that changed, the browser's profile on disk, the application's log, the console, the network traffic, the address and history, the storage, the exports, and a snapshot of the memory of the page and of the application). It first plants a copy of the key in each kind of place and checks that it finds it; the report shows, per place and way, what was examined. It takes about 2 minutes. It says nothing about your terminal, your shell history, your everyday browser's password manager, or the platform's side.
