// The design tokens are defined once (spec FR-048, SC-027): the report and the page get them from theme.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_TOKENS, REPORT_TOKENS, PAGE_TOKENS, tokensCss } from '../../app/public/src/theme.mjs';
import { REPORT_CSS } from '../../app/public/src/report-style.mjs';

/** The custom properties of a block: { name: value }. */
const read = (block) => Object.fromEntries(block.split(';').map((part) => { const at = part.indexOf(':'); return [part.slice(2, at), part.slice(at + 1)]; }));

test('every token has a light and a dark value, and the names are unique', () => {
  const all = [...SHARED_TOKENS, ...REPORT_TOKENS, ...PAGE_TOKENS];
  assert.equal(new Set(all.map((t) => t[0])).size, all.length);
  for (const [name, light, dark] of all) assert.ok(light && dark, name);
});

test('tokensCss writes the light values, then the dark ones under the system setting', () => {
  const css = tokensCss(':root', PAGE_TOKENS);
  const [lightLine, darkLine] = css.split('\n');
  assert.match(lightLine, /^:root\{--bg:#f4f6fb;/);
  assert.match(darkLine, /^@media \(prefers-color-scheme:dark\)\{:root\{--bg:#0d111c;/);
  const light = read(/^:root\{(.*)\}$/.exec(lightLine)[1]);
  const dark = read(/\{:root\{(.*)\}\}$/.exec(darkLine)[1]);
  for (const [name, l, d] of [...SHARED_TOKENS, ...PAGE_TOKENS]) { assert.equal(light[name], l, `light ${name}`); assert.equal(dark[name], d, `dark ${name}`); }
  assert.ok(!('insbg' in light), 'the page does not carry the report-only tokens');
});

test('the report CSS carries the same values as the page: one definition (SC-027)', () => {
  const line = /^\.rpt\{(.*)\}$/m.exec(REPORT_CSS)[1];
  const report = read(line);
  const page = read(/^:root\{(.*)\}$/.exec(tokensCss(':root').split('\n')[0])[1]);
  for (const [name] of SHARED_TOKENS) assert.equal(report[name], page[name], `--${name} is the same in the page and in the report`);
  for (const [name, light] of REPORT_TOKENS) assert.equal(report[name], light);
});

test('no external address, font, image, or script in the tokens', () => {
  assert.ok(!/url\(|@import|https?:|<script/i.test(tokensCss(':root', [...PAGE_TOKENS, ...REPORT_TOKENS])));
});
