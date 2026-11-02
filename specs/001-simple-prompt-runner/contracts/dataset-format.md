# Contract: Dataset format (user input)

**Spec**: FR-003–FR-006, FR-034 | **Used by**: `dataset.mjs`, the dataset view

The user gives the app a text (pasted or from a file) with a header row and one record per test.

## Columns

Exactly four columns, names matched ignoring letter case, in any order. Other columns are ignored.

| Column | Required value | Meaning |
|--------|----------------|---------|
| `id` | non-empty, unique | Test identifier |
| `name` | non-empty | Scenario name |
| `prompt_input` | non-empty | Data inserted into the main prompt |
| `expected_result` | may be empty | Exact expected text |

## Separator and quoting

- The separator is detected from the **first record** (read with the same quoting rules as the data, so header names may be wrapped in double quotes): tab, then semicolon, then comma; the first one that makes the header contain all four column names is used.
- A value that contains the separator, a double quote, or a line break must be wrapped in double quotes; a double quote inside is written `""`. A double quote that is not at the start of a value is ordinary text.
- Line breaks are `\n`, `\r\n`, or `\r`. Empty lines are ignored.
- Text copied from a spreadsheet (tab-separated) needs no quoting by the user.

## Validation and messages

Checks run in this order; the first failing group stops loading and nothing is loaded partially. Messages are English plain sentences (spec FR-036).

| Situation | Message (shape) |
|-----------|-----------------|
| Empty text | `The dataset is empty.` |
| No header with the four names | `No header with the columns id, name, prompt_input, expected_result was recognized (missing: …). The separator may be a tab, a semicolon, or a comma.` |
| A record has a different number of columns | `Record N has X columns instead of Y (separator: …). Most likely cause: a value that contains the separator is not wrapped in double quotes. Tip: …` (first bad record; `Similar records: K.` when more) |
| A quoted value is never closed | `Record N starts a value in double quotes that is never closed. Close the quote, or write a double quote inside a quoted value twice ("").` (N = the record in which the quote was opened; nothing is loaded and no later record is absorbed) |
| Header only | `The dataset has no rows.` |
| Per-record problems | `Errors in the dataset: row N: empty id; row N: duplicate id "…"; row N: empty name; row N: empty prompt_input.` |
| Empty `expected_result` | Loaded; note `K without expected_result (similarity: "no expected result")`. |

## Limits and display

- Values of at least 100,000 characters are accepted and sent complete; in the preview a value longer than 110 characters is shortened with its length and expandable.
- The dataset may have more than 20 rows; the preview has a check box per row, the first 20 selected by default (spec FR-034).

## Examples

Tab-separated (copied from a spreadsheet; the second value contains commas and a line break and is quoted by the spreadsheet):

```text
id	name	prompt_input	expected_result
PL	Poland	"Selected indicators	Poland	Source dataset
Population on 1 January
(absolute number)	36 497 495
(2025)	View source data"	Poland has about 36.5 million inhabitants…
```

Comma-separated with quoting:

```text
id,name,prompt_input,expected_result
T1,Capitals,"Poland, France, Germany","Warsaw, Paris, Berlin"
```
