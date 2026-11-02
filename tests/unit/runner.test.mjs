import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun, countRequests, MAX_IN_FLIGHT, START_GAP_MS } from '../../app/public/src/runner.mjs';
import { freshSession } from '../../app/public/src/state.mjs';

const KEY = 'nvapi-SECRET-TEST-KEY';
const JUDGE_KEY = 'nvapi-JUDGE-SECRET';
const MAIN_EP = 'https://main.example/v1/chat/completions';
const JUDGE_EP = 'https://judge.example/v1/chat/completions';

const rowsOf = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `R${i + 1}`, name: `Case ${i + 1}`, promptInput: `input-${i + 1}`, expectedResult: `EXPECTED-${i + 1}`, ...extra,
}));

/** A fake clock whose sleep resolves in order of due time without waiting. */
function clockHarness() {
  const clock = { t: 1_000_000 };
  return {
    clock,
    now: () => clock.t,
    date: () => 1_800_000_000_000 + clock.t,
    sleep: (ms) => {
      const due = clock.t + ms;
      return new Promise((resolve) => setImmediate(() => { clock.t = Math.max(clock.t, due); resolve(); }));
    },
  };
}

const isJudge = (call) => call.payload.messages[0].content.includes('SCORE: <number>');
const rowOf = (call) => /input-(\d+)/.exec(call.payload.messages[0].content)?.[1];

function harness({ rows = rowsOf(3), respond, config, prompts, sameAsMain = true, rowIds, clearKeys } = {}) {
  const time = clockHarness();
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const keysCleared = [];
  const session = freshSession();
  session.config.main = { endpoint: MAIN_EP, apiKey: KEY, params: '{"model":"main-model","temperature":0.5,"chat_template_kwargs":{"enable_thinking":true}}' };
  session.config.judge = { sameAsMain, endpoint: JUDGE_EP, apiKey: JUDGE_KEY, params: '{"model":"judge-model","max_tokens":99}' };
  Object.assign(session.config, config ?? {});
  Object.assign(session.prompts, prompts ?? {});
  const ask = async (call) => {
    const record = { ...call, at: time.now(), index: calls.length };
    calls.push(record);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (respond) {
        const custom = await respond(record, time);
        if (custom !== undefined) return custom;
      }
      return isJudge(record) ? { output: 'Rationale text\nSCORE: 80', cutOff: false } : { output: `OUTPUT-${rowOf(record)}`, cutOff: false };
    } finally {
      inFlight -= 1;
    }
  };
  const handle = startRun({
    dataset: rows,
    rowIds: rowIds ?? rows.map((r) => r.id),
    prompts: session.prompts,
    config: session.config,
    mode: 'full',
    deps: { ask, sleep: time.sleep, now: time.now, date: time.date },
    clearKeys: clearKeys ?? (() => keysCleared.push(time.now())),
    onUpdate: () => {},
  });
  return { handle, calls, time, keysCleared, session, get maxInFlight() { return maxInFlight; } };
}

test('constants: 4 in flight, starts 1.6 s apart', () => {
  assert.equal(MAX_IN_FLIGHT, 4);
  assert.equal(START_GAP_MS, 1600);
});

test('all main requests precede all judge requests; every row ends complete', async () => {
  const h = harness({ rows: rowsOf(5) });
  const run = await h.handle.done;
  assert.equal(run.status, 'finished');
  const firstJudge = h.calls.findIndex(isJudge);
  assert.equal(firstJudge, 5);
  assert.ok(h.calls.slice(0, 5).every((c) => !isJudge(c)));
  assert.ok(h.calls.slice(5).every(isJudge));
  assert.equal(h.calls.length, 15);
  for (const row of run.rows) {
    assert.equal(row.main.state, 'ok');
    assert.equal(row.accuracy.state, 'ok');
    assert.equal(row.accuracy.grade, 80);
    assert.equal(row.accuracy.rationale, 'Rationale text');
    assert.equal(row.completeness.state, 'ok');
  }
  assert.deepEqual(run.rows.map((r) => r.rowId), ['R1', 'R2', 'R3', 'R4', 'R5'], 'dataset order');
});

