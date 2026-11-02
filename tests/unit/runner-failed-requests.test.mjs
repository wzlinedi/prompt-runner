import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun, countRequests, failedRows, failedRequests } from '../../app/public/src/runner.mjs';
import { rerunChoices } from '../../app/public/src/rerun.mjs';
import { firstRun, sessionWith, rowsOf, isJudge, rowOf, MAIN_EP, JUDGE_EP, KEY, JUDGE_KEY } from '../helpers/run-harness.mjs';

/** R2: main error. R3: main ok, Accuracy judge error. R4: all ok. R5: main ok, both judges "not run" style errors. */
const failingFirstRun = () => firstRun({ rows: rowsOf(5), respond: (call) => {
  if (!isJudge(call) && rowOf(call) === '2') return { error: 'Rate limit exceeded (HTTP 429).' };
  if (isJudge(call) && rowOf(call) === '3' && call.payload.messages[0].content.includes('ACCURACY')) return { error: 'Platform or network problem (HTTP 500).' };
  if (isJudge(call) && rowOf(call) === '5') return { output: 'no score', cutOff: false };
  return undefined;
} });

/**
 * Re-runs the failed requests the way the two choices of the page do, one after the other: `failed-main` (rows without an
 * output, with their judges), then `failed-judges` (the judge requests still missing). Together they send what the former
 * single mode sent. The second one is skipped when the first did not finish (stopped or failed).
 */
function rerunFailed({ run, session, time }, { respond, config, clearKeys, prompts } = {}) {
  const calls = [];
  const cleared = [];
  const ask = async (call) => {
    const record = { ...call, index: calls.length };
    calls.push(record);
    if (respond) { const custom = await respond(record); if (custom) return custom; }
    return isJudge(record) ? { output: 'again\nSCORE: 70', cutOff: false } : { output: `NEW-OUTPUT-${rowOf(record)}`, cutOff: false };
  };
  const start = (mode) => startRun({ previous: run, mode, prompts: prompts ?? session.prompts, config: config ?? session.config,
    deps: { ask, ...time }, clearKeys: clearKeys ?? (() => cleared.push(mode)), onUpdate() {} });
  let active = start('failed-main');
  const handle = {
    stop: () => active.stop(),
    done: (async () => {
      const first = await active.done;
      if (first.status !== 'finished') return first;
      active = start('failed-judges');
      return active.done;
    })(),
  };
  return { handle, calls, cleared };
}

/** Whether the page would offer the failing-only choices for this run (spec FR-076). */
const offered = (run, dataset = rowsOf(5)) => Object.fromEntries(rerunChoices({ run, dataset, confirming: false }).filter((c) => c.id.startsWith('failed')).map((c) => [c.id, c.available]));

test('a failed row has no output (error or not run), or output and a judge verdict that is not ok', async () => {
  const first = await failingFirstRun();
  assert.deepEqual(failedRows(first.run).map((r) => r.rowId), ['R2', 'R3', 'R5']);
  assert.deepEqual(offered(first.run), { failedMain: true, failedJudges: true });

  const clean = await firstRun({ rows: rowsOf(2) });
  assert.deepEqual(failedRows(clean.run), []);
  assert.deepEqual(offered(clean.run, rowsOf(2)), { failedMain: false, failedJudges: false }, 'not available when nothing failed');

  first.run.status = 'running';
  assert.deepEqual(offered(first.run), { failedMain: false, failedJudges: false }, 'not available while a run is in progress');
  first.run.status = 'stopped';
  assert.deepEqual(offered(first.run), { failedMain: true, failedJudges: true }, 'available after a stopped run');
});

test('a row with an empty but successful answer is not a failed row', async () => {
  const first = await firstRun({ rows: rowsOf(2), respond: (c) => (!isJudge(c) && rowOf(c) === '1' ? { output: '', cutOff: false } : undefined) });
  assert.deepEqual(failedRows(first.run), []);
});

