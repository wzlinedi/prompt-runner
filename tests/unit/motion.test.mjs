// Motion only where the system allows it (spec FR-055, SC-030): every transition and animation of the page and of the
// report sits inside one `prefers-reduced-motion: no-preference` block and lasts at most 250 ms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PAGE_TOKENS, tokensCss } from '../../app/public/src/theme.mjs';
import { REPORT_CSS } from '../../app/public/src/report-style.mjs';

const pageCss = `${tokensCss(':root', PAGE_TOKENS)}\n${await readFile(new URL('../../app/public/styles.css', import.meta.url), 'utf8')}`.replace(/\/\*[\s\S]*?\*\//g, '');

/** The text outside every `@media (prefers-reduced-motion:no-preference){…}` block, and the text inside them. */
function split(css) {
  const marker = /@media \(prefers-reduced-motion:\s*no-preference\)\s*\{/g;
  let outside = '';
  let inside = '';
  let last = 0;
  for (let m = marker.exec(css); m; m = marker.exec(css)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
    outside += css.slice(last, m.index);
    inside += css.slice(m.index + m[0].length, i - 1);
    last = i;
    marker.lastIndex = i;
  }
  return { outside: outside + css.slice(last), inside };
}

const motion = (css) => [...css.matchAll(/(?:^|[;{\s])(transition(?:-duration)?|animation(?:-duration)?)\s*:\s*([^;}]*)/g)].map((m) => ({ property: m[1], value: m[2] }));
const milliseconds = (value) => [...value.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].map((m) => Number(m[1]) * (m[2] === 's' ? 1000 : 1));

for (const [name, css] of [['the page', pageCss], ['the report', REPORT_CSS]]) {
  test(`${name}: no transition or animation outside the no-preference block`, () => {
    const { outside } = split(css);
    assert.deepEqual(motion(outside), [], 'motion declared where reduced motion would not switch it off');
    assert.ok(!/scroll-behavior\s*:\s*smooth/.test(outside), 'smooth scrolling is motion too');
  });

  test(`${name}: every duration is at most 250 ms`, () => {
    const { inside } = split(css);
    for (const { property, value } of motion(inside)) {
      for (const ms of milliseconds(value)) assert.ok(ms <= 250, `${property}: ${value}`);
    }
  });
}

test('the page does use motion, and only in the one block', () => {
  const { inside } = split(pageCss);
  assert.ok(motion(inside).length >= 4);
  assert.equal((pageCss.match(/prefers-reduced-motion/g) ?? []).length, 1);
});

test('the checker itself notices a stray transition and a long duration', () => {
  const bad = '.a{transition:width .2s}@media (prefers-reduced-motion:no-preference){.b{transition:width .4s}}';
  const { outside, inside } = split(bad);
  assert.equal(motion(outside).length, 1);
  assert.ok(milliseconds(motion(inside)[0].value).some((ms) => ms > 250));
});
