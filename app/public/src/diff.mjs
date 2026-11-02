// Word-level difference between the expected result and the actual output, for the report's "Differences" field.
// Words are compared without the whitespace around them; punctuation and markdown signs belong to the word.

const MAX_CELLS = 4_000_000; // beyond this the comparison would be too large: no differences are shown

/** A word together with the whitespace that follows it. */
const tokens = (text) => (String(text).trim().match(/\S+\s*/g) ?? []).map((t) => (/\s$/.test(t) ? t : `${t} `));
const key = (token) => token.trim();

/**
 * Returns a list of `{ type: 'eq' | 'del' | 'ins', text }` that reads as the actual output with the words that
 * exist only in the expected result (`del`) and only in the actual output (`ins`) marked, or `null` when the
 * texts are too long to compare.
 */
export function diffWords(expected, actual) {
  const a = tokens(expected);
  const b = tokens(actual);

  let start = 0;
  while (start < a.length && start < b.length && key(a[start]) === key(b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && key(a[endA - 1]) === key(b[endB - 1])) { endA--; endB--; }

  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const n = middleA.length;
  const m = middleB.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  // Longest common subsequence of the middle parts.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = key(middleA[i]) === key(middleB[j])
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const parts = [];
  const push = (type, text) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text; else parts.push({ type, text });
  };
  for (let i = 0; i < start; i++) push('eq', b[i]);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && key(middleA[i]) === key(middleB[j])) { push('eq', middleB[j]); i++; j++; }
    else if (j < m && (i === n || table[i * width + j + 1] > table[(i + 1) * width + j])) { push('ins', middleB[j]); j++; }
    else { push('del', middleA[i]); i++; }
  }
  for (let k = endB; k < b.length; k++) push('eq', b[k]);
  if (parts.length) parts[parts.length - 1].text = parts[parts.length - 1].text.trimEnd(); // no whitespace after the last word
  return parts;
}