test('at most 4 requests in flight, starts at least 1.6 s apart', async () => {
  const h = harness({ rows: rowsOf(10), respond: async (call, time) => { await time.sleep(7000); } });
  await h.handle.done;
  assert.ok(h.maxInFlight <= 4, `max in flight ${h.maxInFlight}`);
  assert.ok(h.maxInFlight >= 3, 'the limit is really used');
  const starts = h.calls.map((c) => c.at).sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 1600, `gap ${starts[i] - starts[i - 1]} at ${i}`);
  assert.equal(h.calls.length, 30);
});

test('a failure on one row does not stop the others; nothing is retried', async () => {
  const h = harness({ rows: rowsOf(3), respond: (call) => (!isJudge(call) && rowOf(call) === '2' ? { error: 'Rate limit exceeded (HTTP 429).' } : undefined) });
  const run = await h.handle.done;
  assert.equal(run.rows[1].main.state, 'error');
  assert.equal(run.rows[1].main.error, 'Rate limit exceeded (HTTP 429).');
  assert.equal(run.rows[0].main.state, 'ok');
  assert.equal(run.rows[2].main.state, 'ok');
  assert.equal(h.calls.filter((c) => rowOf(c) === '2').length, 1, 'row 2 was asked once');
  assert.equal(h.calls.length, 3 + 4, 'three main requests and four judge requests');
});

test('a row without output is not sent to any judge: nothing to judge', async () => {
  const h = harness({ rows: rowsOf(3), respond: (call) => {
    if (isJudge(call)) return undefined;
    if (rowOf(call) === '1') return { error: 'boom' };
    if (rowOf(call) === '2') return { output: '', cutOff: false };
    return undefined;
  } });
  const run = await h.handle.done;
  for (const row of run.rows.slice(0, 2)) {
    assert.equal(row.accuracy.state, 'nothing-to-judge');
    assert.equal(row.completeness.state, 'nothing-to-judge');
    assert.equal(row.similarity, 'not available');
  }
  assert.equal(run.rows[1].main.state, 'ok', 'an empty answer is not an error');
  assert.equal(h.calls.filter(isJudge).length, 2);
  assert.ok(h.calls.filter(isJudge).every((c) => rowOf(c) === '3'));
});

test('a cut-off answer is flagged and still judged', async () => {
  const h = harness({ rows: rowsOf(1), respond: (call) => (isJudge(call) ? undefined : { output: 'half an answ', cutOff: true }) });
  const run = await h.handle.done;
  assert.equal(run.rows[0].main.cutOff, true);
  assert.equal(run.rows[0].main.output, 'half an answ');
  assert.equal(run.rows[0].accuracy.state, 'ok');
  assert.equal(h.calls.filter(isJudge).length, 2);
});

test('the main answer note for an empty cut-off answer is kept', async () => {
  const h = harness({ rows: rowsOf(1), respond: (call) => (isJudge(call) ? undefined : { output: '', cutOff: true, note: 'no answer text returned: the length limit was reached before the answer' }) });
  const run = await h.handle.done;
  assert.equal(run.rows[0].main.note, 'no answer text returned: the length limit was reached before the answer');
  assert.equal(run.rows[0].accuracy.state, 'nothing-to-judge');
});

test('similarity: computed from output and expected result; "no expected result" when empty', async () => {
  const rows = [{ id: 'A', name: 'a', promptInput: 'input-1', expectedResult: 'OUTPUT-1' }, { id: 'B', name: 'b', promptInput: 'input-2', expectedResult: '' }];
  const run = await harness({ rows }).handle.done;
  assert.equal(run.rows[0].similarity, 100);
  assert.equal(run.rows[1].similarity, 'no expected result');
});

test('judge verdicts: unreadable answer keeps the raw text; a provider error is an error', async () => {
  const h = harness({ rows: rowsOf(1), respond: (call) => {
    if (!isJudge(call)) return undefined;
    return call.payload.messages[0].content.includes('ACCURACY') ? { output: 'no score here', cutOff: false } : { error: 'The key was refused (HTTP 403).' };
  } });
  const run = await h.handle.done;
  const [row] = run.rows;
  assert.equal(row.accuracy.state, 'error');
  assert.match(row.accuracy.error, /^unreadable answer: no SCORE line/);
  assert.equal(row.accuracy.rawAnswer, 'no score here');
  assert.equal(row.completeness.state, 'error');
  assert.equal(row.completeness.error, 'The key was refused (HTTP 403).');
  assert.equal(row.main.state, 'ok', 'the main output is kept');
});

