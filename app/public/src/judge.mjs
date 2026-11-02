// The judges' answer format: the app adds one instruction to every judge prompt and reads the grade
// from a final `SCORE:` line (contracts/judge-answer-format.md). Pure module: no DOM access.

export const FORMAT_INSTRUCTION = 'Finish your answer with one final line in exactly this form, where the number is your overall percentage from 0 to 100:\nSCORE: <number>';

/** The judge prompt as sent: the user's text plus the format instruction (spec FR-011). */
export function withFormatInstruction(promptText) {
  return `${promptText}\n\n${FORMAT_INSTRUCTION}`;
}

// A whole line: SCORE, a number, an optional percent sign or "/100". Models add markdown around it, so a heading or quote
// mark in front and emphasis around the label, the value, or the whole line are tolerated (contracts/judge-answer-format.md).
const SCORE_LINE = /^[\s>#*_`]*SCORE[*_`]*\s*:\s*[*_`]*\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|\/\s*100)?[\s*_`]*$/i;

/**
 * Reads a judge's answer: { grade, rationale } with the grade a whole percent from 0 to 100, or
 * { error: 'unreadable answer: <reason>', rawAnswer } (spec FR-012). The last SCORE line counts.
 */
export function readAnswer(answer) {
  const text = typeof answer === 'string' ? answer : '';
  if (!text.trim()) return { error: 'unreadable answer: the answer is empty', rawAnswer: text };
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = SCORE_LINE.exec(lines[i]);
    if (!match) continue;
    const value = Number(match[1]);
    if (value > 100) return { error: `unreadable answer: the score ${match[1]} is outside 0–100`, rawAnswer: text };
    return { grade: Math.round(value), rationale: lines.slice(0, i).concat(lines.slice(i + 1)).join('\n').trim() };
  }
  return { error: 'unreadable answer: no SCORE line was found', rawAnswer: text };
}
