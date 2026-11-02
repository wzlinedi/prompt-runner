import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun, countRequests } from '../../app/public/src/runner.mjs';
import { freshSession } from '../../app/public/src/state.mjs';

const KEY = 'nvapi-SECRET-TEST-KEY';
const JUDGE_KEY = 'nvapi-JUDGE-SECRET';
const MAIN_EP = 'https://main.example/v1/chat/completions';
const JUDGE_EP = 'https://judge.example/v1/chat/completions';
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `R${i + 1}`, name: `Case ${i + 1}`, promptInput: `input-${i + 1}`, expectedResult: `EXPECTED-${i + 1}` }));
const isJudge = (call) => call.payload.messages[0].content.includes('SCORE: <number>');
const rowOf = (call) => /input-(\d+)/.exec(call.payload.messages[0].content)?.[1];

function clockHarness() {
  const clock = { t: 1_000_000 };
  return {
    now: () => clock.t,
    date: () => 1_800_000_000_000 + clock.t,
    sleep: (ms) => { const due = clock.t + ms; return new Promise((resolve) => setImmediate(() => { clock.t = Math.max(clock.t, due); resolve(); })); },
  };
}

function sessionWith(sameAsMain = true) {
  const session = freshSession();
  session.config.main = { endpoint: MAIN_EP, apiKey: KEY, params: '{"model":"main-model","temperature":0.5}' };
  session.config.judge = { sameAsMain, endpoint: JUDGE_EP, apiKey: JUDGE_KEY, params: '{"model":"judge-model"}' };
  return session;
}

/** A finished first run to re-run the judges on. `grade` is what the judges first answered. */
async function firstRun({ rows = rowsOf(3), grade = 80, respond } = {}) {
  const time = clockHarness();
  const session = sessionWith();
  const ask = async (call) => {
    if (respond) { const custom = respond(call); if (custom) return custom; }
    return isJudge(call) ? { output: `fine\nSCORE: ${grade}`, cutOff: false } : { output: `OUTPUT-${rowOf(call)}`, cutOff: false };
  };
  const handle = startRun({ dataset: rows, rowIds: rows.map((r) => r.id), prompts: session.prompts, config: session.config, mode: 'full', deps: { ask, ...time }, clearKeys() {} });
  return { run: await handle.done, session, time };
}

function rerun({ run, session, time, respond, prompts, config, clearKeys }) {
  const calls = [];
  const cleared = [];
  const ask = async (call) => {
    const record = { ...call, index: calls.length };
    calls.push(record);
    if (respond) { const custom = await respond(record); if (custom) return custom; }
    return { output: 'new rationale\nSCORE: 90', cutOff: false };
  };
  const handle = startRun({
    previous: run, mode: 'judges-only',
    prompts: prompts ?? session.prompts, config: config ?? session.config,
    deps: { ask, ...time }, clearKeys: clearKeys ?? (() => cleared.push(true)), onUpdate() {},
  });
  return { handle, calls, cleared };
}

test('only judge requests are sent, only for rows with output; the main endpoint gets none', async () => {
  const first = await firstRun({ rows: rowsOf(4), respond: (c) => (!isJudge(c) && rowOf(c) === '2' ? { error: 'boom' } : undefined) });
  const { handle, calls } = rerun(first);
  await handle.done;
  assert.equal(calls.length, 3 * 2);
  assert.ok(calls.every(isJudge));
  assert.ok(calls.every((c) => c.endpoint === MAIN_EP), 'same model: the main endpoint is the judges endpoint');
  assert.ok(calls.every((c) => rowOf(c) !== '2'), 'the row without output is not judged');
});

test('outputs, errors, and similarities are unchanged', async () => {
  const first = await firstRun({ rows: rowsOf(3), respond: (c) => (!isJudge(c) && rowOf(c) === '2' ? { error: 'boom' } : undefined) });
  const before = JSON.stringify(first.run.rows.map((r) => [r.main, r.similarity, r.resolvedPrompt, r.promptInput, r.expectedResult]));
  const { handle } = rerun(first);
  const run = await handle.done;
  assert.equal(JSON.stringify(run.rows.map((r) => [r.main, r.similarity, r.resolvedPrompt, r.promptInput, r.expectedResult])), before);
  assert.equal(run.rows[1].accuracy.state, 'nothing-to-judge');
  assert.equal(run.status, 'finished');
});

test('a changed grade keeps the previous one; an unchanged grade shows none', async () => {
  const first = await firstRun({ rows: rowsOf(2), grade: 80, respond: (c) => (isJudge(c) && rowOf(c) === '2' ? { output: 'x\nSCORE: 90', cutOff: false } : undefined) });
  const { handle } = rerun(first); // everything answers 90 now
  const run = await handle.done;
  assert.equal(run.rows[0].accuracy.grade, 90);
  assert.equal(run.rows[0].accuracy.previousGrade, 80);
  assert.equal(run.rows[0].completeness.previousGrade, 80);
  assert.equal(run.rows[1].accuracy.grade, 90);
  assert.equal(run.rows[1].accuracy.previousGrade, undefined, 'the grade did not change');
  assert.equal(run.rows[0].accuracy.rationale, 'new rationale');
});

