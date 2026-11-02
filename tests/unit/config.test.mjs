import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, effectiveJudgeConfig, displayParams, keyHint, parseParams, isThisComputer, sendsUnencrypted, validateConfigDetailed, describeParams } from '../../app/public/src/config.mjs';
import { freshSession, createState } from '../../app/public/src/state.mjs';
import { DEFAULT_ENDPOINT, DEFAULT_MAIN_JSON, jsonText } from '../../app/public/src/defaults.mjs';

const good = () => {
  const c = structuredClone(freshSession().config);
  c.main.apiKey = 'nvapi-abc';
  return c;
};

test('the defaults are valid once a key is entered', () => {
  assert.equal(freshSession().config.main.endpoint, DEFAULT_ENDPOINT);
  assert.deepEqual(validateConfig(good()), []);
});

test('an empty key is refused, naming the block', () => {
  const c = good(); c.main.apiKey = '  ';
  assert.deepEqual(validateConfig(c), ['Main prompt: the API key is empty.']);
});

test('endpoint: empty, not an address, wrong scheme', () => {
  for (const [value, msg] of [
    ['', 'Main prompt: the endpoint is empty.'],
    ['not a url', 'Main prompt: the endpoint is not a well-formed http or https address.'],
    ['ftp://x.y/z', 'Main prompt: the endpoint is not a well-formed http or https address.'],
  ]) {
    const c = good(); c.main.endpoint = value;
    assert.deepEqual(validateConfig(c), [msg], value);
  }
  const c = good(); c.main.endpoint = 'http://localhost:9000/v1/chat/completions';
  assert.deepEqual(validateConfig(c), []);
});

test('JSON: syntax error with position, non-object, missing model, forbidden keys', () => {
  const cases = [
    ['{"model": ', /^Main prompt: the parameters are not valid JSON \(.+\)\.$/],
    ['[1]', /^Main prompt: the parameters must be a JSON object\.$/],
    ['"x"', /must be a JSON object/],
    ['null', /must be a JSON object/],
    ['{}', /^Main prompt: the parameters must contain a non-empty text under "model"\.$/],
    ['{"model": ""}', /non-empty text under "model"/],
    ['{"model": 5}', /non-empty text under "model"/],
    ['{"model":"m","messages":[]}', /^Main prompt: the parameters must not contain "messages" \(the app sets it\)\.$/],
    ['{"model":"m","stream":true}', /must not contain "stream"/],
  ];
  for (const [text, re] of cases) {
    const c = good(); c.main.params = text;
    const errors = validateConfig(c);
    assert.equal(errors.length, 1, text);
    assert.match(errors[0], re, text);
  }
});

test('the JSON error message includes the position when the engine gives one', () => {
  const c = good(); c.main.params = '{"model": "m",\n  "a": }';
  assert.match(validateConfig(c)[0], /not valid JSON \(.*\)/);
});

test('valid JSON is used as written: no range checks', () => {
  const c = good(); c.main.params = '{"model":"m","temperature":99,"whatever":{"x":[1]}}';
  assert.deepEqual(validateConfig(c), []);
  assert.deepEqual(parseParams(c.main.params).value, { model: 'm', temperature: 99, whatever: { x: [1] } });
});

test('judge fields are validated only when "same model" is off, and then named "LLM as Judge"', () => {
  const c = good();
  c.judge.endpoint = ''; c.judge.apiKey = ''; c.judge.params = 'oops';
  assert.deepEqual(validateConfig(c), [], 'hidden fields are not checked');
  c.judge.sameAsMain = false;
  const errors = validateConfig(c);
  assert.equal(errors.length, 3);
  assert.ok(errors.every((e) => e.startsWith('LLM as Judge: ')));
});

test('several problems are all reported, main block first', () => {
  const c = good(); c.main.apiKey = ''; c.main.params = '{}';
  assert.equal(validateConfig(c).length, 2);
});

test('effectiveJudgeConfig: same as main by default, own fields otherwise', () => {
  const c = good();
  assert.deepEqual(effectiveJudgeConfig(c), { endpoint: c.main.endpoint, apiKey: c.main.apiKey, params: c.main.params, sameAsMain: true });
  c.judge.sameAsMain = false; c.judge.apiKey = 'k2';
  assert.deepEqual(effectiveJudgeConfig(c), { endpoint: c.judge.endpoint, apiKey: 'k2', params: c.judge.params, sameAsMain: false });
});