test('Stop in the main phase: aborts in flight, starts nothing new, unfinished rows are "not run"', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ rows: rowsOf(8), respond: async (call) => {
    await new Promise((resolve) => call.signal.addEventListener('abort', resolve));
    return { aborted: true };
  } });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(h.calls.length >= 1 && h.calls.length <= 4);
  const before = h.calls.length;
  h.handle.stop();
  const run = await h.handle.done;
  release();
  assert.equal(h.calls.length, before, 'no request started after Stop');
  assert.ok(h.calls.every((c) => c.signal.aborted));
  assert.equal(run.status, 'stopped');
  assert.ok(run.rows.every((r) => r.main.state === 'not-run'));
  assert.ok(run.rows.every((r) => r.accuracy.state === 'nothing-to-judge' && r.completeness.state === 'nothing-to-judge'));
});

test('Stop in the judge phase: finished rows keep their results, the rest is "not run"', async () => {
  const h = harness({ rows: rowsOf(4), respond: async (call) => {
    if (!isJudge(call)) return undefined;
    if (call.index === 4) return undefined; // the first judge request finishes
    await new Promise((resolve) => call.signal.addEventListener('abort', resolve));
    return { aborted: true };
  } });
  await new Promise((r) => setTimeout(r, 30));
  h.handle.stop();
  const run = await h.handle.done;
  assert.equal(run.status, 'stopped');
  assert.ok(run.rows.every((r) => r.main.state === 'ok'), 'main outputs are kept');
  assert.equal(run.rows[0].accuracy.state, 'ok');
  const states = run.rows.flatMap((r) => [r.accuracy.state, r.completeness.state]);
  assert.ok(states.filter((s) => s === 'not-run').length >= 1);
  assert.ok(states.every((s) => ['ok', 'not-run'].includes(s)));
});

test('keys are cleared when the run ends, fails, or is stopped — once, after the last request', async () => {
  const ended = harness({ rows: rowsOf(2) });
  await ended.handle.done;
  assert.equal(ended.keysCleared.length, 1);

  const stopped = harness({ rows: rowsOf(3), respond: (call) => new Promise((resolve) => call.signal.addEventListener('abort', () => resolve({ aborted: true }))) });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(stopped.keysCleared.length, 0, 'not cleared while requests are running');
  stopped.handle.stop();
  await stopped.handle.done;
  assert.equal(stopped.keysCleared.length, 1);

  const failed = harness({ rows: rowsOf(2), respond: () => { throw new Error('unexpected'); } });
  const run = await failed.handle.done;
  assert.equal(failed.keysCleared.length, 1);
  assert.equal(run.status, 'stopped');
  assert.match(run.failure, /^The run stopped unexpectedly/);
  assert.ok(run.rows.every((r) => r.main.state === 'not-run' || r.main.state === 'error'));
});

test('countRequests: rows × 1 to the main endpoint, rows × 2 to the judge endpoint', () => {
  assert.deepEqual(countRequests({ mode: 'full', rowIds: ['a', 'b', 'c'] }), { main: 3, judges: 6 });
  assert.deepEqual(countRequests({ mode: 'full', rowIds: Array.from({ length: 20 }, (_, i) => i) }), { main: 20, judges: 40 });
});

test('the expected result never appears in any request body (spec FR-021)', async () => {
  const h = harness({ rows: rowsOf(3) });
  await h.handle.done;
  const bodies = h.calls.map((c) => JSON.stringify(c.payload));
  assert.ok(bodies.every((b) => !b.includes('EXPECTED-')));
});

test('endpoints and keys: main asks use the main block; judges share it by default or use their own', async () => {
  const same = harness({ rows: rowsOf(1) });
  await same.handle.done;
  assert.ok(same.calls.every((c) => c.endpoint === MAIN_EP && c.apiKey === KEY));
  assert.ok(same.calls.filter(isJudge).every((c) => c.payload.model === 'main-model'));

  const own = harness({ rows: rowsOf(1), sameAsMain: false });
  await own.handle.done;
  const main = own.calls.filter((c) => !isJudge(c));
  const judges = own.calls.filter(isJudge);
  assert.ok(main.every((c) => c.endpoint === MAIN_EP && c.apiKey === KEY && c.payload.model === 'main-model'));
  assert.equal(judges.length, 2);
  assert.ok(judges.every((c) => c.endpoint === JUDGE_EP && c.apiKey === JUDGE_KEY && c.payload.model === 'judge-model' && c.payload.max_tokens === 99));
});

