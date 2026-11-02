# Contract: Report and exports

**Spec**: FR-022–FR-026, FR-032, FR-033, FR-036 | **Research**: R9 | **Used by**: `report.mjs`, `exports.mjs`

The on-screen report and the HTML export are produced by the same function; the CSV is produced from the same data structure. Both exports contain **no API key and no endpoint**.

## HTML report (and HTML export)

A single self-contained document: inline CSS, no scripts, no external files. Order of the content:

1. **Header band** (`<title>` and heading `Report – Prompt Runner`), with the facts of the report as small labels: `Report generated: <date time> (UTC±hh:mm)`, the number of test cases, the model of the main prompt, `Judges: same model` or the judges' model. Directly below, the **average cards** (`section.kpis`): three ring gauges (`Similarity`, `Accuracy`, `Completeness`, each with the percentage from the `Average` line of the summary table, or `–` when no row has a value) and a card with the number of test cases and `N failed · M without expected result`.
2. **Summary table**, one line per row of the run: `Test case` (id and name, a link to the lines of that row in the results table), `Similarity`, `Accuracy – score`, `Completeness – score`; a last line `Average`. A missing value shows its state: `error`, `–` (nothing to judge or not run), `no expected result`, `…` (still running).
3. **Prompts table**, three lines: `Main prompt`, `Judge – Accuracy`, `Judge – Completeness`; columns `Model`, `Parameters used` (the parameters JSON without `model`, `chat_template_kwargs` flattened, `name=value` list), `Generated` (date time of the latest run of that prompt).
4. **Prompts used (archive)**: the three prompt texts exactly as used, in a `<details>` section that is collapsed by default (no `open` attribute). The model and parameters are shown only in the prompts table (3); they are not repeated here. When grades of a judge come from earlier versions of its prompt (spec FR-035), each earlier version follows the current text in the same section, labelled `Earlier version (N grades)`, and the line of that judge in the prompts table (3) adds a note `N grades from an earlier version of the prompt`.
5. **Results table** (`table.res`), every row of the run takes its own lines, one under the other; the table is as wide as the page whatever the number of rows (no horizontal scrolling). The table uses the full width of the page. The column headings (`Prompt input`, `Expected result`, `Actual output`, `Similarity`, `Differences`) are repeated in every group, directly under the heading line and above the main prompt line (fixed column widths through a `colgroup`, equal for all groups). Per row, one group (`tbody`) of these lines, in this order:
   1. **Heading line**: the test case `ID – name` (the target of the summary link, `id="row-N"`).
   2. **Column headings line**: `Prompt input`, `Expected result`, `Actual output`, `Similarity`, `Differences`.
   3. **Main prompt line**: five cells side by side: `Prompt input` (a wide column: the label `N characters` and the full text in a box about 17 lines high that scrolls inside itself and can be resized vertically; not collapsed, not shortened), `Expected result` (in full; "none" when empty), `Actual output` (with the note "cut off at the length limit" when applicable, or the error), `Similarity to expected output`, `Differences`.
   4. **Judge line**: one cell across the table holding a small table with the columns `Metric`, `Grade`, `Rationale` and the metrics one under the other: `Accuracy`, then `Completeness` (the grade with `previously N%` when a judge re-run changed it).
   **Long texts**: `Prompt input`, `Expected result`, `Actual output`, and `Differences` are each shown in full in a box (`max-height` about 17 lines, `overflow: auto`, `tabindex="0"` and `role="region"` with an `aria-label` naming the field and the test case, vertically resizable); the rationales in the judge line in boxes of about 9 lines. A short text takes only the space it needs. The HTML export uses the same boxes (inline CSS, no script).
   **Narrow window** (below about 900 px): the cells of the main prompt line are shown one under the other, each across the full width with its label (`data-label`, shown above the value); the column headings line is hidden. This holds for the on-screen report and for the HTML export (the same inline CSS).
   A failed row shows its error in place of the missing fields; "nothing to judge" in the judge line when there was no output; `not run` when stopped.
   - **Differences**: the actual output as one text. Words that exist only in the expected result are shown struck through (`<del>`), words that exist only in the actual output as added (`<ins>`); the two kinds also differ by line style, not only by color. Comparison is by words (whitespace is not compared, punctuation and markdown signs belong to the word). `no expected result` or `–` when one side is missing; when the texts are too long to compare, the line says so and shows the plain output.

Date and time: local time `YYYY-MM-DD HH:MM:SS`, with the UTC offset stated once in the header.

## Report view on the page (spec FR-038)

