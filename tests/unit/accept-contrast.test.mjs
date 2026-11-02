// The contrast measurement of the acceptance walk-through, with fixtures (spec SC-027, SC-034, research R33).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, blend, ratio, worstRatio, luminance, MEASURE } from '../accept/contrast.mjs';

test('browser colours are parsed, with and without alpha', () => {
  assert.deepEqual(parseColor('rgb(20, 26, 42)'), [20, 26, 42, 1]);
  assert.deepEqual(parseColor('rgba(15, 12, 60, 0.28)'), [15, 12, 60, 0.28]);
  assert.deepEqual(parseColor('rgb(0 0 0 / 50%)'), [0, 0, 0, 0.5]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.equal(parseColor('url(x)'), null);
  assert.equal(parseColor(''), null);
});

test('blending paints a semi-transparent colour over a background', () => {
  assert.deepEqual(blend([0, 0, 0, 0.5], [255, 255, 255]), [127.5, 127.5, 127.5]);
  assert.deepEqual(blend([10, 20, 30, 1], [255, 255, 255]), [10, 20, 30]);
  assert.deepEqual(blend([10, 20, 30, 0], [200, 100, 50]), [200, 100, 50]);
});

test('the ratio is 21 for black on white, 1 for the same colour, and does not depend on the order', () => {
  assert.equal(Math.round(ratio([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
  assert.equal(ratio([120, 120, 120], [120, 120, 120]), 1);
  assert.equal(ratio([20, 20, 20], [250, 250, 250]), ratio([250, 250, 250], [20, 20, 20]));
  assert.ok(luminance([255, 255, 255]) > luminance([0, 0, 0]));
});

test('a pair just below 4.5:1 is reported, one just above passes (the limit of the walker)', () => {
  const white = [255, 255, 255];
  const grey = (v) => [v, v, v, 1];
  assert.ok(ratio([118, 118, 118], white) >= 4.5, '#767676 on white is 4.54:1');
  assert.ok(ratio([119, 119, 119], white) < 4.6 && ratio([122, 122, 122], white) < 4.5, '#7a7a7a on white is below 4.5:1');
  assert.ok(worstRatio(grey(118), [white]) >= 4.5);
  assert.ok(worstRatio(grey(122), [white]) < 4.5);
});

test('over a gradient the worst of its colour stops decides', () => {
  const stops = [[49, 46, 129], [79, 70, 229], [124, 58, 237]]; // the report's header gradient
  const white = [255, 255, 255, 1];
  assert.ok(worstRatio(white, stops) >= 4.5, 'white on the gradient is readable at its worst stop');
  assert.ok(worstRatio([200, 200, 255, 1], stops) < worstRatio(white, stops), 'a pale colour does worse');
  const chip = blend([15, 12, 60, 0.28], stops[2]);
  assert.ok(ratio(white.slice(0, 3), chip) > ratio(white.slice(0, 3), stops[2]), 'the dark overlay of a chip raises the contrast');
});

test('the expression for the page carries the very functions above and the limit of 4.5', () => {
  assert.match(MEASURE, /function parseColor/);
  assert.match(MEASURE, /function blend/);
  assert.match(MEASURE, /function ratio/);
  assert.match(MEASURE, /4\.5\)/);
  assert.doesNotThrow(() => new Function(`return ${MEASURE}`), 'it is valid script text');
});
