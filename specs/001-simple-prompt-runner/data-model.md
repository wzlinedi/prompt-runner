# Data Model: Prompt Runner

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

All data lives in the page's memory for the duration of one session (spec FR-029). Nothing here is stored in a database, file, cookie, or browser storage; the only way data leaves the app is an explicit export (HTML or CSV). Names are descriptive; the code may use different identifiers.

---

## Entities

### Session

The container started by **New Session**.

| Field | Type | Notes |
|-------|------|-------|
| `dataset` | Dataset or none | Loaded in step 1. |
| `selection` | set of row ids | 1–20 ids from the dataset (FR-034). |
| `prompts` | PromptSet | Main prompt and the two judge prompts. |
| `config` | Config | Endpoints, keys, parameters JSON. |
| `run` | Run or none | Only the latest run is kept. |
| `exportedSinceChange` | boolean | Drives the unload warning (research R11). |
| `confirming` | boolean | True while a confirmation is open; steps 1–4 are `inert` and only "Confirm and send" and "Cancel" act (FR-039, research R17). Not part of any export. |

**Lifecycle**: `empty` → (New Session) → `active`; New Session again with data or results asks for confirmation, then replaces everything (FR-002). Reload or closing discards it.

### Dataset and DatasetRow

| Field | Type | Rules |
|-------|------|-------|
| `id` | text | Required, unique within the dataset. |
| `name` | text | Required; shown as "scenario". |
| `promptInput` | text | Required, any length (≥ 100,000 characters supported), line breaks preserved. |
| `expectedResult` | text | May be empty (row flagged "no expected result"; still runnable). Never sent to any endpoint (FR-021). |

Validation (all errors are listed, nothing is loaded partially) is in [contracts/dataset-format.md](contracts/dataset-format.md). The dataset may have more than 20 rows; a run covers 1–20 selected rows.

### PromptSet

| Field | Placeholders allowed | Rules |
|-------|---------------------|-------|
| `main` | `{prompt_input}` only | Must contain it at least once; any other `{word}` blocks the run; `{{` and `}}` are literal braces. |
| `accuracy` | `{prompt_input}`, `{output}` | Must contain both; nothing else in braces. |
| `completeness` | `{prompt_input}`, `{output}` | Same as accuracy. |

A placeholder is `{` + letters, digits, underscores + `}`. Every occurrence of the same placeholder gets the same value (FR-008).

### Config

| Field | Type | Rules |
|-------|------|-------|
| `main.endpoint` | URL text | Well-formed `http`/`https`; pre-filled with `https://integrate.api.nvidia.com/v1/chat/completions`. |
| `main.apiKey` | secret text | Required for a run; **memory only**, cleared when a run/re-run ends, fails, or is stopped. |
| `main.params` | JSON text | Valid JSON **object**; non-empty string under `model`; must not contain `messages` or `stream`; otherwise used as written (FR-030). |
| `judge.sameAsMain` | boolean | Default `true`; while true the judges use `main.*` and the judge fields are hidden. |
| `judge.endpoint`, `judge.apiKey`, `judge.params` | as above | Shown and required only when `sameAsMain` is false; one set for both judges. |

Derived: `model` = `params.model`; the *displayed parameters* = `params` without `model`, `chat_template_kwargs` flattened into the list (report table, CSV).

### Run

| Field | Type | Notes |
|-------|------|-------|
| `mode` | `full` \| `judges-only` \| `failed-main` \| `failed-judges` | How the latest execution started (`failed-main` and `failed-judges` replace the former `failed-rows`; R45). |
| `status` | `idle` \| `running` \| `stopping` \| `finished` \| `stopped` | |
| `snapshot` | Snapshot | What the run was started with (below). Archived in the report. |
| `times.main`, `times.judges` | timestamps | When each prompt last produced results (FR-033). |
| `rows` | list of RowResult | Only the selected rows, in dataset order. |
| `reportAt` | timestamp | When the report was last produced. |

**RunRequest and credentials** (FR-039, FR-016): they are not fields of the Run. The *frozen copy* (the selected dataset rows, the three prompt texts, the endpoints, the keys, and the parameters texts) belongs to the confirmation in the run view: it is made when the user presses the action, is what the confirmation describes, is compared with the live form again at "Confirm and send", and is dropped as soon as the run starts or the confirmation is cancelled. The runner copies the prompt texts it is handed and keeps the two *targets* (endpoint and key for the main prompt and for the judges) in its own closure; they are emptied when the run ends, fails, or is stopped. A run that is no longer the current one (New Session) does not touch the session's keys or progress.