On the page the report is shown in its own view (`#reportView`) that replaces steps 1–4 and uses the full width of the window (16 px side margins). A toolbar (sticky at the top) holds `Back to the form`, `Export HTML`, `Export CSV`; the HTML export contains the report without the toolbar. The view opens by itself when a run finishes or is stopped; step 5 has `Open report` (enabled as soon as a run exists, also during a run). `Back to the form` hides the view and shows the steps exactly as left. New Session closes the view. Progress, Stop, confirmations, and the re-run actions stay in step 5, which remains visible whenever a run exists or a confirmation is open, and step 4 (the keys) remains visible whenever a dataset is loaded or a run exists, whatever else steps 1–3 show (spec FR-043, research R20).

## Appearance (HTML report and export)

Reference: [../example-report-modern.html](../example-report-modern.html). Rules (spec FR-037):

- **Style definitions**: one CSS text, defined once (module `report-style.mjs`), inlined in the export and injected once into the page; custom properties for the colors, a light set and a dark set (`prefers-color-scheme`), every text/background pair at least 4.5:1.
- **Levels**: a score of 80–100 is `good` (green), 50–79 `mid` (amber), 0–49 `low` (red), `error` and missing values have their own neutral/red badge; the number or word is always written.
- **Gauges**: a ring drawn with CSS only (`conic-gradient` driven by a custom property holding the percentage), the percentage in its middle; no script, no image, no external font (system font stack).
- **Summary table**: next to every percentage a horizontal bar (hidden on narrow windows) and a rounded badge.
- **Cards**: the prompts table, the archive, and every test case (heading with ID badge, name, three score badges; then the lines of the results table) are cards with rounded corners and a soft shadow; the header band has a gradient background.
- **Differences marks**: `<del>` struck through on a red tint, `<ins>` underlined (dotted) on a green tint.

## CSV export

- Encoding UTF-8 with a byte-order mark; line breaks `CRLF`; every field in double quotes with `""` inside; separator `,`.
- **Spreadsheet safety** (spec FR-026, research R22): in the text columns (1–5, 8, 10–15) a value whose first character is `=`, `+`, `-`, `@`, a tab, or a carriage return is written with a leading single quote (`'`) before it is quoted, so that a spreadsheet program shows it as text and never evaluates it. The columns 6, 7, 9 (similarity and grades, numbers or `error`) and 16–17 (dates) are not changed, and neither is the HTML export.
- One header line, then one line per row of the run.
- Columns, in this order:

| # | Column | Content |
|---|--------|---------|
| 1 | `ID` | row id |
| 2 | `Scenario` | name |
| 3 | `Prompt input` | full text |
| 4 | `Actual output` | output, empty when none |
| 5 | `Expected result` | full text |
| 6 | `Similarity to expected output (%)` | whole percent, empty when none |
| 7 | `Accuracy - Grade` | percent, or `error`, empty when none |
| 8 | `Accuracy - Rationale` | text or error message |
| 9 | `Completeness - Grade` | as 7 |
| 10 | `Completeness - Rationale` | as 8 |
| 11 | `Status` | `ok`, `ok (cut off at the length limit)`, the readable error, `not run` |
| 12 | `Model main` | model of the main prompt |
| 13 | `Model judges` | model of the judges |
| 14 | `Parameters main` | displayed parameters |
| 15 | `Parameters judges` | displayed parameters |
| 16 | `Generated main` | ISO 8601 with offset, e.g. `2026-11-01T14:12:31+01:00` |
| 17 | `Generated judges` | as 16 |

The CSV has no prompts and no averages (they are in the HTML).

## Tests

- Both renderers are fed the same fixture (ok row, cut-off row, main error, judge error, unreadable answer, no expected result, not run, judge re-run with a changed grade) and the tests assert: field order, states in place of blanks, the average row, absence of `SECRET-TEST-KEY` and of any `http` endpoint, valid CSV (re-parsed by the dataset tokenizer equals the input values, including commas, quotes, line breaks, Polish characters; a value that starts with `=`, `+`, `-`, `@`, a tab, or a carriage return comes back with the leading `'`, and the numeric columns are unchanged).
- A fixture whose judges used a different model than the main prompt (also after a judge re-run with changed JSON) shows that model in the header, the prompts table, the archive, and the CSV; "same model" appears only when the parameters are identical (spec FR-042).
- A parameters text containing something shaped like `nvapi-…` appears as `[key]` in the report and in both exports (spec FR-045).
- The HTML export, opened without the app, has no `<script>` and no external references, and carries a `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` (research R21).
