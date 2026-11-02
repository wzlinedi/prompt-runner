# Contract: The application page (regions, step states, readiness, bottom bar, motion, tokens)

**Spec**: FR-048 – FR-057, FR-075 – FR-077, User Story 9, User Story 12, SC-027 – SC-032, SC-042 – SC-044 | **Research**: R23 – R29, R44 – R48 | **Reference**: [../example-form-modern.html](../example-form-modern.html) | **Used by**: `index.html`, `styles.css`, `theme.mjs`, `readiness.mjs`, `problems.mjs`, `ui/chrome-view.mjs`, `ui/panel-view.mjs`, `ui/run-view.mjs`

The page changes appearance and arrangement only; no rule of the first eight user stories changes. Nothing described here carries a key or an endpoint.

## Regions (landmarks and ids)

| Region | Element and id | Content |
|--------|----------------|---------|
| Start screen | `#startScreen` | Hero with the one action `New Session` and the in-memory notice (FR-001, FR-049). |
| Header band | `<header>` (top level of the body, above `#formView` and `#reportView`) | Product name, chips (below), `New Session` (`#newSession2`), the only New Session button once a session is started; it stays visible in the report view (FR-077, R46). |
| Step indicator | `<nav aria-label="Steps">` with `<ol class="steps">` | Five links, one per step (below). |
| Steps 1–4 | `<main>`; cards `#secData`, `#secMain`, `#secJudge`, `#secCfg` | As before. Steps 2–4 unlock in order; step 4 stays while a dataset is loaded or a run exists. |
| Run panel (step 5) | `<aside id="secRes" aria-labelledby=…>` | Readiness list, ready summary, confirmation (`#runConfirm`), Run, Stop, progress, result actions. Shown from the start of a session. |
| Bottom bar | `#runBar` | Only below 1100 px; fixed to the bottom; state text and one action. |

Existing ids of the controls (`run`, `stop`, `confirmYes`, `confirmNo`, `phase`, `prog`, `prog2`, `openReport`, `expHtml`, `expCsv`, `runMsg`, `resMsg`, and the fields) stay. The ids `rerun` and `rerunFailed` are replaced by the re-run control below.

## The re-run control (FR-075, FR-076)

One component in two places: `#rerunBox` in the run panel and `#rvRerunBox` in the toolbar of the report. A native `<details class="rerun">` whose `<summary>` reads "Re-run" (with a badge of the number of failed rows when it is not zero) and holds four buttons:

| Button (`data-rerun`) | Label | Sends (mode) |
|-----------------------|-------|--------------|
| `all` | Re-run all | main prompt, then judges, on the rows of the last run, with the settings on the form (`full`) |
| `failedMain` | Re-run failing main prompts and all related judges | per row without an output: main, then both judges (`failed-main`) |
| `judges` | Re-run all judges | both judges on every row with an output (`judges-only`) |
| `failedJudges` | Re-run only the failing judges | the judge requests that lack a valid grade, on rows with an output (`failed-judges`) |

Each button shows its number of requests. An unavailable choice is `disabled` and is followed by its reason as visible text (`A run is in progress`, `No run yet`, `Nothing failed`, `No row has an output`, `The rows of the last run are no longer loaded`; R48). Escape closes the disclosure and returns the focus to the summary; choosing a choice closes it. From the report, a choice closes the report view and continues as in the run panel: the missing key is reported in `#resMsg` and its field takes the focus, otherwise the confirmation opens (R47). The component has no key field and shows no endpoint.

## New Session (FR-077)

Exactly one `#newSession2` in the header band, visible on the form, during a run, and in the report view; its confirmation `#resetConfirm` is reachable from all of them; Cancel returns the focus to the button; confirming closes the report view, stops a running run, and leaves an empty session (R46).

## Layout

| Window width | Arrangement |
|--------------|-------------|
| ≥ 1100 px | Two columns: the cards of steps 1–4, and the run panel beside them (sticky). Judge prompts side by side; the two configuration blocks may be side by side. |
| 900 – 1099 px | One column; the run panel after the steps; the bottom bar shown. |
| < 900 px | Everything stacked; every button at least 40 px high; the step indicator in two columns (below 560 px the last step takes the full row). |
| any | No horizontal scrolling of the page; the page keeps room below its last card for the bottom bar. |

## Chips of the header band (`sessionFacts`)

`N rows loaded` (hidden without a dataset) · `K of 20 selected` · `Model <main model>` · `Judges: same model` or `Judges: <judge model>` · `No report yet` or `Report ready`. Never a key, never an endpoint. A long model name wraps or is shortened with its full value in `title`.

## Step indicator (`stepStates`)

State per step, shown by an icon and a word (never by colour alone), with a short fact:

| Step | `locked` | `done` (fact) | `attention` (fact) |
|------|----------|---------------|--------------------|
| 1 Dataset | never | dataset loaded and 1–20 rows selected (`5 rows, 3 selected`) | dataset loaded and the selection is not valid (`N problems`); without a dataset the step is the current one |
| 2 Main prompt | no dataset | prompt valid (`valid`) | prompt invalid (`N problems`) |
| 3 Judges | no dataset | both prompts valid (`2 prompts valid`) | a prompt invalid (`N problems`) |
| 4 Configuration | no dataset | endpoint, key, JSON valid (`ready`) | otherwise (`N problems`) |
| 5 Run | no dataset | a finished or stopped run exists (`done`) | – (`not ready` while any problem exists; `ready to run` when none; `running`) |

