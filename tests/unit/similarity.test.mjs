import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, levenshtein } from '../../app/public/src/similarity.mjs';

/** The textbook dynamic-programming distance over code points, as the reference. */
function naive(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[y.length];
}

// A small deterministic generator, so that failures can be repeated.
let seed = 12345;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const randomText = (length, alphabet) => Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');

test('edge strings equal the reference', () => {
  const cases = [['', ''], ['', 'abc'], ['abc', ''], ['a', 'a'], ['a', 'b'], ['abc', 'abc'], ['kitten', 'sitting'], ['flaw', 'lawn'],
    ['Zażółć gęślą jaźń', 'Zazolc gesla jazn'], ['😀a😀', 'a'], ['😀😀', '😀'], ['aaaa', 'bbbb'], ['abcdef', 'fedcba']];
  for (const [a, b] of cases) assert.equal(levenshtein(a, b), naive(a, b), JSON.stringify([a, b]));
});

test('random strings equal the reference, around the 32-bit block borders', () => {
  for (const alphabet of ['ab', 'abcdefghij', 'aąbcćdeęfgh 0123\n']) {
    for (const length of [1, 2, 30, 31, 32, 33, 63, 64, 65, 66, 95, 96, 97, 130, 200]) {
      for (let round = 0; round < 6; round++) {
        const a = randomText(length, alphabet);
        const b = randomText(Math.max(0, length + Math.floor(random() * 41) - 20), alphabet);
        assert.equal(levenshtein(a, b), naive(a, b), `${alphabet.length}/${length}/${round}`);
        assert.equal(levenshtein(b, a), naive(b, a));
      }
    }
  }
});

test('similar long texts with a few edits equal the reference', () => {
  const base = randomText(700, 'abcdefghijklmnopqrstuvwxyz ');
  let edited = base;
  for (let i = 0; i < 12; i++) {
    const at = Math.floor(random() * edited.length);
    edited = i % 3 === 0 ? edited.slice(0, at) + edited.slice(at + 1) : i % 3 === 1 ? `${edited.slice(0, at)}Z${edited.slice(at)}` : `${edited.slice(0, at)}Q${edited.slice(at + 1)}`;
  }
  assert.equal(levenshtein(base, edited), naive(base, edited));
});

test('similarity: the examples of the spec', () => {
  assert.equal(similarity('abcd', 'abce'), 75);
  assert.equal(similarity('same text', 'same text'), 100);
  assert.equal(similarity('', ''), 100);
  assert.equal(similarity('   ', '\n'), 100, 'only whitespace counts as empty');
  assert.equal(similarity('something', ''), 0);
  assert.equal(similarity('', 'something'), 0);
  assert.equal(similarity('abc', 'xyz'), 0);
  assert.equal(similarity('ab', 'abcd'), 50);
});

test('similarity: surrounding whitespace is trimmed, case is significant', () => {
  assert.equal(similarity('  abcd \n', '\tabcd'), 100);
  assert.equal(similarity('ABCD', 'abcd'), 0);
  assert.equal(similarity('a b', 'a  b'), 75, 'inner whitespace counts');
});

test('similarity: rounded to a whole percent', () => {
  assert.equal(similarity('abc', 'abd'), 67);
  assert.equal(similarity('a'.repeat(7), 'a'.repeat(6) + 'b'), 86);
});

test('two 16,000-character texts finish in under 100 ms', () => {
  const a = randomText(16000, 'abcdefghijklmnopqrstuvwxyz ');
  const b = randomText(16000, 'abcdefghijklmnopqrstuvwxyz ');
  const started = performance.now();
  const value = similarity(a, b);
  const elapsed = performance.now() - started;
  assert.ok(value >= 0 && value <= 100);
  assert.ok(elapsed < 100, `took ${elapsed.toFixed(1)} ms`);
});
