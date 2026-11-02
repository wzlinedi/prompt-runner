import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, findPlaceholders, fill, sourceSegments, outputSegments, checkPrompt } from '../../app/public/src/placeholders.mjs';

test('a placeholder is { + letters, digits, underscores + }', () => {
  assert.deepEqual(findPlaceholders('a {prompt_input} b {x1} {A_b2}'), ['prompt_input', 'x1', 'A_b2']);
  assert.deepEqual(findPlaceholders('{} { x } {a-b} {"json": 1} {a.b}'), [], 'anything else in braces is ordinary text');
});

test('{{ and }} are literal braces and are not placeholders', () => {
  assert.deepEqual(findPlaceholders('{{prompt_input}}'), []);
  assert.equal(fill('{{prompt_input}}', { prompt_input: 'X' }), '{prompt_input}');
  assert.equal(fill('use {{ and }} here', {}), 'use { and } here');
  assert.equal(fill('{{{prompt_input}}}', { prompt_input: 'X' }), '{X}');
});

test('every occurrence of the same placeholder gets the same value', () => {
  assert.equal(fill('{a}-{a}-{b}', { a: '1', b: '2' }), '1-1-2');
});

test('a value that itself contains {output} or {{ is inserted literally and not processed again', () => {
  assert.equal(fill('A {prompt_input} B', { prompt_input: 'see {output} and {{ here' }), 'A see {output} and {{ here B');
  assert.equal(fill('{prompt_input} {output}', { prompt_input: '{output}', output: 'OUT' }), '{output} OUT');
});

test('a placeholder without a value stays as written', () => {
  assert.equal(fill('{known} {unknown}', { known: 'K' }), 'K {unknown}');
});

test('values with line breaks, tabs, and 100,000 characters are kept complete', () => {
  const big = `line1\nline2\t"x"\n${'z'.repeat(100_000)}`;
  const out = fill('P: {prompt_input} :END', { prompt_input: big });
  assert.equal(out, `P: ${big} :END`);
  assert.equal(out.length, 'P: '.length + big.length + ' :END'.length);
});

test('tokens keep the source text exactly, for the editor overlay', () => {
  const text = 'x {{ y {prompt_input} }} {zzz}';
  assert.equal(tokenize(text).map((t) => t.raw).join(''), text);
  const segs = sourceSegments(text, ['prompt_input']);
  assert.deepEqual(segs.filter((s) => s.type !== 'plain'), [
    { text: '{prompt_input}', type: 'known' },
    { text: '{zzz}', type: 'unknown' },
  ]);
  assert.equal(segs.map((s) => s.text).join(''), text);
});

test('output segments mark inserted values and unknown placeholders', () => {
  const segs = outputSegments('A {a} B {zzz} {{', { a: 'VAL' });
  assert.deepEqual(segs.map((s) => [s.type, s.text]), [['plain', 'A '], ['value', 'VAL'], ['plain', ' B '], ['unknown', '{zzz}'], ['plain', ' {']]);
});

test('main prompt: {prompt_input} is required and any other {word} blocks the run', () => {
  assert.deepEqual(checkPrompt('main', 'Summarize {prompt_input}'), []);
  assert.deepEqual(checkPrompt('main', 'no place here'), ['Main prompt: {prompt_input} is missing.']);
  const problems = checkPrompt('main', 'Summarize {history} and {prompt_input}');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Main prompt: unknown placeholder \{history\}/);
  assert.match(problems[0], /allowed: \{prompt_input\}/);
  assert.deepEqual(checkPrompt('main', 'JSON example {"a": 1} and {{literal}} and {prompt_input}'), []);
});

test('judge prompts need both {prompt_input} and {output} and nothing else in braces', () => {
  assert.deepEqual(checkPrompt('accuracy', 'x {prompt_input} y {output}'), []);
  assert.deepEqual(checkPrompt('completeness', 'x {prompt_input}'), ['Judge Completeness: {output} is missing.']);
  assert.deepEqual(checkPrompt('accuracy', 'only text'), ['Judge Accuracy: {prompt_input} is missing.', 'Judge Accuracy: {output} is missing.']);
  const problems = checkPrompt('accuracy', '{prompt_input} {output} {zzz} {zzz}');
  assert.equal(problems.length, 1, 'an unknown placeholder is reported once');
  assert.match(problems[0], /Judge Accuracy: unknown placeholder \{zzz\}/);
});

test('an unknown prompt kind is a programming error', () => {
  assert.throws(() => checkPrompt('nope', ''));
});
