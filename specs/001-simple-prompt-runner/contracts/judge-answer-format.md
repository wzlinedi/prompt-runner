# Contract: Judge answer format

**Spec**: FR-010–FR-012, FR-031 | **Research**: R5 | **Used by**: `judge.mjs`

## What the app appends to every judge prompt

After the judge prompt (with `{prompt_input}` and `{output}` replaced), the app adds this text, separated by a blank line:

```text
Finish your answer with one final line in exactly this form, where the number is your overall percentage from 0 to 100:
SCORE: <number>
```

The user never writes or sees this instruction as part of the editable prompt; it is shown in the judge input preview as a separate, labelled block ("added by the app").

## Reading the answer

1. Take the answer text (`message.content`).
2. Search the lines from the end for the **last** line that matches, case-insensitively: `^[\s>#*_`]*SCORE[*_`]*\s*:\s*[*_`]*\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|/\s*100)?[\s*_`]*$`. Markdown emphasis or backticks around the line, around the label, or around the value (`**SCORE: 89**`, `**SCORE:** 89`, `**SCORE**: 89%`), a heading or quote mark in front (`## SCORE: 89`), a percent sign, and `/100` after the number are tolerated, because models often add them; the word inside a sentence is not a score line.
3. The number must be between 0 and 100 inclusive; the grade is that number rounded to a whole percent.
4. The rationale is the answer text without that line, trimmed. It contains the lists the ready-made prompts ask for (checked facts with verdicts; or present and missing facts) and is shown as written, with line breaks.

## Unreadable answers

An answer is **unreadable** when: it is empty, there is no matching line, the number is outside 0–100, or it is not a number. The row then shows the judge's grade as an error `unreadable answer: <reason>` together with the raw answer text, and the row is left out of that judge's average (spec FR-012).

| Raw answer | Result |
|------------|--------|
| `…lists…\nSCORE: 89` | grade 89, rationale = the lists |
| `…\nscore: 89.4 %` | grade 89 |
| `…\nSCORE: 130` | unreadable (outside 0–100) |
| `Looks correct overall.` | unreadable (no SCORE line) |
| `…\n**SCORE: 89%**` | grade 89 (emphasis tolerated) |
| `…\n**SCORE:** 85` | grade 85 (emphasis around the label) |
| `…\n**SCORE**: 85%` | grade 85 |
| `…\nSCORE: 85/100` | grade 85 |
| `…\n## SCORE: 85` | grade 85 (heading mark) |
| `…\nSCORE: 185/100` | unreadable (outside 0–100) |
| two `SCORE:` lines | the last one counts |
| `` (empty) | unreadable (empty answer) |

## Tests

A table-driven unit test covers every row above, plus a rationale that contains the word SCORE in the middle of a sentence (must not be mistaken for the marker line).