**Snapshot** (immutable once the run starts; used by the re-run choices): the three prompt texts, the main params JSON, the judge params JSON or `sameAsMain`, the resulting model names, and the selected row ids. Judge fields of the snapshot are replaced when the judges are re-run (spec User Story 6, scenario 5). **Judge prompt versions**: `judgePromptVersions[accuracy|completeness]` is the list of the texts of that judge prompt that stand behind grades (the first is the text of the original run); a re-run of failed requests that uses a changed judge prompt appends the new text, and a verdict records the index of the version it was produced with (`version`); versions without any remaining grade are dropped. Endpoints and keys are **never** part of the snapshot or of any export.

### RowResult

| Field | Type | Notes |
|-------|------|-------|
| `rowId`, `name`, `promptInput`, `expectedResult` | copied from DatasetRow | The run keeps its own copy. |
| `resolvedPrompt` | text | The main prompt with `{prompt_input}` replaced; exactly what was sent. |
| `main` | MainOutcome | See below. |
| `similarity` | whole percent or a reason | Reason is `no expected result` or `not available` (no output). |
| `accuracy`, `completeness` | JudgeVerdict | One per judge. |

**MainOutcome**: `state` ∈ `pending` · `running` · `ok` · `error` · `not-run`; `output` (text, may be empty); `cutOff` (boolean, from `finish_reason: "length"`); `error` (plain-language message); `durationMs`.

### JudgeVerdict

| Field | Type | Notes |
|-------|------|-------|
| `state` | `pending` · `running` · `ok` · `error` · `nothing-to-judge` · `not-run` | `nothing-to-judge` only while the main prompt has no output; as soon as a main request of that row succeeds, the verdict is reset to `pending` (FR-040, research R18). |
| `grade` | whole percent 0–100 | Only when `ok`. |
| `rationale` | text | The judge's answer without the score line; contains the fact lists. |
| `rawAnswer` | text | Kept when the answer was unreadable, shown next to the error. |
| `error` | text | Provider error or "unreadable answer: <reason>". |
| `previousGrade` | percent | Set when a judge re-run changes a grade (shown next to the new one). |

### Report (derived, not stored)

Built from the Run by [contracts/export-formats.md](contracts/export-formats.md):

