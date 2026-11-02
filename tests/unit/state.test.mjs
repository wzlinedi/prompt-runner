import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, freshSession } from '../../app/public/src/state.mjs';
import { DEFAULT_ENDPOINT, DEFAULT_MAIN_PROMPT } from '../../app/public/src/defaults.mjs';

test('the session holds dataset, selection, prompts, config, run, exportedSinceChange, and the confirming flag', () => {
  const s = createState().get();
  assert.deepEqual(Object.keys(s).sort(), ['config', 'confirming', 'dataset', 'exportedSinceChange', 'prompts', 'run', 'selection', 'started']);
  assert.equal(s.dataset, null);
  assert.deepEqual(s.selection, []);
  assert.equal(s.run, null);
  assert.equal(s.confirming, false);
  assert.equal(s.prompts.main, DEFAULT_MAIN_PROMPT);
  assert.equal(s.config.main.endpoint, DEFAULT_ENDPOINT);
  assert.equal(s.config.judge.sameAsMain, true, 'the judges use the main model by default');
});

test('subscribers are notified on set and update, and can unsubscribe', () => {
  const state = createState();
  const seen = [];
  const off = state.subscribe((session) => seen.push(session.started));
  state.set({ started: true });
  state.update((session) => { session.started = false; });
  assert.deepEqual(seen, [true, false]);
  off();
  state.set({ started: true });
  assert.equal(seen.length, 2);
});

test('reset returns to the empty state', () => {
  const state = createState();
  state.set({ started: true, dataset: [{ id: '1' }], selection: ['1'], run: { x: 1 }, exportedSinceChange: false });
  state.update((s) => { s.prompts.main = 'changed'; s.config.main.apiKey = 'nvapi-x'; });
  state.reset();
  assert.deepEqual(state.get(), freshSession());
});

test('clearKeys empties every key field and nothing else', () => {
  const state = createState();
  state.update((s) => {
    s.config.main.apiKey = 'nvapi-main'; s.config.judge.apiKey = 'nvapi-judge';
    s.config.main.endpoint = 'https://example.test/v1'; s.prompts.main = 'keep {prompt_input}'; s.started = true;
  });
  state.clearKeys();
  const s = state.get();
  assert.equal(s.config.main.apiKey, '');
  assert.equal(s.config.judge.apiKey, '');
  assert.equal(s.config.main.endpoint, 'https://example.test/v1');
  assert.equal(s.prompts.main, 'keep {prompt_input}');
  assert.equal(s.started, true);
});

test('the session never carries a key anywhere but the two key fields', () => {
  const state = createState();
  state.update((s) => { s.config.main.apiKey = 'SECRET-TEST-KEY'; });
  const copy = JSON.parse(JSON.stringify(state.get()));
  copy.config.main.apiKey = '';
  assert.ok(!JSON.stringify(copy).includes('SECRET-TEST-KEY'));
});
