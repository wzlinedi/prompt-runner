import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENDPOINT, DEFAULT_MAIN_PROMPT, DEFAULT_MAIN_JSON, DEFAULT_JUDGE_JSON,
  DEFAULT_ACCURACY_PROMPT, DEFAULT_COMPLETENESS_PROMPT, SAMPLE_DATASET, jsonText,
} from '../../app/public/src/defaults.mjs';
import { checkPrompt, findPlaceholders } from '../../app/public/src/placeholders.mjs';
import { parseDataset } from '../../app/public/src/dataset.mjs';

test('all ready-made prompts pass their own checks', () => {
  assert.deepEqual(checkPrompt('main', DEFAULT_MAIN_PROMPT), []);
  assert.deepEqual(checkPrompt('accuracy', DEFAULT_ACCURACY_PROMPT), []);
  assert.deepEqual(checkPrompt('completeness', DEFAULT_COMPLETENESS_PROMPT), []);
});

test('the Accuracy prompt casts a QA reviewer who verifies facts one by one (spec FR-031)', () => {
  const p = DEFAULT_ACCURACY_PROMPT;
  assert.match(p, /QA reviewer/);
  assert.match(p, /Extract every verifiable fact from the MODEL OUTPUT/);
  assert.match(p, /SOURCE DATA only\. Do not use outside knowledge/);
  for (const verdict of ['CORRECT', 'INCORRECT', 'UNSUPPORTED']) assert.ok(p.includes(verdict), verdict);
  assert.match(p, /state the correct value/);
  assert.match(p, /rounding is acceptable/);
  assert.match(p, /omissions are not accuracy errors/);
  assert.match(p, /list of the facts checked, each with its verdict/);
  assert.match(p, /overall accuracy percentage/);
  assert.deepEqual([...new Set(findPlaceholders(p))].sort(), ['output', 'prompt_input']);
});

test('the Completeness prompt lists the facts of the source and what is present and missing (spec FR-031)', () => {
  const p = DEFAULT_COMPLETENESS_PROMPT;
  assert.match(p, /QA reviewer/);
  assert.match(p, /List every distinct fact in the SOURCE DATA/);
  assert.match(p, /PRESENT or MISSING/);
  assert.match(p, /wrong value, mark it PRESENT and add a short note/);
  assert.match(p, /A list of the facts that appear in the output \(PRESENT\)/);
  assert.match(p, /A list of the facts that do not appear \(MISSING\)/);
  assert.match(p, /overall completeness percentage/);
});

test('default parameters are the confirmed ones and are valid for the platform request', () => {
  assert.equal(DEFAULT_ENDPOINT, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.deepEqual(DEFAULT_MAIN_JSON, { model: 'nvidia/nemotron-3.5-bolt-e4b', temperature: 1, top_p: 0.95, max_tokens: 4096, seed: 42, chat_template_kwargs: { enable_thinking: true } });
  assert.equal(DEFAULT_JUDGE_JSON.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
  assert.equal(DEFAULT_JUDGE_JSON.reasoning_budget, 16384);
  for (const json of [DEFAULT_MAIN_JSON, DEFAULT_JUDGE_JSON]) {
    assert.ok(!('messages' in json) && !('stream' in json), 'the app sets messages and stream itself');
    assert.deepEqual(JSON.parse(jsonText(json)), json);
  }
});

test('the sample dataset loads: five countries in the Eurostat format, one without an expected result', () => {
  const r = parseDataset(SAMPLE_DATASET);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => x.id), ['PL', 'CZ', 'SK', 'HU', 'DE']);
  assert.equal(r.rows.find((x) => x.id === 'DE').expectedResult, '');
  assert.deepEqual(r.notes, ['1 without expected_result (similarity: "no expected result")']);
  assert.ok(r.rows[0].promptInput.startsWith('Selected indicators\tPoland\tSource dataset\nPopulation on 1 January\n(absolute number)\t36 497 495\n(2025)\tView source data'));
  assert.equal(r.rows[0].promptInput.split('View source data').length - 1, 18, 'eighteen indicators');
  assert.ok(r.rows.filter((x) => x.id !== 'PL').every((x) => /\(example/.test(x.name)), 'invented rows are marked as examples');
});
