// What blocks a run, a judge re-run, and a re-run of failed requests (spec FR-008, FR-010, FR-015, FR-030, FR-034, FR-041, FR-052).
// Pure module. The problems are items `{ step, field, text }`: the step of the page (1 dataset, 2 main prompt, 3 judges,
// 4 configuration) and the id of the field to move the focus to; `text` is the message as it has always been written.
import { checkPrompt } from './placeholders.mjs';
import { validateConfig, validateConfigDetailed, validateJudgeConfig } from './config.mjs';
import { validateSelection } from './dataset.mjs';
import { failedRequests } from './runner.mjs';

const PROMPTS = [
  { kind: 'main', step: 2, field: 'mainText' },
  { kind: 'accuracy', step: 3, field: 'accText' },
  { kind: 'completeness', step: 3, field: 'compText' },
];
const CONFIG_FIELD = {
  main: { endpoint: 'mainEp', apiKey: 'mainKey', params: 'main_json' },
  judge: { endpoint: 'judgeEp', apiKey: 'judgeKey', params: 'judge_json' },
};

/** Every problem that blocks a run, in the order of the page: dataset, prompts, configuration. */
export function problemList(session) {
  const items = [];
  if (!session.dataset?.length) items.push({ step: 1, field: 'dsText', text: 'Dataset: load a dataset first.' });
  else {
    const check = validateSelection(session.selection);
    if (!check.ok) items.push({ step: 1, field: 'selAll', text: `Dataset: ${check.message}` });
  }
  for (const { kind, step, field } of PROMPTS) {
    for (const text of checkPrompt(kind, session.prompts[kind])) items.push({ step, field, text });
  }
  for (const { text, block, field } of validateConfigDetailed(session.config)) items.push({ step: 4, field: CONFIG_FIELD[block][field], text });
  return items;
}

/** The messages of every problem that blocks a run. */
export function blockingProblems(session) {
  return problemList(session).map((item) => item.text);
}

/** Problems that block a judge re-run: there must be a run with answers, valid judge prompts, and valid judge fields. */
export function judgeRerunProblems(session) {
  const problems = [];
  if (!session.run) problems.push('Result: there is no run to re-run.');
  for (const kind of ['accuracy', 'completeness']) problems.push(...checkPrompt(kind, session.prompts[kind]));
  problems.push(...validateJudgeConfig(session.config));
  return problems;
}

/**
 * Problems that block a re-run of failed requests (`failed-main`, `failed-judges`, or both kinds together): the endpoints and keys of what will be
 * called, and the judge prompts it will send (spec FR-041, FR-075).
 */
export function failedRerunProblems(session, mode) {
  const problems = [];
  const kind = mode === 'failed-judges' ? 'judges' : mode === 'failed-main' ? 'main' : 'all'; // no mode: both kinds together
  const run = session.run;
  const requests = run && ['finished', 'stopped'].includes(run.status) ? failedRequests(run.rows, kind) : [];
  if (!requests.length) return ['Result: no row has failed.'];
  // The judge requests carry the current judge prompts, so those prompts must be valid (spec FR-041).
  const parts = new Set(requests.map((request) => request.part));
  for (const [part, promptKind] of [['Accuracy', 'accuracy'], ['Completeness', 'completeness']]) {
    if (parts.has(part)) problems.push(...checkPrompt(promptKind, session.prompts[promptKind]));
  }
  const needsMain = requests.some((request) => request.part === 'main');
  const config = session.config;
  const mainProblems = validateConfig({ main: config.main, judge: { ...config.judge, sameAsMain: true } }).filter((p) => p.startsWith('Main prompt:'));
  const judgeSeparate = !run.snapshot.judgeSameAsMain;
  const judgeProblems = judgeSeparate ? validateConfig({ main: config.main, judge: { ...config.judge, sameAsMain: false } }).filter((p) => p.startsWith('LLM as Judge:')) : [];
  const endpointKeyOnly = (list) => list.filter((p) => /endpoint|API key/.test(p));
  if (needsMain || !judgeSeparate) problems.push(...endpointKeyOnly(mainProblems));
  problems.push(...endpointKeyOnly(judgeProblems));
  return problems;
}
