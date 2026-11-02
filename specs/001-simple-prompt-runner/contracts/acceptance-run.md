# Contract: The acceptance walk-through (command, checks, evidence, report)

**Spec**: FR-058 – FR-065, User Story 10, SC-033 – SC-036 | **Research**: R30 – R35 | **Used by**: `tests/accept/*`, `package.json` (`accept`)

A development tool, started from the command line. It uses the fake platform and a fake key only; it never calls the real platform and never needs a key.

## Command

```bash
npm run accept                    # = node tests/accept/run.mjs
npm run accept -- --only flow,exports      # a subset of the groups (flow, exports, privacy, keyboard, appearance, keyguard)
npm run audit:key                          # only the key audit (see key-audit.md)
npm run accept -- --headed                 # shows the browser (to watch a failure)
CHROME_BIN=/path/to/chrome npm run accept
```

| Exit status | Meaning |
|-------------|---------|
| 0 | every check passed (human-judgment entries are listed and do not count) |
| 1 | at least one check failed, or the coverage of the quickstart is broken (a row without a check) |
| 2 | the walk-through could not run: no browser, the browser could not be driven, the application could not start, or an unexpected error stopped it |
| 130, 143 | interrupted (Ctrl+C, a termination request): the remaining checks are skipped and everything that was started is stopped before the process ends |

## Run folder

`test-results/acceptance-YYYYMMDD-HHMMSS/`:

| Path | Content |
|------|---------|
| `report.html` | self-contained report: the human items at the top, the verdict table, the evidence per check, the gallery |
| `results.json` | the same as data: one record per check |
| `relay.log` | the standard output of the real `node app/server.mjs` of the run (the log that the privacy check reads) |
| `downloads/` | the files that Export HTML and Export CSV really downloaded |
| `screenshots/` | `<group>-<name>-<width>-<scheme>.png` |
| `reference/` | the reference page [../example-form-modern.html](../example-form-modern.html) rendered in the light and the dark scheme |

The folder is searched at the end for the fake key of the run: it must not appear anywhere in it (SC-035).

## Check record

```json
{ "id": "exports.real-downloads", "group": "exports", "row": "Exports",
  "title": "Export HTML and CSV download real files", "verdict": "pass",
  "expected": "…", "seen": "…", "evidence": [{ "path": "downloads/prompt-runner-report-….csv", "bytes": 2048 }],
  "screenshot": "screenshots/….png", "durationMs": 4210 }
```

`verdict` is `pass`, `fail`, `not-run` (with a reason, for example the dark scheme or reduced motion could not be requested from the browser: the part that could be examined is still examined, a failure there is a `fail`, and the rest is never a silent pass), or `human` (with the reason; no verdict is claimed). `evidence` entries are `{ path, bytes? }`; a file shows its size in the report.

## Groups and checks (the name of the quickstart row they answer)

