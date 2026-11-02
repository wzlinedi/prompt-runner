import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKey, keyForms, findKey, mask, excerpt } from '../accept/leak.mjs';

const key = makeKey();
const forms = keyForms(key);
const found = (data) => findKey(data, forms).length > 0;

test('a key has the fixed prefix and 12 random hexadecimal characters; two keys differ', () => {
  assert.match(key.text, /^nvapi-FAKE-AUDIT-[0-9a-f]{12}$/);
  assert.equal(key.distinctive.length, 12);
  assert.notEqual(makeKey().text, key.text);
});

test('every form is found alone and next to other bytes', () => {
  const t = key.text;
  const samples = {
    utf8: Buffer.from(`xx ${t} yy`),
    json: Buffer.from(JSON.stringify({ a: `"q"${t}` })),
    percent: Buffer.from(`/path?k=${encodeURIComponent(t)}&z=1`),
    utf16le: Buffer.concat([Buffer.from('abc'), Buffer.from(t, 'utf16le')]),
    utf16be: Buffer.concat([Buffer.from('abc'), Buffer.from(t, 'utf16le').swap16()]),
    part: Buffer.from(`id=${key.distinctive}`),
  };
  for (const [name, buf] of Object.entries(samples)) assert.ok(found(buf), `${name} not found`);
});

test('base64 is found at all three alignments', () => {
  for (const pad of ['', 'a', 'ab', 'abc', 'abcd', 'abcde']) {
    const encoded = Buffer.from(`${pad}${key.text}trailing text`).toString('base64');
    assert.ok(found(encoded), `base64 with ${pad.length} leading bytes not found`);
    assert.ok(found(Buffer.from(`${pad}${key.distinctive}zz`).toString('base64')), `base64 of the part with ${pad.length} leading bytes not found`);
  }
});

test('texts without the key, and a key that differs in one character, are not matched', () => {
  assert.equal(found('nothing to see here, just text'), false);
  assert.equal(found(Buffer.alloc(1000, 7)), false);
  const other = key.text.slice(0, -1) + (key.text.endsWith('0') ? '1' : '0');
  assert.equal(found(`k=${other}`), false);
  assert.equal(found(Buffer.from(other, 'utf16le')), false);
});

test('a hit says which form and where; the excerpt and the mask keep only 8 characters of a key', () => {
  const hits = findKey(`ab${key.text}`, forms);
  assert.ok(hits.some((h) => h.offset === 2 && h.form === 'key/utf-8'));
  const m = mask(`Bearer ${key.text} end`);
  assert.equal(m, 'Bearer nvapi-FA… end');
  assert.ok(!excerpt(`ab${key.text}cd`, 2).includes(key.distinctive));
  assert.ok(!mask(`id ${key.distinctive}`).includes(key.distinctive));
});

test('a piece of another key cut by the window of an excerpt is masked as well', () => {
  const data = `${key.text}${key.text}`;
  const shown = excerpt(data, key.text.length);
  assert.ok(!shown.includes(key.distinctive.slice(0, 8)), shown);
  assert.ok(!/[0-9a-f]{6}/.test(shown), shown);
});