test('the main prompt is called only for rows without output; each judge only where a valid grade is missing', async () => {
  const first = await failingFirstRun();
  const { handle, calls } = rerunFailed(first);
  await handle.done;
  const main = calls.filter((c) => !isJudge(c));
  const judges = calls.filter(isJudge);
  assert.deepEqual(main.map(rowOf), ['2']);
  const forRow = (n) => judges.filter((c) => rowOf(c) === n);
  assert.equal(forRow('2').length, 2, 'R2 got its output, so both judges run');
  assert.equal(forRow('3').length, 1);
  assert.ok(forRow('3')[0].payload.messages[0].content.includes('ACCURACY'));
  assert.equal(forRow('5').length, 2, 'R5: both judge answers were unreadable');
  assert.equal(forRow('1').length + forRow('4').length, 0, 'rows that succeeded are not touched');
  assert.equal(calls.length, 1 + 2 + 1 + 2);
});

test('rows that succeeded are untouched; failed rows are completed', async () => {
  const first = await failingFirstRun();
  const untouched = JSON.stringify([first.run.rows[0], first.run.rows[3]]);
  const { handle } = rerunFailed(first);
  const run = await handle.done;
  assert.equal(JSON.stringify([run.rows[0], run.rows[3]]), untouched);
  assert.equal(run.rows[1].main.state, 'ok');
  assert.equal(run.rows[1].main.output, 'NEW-OUTPUT-2');
  assert.equal(typeof run.rows[1].similarity, 'number', 'the similarity of the new answer is computed');
  assert.equal(run.rows[1].accuracy.grade, 70);
  assert.equal(run.rows[2].accuracy.grade, 70);
  assert.equal(run.rows[2].completeness.grade, 80, 'the valid grade of the other judge stays');
  assert.equal(run.rows[4].completeness.grade, 70);
  assert.deepEqual(failedRows(run), []);
  assert.equal(run.status, 'finished');
});

test('a row that fails again stays failed, with nothing to judge', async () => {
  const first = await failingFirstRun();
  const { handle } = rerunFailed(first, { respond: (c) => (!isJudge(c) ? { error: 'still down' } : undefined) });
  const run = await handle.done;
  assert.equal(run.rows[1].main.state, 'error');
  assert.equal(run.rows[1].main.error, 'still down');
  assert.equal(run.rows[1].accuracy.state, 'nothing-to-judge');
  assert.deepEqual(failedRows(run).map((r) => r.rowId), ['R2']);
});

test('the main request uses the archived main prompt and parameters; the judge requests use the edited judge prompt (spec FR-035, scenario 7)', async () => {
  const first = await failingFirstRun();
  const edited = sessionWith();
  edited.prompts.main = 'EDITED MAIN {prompt_input}';
  edited.prompts.accuracy = 'EDITED ACCURACY {prompt_input} {output}';
  edited.config.main.params = '{"model":"other-model","temperature":0.1}';
  const { handle, calls } = rerunFailed(first, { config: edited.config, prompts: edited.prompts });
  const run = await handle.done;
  const main = calls.filter((c) => !isJudge(c));
  assert.ok(main.every((c) => !c.payload.messages[0].content.includes('EDITED MAIN') && c.payload.messages[0].content.startsWith('Summarize below data.')), 'the main prompt is the archived one');
  assert.ok(calls.every((c) => c.payload.model === 'main-model' && c.payload.temperature === 0.5), 'model and parameters are the archived ones');
  const accuracy = calls.filter((c) => isJudge(c) && c.payload.messages[0].content.includes('EDITED ACCURACY'));
  const completeness = calls.filter((c) => isJudge(c) && !c.payload.messages[0].content.includes('EDITED ACCURACY'));
  assert.ok(accuracy.length >= 3, 'the Accuracy requests carry the edited prompt');
  assert.ok(completeness.length >= 1 && completeness.every((c) => c.payload.messages[0].content.includes('COMPLETENESS')), 'the Completeness prompt was not edited');
  assert.equal(run.snapshot.prompts.main, first.session.prompts.main);
  assert.equal(run.snapshot.models.main, 'main-model');
});