From 1100 px the indicator is `position: sticky` at the top of the window and gets a background band once it has stuck (spec FR-050); below 1100 px it scrolls with the page. `New Session` in the header band is quiet (`ghost`) while the session is empty and solid with dark red text (`data-weight="heavy"`) once it holds a dataset or a run (spec FR-054).

`aria-current="step"` marks the first step that is not `done`. A step that is not `locked` can be pressed (keyboard operable) and scrolls to its card or to the panel.

## Readiness list (`readiness`)

- Items are the problems that block a run, as `{ step, field, text }`, from the same checks that block the run (`problems.mjs`); the text is the text of the existing messages.
- The list is grouped by step 1–4. A group of a step that is `locked` is dimmed, says when it becomes available ("available after step N"), and its items are not links. An item of an available step is a link that moves the focus to `field`:

| Problem | field |
|---------|-------|
| no dataset / unreadable dataset | `dsText` |
| selection not between 1 and 20 | `selAll` |
| main prompt | `mainText` |
| Accuracy / Completeness prompt | `accText` / `compText` |
| main endpoint / key / JSON | `mainEp` / `mainKey` / `main_json` |
| judge endpoint / key / JSON (when shown) | `judgeEp` / `judgeKey` / `judge_json` |

- With no problem the list is replaced by `Ready to run.` and the ready summary: the number of requests per endpoint (host only) and the models, the same numbers as the confirmation (FR-017), which still follows.
- `aria-live="polite"`; the list is rewritten only when the set of problems changes. The state badge says `N problems` or `ready`.
- **Run** is disabled while a problem is listed and while a confirmation is open; the reasons stay visible (`aria-describedby` points to the list).

## Bottom bar (`#runBar`)

| State | State text | Action |
|-------|------------|--------|
| problems | `N problems` (pressing it scrolls to the panel) | `Run`, disabled |
| ready | `Ready` | `Run` |
| confirmation open | `Confirmation waiting` (the panel comes into view) | disabled |
| running / stopping | the phase and the progress | `Stop` |
| finished / stopped | `Report ready` | `Open report` |

The action button delegates to the panel's own button (`run`, `stop`, `openReport`), so the confirmation, the lock, and every check exist once.

## Inputs

- Dataset: choose a file, drop a file on the drop zone (read by the same code as the chooser), or paste; the preview table in the style of the report with a check box per row; the selection count as a chip.
- Prompt editors: the highlighted places (not by colour alone) and the number of characters.
- Parameters JSON: a badge `valid · <model>` or the problem, from `describeParams` (the function that also blocks the run).
- Keys: masked; no control that shows them.

## Motion

All `transition` and `animation` declarations are inside one `@media (prefers-reduced-motion: no-preference)` block, at most 250 ms, `ease-out`: a step unlocking, a readiness item appearing, the confirmation opening, the progress fill, the gauge fill, hover and press of buttons. With reduced motion nothing runs. No information is carried by motion alone.

## Design tokens (`theme.mjs`)

One list of tokens, each with a light and a dark value, written for `:root` (the page, via `GET /styles.css`) and for `.rpt` (the report and its HTML export): `bg`, `surface`, `surface2`, `text`, `muted`, `line`, `accent`, `accent-soft`, `on-accent`, `good`, `goodbg`, `mid`, `midbg`, `ring-mid`, `low`, `lowbg`, `shadow`, `hero1`, `hero2`, `hero3`, `herotext` (the report's own `insbg`, `delbg`, `delfg` stay with the report). Every text/background pair of the page and of the report has a contrast of at least 4.5:1 in both appearances.

## Tests

0. `rerun` (User Story 12): every row of the availability table (in progress, no run, nothing failed, no output, rows gone), the counts for a 10-row run with one failed judge request (failed judges 1, failed main 0, all judges 20, all 30), and the badge.
1. `readiness`: a fresh session lists every problem of every step with steps 2–4 `locked`; after a valid dataset steps 2–4 are available; every blocking problem of `blockingProblems` appears exactly once with its field; a state with no problem gives an empty list.
2. `stepStates` and `sessionFacts`: the table above, row by row; the facts contain no key and no endpoint even when both are set.
3. `theme`: the page's token list equals the report's; contrast of the pairs of the page and of the report in both appearances; the motion rule (no `transition`/`animation` outside the `no-preference` block, none over 250 ms).
4. `describeParams`: valid, not JSON, no model, reserved key.
5. Contract: `GET /styles.css` starts with the shared tokens and keeps the security headers.
6. End to end (`us9`): the step indicator follows the flow; the readiness list changes while typing and an item moves the focus; Run is disabled with reasons and enabled when ready; at 500 px the bottom bar shows the state and its action and nothing overflows horizontally; with reduced motion requested no transition runs; the whole flow from New Session to the report with the keyboard alone; all earlier scenarios pass (SC-031).
