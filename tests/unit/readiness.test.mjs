// The readiness list, the step states, and the chips (spec FR-049, FR-050, FR-052; contracts/page-ui.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readiness, stepStates, sessionFacts, STEP_TITLES } from '../../app/public/src/readiness.mjs';
import { problemList, blockingProblems } from '../../app/public/src/problems.mjs';
import { freshSession } from '../../app/public/src/state.mjs';
import { rowsOf } from '../helpers/run-harness.mjs';

const ready = () => {
  const s = freshSession();
  s.started = true;
  s.dataset = rowsOf(5);
  s.selection = ['R1', 'R2', 'R3'];
  s.config.main.apiKey = 'nvapi-SECRET-TEST-KEY-123';
  return s;
};

test('a fresh session lists the problems of every step; steps 2-4 are not available yet', () => {
  const s = freshSession();
  const r = readiness(s);
  assert.deepEqual(r.groups.map((g) => [g.step, g.available, g.items.length]), [[1, true, 1], [2, false, 0], [3, false, 0], [4, false, 1]]);
  assert.equal(r.groups[0].items[0].text, 'Dataset: load a dataset first.');
  assert.equal(r.groups[0].items[0].field, 'dsText');
  assert.equal(r.groups[3].items[0].text, 'Main prompt: the API key is empty.');
  assert.equal(r.groups[3].items[0].field, 'mainKey');
  assert.equal(r.count, 2);
});

test('every blocking problem of a run appears once, with the step and the field it belongs to', () => {
  const s = ready();
  s.selection = [];
  s.prompts.main = 'no place for the data';
  s.prompts.accuracy = 'only {prompt_input}';
  s.prompts.completeness = 'bad {nonsense} {output} {prompt_input}';
  s.config.main.endpoint = 'ftp://x';
  s.config.main.apiKey = '';
  s.config.main.params = '{nope';
  s.config.judge.sameAsMain = false;
  s.config.judge.endpoint = '';
  s.config.judge.apiKey = '';
  s.config.judge.params = '{"x":1}';
  const items = problemList(s);
  assert.deepEqual(items.map((i) => i.text), blockingProblems(s), 'the same texts, in the same order');
  assert.deepEqual(items.map((i) => [i.step, i.field]), [
    [1, 'selAll'], [2, 'mainText'], [3, 'accText'], [3, 'compText'],
    [4, 'mainEp'], [4, 'mainKey'], [4, 'main_json'], [4, 'judgeEp'], [4, 'judgeKey'], [4, 'judge_json'],
  ]);
  assert.equal(readiness(s).count, items.length);
});

test('steps 2-4 become available once a dataset is loaded; with nothing wrong the list is empty', () => {
  const s = ready();
  const r = readiness(s);
  assert.ok(r.groups.every((g) => g.available));
  assert.equal(r.count, 0);
  assert.deepEqual(r.groups.map((g) => g.items.length), [0, 0, 0, 0]);
});

test('step states follow the table of the contract', () => {
  const fresh = stepStates(freshSession());
  assert.deepEqual(fresh.map((x) => [x.state, x.current]), [['todo', true], ['locked', false], ['locked', false], ['locked', false], ['locked', false]]);
  assert.equal(fresh[0].fact, 'load a dataset');
  assert.deepEqual(fresh.map((x) => x.title), Object.values(STEP_TITLES));

  const noKey = ready();
  noKey.config.main.apiKey = '';
  const a = stepStates(noKey);
  assert.deepEqual(a.map((x) => x.state), ['done', 'done', 'done', 'attention', 'attention']);
  assert.deepEqual([a[0].fact, a[1].fact, a[2].fact, a[3].fact, a[4].fact], ['5 rows, 3 selected', 'valid', '2 prompts valid', '1 problem', 'not ready']);
  assert.equal(a.findIndex((x) => x.current), 3, 'the first step that is not done is the current one');

  const b = stepStates(ready());
  assert.deepEqual(b.map((x) => x.state), ['done', 'done', 'done', 'done', 'todo']);
  assert.equal(b[4].fact, 'ready to run');
  assert.equal(b[3].fact, 'ready');
  assert.equal(b.findIndex((x) => x.current), 4);

  const badSelection = ready();
  badSelection.selection = [];
  assert.equal(stepStates(badSelection)[0].state, 'attention');

  const badPrompt = ready();
  badPrompt.prompts.main = 'nothing';
  assert.deepEqual(stepStates(badPrompt).map((x) => x.state).slice(0, 4), ['done', 'attention', 'done', 'done']);
});

test('step 5 follows the run', () => {
  const s = ready();
  s.run = { status: 'running' };
  assert.deepEqual([stepStates(s)[4].state, stepStates(s)[4].fact], ['todo', 'running']);
  s.run = { status: 'finished' };
  assert.deepEqual([stepStates(s)[4].state, stepStates(s)[4].fact], ['done', 'done']);
  s.run = { status: 'stopped' };
  assert.equal(stepStates(s)[4].fact, 'stopped');
});

test('the chips show the facts of the session', () => {
  const s = ready();
  assert.deepEqual(sessionFacts(s), { rowsLoaded: 5, rowsSelected: 3, limit: 20, mainModel: 'nvidia/nemotron-3.5-bolt-e4b', judges: 'same model', report: false });
  s.config.judge.sameAsMain = false;
  assert.equal(sessionFacts(s).judges, 'nvidia/nemotron-3.5-lightning-30b-a3b');
  s.run = { status: 'finished' };
  assert.equal(sessionFacts(s).report, true);
  assert.deepEqual(sessionFacts(freshSession()), { rowsLoaded: 0, rowsSelected: 0, limit: 20, mainModel: 'nvidia/nemotron-3.5-bolt-e4b', judges: 'same model', report: false });
});

test('the chips, the step states, and the list never hold a key or an endpoint', () => {
  const s = ready();
  s.config.main.endpoint = 'https://secret-host.example/v1/chat';
  s.config.judge.apiKey = 'nvapi-JUDGE-KEY-456';
  const everything = JSON.stringify([sessionFacts(s), stepStates(s), readiness(s)]);
  assert.ok(!everything.includes('SECRET-TEST-KEY') && !everything.includes('JUDGE-KEY') && !everything.includes('secret-host'));
  s.config.main.apiKey = '';
  s.config.main.endpoint = 'ftp://secret-host.example';
  assert.ok(!JSON.stringify(readiness(s)).includes('secret-host'), 'a problem message does not repeat the address');
});