test('the snapshot gets the current judge prompts and parameters; times.judges moves, times.main does not', async () => {
  const first = await firstRun({ rows: rowsOf(1) });
  const mainTime = first.run.times.main;
  const judgesTime = first.run.times.judges;
  const mainPrompt = first.run.snapshot.prompts.main;
  const session = sessionWith(false);
  session.prompts.accuracy = 'NEW ACCURACY {prompt_input} {output}';
  session.prompts.main = 'EDITED MAIN {prompt_input}';
  const { handle } = rerun({ ...first, session });
  await new Promise((r) => setTimeout(r, 5));
  const run = await handle.done;
  assert.equal(run.snapshot.prompts.accuracy, 'NEW ACCURACY {prompt_input} {output}');
  assert.equal(run.snapshot.prompts.main, mainPrompt, 'the main prompt of the run is not replaced');
  assert.equal(run.snapshot.models.judges, 'judge-model');
  assert.equal(run.snapshot.judgeSameAsMain, false);
  assert.match(run.snapshot.params.judges, /judge-model/);
  assert.equal(run.times.main, mainTime);
  assert.ok(run.times.judges > judgesTime);
  assert.equal(run.snapshot.rowIds.length, 1);
});

test('own judge endpoint and key are used when the judges do not share the model; nothing else leaks', async () => {
  const first = await firstRun({ rows: rowsOf(1) });
  const { handle, calls } = rerun({ ...first, session: sessionWith(false) });
  const run = await handle.done;
  assert.ok(calls.every((c) => c.endpoint === JUDGE_EP && c.apiKey === JUDGE_KEY && c.payload.model === 'judge-model'));
  const text = JSON.stringify(run);
  for (const secret of [KEY, JUDGE_KEY, MAIN_EP, JUDGE_EP]) assert.ok(!text.includes(secret));
});

test('the judge prompt text uses the current prompts and the stored output', async () => {
  const first = await firstRun({ rows: rowsOf(1) });
  const session = sessionWith();
  session.prompts.completeness = 'COMPLETE? {prompt_input} || {output}';
  const { handle, calls } = rerun({ ...first, session });
  await handle.done;
  const completeness = calls.find((c) => c.payload.messages[0].content.startsWith('COMPLETE?'));
  assert.ok(completeness.payload.messages[0].content.includes('input-1 || OUTPUT-1'));
});

test('Stop keeps new grades for finished rows and previous grades for the rest', async () => {
  const first = await firstRun({ rows: rowsOf(4), grade: 80 });
  const { handle, calls } = rerun({ ...first, respond: (call) => {
    if (call.index < 2) return undefined; // the first two requests finish (row 1, both judges)
    return new Promise((resolve) => call.signal.addEventListener('abort', () => resolve({ aborted: true })));
  } });
  await new Promise((r) => setTimeout(r, 30));
  handle.stop();
  const run = await handle.done;
  assert.equal(run.status, 'stopped');
  assert.equal(run.rows[0].accuracy.grade, 90);
  assert.equal(run.rows[0].completeness.grade, 90);
  for (const row of run.rows.slice(1)) {
    assert.equal(row.accuracy.state, 'ok');
    assert.equal(row.accuracy.grade, 80, 'the previous grade is kept');
    assert.equal(row.accuracy.previousGrade, undefined);
    assert.equal(row.completeness.grade, 80);
  }
  assert.ok(calls.length >= 3 && calls.length <= 6);
});

test('the key is cleared when the re-run ends, fails, or is stopped', async () => {
  const ended = rerun(await firstRun({ rows: rowsOf(1) }));
  await ended.handle.done;
  assert.equal(ended.cleared.length, 1);

  const stopped = rerun({ ...(await firstRun({ rows: rowsOf(2) })), respond: (call) => new Promise((resolve) => call.signal.addEventListener('abort', () => resolve({ aborted: true }))) });
  await new Promise((r) => setTimeout(r, 10));
  stopped.handle.stop();
  await stopped.handle.done;
  assert.equal(stopped.cleared.length, 1);

  const failed = rerun({ ...(await firstRun({ rows: rowsOf(1) })), respond: () => { throw new Error('unexpected'); } });
  const run = await failed.handle.done;
  assert.equal(failed.cleared.length, 1);
  assert.equal(run.status, 'stopped');
  assert.equal(run.rows[0].accuracy.grade, 80, 'previous grades survive a failure');
});

test('a judge error replaces the old verdict; the main output stays', async () => {
  const first = await firstRun({ rows: rowsOf(1) });
  const { handle } = rerun({ ...first, respond: () => ({ error: 'The key was refused (HTTP 403).' }) });
  const run = await handle.done;
  assert.equal(run.rows[0].accuracy.state, 'error');
  assert.equal(run.rows[0].main.output, 'OUTPUT-1');
});

test('unavailable while a run is in progress', async () => {
  const first = await firstRun({ rows: rowsOf(1) });
  first.run.status = 'running';
  assert.throws(() => rerun(first), /while a run is in progress/);
  first.run.status = 'stopping';
  assert.throws(() => rerun(first), /while a run is in progress/);
});

test('the request count is rows with output × 2, all to the judge endpoint', async () => {
  const first = await firstRun({ rows: rowsOf(4), respond: (c) => (!isJudge(c) && rowOf(c) === '3' ? { error: 'x' } : undefined) });
  assert.deepEqual(countRequests({ mode: 'judges-only', rows: first.run.rows }), { main: 0, judges: 6 });
});
