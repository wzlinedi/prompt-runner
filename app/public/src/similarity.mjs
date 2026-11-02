// Similarity of the actual output to the expected result (spec FR-024, research R6): character-level
// Levenshtein distance, computed bit-parallel (Myers / Hyyrö) in 32-bit blocks, so that texts of tens of
// thousands of characters take milliseconds. No model is involved.

const WORD = 32;
const ZERO = new Int32Array(0);

/** Advances one 32-row block by one text column; `hin` is the horizontal delta entering the block (-1, 0, +1). */
function advance(eq, state, block, hin) {
  const pv = state.pv[block];
  const mv = state.mv[block];
  const xv = eq | mv;
  if (hin < 0) eq |= 1;
  const xh = (((eq & pv) + pv) ^ pv) | eq;
  let ph = mv | ~(xh | pv);
  let mh = pv & xh;
  state.ph = ph; // before shifting: the caller reads the bit of the last real row from these
  state.mh = mh;
  const hout = (ph >>> 31) ? 1 : (mh >>> 31) ? -1 : 0;
  ph <<= 1;
  mh <<= 1;
  if (hin < 0) mh |= 1; else if (hin > 0) ph |= 1;
  state.pv[block] = mh | ~(xv | ph);
  state.mv[block] = ph & xv;
  return hout;
}

/** Edit distance between two arrays of code points. */
function distance(a, b) {
  // Strip the common prefix and suffix: they never change the distance.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  // The shorter text is the pattern (fewer blocks).
  let pattern = a.slice(start, endA);
  let text = b.slice(start, endB);
  if (pattern.length > text.length) [pattern, text] = [text, pattern];
  const m = pattern.length;
  if (m === 0) return text.length;

  const blocks = Math.ceil(m / WORD);
  const peq = new Map(); // code point -> match bits per block
  for (let i = 0; i < m; i++) {
    let bits = peq.get(pattern[i]);
    if (!bits) { bits = new Int32Array(blocks); peq.set(pattern[i], bits); }
    bits[(i / WORD) | 0] |= 1 << (i % WORD);
  }
  const state = { pv: new Int32Array(blocks).fill(-1), mv: new Int32Array(blocks), ph: 0, mh: 0 };
  const lastBlock = blocks - 1;
  const lastBit = 1 << ((m - 1) % WORD);
  let score = m;
  for (let j = 0; j < text.length; j++) {
    const bits = peq.get(text[j]) ?? ZERO;
    let hin = 1; // the first row of the table grows by one per column
    for (let block = 0; block < blocks; block++) {
      hin = advance(bits.length ? bits[block] : 0, state, block, hin);
      if (block === lastBlock) {
        if (state.ph & lastBit) score++;
        else if (state.mh & lastBit) score--;
      }
    }
  }
  return score;
}

/** Levenshtein distance of two texts, counted in characters (code points). */
export function levenshtein(a, b) {
  return distance(Array.from(a), Array.from(b));
}

/** Whole percent: 100 for equal texts, 0 for nothing in common; trimmed, case-sensitive. */
export function similarity(actual, expected) {
  const a = Array.from(String(actual).trim());
  const b = Array.from(String(expected).trim());
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 0;
  return Math.round((1 - distance(a, b) / Math.max(a.length, b.length)) * 100);
}