- `facts.judges`: "same model" only when the archived judge parameters equal the main ones; otherwise the judges' model (FR-042). `archive.judgesJson` is present whenever they differ.
- `summaryRows[]`: test case (id, name), similarity text, accuracy text, completeness text.
- `averages`: similarity, accuracy, completeness over the rows that have a value.
- `promptRows[]`: for the main prompt and each judge: model, displayed parameters, generated-at.
- `rows[]`: per row the fields of the results table (main prompt line and judge line) (prompt input, expected result, actual output, similarity, word differences, the two judges' grades and rationales), one column each.

---

## Derived views of the page (User Story 9)

Computed from the Session by the pure module `readiness.mjs`; never stored, never exported, never carrying a key or an endpoint. Details and tests: [contracts/page-ui.md](contracts/page-ui.md).

| View | Fields | Notes |
|------|--------|-------|
| `ReadinessItem` | `step` (1–4), `field` (id of the field to focus), `text` | One per problem that blocks a run; the text is the existing message. Grouped by step; a group is `available` when its step is unlocked. |
| `StepState` | `step` (1–5), `state` (`locked` · `current` · `done` · `attention`), `fact`, `problems` (count) | Rules per step in the contract. `aria-current` marks the first step that is not `done`. |
| `SessionFacts` | `rowsLoaded`, `rowsSelected`, `limit` (20), `mainModel`, `judges` (`same model` or a model), `report` (exists or not) | The chips of the header band. |

---

## The acceptance run (development tool, User Story 10)

Not part of a session and never stored by the application; written by `npm run accept` into its own folder ([contracts/acceptance-run.md](contracts/acceptance-run.md)).

| Entity | Fields | Notes |
|--------|--------|-------|
| `Check` | `id`, `group` (`flow` · `exports` · `privacy` · `keyboard` · `appearance`), `row` (name of a quickstart row or none), `title`, `timeoutMs` | `rows.mjs` maps every quickstart row to a check id or `{ human: reason }`. |
| `Verdict` | `id`, `verdict` (`pass` · `fail` · `not-run` · `human`), `expected`, `seen`, `evidence[]` (entries `{ path, bytes? }`: a relative path, and the size when it is a file), `screenshot`, `durationMs`, `reason` (for `not-run` and `human`) | One per check; a failure is a verdict, never an exception. |
| `RunFolder` | `report.html`, `results.json`, `relay.log`, `downloads/`, `screenshots/`, `reference/` | Searched at the end for the fake key of the run. |

---

## The key audit (development tool, User Story 11)

Not part of a session; kept in memory while it runs and reported in the run's folder ([contracts/key-audit.md](contracts/key-audit.md)). Nothing of it holds the key in full once the report is written.

| Entity | Fields | Notes |
|--------|--------|-------|
| `Key` | `text` (`nvapi-FAKE-AUDIT-` + 12 hexadecimal characters), `distinctive` (the 12), `forms[]` (name, bytes) | One per run of the tool. |
| `Place` | `kind` (files · profile · app-log · app-memory · page-memory · console · network · history · cookies · storage · exports · page-text) | The places of FR-067. |
| `Way` | `id` (1–7), `name`, `sandbox` (app instance, fake, browser, profile, recorders) | The ways of FR-068. |
| `Observation` | `place`, `way`, `examined` (counts), `skipped[]` (path, size, reason), `hits[]` (form, where, masked excerpt), `empty` (the permitted uses were not seen, so the examination proves nothing), `nothingCanExist` | One per cell of the matrix; the matrix is the evidence of `keyguard.audit`. |
| `Planted` | `place`, `how`, `found` | One per kind of place, from `keyguard.self-test`. |

---

## State transitions

**Main outcome of a row**

```text
pending ──send──▶ running ──ok──────────▶ ok
                     │ └──error──────────▶ error
Stop ───────────────────────────────────▶ not-run   (rows not yet finished)
error / not-run ──"re-run failing main prompts and all related judges"──▶ running ─▶ ok | error
```

**Judge verdict of a row** (per judge)

```text
(main ok)      pending ─▶ running ─▶ ok | error
(main error / not-run)   nothing-to-judge
"re-run judges"          ok | error | nothing-to-judge ─▶ running ─▶ ok (previousGrade kept if changed) | error
"re-run failing main prompts" (failed-main)   error | not-run | pending ─▶ running ─▶ ok | error, then both judges of that row   (rows already ok are untouched)
"re-run only the failing judges" (failed-judges)   a judge verdict that is not ok on a row with an output ─▶ running ─▶ ok | error   (nothing else is touched)
```

**RerunChoice** (derived, never stored; `rerunChoices(session)`, R44, R48): `id` (`all` \| `failedMain` \| `judges` \| `failedJudges`), `label`, `requests` (a count, with the split into main and judge requests), `available`, `reason` (empty when available). `failedMain` and `failedJudges` never overlap; together they are the former failed rows (FR-035). The control's badge is the number of failed rows.

**Run status**: `idle → running → finished`; `running → stopping → stopped` (Stop); `finished | stopped → running` (any of the four re-run choices). "Re-run" actions are available only when the status is `finished` or `stopped` (FR-028, FR-035).

**Failed row** (FR-035, FR-040): the main prompt has no output (`error` or `not-run`), or the output exists and at least one judge verdict is not `ok` (`error`, `not-run`, `pending`, `running`, and also a stray `nothing-to-judge`). One function answers this for the button, the count, the itemised confirmation, and the list of requests that is really sent.

---

## Derived values and invariants

- `selection.size` is between 1 and 20 before any request is sent.
- Similarity is computed only from `output` and `expectedResult` (R6) and never calls a model.
- The expected result and the keys never appear in any request body, URL, log line, snapshot, or export of keys; the expected result appears in the report and exports, because they are results.
- Averages exclude rows without a value; the "failed" rows are shown with their state instead of a blank.
- The request count shown before a run is `rows × 1` to the main endpoint and `rows × 2` to the judge endpoint (an upper bound; fewer if rows fail), recalculated for judge re-runs (`rows with output × 2`) and failed-rows re-runs (only the missing requests).