test('judge prompt versions: kept grades keep their version, new grades get the new one (data-model: Snapshot)', async () => {
  const first = await failingFirstRun();
  assert.deepEqual(first.run.snapshot.judgePromptVersions.accuracy, [first.session.prompts.accuracy]);
  const edited = sessionWith();
  edited.prompts.accuracy = 'EDITED ACCURACY {prompt_input} {output}';
  const run = await rerunFailed(first, { prompts: edited.prompts }).handle.done;
  const versions = run.snapshot.judgePromptVersions.accuracy;
  assert.deepEqual(versions, [first.session.prompts.accuracy, 'EDITED ACCURACY {prompt_input} {output}']);
  assert.equal(run.rows[0].accuracy.version, 0, 'R1 kept its grade from the original prompt');
  assert.equal(run.rows[3].accuracy.version, 0);
  assert.equal(run.rows[2].accuracy.version, 1, 'R3 was re-run with the edited prompt');
  assert.equal(run.rows[1].accuracy.version, 1);
  assert.equal(run.snapshot.prompts.accuracy, 'EDITED ACCURACY {prompt_input} {output}');
  assert.deepEqual(run.snapshot.judgePromptVersions.completeness, [first.session.prompts.completeness], 'an unchanged prompt adds no version');
});

test('judge prompt versions: a version without any remaining grade is dropped and the grades are renumbered', async () => {
  const first = await firstRun({ rows: rowsOf(2), respond: (c) => (isJudge(c) && c.payload.messages[0].content.includes('ACCURACY') ? { output: 'no score at all', cutOff: false } : undefined) });
  assert.ok(first.run.rows.every((r) => r.accuracy.state === 'error'));
  const edited = sessionWith();
  edited.prompts.accuracy = 'FIXED ACCURACY {prompt_input} {output}';
  const run = await rerunFailed(first, { prompts: edited.prompts }).handle.done;
  assert.deepEqual(run.snapshot.judgePromptVersions.accuracy, ['FIXED ACCURACY {prompt_input} {output}']);
  assert.ok(run.rows.every((r) => r.accuracy.state === 'ok' && r.accuracy.version === 0));
});

test('a re-run with the same prompts adds no version', async () => {
  const first = await failingFirstRun();
  const run = await rerunFailed(first).handle.done;
  assert.equal(run.snapshot.judgePromptVersions.accuracy.length, 1);
  assert.equal(run.snapshot.judgePromptVersions.completeness.length, 1);
});

test('model, parameters, and the "same model" choice come from the snapshot; endpoints and keys from the current configuration', async () => {
  const first = await failingFirstRun(); // judges shared the main model
  const current = sessionWith(false); // now configured as separate judges
  current.config.main.endpoint = 'https://new-main.example/v1/chat/completions';
  current.config.main.apiKey = 'nvapi-NEW-MAIN-KEY';
  const { handle, calls } = rerunFailed(first, { config: current.config });
  await handle.done;
  assert.ok(calls.every((c) => c.endpoint === 'https://new-main.example/v1/chat/completions' && c.apiKey === 'nvapi-NEW-MAIN-KEY'), 'the snapshot says the judges shared the main model: main endpoint and key');
  assert.ok(calls.every((c) => c.payload.model === 'main-model'));

  const separate = await firstRun({ rows: rowsOf(2), session: sessionWith(false), respond: (c) => (isJudge(c) && rowOf(c) === '1' ? { error: 'x' } : undefined) });
  const now = sessionWith(true);
  now.config.judge = { sameAsMain: false, endpoint: 'https://new-judge.example/v1/chat/completions', apiKey: 'nvapi-NEW-JUDGE-KEY', params: '{"model":"changed"}' };
  now.config.judge.sameAsMain = false;
  const again = rerunFailed(separate, { config: now.config });
  await again.handle.done;
  assert.ok(again.calls.every(isJudge));
  assert.ok(again.calls.every((c) => c.endpoint === 'https://new-judge.example/v1/chat/completions' && c.apiKey === 'nvapi-NEW-JUDGE-KEY'));
  assert.ok(again.calls.every((c) => c.payload.model === 'judge-model'), 'the judge model comes from the snapshot');
});

