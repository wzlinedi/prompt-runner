// Dataset loading: separator detection, tokenizer, validation, and row selection (spec FR-003–FR-006, FR-034).
// Pure module: no DOM access.

export const REQUIRED_COLUMNS = ['id', 'name', 'prompt_input', 'expected_result'];
export const SEPARATORS = [
  { sep: '\t', name: 'tab' },
  { sep: ';', name: 'semicolon' },
  { sep: ',', name: 'comma' },
];
export const MAX_ROWS_PER_RUN = 20;

export const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const hasContent = (record) => record.some((v) => v !== '');

/**
 * Reads text into records of values. A double quote opens a quoted value only at the start of a value; `""` inside
 * quotes is a quote; separators and line breaks inside quotes are kept; `\r\n`, `\r`, and `\n` end a record.
 * Returns the raw records (empty ones included), and `open`: the number of non-empty records before the one in which a
 * quote was opened and never closed (so 0 is the header, 1 the first data record), or null. With `firstOnly` the
 * scan stops after the first non-empty record (used to read the header).
 */
function scan(text, sep, { firstOnly = false } = {}) {
  const records = [];
  let record = [];
  let value = '';
  let quoted = false;
  let openedAt = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; } else quoted = false;
      } else value += ch;
    } else if (ch === '"' && value === '') {
      quoted = true;
      openedAt = records.length;
    } else if (ch === sep) {
      record.push(value); value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(value); records.push(record); record = []; value = '';
      if (firstOnly && hasContent(records[records.length - 1])) return { records, open: null };
    } else value += ch;
  }
  if (value !== '' || record.length) { record.push(value); records.push(record); }
  return { records, open: quoted ? records.slice(0, openedAt).filter(hasContent).length : null };
}

/**
 * Separator from the HEADER (the first record, read with the quoting rules of the data): tab, then semicolon, then
 * comma; the first one that makes the header contain all four column names wins.
 */
export function detectSeparator(text) {
  const source = stripBom(text);
  for (const candidate of SEPARATORS) {
    const first = scan(source, candidate.sep, { firstOnly: true }).records.find(hasContent) ?? [];
    const header = first.map((h) => h.trim().toLowerCase());
    if (REQUIRED_COLUMNS.every((name) => header.includes(name))) return candidate;
  }
  return null;
}

/** Splits text into records of values (see `scan`). Records without any content are dropped. No header validation here. */
export function tokenize(text, sep) {
  return scan(text, sep).records.filter(hasContent);
}

/**
 * Parses and validates a dataset. Returns { ok: true, rows, notes, separator } or { ok: false, errors }.
 * Nothing is ever loaded partially. Messages are in English (spec FR-036).
 */
export function parseDataset(input) {
  const text = stripBom(String(input ?? ''));
  if (!text.trim()) return { ok: false, errors: ['The dataset is empty.'] };

  const found = detectSeparator(text);
  if (!found) {
    const firstLine = text.split(/\r\n|\n|\r/)[0].toLowerCase();
    const missing = REQUIRED_COLUMNS.filter((name) => !firstLine.includes(name));
    const detail = missing.length && missing.length < REQUIRED_COLUMNS.length ? ` (missing: ${missing.join(', ')})` : '';
    return { ok: false, errors: [`No header with the columns id, name, prompt_input, expected_result was recognized${detail}. The separator may be a tab, a semicolon, or a comma.`] };
  }

  const { records: raw, open } = scan(text, found.sep);
  if (open !== null) {
    // Checked before the number of columns: a quote left open swallows the records after it and would otherwise go unnoticed.
    return { ok: false, errors: [open === 0
      ? 'The header starts a value in double quotes that is never closed. Close the quote, or write a double quote inside a quoted value twice ("").'
      : `Record ${open} starts a value in double quotes that is never closed. Close the quote, or write a double quote inside a quoted value twice ("").`] };
  }
  const records = raw.filter(hasContent);
  const header = records[0].map((h) => h.trim().toLowerCase());
  const bad = records.slice(1).map((r, i) => ({ n: i + 1, count: r.length })).filter((x) => x.count !== header.length);
  if (bad.length) {
    const [first] = bad;
    const which = found.name === 'comma' ? 'comma' : 'separator';
    let message = `Record ${first.n} has ${first.count} columns instead of ${header.length} (separator: ${found.name}). Most likely cause: a value that contains the ${which} is not wrapped in double quotes. Tip: copy the cells from a spreadsheet (tabs) or wrap such a value in "double quotes".`;
    if (bad.length > 1) message += ` Similar records: ${bad.length}.`;
    return { ok: false, errors: [message] };
  }

  const index = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, header.indexOf(name)]));
  const data = records.slice(1).map((r) => ({
    id: (r[index.id] ?? '').trim(),
    name: (r[index.name] ?? '').trim(),
    promptInput: (r[index.prompt_input] ?? '').trim(),
    expectedResult: (r[index.expected_result] ?? '').trim(),
  }));
  if (!data.length) return { ok: false, errors: ['The dataset has no rows.'] };

  const problems = [];
  const seen = new Set();
  data.forEach((row, i) => {
    const n = i + 1;
    if (!row.id) problems.push(`row ${n}: empty id`);
    else if (seen.has(row.id)) problems.push(`row ${n}: duplicate id "${row.id}"`);
    seen.add(row.id);
    if (!row.name) problems.push(`row ${n}: empty name`);
    if (!row.promptInput) problems.push(`row ${n}: empty prompt_input`);
  });
  if (problems.length) return { ok: false, errors: [`Errors in the dataset: ${problems.join('; ')}.`] };

  const notes = [];
  const withoutExpected = data.filter((row) => !row.expectedResult).length;
  if (withoutExpected) notes.push(`${withoutExpected} without expected_result (similarity: "no expected result")`);
  return { ok: true, rows: data, notes, separator: found.name };
}

/** A long value shortened with its length (spec FR-006); the full value stays available. */
export function shorten(value, max = 110) {
  const text = String(value ?? '');
  if (text.length <= max) return { text, length: text.length, truncated: false };
  return { text: text.slice(0, max).replace(/\s+/g, ' '), length: text.length, truncated: true };
}

// ---- Row selection (spec FR-034) ----

/** The ids selected by default: all rows, or the first 20 when there are more. */
export function defaultSelection(rows, limit = MAX_ROWS_PER_RUN) {
  return rows.slice(0, limit).map((row) => row.id);
}

/** A run covers from 1 to 20 selected rows. Returns { ok: true } or { ok: false, message }. */
export function validateSelection(ids, limit = MAX_ROWS_PER_RUN) {
  const count = new Set(ids).size;
  if (count >= 1 && count <= limit) return { ok: true, count };
  return { ok: false, count, message: `Select between 1 and ${limit} rows; ${count} ${count === 1 ? 'is' : 'are'} selected now.` };
}

/** Select all rows (may exceed the limit; the run is then refused with the count). */
export function selectAll(rows) {
  return rows.map((row) => row.id);
}

/** Select no rows. */
export function selectNone() {
  return [];
}
