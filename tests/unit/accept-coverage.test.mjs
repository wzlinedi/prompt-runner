// Every row of the quickstart has a check or a human entry, and no entry is left without a row (spec FR-059, research R35).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROWS, EXTRA, HUMAN, quickstartRows, coverageProblems } from '../accept/rows.mjs';
import { CHECKS } from '../accept/checks/index.mjs';

const quickstart = await readFile(new URL('../../specs/001-simple-prompt-runner/quickstart.md', import.meta.url), 'utf8');
const ids = CHECKS.map((c) => c.id);

test('the quickstart is fully covered by the registered checks', () => {
  assert.deepEqual(coverageProblems(quickstart, ids), []);
});

test('the rows of the quickstart are read from its tables (section 3), without the header', () => {
  const rows = quickstartRows(quickstart);
  assert.ok(rows.length >= 28, `${rows.length} rows read`);
  assert.ok(rows.includes('Exports') && rows.includes('Keyboard only') && !rows.includes('Check'));
});

test('a row without a check, a check that is not registered, and an entry without a row are all reported', () => {
  const withNewRow = quickstart.replace('| Keyboard only |', '| A brand new row | somewhere | something |\n| Keyboard only |');
  assert.match(coverageProblems(withNewRow, ids).join(), /the quickstart row "A brand new row" has no check and no human entry/);
  assert.match(coverageProblems(quickstart, ids.filter((id) => id !== 'flow.stop')).join(), /"Stop" names the check flow\.stop, which no module registers/);
  assert.match(coverageProblems(quickstart.replace(/^\| Stop \|.*\n/m, ''), ids).join(), /"Stop" is mapped but is not a row of the quickstart/);
});

test('the three items that stay with a human are listed, each with a reason', () => {
  const human = Object.entries(EXTRA).filter(([, v]) => typeof v !== 'string');
  assert.equal(human.length, 3);
  for (const [, v] of human) assert.ok(v.human.length > 20);
  assert.deepEqual(Object.keys(HUMAN).sort(), ['live', 'look', 'usability']);
});

test('the check ids are unique, every check names its group, and every mapped row points at a check of its own', () => {
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CHECKS) assert.ok(c.id.startsWith(`${c.group}.`) && typeof c.run === 'function', c.id);
  for (const [row, id] of Object.entries(ROWS)) assert.equal(CHECKS.find((c) => c.id === id)?.row, row, `${id} answers "${row}"`);
});