test('generation dates show the latest run of each prompt', async () => {
  const first = await failingFirstRun();
  const { main, judges } = first.run.times;
  const { handle } = rerunFailed(first);
  const run = await handle.done;
  assert.ok(run.times.main > main);
  assert.ok(run.times.judges > judges);

  const judgesOnlyFailed = await firstRun({ rows: rowsOf(2), respond: (c) => (isJudge(c) && rowOf(c) === '1' ? { error: 'x' } : undefined) });
  const mainBefore = judgesOnlyFailed.run.times.main;
  const second = rerunFailed(judgesOnlyFailed);
  const run2 = await second.handle.done;
  assert.equal(run2.times.main, mainBefore, 'no main request was sent: the main date stays');
});

test('countRequests for failed rows', async () => {
  const first = await failingFirstRun();
  assert.deepEqual(countRequests({ mode: 'failed-main', rows: first.run.rows }), { main: 1, judges: 2 });
  assert.deepEqual(countRequests({ mode: 'failed-judges', rows: first.run.rows }), { main: 0, judges: 1 + 2 });
});

test('unavailable while a run is in progress', async () => {
  const first = await failingFirstRun();
  first.run.status = 'running';
  assert.throws(() => rerunFailed(first), /while a run is in progress/);
});

test('keys are cleared when the re-run ends, fails, or is stopped', async () => {
  const ended = rerunFailed(await failingFirstRun());
  await ended.handle.done;
  assert.deepEqual(ended.cleared, ['failed-main', 'failed-judges'], 'each of the two runs clears the keys once');

  const stopped = rerunFailed(await failingFirstRun(), { respond: (c) => new Promise((resolve) => c.signal.addEventListener('abort', () => resolve({ aborted: true }))) });
  await new Promise((r) => setTimeout(r, 10));
  stopped.handle.stop();
  const stoppedRun = await stopped.handle.done;
  assert.equal(stopped.cleared.length, 1, 'a stopped run clears the keys and the second kind is not started');
  assert.equal(stoppedRun.status, 'stopped');
  assert.equal(stoppedRun.rows[1].main.state, 'error', 'an aborted row keeps its earlier state');
  assert.equal(stoppedRun.rows[1].main.error, 'Rate limit exceeded (HTTP 429).');

  const failed = rerunFailed(await failingFirstRun(), { respond: () => { throw new Error('unexpected'); } });
  const run = await failed.handle.done;
  assert.equal(failed.cleared.length, 1);
  assert.equal(run.status, 'stopped');
  assert.equal(run.rows[1].main.state, 'error');
});

test('no secret reaches the run object', async () => {
  const first = await failingFirstRun();
  const { handle } = rerunFailed(first);
  const run = await handle.done;
  const text = JSON.stringify(run);
  for (const secret of [KEY, JUDGE_KEY, MAIN_EP, JUDGE_EP]) assert.ok(!text.includes(secret));
});

test('failedRequests: two rows with one failed judge give exactly that one request (spec SC-019)', async () => {
  const first = await firstRun({ rows: rowsOf(2), respond: (c) => (isJudge(c) && rowOf(c) === '2' && c.payload.messages[0].content.includes('ACCURACY') ? { error: 'Platform or network problem (HTTP 500).' } : undefined) });
  assert.deepEqual(failedRequests(first.run.rows), [{ rowId: 'R2', name: 'Case 2', part: 'Accuracy' }]);
  const { handle, calls } = rerunFailed(first);
  await handle.done;
  assert.equal(calls.length, 1);
  assert.ok(isJudge(calls[0]) && rowOf(calls[0]) === '2' && calls[0].payload.messages[0].content.includes('ACCURACY'));
});

test('failedRequests: a row without output gives its main request and both judges, in the order of the rows', async () => {
  const first = await failingFirstRun();
  assert.deepEqual(failedRequests(first.run.rows).map((r) => `${r.rowId}:${r.part}`), ['R2:main', 'R2:Accuracy', 'R2:Completeness', 'R3:Accuracy', 'R5:Accuracy', 'R5:Completeness']);
});