| Group | Check id | Quickstart row | What it does with real input |
|-------|----------|----------------|------------------------------|
| flow | `flow.start` | Start screen offers only New Session | one action on the hero |
| flow | `flow.dataset-errors` | Wrong dataset gives a specific message | pastes `id,name`; message names the columns; nothing runs |
| flow | `flow.placeholder` | Placeholder check | removes `{prompt_input}`; the message and the list name it; Run disabled |
| flow | `flow.judges-share-model` | Judges share the model by default | judge fields hidden; the confirmation names one model |
| flow | `flow.confirmation` | Confirmation before sending | counts and models; the fake has received nothing |
| flow | `flow.report-view` | Report view | after a run the page shows the report (header, cards, tables, archive collapsed) |
| flow | `flow.case-card` | Test case card | heading, five fields, judges below; fields stack below 900 px |
| flow | `flow.differences` | Differences | struck words only in the expected result, underlined only in the output |
| flow | `flow.back-to-form` | Back to the form | the form is as left; step 5 offers the actions |
| flow | `flow.failed-rerun` | Failed row and re-run | row `HU` fails once; only its requests are sent |
| flow | `flow.row-selection` | Row selection | unticks rows; more than 20 refused with the count |
| flow | `flow.judge-rerun` | Judge re-run | only judge requests; `previously N%` |
| flow | `flow.stop` | Stop | Stop with requests held by the fake; nothing arrives for 5 s |
| flow | `flow.unload-guard` | Closing with unexported results | navigating away raises the browser's confirmation (`beforeunload` dialog) |
| flow | `flow.locked-form` | Locked form while confirming | real clicks and typing into locked fields change nothing |
| flow | `flow.edits-during-run` | Edits during a run | typing in a judge prompt during a run; the archive keeps the original |
| flow | `flow.unclosed-quote` | Unclosed quote | the error names the record; no row loaded |
| flow | `flow.score-forms` | Judge score forms | fake answers `**SCORE:** 85` and `SCORE: 85/100`; grade 85 |
| flow | `flow.stop-after-failed-load` | Stop after a failed load | a broken dataset during a run; Stop still there and works |
| flow | `flow.http-warning` | Plain `http` warning | the confirmation warns for `http://example.com/…`, not for the fake's address |
| flow | `flow.chips-steps` | Step indicator and chips | chips and the states of the steps follow the dataset and the key |
| flow | `flow.readiness` | Live readiness list | the list at the start, while filling, an item moves the focus, Run waits |
| flow | `flow.json-badge` | JSON badge | breaks and repairs the JSON |
| exports | `exports.real-downloads` | Exports | real files; HTML without script or external reference; CSV with BOM, CRLF, 17 columns; no key, endpoint, relay address, prompt text |
| exports | `exports.csv-formulas` | CSV formulas | a fake answer starting with `=SUM(1,1)`; the cell starts with `'` |
| privacy | `privacy.relay-log` | (section 5, relay log) | `relay.log` has no key and no prompt text |
| privacy | `privacy.exports` | (section 5, exports) | the downloaded files have no key and no `127.0.0.1` |
| privacy | `privacy.storage` | (section 5, browser) | local, session, cookies, IndexedDB, caches are empty after a run |
| keyboard | `keyboard.full-flow` | Keyboard only | New Session to the report with keys alone; order and visible focus recorded |
| appearance | `appearance.matrix` | Modern page, look | 500/900/1100/1920 px × light/dark: no overflow, nothing covered, focus ring, contrast ≥ 4.5:1, screenshots (the look itself is `human`: see below) |
| appearance | `appearance.bottom-bar` | Bottom bar | at 500 px: state text and action, never covering a control, delegating to the panel |
| appearance | `appearance.reduced-motion` | Reduced motion | `prefers-reduced-motion: reduce` emulated; no transition or animation runs |

Entries with `{ human: reason }` (also counted by the coverage test): *the page looks as professional as the reference page* (reason: a judgment; closed by the implementer's review of the gallery, as decided by the user), *usability with a first-time user* (waived by the user), *live check with a real key* (run by the user, with real data, once the system is declared ready).

## Rules

- A check never throws out of the run: an exception is a `fail` with the message; a time limit (60 s unless the check says otherwise) is a `fail` with the screenshot at that moment.
- A control is clicked only when the element at its centre is the control itself; otherwise the check fails with "covered by …".
- The run writes nothing outside its folder and the temporary browser profile, and removes the profile and stops every process it started: at the end, after an unexpected error, and after an interrupt. All of them are stopped by one shared stop that every path waits for, so the process never ends while something is still running.
- The key typed into the page is the fake key of the run; the real platform is never contacted.

## Tests (no browser needed)

1. `tests/unit/accept-coverage.test.mjs`: every row of the tables of `quickstart.md` has an entry in `rows.mjs` (a check id that exists, or `human` with a reason) and no entry is without a row.
2. `tests/unit/accept-contrast.test.mjs`: parsing, blending over a background, the worst colour stop of a gradient, and the ratio; a pair at 4.4:1 is reported, one at 4.5:1 passes.
3. `tests/unit/accept-checkers.test.mjs`: the pure checkers fail on deliberately broken fixtures and pass on good ones: a CSV with a fake key in it, without the BOM, with a cell starting with `=` and no quote; an HTML export with a `<script>` or an `http` address; a relay log with a key; a tab-order record with a control missing or out of order or without a visible focus; an overflow record; a transition record with a non-zero duration under reduced motion (SC-034).
4. `tests/unit/accept-report.test.mjs`: the report page is self-contained, lists the human items first, shows a failed check with its expected and seen values, and contains no key.