test('request bodies: the user JSON plus messages and stream:false; the judge input has both places filled and the app instruction', async () => {
  const h = harness({ rows: rowsOf(1) });
  await h.handle.done;
  const [main, accuracy] = h.calls;
  assert.equal(main.payload.temperature, 0.5);
  assert.deepEqual(main.payload.chat_template_kwargs, { enable_thinking: true });
  assert.equal(main.payload.stream, false);
  assert.equal(main.payload.messages.length, 1);
  assert.ok(main.payload.messages[0].content.endsWith('input-1'));
  const judgeText = accuracy.payload.messages[0].content;
  assert.ok(judgeText.includes('input-1') && judgeText.includes('OUTPUT-1'));
  assert.ok(!judgeText.includes('{output}') && !judgeText.includes('{prompt_input}'));
  assert.ok(judgeText.endsWith('SCORE: <number>'));
});

test('the snapshot holds prompts, parameters, and models — never keys or endpoints', async () => {
  const run = await harness({ rows: rowsOf(2) }).handle.done;
  const { snapshot } = run;
  assert.equal(snapshot.prompts.main, freshSession().prompts.main);
  assert.equal(snapshot.models.main, 'main-model');
  assert.equal(snapshot.models.judges, 'main-model');
  assert.equal(snapshot.judgeSameAsMain, true);
  assert.deepEqual(snapshot.rowIds, ['R1', 'R2']);
  assert.match(snapshot.params.main, /"temperature":0.5/);
  const text = JSON.stringify(run);
  for (const secret of [KEY, JUDGE_KEY, 'SECRET', MAIN_EP, JUDGE_EP, 'example/v1']) assert.ok(!text.includes(secret), secret);

  const own = await harness({ rows: rowsOf(1), sameAsMain: false }).handle.done;
  assert.equal(own.snapshot.models.judges, 'judge-model');
  assert.equal(own.snapshot.judgeSameAsMain, false);
  assert.match(own.snapshot.params.judges, /"max_tokens":99/);
});

test('the run keeps its own copy of the rows: later edits of the dataset do not change it', async () => {
  const rows = rowsOf(1);
  const run = await harness({ rows }).handle.done;
  rows[0].promptInput = 'CHANGED';
  assert.equal(run.rows[0].promptInput, 'input-1');
  assert.equal(run.rows[0].expectedResult, 'EXPECTED-1');
  assert.ok(run.rows[0].resolvedPrompt.endsWith('input-1'));
});

test('times: main and judges are stamped when their phase finishes; progress is reported per phase', async () => {
  const updates = [];
  const time = clockHarness();
  const ask = async (call) => (isJudge(call) ? { output: 'x\nSCORE: 50', cutOff: false } : { output: 'o', cutOff: false });
  const session = freshSession();
  session.config.main.apiKey = KEY;
  const handle = startRun({ dataset: rowsOf(2), rowIds: ['R1', 'R2'], prompts: session.prompts, config: session.config, mode: 'full',
    deps: { ask, ...time }, clearKeys() {}, onUpdate: (run) => updates.push({ ...run.phase }) });
  const run = await handle.done;
  assert.ok(run.times.main > 0 && run.times.judges >= run.times.main);
  assert.ok(updates.some((u) => u.name === 'main' && u.done === 0 && u.total === 2));
  assert.ok(updates.some((u) => u.name === 'main' && u.done === 2));
  assert.ok(updates.some((u) => u.name === 'judges' && u.done === 4 && u.total === 4));
});

test('more than 20 rows are refused before anything is sent', () => {
  const time = clockHarness();
  const session = freshSession();
  assert.throws(() => startRun({ dataset: rowsOf(21), rowIds: rowsOf(21).map((r) => r.id), prompts: session.prompts, config: session.config, mode: 'full',
    deps: { ask: async () => ({ output: 'x' }), ...time }, clearKeys() {}, onUpdate() {} }), /at most 20 rows/);
});