test('failedRequests: nothing failed gives an empty list; its length equals the request count', async () => {
  assert.deepEqual(failedRequests((await firstRun({ rows: rowsOf(2) })).run.rows), []);
  const first = await failingFirstRun();
  for (const [mode, kind] of [['failed-main', 'main'], ['failed-judges', 'judges']]) {
    const counts = countRequests({ mode, rows: first.run.rows });
    assert.equal(counts.main + counts.judges, failedRequests(first.run.rows, kind).length);
  }
  assert.equal(failedRequests(first.run.rows).length, failedRequests(first.run.rows, 'main').length + failedRequests(first.run.rows, 'judges').length, 'the two kinds never overlap');
});

function rerunMode(first, mode) {
  const calls = [];
  const ask = async (call) => { calls.push(call); return isJudge(call) ? { output: 'again\nSCORE: 70', cutOff: false } : { output: `NEW-OUTPUT-${rowOf(call)}`, cutOff: false }; };
  const handle = startRun({ previous: first.run, mode, prompts: first.session.prompts, config: first.session.config, deps: { ask, ...first.time }, clearKeys() {}, onUpdate() {} });
  return { handle, calls };
}

test('failed-main sends the main request and both judges of the rows without an output, and nothing for other rows (spec FR-075)', async () => {
  const first = await failingFirstRun();
  const { handle, calls } = rerunMode(first, 'failed-main');
  const run = await handle.done;
  assert.deepEqual(calls.map((c) => `${rowOf(c)}:${isJudge(c) ? 'judge' : 'main'}`).sort(), ['2:judge', '2:judge', '2:main']);
  assert.equal(run.mode, 'failed-main');
  assert.equal(run.rows[2].accuracy.state, 'error', 'the failed judge of another row is not touched');
  assert.deepEqual(failedRows(run).map((r) => r.rowId), ['R3', 'R5']);
});

test('failed-judges sends only the judge requests that lack a valid grade, never the main prompt (spec FR-075, SC-042)', async () => {
  const first = await failingFirstRun();
  const { handle, calls } = rerunMode(first, 'failed-judges');
  const run = await handle.done;
  assert.ok(calls.every(isJudge), 'no request to the main endpoint');
  assert.deepEqual(calls.map((c) => rowOf(c)).sort(), ['3', '5', '5']);
  assert.equal(run.mode, 'failed-judges');
  assert.equal(run.rows[1].main.state, 'error', 'the row without an output is not touched');
  assert.deepEqual(failedRows(run).map((r) => r.rowId), ['R2']);
  assert.equal(run.times.main, first.run.times.main, 'the date of the main prompt stays');
});

test('one failed judge request in a run of ten rows: failed-judges sends exactly that one and changes nothing else', async () => {
  const first = await firstRun({ rows: rowsOf(10), respond: (c) => (isJudge(c) && rowOf(c) === '7' && c.payload.messages[0].content.includes('COMPLETENESS') ? { error: 'Unknown address or model (HTTP 404).' } : undefined) });
  assert.deepEqual(countRequests({ mode: 'failed-judges', rows: first.run.rows }), { main: 0, judges: 1 });
  assert.deepEqual(countRequests({ mode: 'failed-main', rows: first.run.rows }), { main: 0, judges: 0 });
  const before = JSON.stringify(first.run.rows.filter((r) => r.rowId !== 'R7'));
  const { handle, calls } = rerunMode(first, 'failed-judges');
  const run = await handle.done;
  assert.equal(calls.length, 1);
  assert.ok(rowOf(calls[0]) === '7' && calls[0].payload.messages[0].content.includes('COMPLETENESS'));
  assert.equal(JSON.stringify(run.rows.filter((r) => r.rowId !== 'R7')), before);
  assert.deepEqual(failedRows(run), []);
});

test('the former mode name is gone', async () => {
  const first = await failingFirstRun();
  assert.throws(() => startRun({ previous: first.run, mode: 'failed-rows', prompts: first.session.prompts, config: first.session.config, deps: { ask: async () => ({}), ...first.time }, clearKeys() {}, onUpdate() {} }), /unknown mode/);
  assert.throws(() => countRequests({ mode: 'failed-rows', rows: first.run.rows }), /unknown mode/);
});
