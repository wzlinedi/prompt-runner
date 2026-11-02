// CSV export (contracts/export-formats.md) and the browser download. The CSV holds no prompts, no averages,
// no keys, and no endpoints; text values a spreadsheet could evaluate as a formula get a leading quote.
import { formatIso } from './report.mjs';

export const CSV_HEADER = [
  'ID', 'Scenario', 'Prompt input', 'Actual output', 'Expected result', 'Similarity to expected output (%)',
  'Accuracy - Grade', 'Accuracy - Rationale', 'Completeness - Grade', 'Completeness - Rationale', 'Status',
  'Model main', 'Model judges', 'Parameters main', 'Parameters judges', 'Generated main', 'Generated judges',
];

const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

// A text that starts with one of these is read by a spreadsheet program as a formula (spec FR-026).
const FORMULA_START = /^[=+\-@\t\r]/;
/** A text column's value as it is written: with a leading `'` when a spreadsheet could evaluate it. */
const text = (value) => {
  const plain = String(value ?? '');
  return FORMULA_START.test(plain) ? `'${plain}` : plain;
};

const gradeCell = (view) => (view.state === 'ok' ? String(view.value) : view.state === 'error' ? 'error' : '');

/** UTF-8 with a byte-order mark, CRLF line breaks, every field in double quotes. */
export function renderCsv(report) {
  const [main, accuracy, completeness] = report.promptRows;
  const date = (ms) => (ms ? formatIso(ms) : '');
  // Text columns go through `text`; similarity, grades, and dates are numbers, `error`, or dates and are written as they are.
  const records = report.rows.map((row) => [
    text(row.id), text(row.name), text(row.promptInput), text(row.output), text(row.expected),
    row.similarity.value === null ? '' : String(row.similarity.value),
    gradeCell(row.accuracy), text(row.accuracy.rationale), gradeCell(row.completeness), text(row.completeness.rationale),
    text(row.status),
    text(main.model), text(accuracy.model), text(main.params), text(accuracy.params), date(main.generatedAt), date(accuracy.generatedAt),
  ]);
  return `﻿${[CSV_HEADER, ...records].map((record) => record.map(quote).join(',')).join('\r\n')}\r\n`;
}

/** Offers a text as a file download. */
export function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
