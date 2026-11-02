// What the page's header, step indicator, and run panel show, derived from the session (spec FR-049, FR-050, FR-052).
// Pure module: no DOM access, and nothing here ever holds a key or an endpoint. The three functions agree with each other
// and with the checks that really block a run, because they all start from `problemList` (problems.mjs).
import { problemList } from './problems.mjs';
import { parseParams } from './config.mjs';
import { MAX_ROWS_PER_RUN } from './dataset.mjs';

export const STEP_TITLES = { 1: 'Dataset', 2: 'Main prompt', 3: 'Judges', 4: 'Configuration', 5: 'Run' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The problems that block a run, grouped by step 1–4. A group is `available` when its step is unlocked: step 1 always,
 * steps 2–4 once a dataset is loaded (steps unlock in order, spec User Story 1). Items of steps that are not available
 * are listed too (dimmed by the page): the user sees the whole road at once.
 */
export function readiness(session) {
  const items = problemList(session);
  const loaded = Boolean(session.dataset?.length);
  const groups = [1, 2, 3, 4].map((step) => ({
    step,
    title: STEP_TITLES[step],
    available: step === 1 || loaded,
    items: items.filter((item) => item.step === step),
  }));
  return { items, groups, count: items.length };
}

/**
 * The state of each of the five steps: `locked`, `done`, `attention`, or `todo` (the step the user is on when nothing is
 * wrong with it yet), with a short fact and the number of problems; `current` marks the first step that is not done and not locked.
 */
export function stepStates(session) {
  const { groups, count } = readiness(session);
  const loaded = Boolean(session.dataset?.length);
  const problemsOf = (step) => groups[step - 1].items.length;
  const states = [];

  const selected = (session.selection ?? []).length;
  if (!loaded) states.push({ step: 1, state: 'todo', fact: 'load a dataset', problems: problemsOf(1) });
  else if (problemsOf(1)) states.push({ step: 1, state: 'attention', fact: plural(problemsOf(1), 'problem'), problems: problemsOf(1) });
  else states.push({ step: 1, state: 'done', fact: `${plural(session.dataset.length, 'row')}, ${selected} selected`, problems: 0 });

  for (const [step, ok] of [[2, 'valid'], [3, '2 prompts valid'], [4, 'ready']]) {
    if (!loaded) states.push({ step, state: 'locked', fact: `after step ${step - 1}`, problems: problemsOf(step) });
    else if (problemsOf(step)) states.push({ step, state: 'attention', fact: plural(problemsOf(step), 'problem'), problems: problemsOf(step) });
    else states.push({ step, state: 'done', fact: ok, problems: 0 });
  }

  const status = session.run?.status;
  if (!loaded && !session.run) states.push({ step: 5, state: 'locked', fact: 'after step 4', problems: count });
  else if (status === 'running' || status === 'stopping') states.push({ step: 5, state: 'todo', fact: 'running', problems: 0 });
  else if (status === 'finished' || status === 'stopped') states.push({ step: 5, state: 'done', fact: status === 'stopped' ? 'stopped' : 'done', problems: 0 });
  else if (count) states.push({ step: 5, state: 'attention', fact: 'not ready', problems: count });
  else states.push({ step: 5, state: 'todo', fact: 'ready to run', problems: 0 });

  const current = states.findIndex((entry) => entry.state !== 'done' && entry.state !== 'locked');
  return states.map((entry, index) => ({ ...entry, title: STEP_TITLES[entry.step], current: index === current }));
}

/** The chips of the header band: facts of the session, never a key or an endpoint (spec FR-049). */
export function sessionFacts(session) {
  const ids = new Set((session.dataset ?? []).map((row) => row.id));
  const judge = session.config.judge;
  return {
    rowsLoaded: session.dataset?.length ?? 0,
    rowsSelected: (session.selection ?? []).filter((id) => ids.has(id)).length,
    limit: MAX_ROWS_PER_RUN,
    mainModel: parseParams(session.config.main.params).value?.model ?? '',
    judges: judge.sameAsMain ? 'same model' : (parseParams(judge.params).value?.model ?? ''),
    report: Boolean(session.run),
  };
}
