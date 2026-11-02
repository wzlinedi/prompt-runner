// The four re-run choices: what each would send and why one is unavailable (spec FR-075, FR-076, research R44, R48).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rerunChoices, failedRowCount, lastRunRowIds, choiceNote, CHOICES } from '../../app/public/src/rerun.mjs';
import { firstRun, rowsOf, isJudge, rowOf } from '../helpers/run-harness.mjs';

const by = (choices) => Object.fromEntries(choices.map((c) => [c.id, c]));
const sessionOf = ({ run, session }, extra = {}) => ({ ...session, run, dataset: rowsOf(10), confirming: false, ...extra });

test('the choices come in the fixed order with the names of the specification', () => {
  assert.deepEqual(CHOICES.map((c) => c.label), ['Re-run all', 'Re-run failing main prompts and all related judges', 'Re-run all judges', 'Re-run only the failing judges']);
  assert.deepEqual(CHOICES.map((c) => c.mode), ['all', 'failed-main', 'judges-only', 'failed-judges']);
});

test('no run yet: nothing is available and the reason says so', () => {
  const choices = rerunChoices({ run: null, dataset: rowsOf(3), confirming: false });
  assert.ok(choices.every((c) => !c.available && c.reason === 'No run yet'));
  assert.equal(failedRowCount({ run: null }), 0);
});

test('ten rows, one failed judge request: failing judges 1, failing main 0, all judges 20, all 30', async () => {
  const first = await firstRun({ rows: rowsOf(10), respond: (c) => (isJudge(c) && rowOf(c) === '4' && c.payload.messages[0].content.includes('ACCURACY') ? { error: 'x' } : undefined) });
  const choices = by(rerunChoices(sessionOf(first)));
  assert.deepEqual(choices.failedJudges.requests, { main: 0, judges: 1 });
  assert.equal(choices.failedJudges.available, true);
  assert.deepEqual(choices.failedMain.requests, { main: 0, judges: 0 });
  assert.equal(choices.failedMain.available, false);
  assert.equal(choices.failedMain.reason, 'Nothing failed');
  assert.deepEqual(choices.judges.requests, { main: 0, judges: 20 });
  assert.equal(choices.judges.available, true);
  assert.deepEqual(choices.all.requests, { main: 10, judges: 20 });
  assert.equal(choices.all.available, true);
  assert.equal(failedRowCount(sessionOf(first)), 1);
});

test('a row without an output: failing main prompts and their judges give 1 + 2 requests, failing judges none', async () => {
  const first = await firstRun({ rows: rowsOf(5), respond: (c) => (!isJudge(c) && rowOf(c) === '2' ? { error: 'down' } : undefined) });
  const choices = by(rerunChoices(sessionOf(first, { dataset: rowsOf(5) })));
  assert.deepEqual(choices.failedMain.requests, { main: 1, judges: 2 });
  assert.equal(choices.failedJudges.available, false);
  assert.deepEqual(choices.judges.requests, { main: 0, judges: 8 }, 'only rows with an output are graded again');
});

test('a clean run: both failing-only choices say "Nothing failed" and the badge is 0', async () => {
  const first = await firstRun({ rows: rowsOf(3) });
  const choices = by(rerunChoices(sessionOf(first, { dataset: rowsOf(3) })));
  assert.equal(choices.failedMain.reason, 'Nothing failed');
  assert.equal(choices.failedJudges.reason, 'Nothing failed');
  assert.equal(choices.judges.available && choices.all.available, true);
  assert.equal(failedRowCount(sessionOf(first)), 0);
});

test('no row has an output: re-running all judges is unavailable with that reason', async () => {
  const first = await firstRun({ rows: rowsOf(2), respond: (c) => (!isJudge(c) ? { error: 'down' } : undefined) });
  const choices = by(rerunChoices(sessionOf(first, { dataset: rowsOf(2) })));
  assert.equal(choices.judges.available, false);
  assert.equal(choices.judges.reason, 'No row has an output');
  assert.equal(choices.failedMain.available, true);
});

test('while a run is in progress, or a confirmation is open, every choice is unavailable with that reason', async () => {
  const first = await firstRun({ rows: rowsOf(3), respond: (c) => (isJudge(c) && rowOf(c) === '1' ? { error: 'x' } : undefined) });
  for (const status of ['running', 'stopping']) {
    first.run.status = status;
    assert.ok(rerunChoices(sessionOf(first)).every((c) => !c.available && c.reason === 'A run is in progress'), status);
  }
  first.run.status = 'finished';
  assert.ok(rerunChoices(sessionOf(first, { confirming: true })).every((c) => !c.available && c.reason === 'A run is in progress'));
  assert.ok(rerunChoices(sessionOf(first)).some((c) => c.available));
});

test('a stopped run offers the choices like a finished one', async () => {
  const first = await firstRun({ rows: rowsOf(3), respond: (c) => (isJudge(c) && rowOf(c) === '1' ? { error: 'x' } : undefined) });
  first.run.status = 'stopped';
  assert.equal(by(rerunChoices(sessionOf(first))).failedJudges.available, true);
});

test('re-run all uses the rows of the last run that are still loaded; with none left it is unavailable', async () => {
  const first = await firstRun({ rows: rowsOf(4) });
  const session = sessionOf(first, { dataset: rowsOf(4).slice(0, 2) });
  assert.deepEqual(lastRunRowIds(session), ['R1', 'R2']);
  assert.deepEqual(by(rerunChoices(session)).all.requests, { main: 2, judges: 4 });
  const gone = sessionOf(first, { dataset: [] });
  assert.equal(by(rerunChoices(gone)).all.available, false);
  assert.equal(by(rerunChoices(gone)).all.reason, 'The rows of the last run are no longer loaded');
});

test('every choice has a count in its note in every state, followed by its reason when it is unavailable (spec FR-076)', async () => {
  const none = rerunChoices({ run: null, dataset: rowsOf(3), confirming: false });
  assert.deepEqual(none.map(choiceNote), Array(4).fill('0 requests · No run yet'));
  const first = await firstRun({ rows: rowsOf(10), respond: (c) => (isJudge(c) && rowOf(c) === '4' && c.payload.messages[0].content.includes('ACCURACY') ? { error: 'x' } : undefined) });
  const notes = Object.fromEntries(rerunChoices(sessionOf(first)).map((c) => [c.id, choiceNote(c)]));
  assert.deepEqual(notes, { all: '30 requests', failedMain: '0 requests · Nothing failed', judges: '20 requests', failedJudges: '1 request' });
  first.run.status = 'running';
  assert.ok(rerunChoices(sessionOf(first)).every((c) => /^\d+ requests? · A run is in progress$/.test(choiceNote(c))));
});
