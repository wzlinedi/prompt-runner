import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDataset, tokenize, detectSeparator, shorten, stripBom } from '../../app/public/src/dataset.mjs';

const fixture = (name) => readFileSync(new URL(`../fixtures/datasets/${name}`, import.meta.url), 'utf8');

test('separator detection reads the first line: tab, then semicolon, then comma', () => {
  assert.equal(detectSeparator(fixture('tab.txt')).name, 'tab');
  assert.equal(detectSeparator(fixture('semicolon.txt')).name, 'semicolon');
  assert.equal(detectSeparator(fixture('comma-quoted.txt')).name, 'comma');
  assert.equal(detectSeparator('id,name,prompt_input'), null);
  assert.equal(detectSeparator('ID,Name,PROMPT_INPUT,Expected_Result\n').name, 'comma', 'names are matched ignoring letter case');
});

test('tokenizer: a quote opens a value only at its start, "" is a quote, separators and line breaks inside quotes are kept', () => {
  assert.deepEqual(tokenize('a,"b,c",d', ','), [['a', 'b,c', 'd']]);
  assert.deepEqual(tokenize('a,"he said ""hi""",c', ','), [['a', 'he said "hi"', 'c']]);
  assert.deepEqual(tokenize('a,"x\ny",c', ','), [['a', 'x\ny', 'c']]);
  assert.deepEqual(tokenize('a,5" screen,c', ','), [['a', '5" screen', 'c']], 'a quote in the middle of a value is ordinary text');
  assert.deepEqual(tokenize('a;b\r\nc;d\re;f\ng;h', ';'), [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']], 'CRLF, CR, and LF end records');
  assert.deepEqual(tokenize('a,b\n\n\nc,d\n', ','), [['a', 'b'], ['c', 'd']], 'empty lines are ignored');
});

test('a tab-separated text from a spreadsheet loads with commas, quotes, and line breaks intact', () => {
  const r = parseDataset(fixture('tab.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.separator, 'tab');
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows[0].promptInput.includes('Population, total\n36 497 495'));
  assert.ok(r.rows[0].promptInput.includes('\tPoland\n'), 'tabs inside a quoted value are kept');
  assert.ok(r.rows[0].expectedResult.includes('"high"'));
});

test('semicolon and comma files, quoting, and multi-line values', () => {
  const s = parseDataset(fixture('semicolon.txt'));
  assert.equal(s.ok, true);
  assert.deepEqual(s.rows.map((x) => x.promptInput), ['Poland, France, Germany', 'Vistula; Oder']);
  const c = parseDataset(fixture('comma-quoted.txt'));
  assert.equal(c.ok, true);
  assert.equal(c.rows[0].promptInput, 'Poland, France, Germany');
  assert.equal(c.rows[1].promptInput, 'He said "hello", then left');
  assert.equal(c.rows[1].expectedResult, 'line one\nline two');
});

test('a quote in the middle of an unquoted value is kept as ordinary text', () => {
  const r = parseDataset(fixture('quote-in-middle.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].promptInput, 'a 5" screen and a 7" screen');
});

test('a byte-order mark at the start (files saved by spreadsheets) does not break the header', () => {
  assert.equal(stripBom('﻿id').length, 2);
  const r = parseDataset(fixture('bom.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].id, 'BM1');
});

test('empty text', () => {
  assert.deepEqual(parseDataset(''), { ok: false, errors: ['The dataset is empty.'] });
  assert.deepEqual(parseDataset('   \n \n'), { ok: false, errors: ['The dataset is empty.'] });
});

test('no header: the message names what is missing and lists the separators', () => {
  const r = parseDataset(fixture('missing-column.txt'));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^No header with the columns id, name, prompt_input, expected_result was recognized \(missing: expected_result\)\./);
  assert.match(r.errors[0], /The separator may be a tab, a semicolon, or a comma\.$/);
  assert.match(parseDataset('hello world').errors[0], /^No header with the columns .* was recognized\. The separator/, 'no "(missing: …)" when nothing matches');
});

test('a record with the wrong number of columns: record number, separator, likely cause, similar records; nothing is loaded', () => {
  const r = parseDataset(fixture('broken-columns.txt'));
  assert.equal(r.ok, false);
  assert.equal(r.rows, undefined);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^Record 1 has 6 columns instead of 4 \(separator: comma\)\./);
  assert.match(r.errors[0], /Most likely cause: a value that contains the comma is not wrapped in double quotes\./);
  assert.match(r.errors[0], /Tip: copy the cells from a spreadsheet \(tabs\) or wrap such a value in "double quotes"\./);
  assert.match(r.errors[0], /Similar records: 2\.$/);
});

test('a header with no rows', () => {
  assert.deepEqual(parseDataset(fixture('header-only.txt')), { ok: false, errors: ['The dataset has no rows.'] });
});

test('per-record problems are listed together: empty or duplicate id, empty name, empty prompt_input', () => {
  const dup = parseDataset(fixture('duplicate-id.txt'));
  assert.deepEqual(dup, { ok: false, errors: ['Errors in the dataset: row 3: duplicate id "X1".'] });
  const name = parseDataset(fixture('empty-name.txt'));
  assert.deepEqual(name, { ok: false, errors: ['Errors in the dataset: row 1: empty name.'] });
  const many = parseDataset('id,name,prompt_input,expected_result\n,,,x\nA,B,,y\nA,C,in,z\n');
  assert.deepEqual(many.errors, ['Errors in the dataset: row 1: empty id; row 1: empty name; row 1: empty prompt_input; row 2: empty prompt_input; row 3: duplicate id "A".']);
});

test('a row with an empty expected_result is accepted and flagged', () => {
  const r = parseDataset(fixture('empty-expected.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.rows[1].expectedResult, '');
  assert.deepEqual(r.notes, ['1 without expected_result (similarity: "no expected result")']);
  assert.deepEqual(parseDataset(fixture('comma-quoted.txt')).notes, []);
});

test('row fields: id, name, promptInput, expectedResult', () => {
  const r = parseDataset(fixture('comma-quoted.txt'));
  assert.deepEqual(Object.keys(r.rows[0]), ['id', 'name', 'promptInput', 'expectedResult']);
});

test('a dataset with more than 20 rows loads completely', () => {
  const r = parseDataset(fixture('over-20-rows.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 25);
});

test('a value of more than 100,000 characters is kept complete, with its line breaks', () => {
  const r = parseDataset(fixture('long-value.txt'));
  assert.equal(r.ok, true);
  assert.ok(r.rows[0].promptInput.length >= 100_000, `kept ${r.rows[0].promptInput.length} characters`);
  assert.ok(r.rows[0].promptInput.includes('\n'));
  assert.ok(r.rows[0].promptInput.startsWith('0123456789 abcdefghij\n0123456789'));
});

test('long values are shortened with their length', () => {
  assert.deepEqual(shorten('short'), { text: 'short', length: 5, truncated: false });
  const s = shorten('word '.repeat(100));
  assert.equal(s.truncated, true);
  assert.equal(s.length, 500);
  assert.ok(s.text.length <= 110);
});

// ---- Corrections after the code review (spec FR-003, FR-004, User Story 8, scenarios 3 and 4) ----

test('a quoted value that is never closed is an error naming the record; nothing is loaded and no record is absorbed', () => {
  const last = parseDataset('id,name,prompt_input,expected_result\n1,a,b,"oops\n2,c,d,e\n3,f,g,h\n');
  assert.equal(last.ok, false);
  assert.equal(last.rows, undefined);
  assert.match(last.errors[0], /^Record 1 starts a value in double quotes that is never closed\./);

  const second = parseDataset('id,name,prompt_input,expected_result\n1,a,b,c\n2,"d,e,f\n3,g,h,i');
  assert.equal(second.ok, false);
  assert.match(second.errors[0], /^Record 2 starts a value/);

  const tabbed = parseDataset('id\tname\tprompt_input\texpected_result\n1\ta\t"never closed\t\n2\tb\tc\td');
  assert.match(tabbed.errors[0], /^Record 1 starts a value/);
});

test('a closed quote followed by more quoted values, and a lone quote inside an unquoted value, are still fine', () => {
  const ok = parseDataset('id,name,prompt_input,expected_result\n1,a,"he said ""hi""","x"\n2,b,5" tall,y\n');
  assert.equal(ok.ok, true);
  assert.equal(ok.rows[0].promptInput, 'he said "hi"');
  assert.equal(ok.rows[1].promptInput, '5" tall');
});

test('header names may be wrapped in double quotes, with every separator', () => {
  for (const [sep, name] of [[',', 'comma'], [';', 'semicolon'], ['\t', 'tab']]) {
    const text = ['"id"', '"name"', '"prompt_input"', '"expected_result"'].join(sep) + '\n' + ['1', 'a', 'b', 'c'].join(sep);
    const result = parseDataset(text);
    assert.equal(result.ok, true, name);
    assert.equal(result.separator, name);
    assert.deepEqual(result.rows, [{ id: '1', name: 'a', promptInput: 'b', expectedResult: 'c' }]);
  }
  assert.equal(detectSeparator('"ID","Name ","Prompt_Input","Expected_Result"\n1,a,b,c').name, 'comma', 'letter case and spaces inside the names are ignored');
});

test('line breaks may be CR+LF, LF, or CR alone, in the header and in the data', () => {
  for (const eol of ['\r\n', '\n', '\r']) {
    const result = parseDataset(`id,name,prompt_input,expected_result${eol}1,a,b,c${eol}2,d,"two${eol}lines",e${eol}`);
    assert.equal(result.ok, true, JSON.stringify(eol));
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[1].promptInput, `two${eol}lines`, 'a line break inside a quoted value is kept');
  }
});

test('a header that is not recognised still names what is missing, also with CR-only line breaks', () => {
  const result = parseDataset('id,name\r1,a\r');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /No header with the columns id, name, prompt_input, expected_result was recognized \(missing: prompt_input, expected_result\)/);
});

test('tokenize still returns an array of records (the exports are re-read with it)', () => {
  assert.deepEqual(tokenize('a,b\r\n"c,d",e\n\n', ','), [['a', 'b'], ['c,d', 'e']]);
});
