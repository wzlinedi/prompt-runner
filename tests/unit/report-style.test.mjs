import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_CSS } from '../../app/public/src/report-style.mjs';

const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2]]));
const light = tokens(/\.rpt\{(--bg:[^}]*)\}/.exec(REPORT_CSS)[1]);
const dark = tokens(/prefers-color-scheme:dark\)\{\.rpt\{([^}]*)\}/.exec(REPORT_CSS)[1]);

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function luminance(hex) {
  const h = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// Every text/background pair the report uses (spec FR-037, SC-017).
const pairs = (t) => [
  ['text on page', t.text, t.bg], ['text on card', t.text, t.surface], ['text on second surface', t.text, t.surface2],
  ['muted on card', t.muted, t.surface], ['muted on second surface', t.muted, t.surface2], ['muted on page', t.muted, t.bg],
  ['accent on card', t.accent, t.surface], ['chip', t.accent, t['accent-soft']],
  ['good badge', t.good, t.goodbg], ['mid badge', t.mid, t.midbg], ['low and error badge', t.low, t.lowbg],
  ['error text on card', t.low, t.surface], ['added words', t.text, t.insbg], ['removed words', t.delfg, t.delbg],
  ['header on gradient 1', t.herotext, t.hero1], ['header on gradient 2', t.herotext, t.hero2], ['header on gradient 3', t.herotext, t.hero3],
];

test('light appearance: every text/background pair has a contrast of at least 4.5:1', () => {
  for (const [name, fg, bg] of pairs(light)) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
});

test('dark appearance: every text/background pair has a contrast of at least 4.5:1', () => {
  for (const [name, fg, bg] of pairs(dark)) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
});

test('the dark set overrides every colour token of the light set', () => {
  const colours = Object.keys(light).filter((k) => !['herotext'].includes(k));
  for (const name of colours) assert.ok(name in dark, `--${name} has a dark value`);
});

test('the gauges and the bars carry colors that are visible against the card', () => {
  for (const t of [light, dark]) {
    for (const name of ['good', 'ring-mid', 'low']) assert.ok(ratio(t[name], t.surface) >= 3, `${name} against the card (graphics need 3:1)`);
  }
});

test('self-contained: no external address, import, font, image, or script', () => {
  assert.ok(!/url\(|@import|@font-face|https?:|<script/i.test(REPORT_CSS));
});

test('every rule is scoped under .rpt, so the page keeps its own styles', () => {
  const rules = REPORT_CSS.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const rule of rules) assert.ok(rule.startsWith('.rpt') || rule.startsWith('@media'), rule.slice(0, 60));
  const inner = [...REPORT_CSS.matchAll(/@media[^{]*\{([\s\S]*?)\}\}/g)].map((m) => m[1]);
  assert.ok(inner.length >= 3);
});

test('the dark setting follows the system and the narrow window rule exists at 900 px', () => {
  assert.match(REPORT_CSS, /@media \(prefers-color-scheme:dark\)/);
  assert.match(REPORT_CSS, /@media \(max-width:900px\)\{[^@]*\.rpt \.main\{display:block\}/);
});
