// The testable parts of the run view: the frozen copy behind a confirmation (spec FR-039), the check of the
// judge prompts before a failed-requests re-run (FR-041), and the warning about plain http (FR-044).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeSession, sameInputs, unencryptedLines, failedRerunProblems, blockingProblems } from '../../app/public/src/ui/run-view.mjs';
import { firstRun, isJudge, rowOf, rowsOf, sessionWith } from '../helpers/run-harness.mjs';

const loaded = () => {
  const session = sessionWith();
  session.dataset = rowsOf(3);
  session.selection = ['R1', 'R2'];
  return session;
};

test('the frozen copy does not follow later edits of the session, and sameInputs notices them', () => {
  const session = loaded();
  const frozen = freezeSession(session);
  assert.equal(sameInputs(session, frozen), true);

  session.config.main.endpoint = 'https://elsewhere.example/v1/chat/completions';
  assert.equal(frozen.config.main.endpoint, 'https://main.example/v1/chat/completions', 'the copy keeps the disclosed endpoint');
  assert.equal(sameInputs(session, frozen), false, 'a changed endpoint is noticed');

  const again = freezeSession(session);
  session.prompts.accuracy += ' edited';
  assert.equal(sameInputs(session, again), false, 'a changed prompt is noticed');

  const third = freezeSession(session);
  session.selection = ['R3'];
  session.dataset[0].promptInput = 'changed';
  assert.equal(sameInputs(session, third), false, 'a changed selection or dataset is noticed');
  assert.notEqual(third.dataset[0].promptInput, 'changed', 'rows are copied, not shared');
});

test('the frozen copy is blocked by the same rules as a live session', () => {
  const session = loaded();
  assert.deepEqual(blockingProblems(session), []);
  const frozen = freezeSession(session);
  frozen.prompts.main = 'no place for the data';
  assert.ok(blockingProblems({ ...frozen, started: true }).length > 0);
});

const withUnreadableAccuracy = () => firstRun({ rows: rowsOf(2), respond: (call) => {
  if (isJudge(call) && rowOf(call) === '2' && call.payload.messages[0].content.includes('ACCURACY')) return { output: 'no score', cutOff: false };
  return undefined;
} });

test('the re-run choices that send judge requests are blocked by an invalid judge prompt that they would send, naming the judge', async () => {
  const { run, session } = await withUnreadableAccuracy();
  session.run = run;
  assert.deepEqual(failedRerunProblems(session), []);

  session.prompts.accuracy = 'Rate this: {prompt_input}'; // {output} missing
  const problems = failedRerunProblems(session);
  assert.ok(problems.some((p) => p.includes('{output} is missing')), problems.join(' | '));

  session.prompts.accuracy = '';
  assert.ok(failedRerunProblems(session).length > 0, 'an empty prompt is refused too');
});

test('a judge prompt that the re-run would not send is not checked', async () => {
  const { run, session } = await withUnreadableAccuracy();
  session.run = run;
  session.prompts.completeness = 'broken {nonsense}';
  assert.deepEqual(failedRerunProblems(session), [], 'only Accuracy fails, so only the Accuracy prompt is sent');
});

test('plain http outside this computer is warned about, once per address; https and this computer are not', () => {
  const lines = unencryptedLines(['http://example.com/v1/chat', 'http://example.com/v1/chat', 'https://example.com/x', 'http://localhost:9911/v1', 'http://127.0.0.1:9911/v1', 'http://[::1]:9/v1']);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Warning: http:\/\/example\.com\/v1\/chat uses unencrypted http, so the key and the data travel unencrypted\.$/);
  assert.deepEqual(unencryptedLines([]), []);
});
