// Runs the prompts: phase 1 the main prompt on the selected rows, phase 2 the two judges on the rows that
// have an answer (spec FR-017 – FR-021). At most MAX_IN_FLIGHT requests are in flight and starts are at least
// START_GAP_MS apart; nothing is retried. The clock, the sleep, and the request function are injected so that
// the tests need no real time and no network. Keys are handed to `ask` only and never stored in the run; the run
// works on its own copy of the prompts, so later edits of the page cannot reach it (spec FR-039).
import { fill } from './placeholders.mjs';
import { buildPayload } from './chat.mjs';
import { withFormatInstruction, readAnswer } from './judge.mjs';
import { similarity } from './similarity.mjs';
import { effectiveJudgeConfig, parseParams } from './config.mjs';
import { MAX_ROWS_PER_RUN } from './dataset.mjs';

export const MAX_IN_FLIGHT = 4;
export const START_GAP_MS = 1600;

const JUDGES = [
  { key: 'accuracy', prompt: 'accuracy' },
  { key: 'completeness', prompt: 'completeness' },
];

const hasOutput = (row) => row.main.state === 'ok' && row.main.output !== '';
const needsMain = (row) => ['error', 'not-run', 'pending', 'running'].includes(row.main.state);
/**
 * A row that has an output but no valid grade from a judge: whatever the reason (error, "not run", still pending, or a stray
 * "nothing to judge", which is valid only while the row has no output). The one definition behind the re-run button, the
 * count, the itemised confirmation, and the requests that are really sent (spec FR-035, FR-040).
 */
const judgeMissing = (row, judge) => hasOutput(row) && ['error', 'not-run', 'pending', 'running', 'nothing-to-judge'].includes(row[judge.key].state);

/** Failed rows (spec FR-035): no output because of an error or "not run", or an output and a judge without a valid grade. */
export function failedRows(run) {
  return run.rows.filter((row) => needsMain(row) || JUDGES.some((judge) => judgeMissing(row, judge)));
}

/** The parts of a test case that a request belongs to, as shown to the user. */
const PART = { accuracy: 'Accuracy', completeness: 'Completeness' };

/**
 * The requests that a re-run of the failed requests will send, in the order of the rows. `kind` is `'main'` (a main
 * request for each row without an output, and then both judges), `'judges'` (a judge request for each row with an output
 * and no valid grade from that judge), or `'all'` (both, which is what the two kinds send together). The two kinds never
 * overlap (spec FR-075).
 */
export function failedRequests(rows, kind = 'all') {
  const list = [];
  for (const row of rows) {
    const base = { rowId: row.rowId, name: row.name };
    if (needsMain(row)) {
      if (kind !== 'judges') list.push({ ...base, part: 'main' }, ...JUDGES.map((judge) => ({ ...base, part: PART[judge.key] })));
    } else if (hasOutput(row) && kind !== 'main') {
      for (const judge of JUDGES) if (judgeMissing(row, judge)) list.push({ ...base, part: PART[judge.key] });
    }
  }
  return list;
}

/** How many requests a run will send at most: main endpoint and judge endpoint. */
export function countRequests({ mode = 'full', rowIds = [], rows = [] }) {
  if (mode === 'full') return { main: rowIds.length, judges: rowIds.length * 2 };
  if (mode === 'judges-only') return { main: 0, judges: rows.filter(hasOutput).length * 2 };
  if (mode === 'failed-main' || mode === 'failed-judges') {
    const list = failedRequests(rows, mode === 'failed-main' ? 'main' : 'judges');
    const main = list.filter((request) => request.part === 'main').length;
    return { main, judges: list.length - main };
  }
  throw new Error(`countRequests: unknown mode ${mode}`);
}

function newRow(source, prompts) {
  return {
    rowId: source.id,
    name: source.name,
    promptInput: source.promptInput,
    expectedResult: source.expectedResult,
    resolvedPrompt: fill(prompts.main, { prompt_input: source.promptInput }),
    main: { state: 'pending' },
    similarity: null,
    accuracy: { state: 'pending' },
    completeness: { state: 'pending' },
  };
}

