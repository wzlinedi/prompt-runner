// Corrections after the code review (spec User Story 8): the run works on its own copy (FR-039), a stopped
// re-run leaves no row that looks finished (FR-040), and no key stays reachable after a run (FR-016).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun, failedRows, failedRequests, countRequests } from '../../app/public/src/runner.mjs';
import { rerunChoices } from '../../app/public/src/rerun.mjs';
import { firstRun, clockHarness, sessionWith, rowsOf, isJudge, rowOf, KEY, JUDGE_KEY } from '../helpers/run-harness.mjs';

test('editing the prompts object after the start does not change the requests of the run (FR-039)', async () => {
  const session = sessionWith();
  const calls = [];
  const time = clockHarness();
  const original = session.prompts.accuracy;
  const ask = async (call) => {
    calls.push(call);
    if (!isJudge(call)) {
      session.prompts.accuracy = 'half typed';   // the user keeps typing in the editor while the main phase runs
      session.prompts.completeness = 'half typed too';
      session.prompts.main = 'changed {prompt_input}';
      return { output: `OUT-${rowOf(call)}`, cutOff: false };
    }
    return { output: 'fine\nSCORE: 90', cutOff: false };
  };
  const rows = rowsOf(2);
  const handle = startRun({ dataset: rows, rowIds: rows.map((r) => r.id), prompts: session.prompts, config: session.config, mode: 'full', deps: { ask, ...time }, clearKeys() {} });
  const run = await handle.done;
  const judges = calls.filter(isJudge);
  assert.equal(judges.length, 4);
  assert.ok(judges.every((c) => !c.payload.messages[0].content.includes('half typed')), 'no half-typed text was sent');
  assert.ok(judges.some((c) => c.payload.messages[0].content.startsWith(original.slice(0, 40))), 'the judge prompt of the start was sent');
  assert.equal(run.snapshot.prompts.accuracy, original, 'the archive shows the prompt the run used');
  assert.equal(run.snapshot.prompts.main.startsWith('changed'), false);
});

const mainFailsForSecondRow = () => firstRun({ rows: rowsOf(2), respond: (c) => (!isJudge(c) && rowOf(c) === '2' ? { error: 'Rate limit exceeded (HTTP 429).' } : undefined) });

test('a re-run stopped between the main answer and the judges leaves the row failed, listed and sent consistently (FR-040)', async () => {
  const first = await mainFailsForSecondRow();
  assert.deepEqual(failedRows(first.run).map((r) => r.rowId), ['R2']);
  assert.equal(first.run.rows[1].accuracy.state, 'nothing-to-judge');

  const time = clockHarness();
  let handle;
  const ask = async (call) => {
    if (isJudge(call)) { handle.stop(); return { aborted: true }; }  // Stop pressed before any judge answered
    return { output: 'NEW-OUTPUT-2', cutOff: false };
  };
  handle = startRun({ previous: first.run, mode: 'failed-main', prompts: first.session.prompts, config: first.session.config, deps: { ask, ...time }, clearKeys() {}, onUpdate() {} });
  const run = await handle.done;

  const row = run.rows[1];
  assert.equal(run.status, 'stopped');
  assert.equal(row.main.state, 'ok');
  assert.equal(row.main.output, 'NEW-OUTPUT-2');
  assert.equal(row.accuracy.state, 'not-run', 'never "nothing to judge" next to a real output');
  assert.equal(row.completeness.state, 'not-run');
  assert.deepEqual(failedRows(run).map((r) => r.rowId), ['R2'], 'the row still counts as failed');
  assert.equal(rerunChoices({ run, dataset: rowsOf(2), confirming: false }).find((c) => c.id === 'failedJudges').available, true, 'the re-run of the failing judges is still available');

  const listed = failedRequests(run.rows);
  assert.deepEqual(listed.map((r) => r.part), ['Accuracy', 'Completeness']);
  assert.deepEqual(countRequests({ mode: 'failed-judges', rows: run.rows }), { main: 0, judges: 2 });
  assert.deepEqual(countRequests({ mode: 'failed-main', rows: run.rows }), { main: 0, judges: 0 });

  // What the next re-run really sends equals what was listed.
  const sent = [];
  const next = startRun({ previous: run, mode: 'failed-judges', prompts: first.session.prompts, config: first.session.config,
    deps: { ask: async (c) => { sent.push(c); return { output: 'ok\nSCORE: 60', cutOff: false }; }, ...time }, clearKeys() {}, onUpdate() {} });
  const finished = await next.done;
  assert.equal(sent.length, listed.length);
  assert.ok(sent.every(isJudge) && sent.every((c) => rowOf(c) === '2'));
  assert.deepEqual(failedRows(finished), []);
});

