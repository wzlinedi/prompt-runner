import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDataset, defaultSelection, validateSelection, selectAll, selectNone, MAX_ROWS_PER_RUN } from '../../app/public/src/dataset.mjs';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `R${i + 1}`, name: `n${i + 1}`, promptInput: 'x', expectedResult: '' }));

test('the limit is 20 rows per run', () => assert.equal(MAX_ROWS_PER_RUN, 20));

test('default selection: all rows, or the first 20 when there are more', () => {
  assert.deepEqual(defaultSelection(rows(3)), ['R1', 'R2', 'R3']);
  assert.equal(defaultSelection(rows(20)).length, 20);
  const many = defaultSelection(rows(35));
  assert.equal(many.length, 20);
  assert.deepEqual(many.slice(0, 2).concat(many.slice(-1)), ['R1', 'R2', 'R20']);
  assert.deepEqual(defaultSelection([]), []);
});

test('validateSelection: 1 to 20 ids pass; none or more than 20 are refused with the current count', () => {
  assert.deepEqual(validateSelection(['R1']), { ok: true, count: 1 });
  assert.deepEqual(validateSelection(rows(20).map((r) => r.id)), { ok: true, count: 20 });
  assert.deepEqual(validateSelection([]), { ok: false, count: 0, message: 'Select between 1 and 20 rows; 0 are selected now.' });
  assert.deepEqual(validateSelection(rows(21).map((r) => r.id)), { ok: false, count: 21, message: 'Select between 1 and 20 rows; 21 are selected now.' });
  assert.equal(validateSelection(['R1', 'R1']).count, 1, 'a row counts once');
});

test('select all and select none', () => {
  assert.deepEqual(selectAll(rows(3)), ['R1', 'R2', 'R3']);
  assert.equal(selectAll(rows(25)).length, 25, 'select all may exceed the limit; the run is then refused with the count');
  assert.equal(validateSelection(selectAll(rows(25))).ok, false);
  assert.deepEqual(selectNone(), []);
});

test('a dataset with more than 20 rows loads completely', async () => {
  const text = await readFile(new URL('../fixtures/datasets/over-20-rows.txt', import.meta.url), 'utf8');
  const result = parseDataset(text);
  assert.equal(result.ok, true);
  assert.ok(result.rows.length > 20);
  assert.equal(defaultSelection(result.rows).length, 20);
});
