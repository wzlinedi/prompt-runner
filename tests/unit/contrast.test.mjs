// Contrast and tokens of the application page (spec FR-048, SC-027): the colours come from the shared token list
// of theme.mjs, so the page and the report are checked against the same values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SHARED_TOKENS, PAGE_TOKENS, tokensCss } from '../../app/public/src/theme.mjs';

const css = await readFile(new URL('../../app/public/styles.css', import.meta.url), 'utf8');
const served = `${tokensCss(':root', PAGE_TOKENS)}\n${css}`;

const light = Object.fromEntries([...SHARED_TOKENS, ...PAGE_TOKENS].map(([name, l]) => [name, l]));
const dark = Object.fromEntries([...SHARED_TOKENS, ...PAGE_TOKENS].map(([name, , d]) => [name, d]));

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (hex) => {
  const h = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const luminance = (color) => { const [r, g, b] = Array.isArray(color) ? color : rgb(color); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** `top` painted over `bottom` with the given opacity. */
const blend = (top, bottom, alpha) => rgb(bottom).map((c, i) => Math.round(rgb(top)[i] * alpha + c * (1 - alpha)));

// Text colour on background pairs that the page really uses (styles.css, index.html).
const pairs = (t) => [
  ['text on page', t.text, t.bg], ['text on card', t.text, t.surface], ['text on second surface', t.text, t.surface2],
  ['muted on page', t.muted, t.bg], ['muted on card', t.muted, t.surface], ['muted on second surface', t.muted, t.surface2],
  ['link/accent on card', t.accent, t.surface], ['chip and lock note', t.accent, t['accent-soft']],
  ['primary button text', t['on-accent'], t.accent], ['step number', t['on-accent'], t.accent],
  ['error text on card', t.low, t.surface], ['problem in the list', t.low, t.lowbg], ['ready item and ok tag', t.good, t.goodbg],
  ['attention step and mid badge', t.mid, t.midbg], ['done step', t.good, t.goodbg], ['locked step number', t.muted, t.surface2],
  ['confirmation box', t.text, t.midbg], ['placeholder mark', t.text, t.ph], ['inserted value mark', t.text, t.val], ['error mark', t.text, t.lowbg],
  ['drop zone text', t.muted, t.surface2], ['drop zone hovered', t.accent, t['accent-soft']],
  ['header on gradient 1', t.herotext, t.hero1], ['header on gradient 2', t.herotext, t.hero2], ['header on gradient 3', t.herotext, t.hero3],
  ['chips on gradient 1', t.herotext, blend('#0f0c3c', t.hero1, 0.28)], ['chips on gradient 2', t.herotext, blend('#0f0c3c', t.hero2, 0.28)], ['chips on gradient 3', t.herotext, blend('#0f0c3c', t.hero3, 0.28)],
];

test('light appearance: every text/background pair of the page has a contrast of at least 4.5:1 (SC-027)', () => {
  for (const [name, fg, bg] of pairs(light)) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
});

test('dark appearance: every text/background pair of the page has a contrast of at least 4.5:1 (SC-027)', () => {
  for (const [name, fg, bg] of pairs(dark)) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
});

test('the start button (white with dark text) and the heavy New Session button (white with dark red text) are readable in both appearances', () => {
  assert.ok(ratio('#312e81', '#ffffff') >= 4.5);
  assert.ok(ratio('#8a1c12', '#ffffff') >= 4.5, 'heavy New Session');
  assert.match(css, /button\.ghost\[data-weight=heavy\]\{background:#fff;border-color:#fff;color:#8a1c12/, 'the colours of the test are the ones of the page');
});

test('every custom property that the page uses is defined by the shared tokens', () => {
  const defined = new Set([...SHARED_TOKENS, ...PAGE_TOKENS].map(([name]) => name));
  const used = new Set([...css.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]));
  for (const name of used) assert.ok(defined.has(name), `--${name} is used but not defined`);
});

test('the served style sheet starts with the light tokens and has the dark ones under the system setting', () => {
  assert.match(served, /^:root\{--bg:#f4f6fb;/);
  assert.match(served, /@media \(prefers-color-scheme:dark\)\{:root\{--bg:#0d111c;/);
});

test('the focus outline is declared', () => {
  assert.match(css, /:focus-visible\{outline:2px solid var\(--accent\)/);
  assert.match(css, /\.editor:focus-within\{outline/);
});

test('no external address, import, font, image, or script', () => {
  assert.ok(!/url\(|@import|@font-face|https?:|<script/i.test(served));
});
