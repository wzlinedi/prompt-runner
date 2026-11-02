import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWords } from '../../app/public/src/diff.mjs';

const words = (text) => text.trim().split(/\s+/).filter(Boolean);
const joined = (parts, ...types) => parts.filter((p) => types.includes(p.type)).map((p) => p.text).join('').trim();
const kinds = (parts) => parts.map((p) => `${p.type}:${p.text.trim()}`);

test('identical texts are one unchanged part', () => {
  assert.deepEqual(diffWords('a b c', 'a b c'), [{ type: 'eq', text: 'a b c' }]);
});

test('added and removed words', () => {
  assert.deepEqual(kinds(diffWords('the cat sat', 'the big cat sat')), ['eq:the', 'ins:big', 'eq:cat sat']);
  assert.deepEqual(kinds(diffWords('the big cat sat', 'the cat sat')), ['eq:the', 'del:big', 'eq:cat sat']);
});

test('a replaced word is a removal followed by an addition', () => {
  assert.deepEqual(kinds(diffWords('GDP is 100 today', 'GDP is 120 today')), ['eq:GDP is', 'del:100', 'ins:120', 'eq:today']);
});

test('whitespace and line breaks are not compared; the text of the actual output is kept', () => {
  const parts = diffWords('a  b\n\nc', 'a b c');
  assert.deepEqual(kinds(parts), ['eq:a b c']);
  assert.equal(parts[0].text, 'a b c');
  assert.equal(diffWords('a\nb', 'a\nb')[0].text, 'a\nb');
});

test('punctuation and markdown signs belong to the word', () => {
  assert.deepEqual(kinds(diffWords('rate is **3.1%**', 'rate is 3.1%')), ['eq:rate is', 'del:**3.1%**', 'ins:3.1%']);
});

test('empty sides', () => {
  assert.deepEqual(kinds(diffWords('', 'new text')), ['ins:new text']);
  assert.deepEqual(kinds(diffWords('old text', '')), ['del:old text']);
  assert.deepEqual(diffWords('', ''), []);
});

test('random texts: the unchanged and added parts give the actual text; the unchanged and removed parts give the expected one', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const vocabulary = ['alpha', 'beta', 'gamma', '3.1%', 'GDP', '**bold**', 'x,', 'y.'];
  const make = (n) => Array.from({ length: n }, () => vocabulary[Math.floor(random() * vocabulary.length)]).join(random() < 0.5 ? ' ' : '\n');
  for (let round = 0; round < 60; round++) {
    const expected = make(Math.floor(random() * 40));
    const actual = make(Math.floor(random() * 40));
    const parts = diffWords(expected, actual);
    assert.deepEqual(words(joined(parts, 'eq', 'ins')), words(actual), `actual, round ${round}`);
    assert.deepEqual(words(joined(parts, 'eq', 'del')), words(expected), `expected, round ${round}`);
    assert.ok(parts.every((p, i) => i === 0 || p.type !== parts[i - 1].type), 'neighbouring parts of one kind are merged');
  }
});

test('texts too long to compare give null; typical long texts do not', () => {
  const big = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
  const other = Array.from({ length: 3000 }, (_, i) => `v${i}`).join(' ');
  assert.equal(diffWords(big, other), null);
  assert.ok(diffWords(big, `${big} tail`).length > 0, 'a long common start and end is trimmed first');
  const a = Array.from({ length: 800 }, (_, i) => `a${i % 50}`).join(' ');
  const b = Array.from({ length: 800 }, (_, i) => `a${(i * 7) % 50}`).join(' ');
  const started = performance.now();
  assert.notEqual(diffWords(a, b), null);
  assert.ok(performance.now() - started < 500);
});