test('a judge that fails on a row with an output, and one that was "nothing to judge" by mistake, are the same kind of failure (FR-040)', async () => {
  const first = await firstRun({ rows: rowsOf(2) });
  first.run.rows[0].accuracy = { state: 'nothing-to-judge' }; // the stray state of the review's reproduction
  first.run.status = 'stopped';
  assert.deepEqual(failedRows(first.run).map((r) => r.rowId), ['R1']);
  assert.deepEqual(failedRequests(first.run.rows).map((r) => `${r.rowId}:${r.part}`), ['R1:Accuracy']);
});

test('after a run no key is reachable from the run or from the handle (FR-016)', async () => {
  const session = sessionWith(false);
  const rows = rowsOf(2);
  const time = clockHarness();
  const cleared = [];
  const handle = startRun({ dataset: rows, rowIds: ['R1', 'R2'], prompts: session.prompts, config: session.config, mode: 'full',
    deps: { ask: async (c) => (isJudge(c) ? { output: 'fine\nSCORE: 50', cutOff: false } : { output: 'x', cutOff: false }), ...time }, clearKeys: () => cleared.push(true) });
  const run = await handle.done;
  assert.equal(cleared.length, 1);
  for (const secret of [KEY, JUDGE_KEY]) {
    assert.ok(!JSON.stringify(run).includes(secret), 'not in the run');
    assert.ok(!JSON.stringify(Object.entries(handle).map(([k, v]) => [k, typeof v === 'function' ? v.toString() : v])).includes(secret), 'not in the handle');
  }
  assert.ok(!JSON.stringify(run.snapshot).includes('example/v1'), 'no endpoint in the archive either');
});

test('stopping a run and a stopped run keep no key in the run either (FR-016)', async () => {
  const session = sessionWith();
  const rows = rowsOf(3);
  const time = clockHarness();
  let handle;
  const ask = async (call) => { if (isJudge(call)) { handle.stop(); return { aborted: true }; } return { output: 'x', cutOff: false }; };
  handle = startRun({ dataset: rows, rowIds: ['R1', 'R2', 'R3'], prompts: session.prompts, config: session.config, mode: 'full', deps: { ask, ...time }, clearKeys() {} });
  const run = await handle.done;
  assert.equal(run.status, 'stopped');
  assert.ok(!JSON.stringify(run).includes(KEY));
});

test('Stop with 20 rows and requests in flight ends the run in under a second, unfinished rows "not run" (FR-047)', async () => {
  const session = sessionWith();
  const rows = rowsOf(20);
  const time = clockHarness();
  let started = 0;
  // Every request stays pending until it is aborted, as when the platform is slow.
  const ask = ({ signal }) => new Promise((resolve) => { started += 1; signal.addEventListener('abort', () => resolve({ aborted: true }), { once: true }); });
  const handle = startRun({ dataset: rows, rowIds: rows.map((r) => r.id), prompts: session.prompts, config: session.config, mode: 'full', deps: { ask, ...time }, clearKeys() {} });
  while (started < 4) await new Promise((resolve) => setImmediate(resolve)); // four requests in flight: the most the runner allows
  const before = performance.now();
  handle.stop();
  const run = await handle.done;
  const took = performance.now() - before;
  assert.ok(took < 1000, `Stop took ${Math.round(took)} ms`);
  assert.equal(run.status, 'stopped');
  assert.equal(run.rows.length, 20);
  assert.ok(run.rows.every((r) => r.main.state === 'not-run'), 'no row is left pending or running');
  assert.equal(started, 4, 'no request was started after Stop');
});