test('displayParams: without model, chat_template_kwargs flattened into name=value', () => {
  assert.equal(displayParams(jsonText(DEFAULT_MAIN_JSON)), 'temperature=1, top_p=0.95, max_tokens=4096, seed=42, enable_thinking=true');
  assert.equal(displayParams('{"model":"m"}'), '');
  assert.equal(displayParams('{"model":"m","stop":["a","b"],"x":"t"}'), 'stop=["a","b"], x=t');
  assert.equal(displayParams('broken'), '');
});

test('keyHint: only a key not starting with lowercase nvapi- gets a hint; empty gets none', () => {
  assert.equal(keyHint(''), '');
  assert.equal(keyHint('nvapi-xyz'), '');
  assert.match(keyHint('NVAPI-xyz'), /usually starts with "nvapi-"/);
  assert.match(keyHint('sk-123'), /usually starts with "nvapi-"/);
  assert.ok(!keyHint('sk-123').includes('sk-123'), 'the key is never echoed');
});

test('clearKeys empties both keys and nothing else', () => {
  const state = createState();
  state.update((s) => { s.config.main.apiKey = 'a'; s.config.judge.apiKey = 'b'; s.config.main.endpoint = 'http://x'; });
  state.clearKeys();
  assert.equal(state.get().config.main.apiKey, '');
  assert.equal(state.get().config.judge.apiKey, '');
  assert.equal(state.get().config.main.endpoint, 'http://x');
});

test('addresses on this computer are recognised; plain http elsewhere is flagged (spec FR-044)', () => {
  for (const local of ['http://localhost:8787/x', 'http://LOCALHOST/x', 'http://app.localhost/x', 'http://127.0.0.1:9911/v1', 'http://127.1.2.3/x', 'http://[::1]:80/x', 'https://localhost/x']) {
    assert.equal(isThisComputer(local), true, local);
    assert.equal(sendsUnencrypted(local), false, local);
  }
  for (const remote of ['http://example.com/x', 'http://10.0.0.5/x', 'http://127.0.0.1.example.com/x', 'http://localhost.example.com/x']) {
    assert.equal(isThisComputer(remote), false, remote);
    assert.equal(sendsUnencrypted(remote), true, remote);
  }
  assert.equal(sendsUnencrypted('https://integrate.api.nvidia.com/v1/chat/completions'), false, 'https is encrypted');
  assert.equal(sendsUnencrypted('not a url'), false);
  assert.equal(sendsUnencrypted(''), false);
});

test('validateConfigDetailed gives the block and the field of every problem; validateConfig keeps the texts', () => {
  const c = good();
  c.main.endpoint = ''; c.main.apiKey = ''; c.main.params = '[]';
  c.judge.sameAsMain = false; c.judge.endpoint = 'ftp://x'; c.judge.apiKey = ' '; c.judge.params = '{"model":""}';
  const items = validateConfigDetailed(c);
  assert.deepEqual(items.map((i) => [i.block, i.field]), [
    ['main', 'endpoint'], ['main', 'apiKey'], ['main', 'params'], ['judge', 'endpoint'], ['judge', 'apiKey'], ['judge', 'params'],
  ]);
  assert.deepEqual(validateConfig(c), items.map((i) => i.text));
  assert.equal(items[0].text, 'Main prompt: the endpoint is empty.');
  assert.deepEqual(validateConfigDetailed(good()), []);
});

test('describeParams says what the badge shows (spec FR-053)', () => {
  assert.deepEqual(describeParams('{"model":"m-1","temperature":1}'), { ok: true, model: 'm-1' });
  assert.equal(describeParams('{nope').ok, false);
  assert.match(describeParams('{nope').problem, /not valid JSON/);
  assert.match(describeParams('{"temperature":1}').problem, /"model"/);
  assert.match(describeParams('{"model":"m","stream":true}').problem, /must not contain "stream"/);
  assert.match(describeParams('[1]').problem, /must be a JSON object/);
});