function snapshotOf({ prompts, config, rowIds }) {
  const judge = effectiveJudgeConfig(config);
  return {
    prompts: { main: prompts.main, accuracy: prompts.accuracy, completeness: prompts.completeness },
    params: { main: config.main.params, judges: judge.params },
    judgeSameAsMain: judge.sameAsMain,
    models: { main: parseParams(config.main.params).value?.model ?? '', judges: parseParams(judge.params).value?.model ?? '' },
    rowIds: [...rowIds],
    // The texts of each judge prompt that stand behind grades; the last one is the latest used (data-model: Snapshot).
    judgePromptVersions: { accuracy: [prompts.accuracy], completeness: [prompts.completeness] },
  };
}

/**
 * Starts a run. Modes: `full` (main prompt on `rowIds`, then the judges), `judges-only` (the judges again on the
 * answers of `previous`, with the current judge prompts), `failed-main` (the rows of `previous` without an output: their
 * main request and then both judges) and `failed-judges` (the judge requests of `previous` that lack a valid grade), both
 * with the prompts and parameters archived in its snapshot. Returns `{ run, done, stop }`: `run` is updated in place
 * (and `onUpdate(run)` is called after every change), `done` resolves to the run when it has finished or stopped.
 */
export function startRun({ dataset, rowIds, prompts, config, mode = 'full', previous = null, deps, clearKeys, onUpdate = () => {} }) {
  if (!['full', 'judges-only', 'failed-main', 'failed-judges'].includes(mode)) throw new Error(`startRun: unknown mode ${mode}`);
  const full = mode === 'full';
  const judgesOnly = mode === 'judges-only';
  const failedOnly = mode === 'failed-main' || mode === 'failed-judges';
  const skipMain = judgesOnly || mode === 'failed-judges'; // no request goes to the main endpoint
  if (!full && (previous.status === 'running' || previous.status === 'stopping')) {
    throw new Error(`${judgesOnly ? 'The judges' : 'Failed requests'} cannot be re-run while a run is in progress.`);
  }
  if (full && rowIds.length > MAX_ROWS_PER_RUN) throw new Error(`A run covers at most ${MAX_ROWS_PER_RUN} rows.`);
  const { ask, sleep, now, date = Date.now } = deps;
  // The run keeps its own copy of the prompt texts: the page's editors change the object they were handed on every keystroke.
  prompts = { main: prompts.main, accuracy: prompts.accuracy, completeness: prompts.completeness };

  const rows = full ? dataset.filter((row) => new Set(rowIds).has(row.id)).map((row) => newRow(row, prompts)) : previous.rows;
  // `failed-main` judges only the rows whose main request it repeats, not rows that already had an output (spec FR-075).
  const mainRepeated = mode === 'failed-main' ? new Set(rows.filter(needsMain)) : null;

  // What is sent with: a re-run of failed requests uses the archived prompts and parameters, the others the current ones.
  // Endpoints and keys always come from the current configuration; the two targets below are emptied when the run ends.
  const judgeSource = effectiveJudgeConfig(config);
  const used = failedOnly
    ? { prompts: { ...previous.snapshot.prompts, accuracy: prompts.accuracy, completeness: prompts.completeness }, mainParams: previous.snapshot.params.main, judgeParams: previous.snapshot.params.judges, judgesShareMain: previous.snapshot.judgeSameAsMain }
    : { prompts, mainParams: config.main.params, judgeParams: judgeSource.params, judgesShareMain: judgeSource.sameAsMain };
  const mainParams = parseParams(used.mainParams).value;
  const judgeParams = parseParams(used.judgeParams).value;
  const mainTarget = { endpoint: config.main.endpoint, apiKey: config.main.apiKey };
  const judgeTarget = failedOnly && used.judgesShareMain
    ? mainTarget
    : failedOnly ? { endpoint: config.judge.endpoint, apiKey: config.judge.apiKey } : { endpoint: judgeSource.endpoint, apiKey: judgeSource.apiKey };

  const run = full ? {
    mode,
    status: 'running',
    phase: { name: 'main', done: 0, total: rows.length },
    snapshot: snapshotOf({ prompts, config, rowIds }),
    times: { main: null, judges: null },
    rows,
    reportAt: date(),
    failure: null,
  } : previous;
  if (!full) {
    run.mode = mode;
    run.status = 'running';
    run.failure = null;
  }
  if (judgesOnly) {
    // The judges' latest prompts and parameters replace those of the snapshot; the main prompt's stay (spec FR-027, FR-033).
    const latest = snapshotOf({ prompts, config, rowIds: previous.snapshot.rowIds });
    run.snapshot = {
      ...previous.snapshot,
      prompts: { ...previous.snapshot.prompts, accuracy: latest.prompts.accuracy, completeness: latest.prompts.completeness },
      params: { ...previous.snapshot.params, judges: latest.params.judges },
      judgeSameAsMain: latest.judgeSameAsMain,
      models: { ...previous.snapshot.models, judges: latest.models.judges },
    };
  }
  // Judge prompt versions (a failed-requests re-run may use a corrected judge prompt, spec FR-035).
  const versions = (run.snapshot.judgePromptVersions ??= { accuracy: [run.snapshot.prompts.accuracy], completeness: [run.snapshot.prompts.completeness] });
  /** The index of the version of a judge prompt that a request uses; a changed text becomes a new version. */
  function useVersion(key, text) {
    const list = versions[key];
    if (list[list.length - 1] !== text) list.push(text);
    return list.length - 1;
  }
  /** Drops the versions that no kept grade stands behind (the latest stays) and renumbers the grades. */
  function pruneVersions() {
    for (const judge of JUDGES) {
      const list = versions[judge.key];
      const used = new Set(rows.map((row) => row[judge.key]).filter((v) => v.state === 'ok').map((v) => v.version ?? 0));
      used.add(list.length - 1);
      const mapping = new Map();
      const kept = [];
      list.forEach((text, index) => { if (used.has(index)) { mapping.set(index, kept.length); kept.push(text); } });
      versions[judge.key] = kept;
      for (const row of rows) if (row[judge.key].state === 'ok') row[judge.key].version = mapping.get(row[judge.key].version ?? 0);
      run.snapshot.prompts[judge.key] = kept[kept.length - 1];
    }
    run.snapshot.judgePromptVersions = versions;
  }
  const controller = new AbortController();
  const changed = () => { run.reportAt = date(); onUpdate(run); };

  let nextStartAt = 0;
  /** Reserves the next start slot at once (no await between reading and writing), then waits for it. */
  async function waitForSlot() {
    const current = now();
    const startAt = Math.max(current, nextStartAt);
    nextStartAt = startAt + START_GAP_MS;
    if (startAt > current) await sleep(startAt - current, controller.signal);
  }

  /** Runs the jobs with the concurrency limit; `job(item)` returns when that item is settled. */
  async function runPool(items, job) {
    const queue = [...items];
    const worker = async () => {
      while (!controller.signal.aborted) {
        const item = queue.shift();
        if (item === undefined) return;
        await waitForSlot();
        if (controller.signal.aborted) return;
        await job(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, items.length) }, worker));
  }

  // Re-runs: the earlier state that a running job replaces; it comes back when the job is aborted or the run fails.
  const earlier = new Map();

  async function mainJob(row) {
    const old = row.main;
    const running = { state: 'running' };
    earlier.set(running, old);
    row.main = running;
    changed();
    const started = now();
    const answer = await ask({ ...mainTarget, payload: buildPayload(mainParams, row.resolvedPrompt), signal: controller.signal });
    if (answer.aborted) { row.main = full ? { state: 'not-run' } : old; return; }
    if (answer.error) {
      row.main = { state: 'error', error: answer.error, durationMs: now() - started };
    } else {
      row.main = { state: 'ok', output: answer.output, cutOff: answer.cutOff, ...(answer.note ? { note: answer.note } : {}), durationMs: now() - started };
      if (answer.output === '') row.similarity = 'not available';
      else row.similarity = row.expectedResult.trim() === '' ? 'no expected result' : similarity(answer.output, row.expectedResult);
    }
    if (row.main.state === 'error') row.similarity = 'not available';
    // The row has an output now, so "nothing to judge" no longer holds; if the run is stopped before the judges
    // answer, they end as "not run" and the row still counts as failed (spec FR-040).
    if (!full && hasOutput(row)) for (const judge of JUDGES) row[judge.key] = { state: 'pending' };
    run.phase.done += 1;
    changed();
  }

  async function judgeJob({ row, judge }) {
    const old = row[judge.key];
    const running = { state: 'running' };
    earlier.set(running, old);
    row[judge.key] = running;
    changed();
    const version = useVersion(judge.key, used.prompts[judge.prompt]);
    const text = withFormatInstruction(fill(used.prompts[judge.prompt], { prompt_input: row.promptInput, output: row.main.output }));
    const answer = await ask({ ...judgeTarget, payload: buildPayload(judgeParams, text), signal: controller.signal });
    if (answer.aborted) { row[judge.key] = full ? { state: 'not-run' } : old; return; }
    if (answer.error) row[judge.key] = { state: 'error', error: answer.error };
    else {
      const read = readAnswer(answer.output);
      row[judge.key] = read.error ? { state: 'error', error: read.error, rawAnswer: read.rawAnswer } : { state: 'ok', grade: read.grade, rationale: read.rationale, version };
      if (judgesOnly && read.grade !== undefined && old.state === 'ok' && old.grade !== read.grade) row[judge.key].previousGrade = old.grade;
    }
    run.phase.done += 1;
    changed();
  }

  /** Whatever did not finish: in a full run "not run" (rows without an answer have nothing to judge); in a re-run the earlier state. */
  function settleUnfinished() {
    if (!full) {
      for (const row of rows) {
        if (earlier.has(row.main)) row.main = earlier.get(row.main);
        for (const judge of JUDGES) {
          if (earlier.has(row[judge.key])) row[judge.key] = earlier.get(row[judge.key]);
          if (hasOutput(row) && ['pending', 'running'].includes(row[judge.key].state)) row[judge.key] = { state: 'not-run' };
        }
      }
      return;
    }
    for (const row of rows) {
      if (row.main.state === 'pending' || row.main.state === 'running') row.main = { state: 'not-run' };
      if (row.main.state !== 'ok' || row.main.output === '') {
        for (const judge of JUDGES) row[judge.key] = { state: 'nothing-to-judge' };
        if (row.similarity === null) row.similarity = 'not available';
      } else {
        for (const judge of JUDGES) {
          if (row[judge.key].state === 'pending' || row[judge.key].state === 'running') row[judge.key] = { state: 'not-run' };
        }
      }
    }
  }

  /** The judge requests still to send: every judge on every answer, or in a re-run of failed requests only the missing grades. */
  const judgeJobs = () => rows.filter(hasOutput).filter((row) => !mainRepeated || mainRepeated.has(row))
    .flatMap((row) => JUDGES.filter((judge) => !failedOnly || judgeMissing(row, judge)).map((judge) => ({ row, judge })));

  async function execute() {
    try {
      changed();
      if (!skipMain) {
        const mainRows = full ? rows : rows.filter(needsMain);
        run.phase = { name: 'main', done: 0, total: mainRows.length };
        changed();
        await runPool(mainRows, mainJob);
        if (!controller.signal.aborted && mainRows.length) run.times.main = date();
        if (!controller.signal.aborted) {
          // A row without an answer has nothing to judge, before any judge request is sent.
          for (const row of rows) {
            if (!hasOutput(row)) for (const judge of JUDGES) row[judge.key] = { state: 'nothing-to-judge' };
          }
        }
      }
      if (!controller.signal.aborted) {
        const jobs = judgeJobs();
        run.phase = { name: 'judges', done: 0, total: jobs.length };
        changed();
        await runPool(jobs, judgeJob);
        if (!controller.signal.aborted && jobs.length) run.times.judges = date();
      }
      run.status = controller.signal.aborted ? 'stopped' : 'finished';
    } catch {
      controller.abort();
      run.status = 'stopped';
      run.failure = 'The run stopped unexpectedly. Results that were already received are kept.';
    } finally {
      settleUnfinished();
      pruneVersions();
      clearKeys(); // memory only, and not needed any more (spec FR-016)
      // The closures of this run (Stop, the job queue) must not keep a key either.
      mainTarget.apiKey = '';
      judgeTarget.apiKey = '';
      changed();
    }
    return run;
  }

  const done = execute();
  return {
    run,
    done,
    stop() {
      if (run.status === 'running') { run.status = 'stopping'; changed(); }
      controller.abort();
    },
  };
}
