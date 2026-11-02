import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORMAT_INSTRUCTION, withFormatInstruction, readAnswer } from '../../app/public/src/judge.mjs';

test('the appended instruction is exactly the one in the contract', () => {
  const contract = readFileSync(new URL('../../specs/001-simple-prompt-runner/contracts/judge-answer-format.md', import.meta.url), 'utf8');
  const section = contract.split('## What the app appends to every judge prompt')[1];
  const block = /```text\n([\s\S]*?)\n```/.exec(section)[1];
  assert.equal(FORMAT_INSTRUCTION, block);
  assert.equal(withFormatInstruction('JUDGE'), `JUDGE\n\n${block}`);
});

const table = [
  ['a lists\nSCORE: 89', { grade: 89, rationale: 'a lists' }],
  ['text\n\nscore: 89.4 %', { grade: 89, rationale: 'text' }],
  ['x\nSCORE: 66.67', { grade: 67, rationale: 'x' }],
  ['x\nSCORE: 0', { grade: 0, rationale: 'x' }],
  ['x\nSCORE: 100', { grade: 100, rationale: 'x' }],
  ['x\r\nSCORE: 50\r\n', { grade: 50, rationale: 'x' }],
  ['  x  \n  SCORE:  75%  \n\n', { grade: 75, rationale: 'x' }],
  ['x\n**SCORE: 80**', { grade: 80, rationale: 'x' }],
  ['x\n`SCORE: 80`', { grade: 80, rationale: 'x' }],
  ['SCORE: 10\nmiddle\nSCORE: 20', { grade: 20, rationale: 'SCORE: 10\nmiddle' }],
  ['The SCORE: 12 appears inside a sentence.\nSCORE: 60', { grade: 60, rationale: 'The SCORE: 12 appears inside a sentence.' }],
  ['SCORE: 90', { grade: 90, rationale: '' }],
  // Forms that models use (spec FR-012, User Story 8, scenario 5)
  ['x\n**SCORE:** 85', { grade: 85, rationale: 'x' }],
  ['x\n**SCORE**: 85%', { grade: 85, rationale: 'x' }],
  ['x\nSCORE: 85/100', { grade: 85, rationale: 'x' }],
  ['x\nSCORE: 85 / 100', { grade: 85, rationale: 'x' }],
  ['x\n## SCORE: 85', { grade: 85, rationale: 'x' }],
  ['x\n> SCORE: 85%', { grade: 85, rationale: 'x' }],
  ['x\n__SCORE:__ 85.5/100', { grade: 86, rationale: 'x' }],
  ['x\n**Score: 85%**', { grade: 85, rationale: 'x' }],
];
for (const [answer, expected] of table) {
  test(`reads ${JSON.stringify(answer.slice(0, 40))}`, () => assert.deepEqual(readAnswer(answer), expected));
}

const unreadable = [
  ['x\nSCORE: 130', /outside 0–100/],
  ['x\nSCORE: 100.5', /outside 0–100/],
  ['Looks correct overall.', /no SCORE line/],
  ['The SCORE: 70 is inside a sentence only.', /no SCORE line/],
  ['x\nSCORE: abc', /no SCORE line/],
  ['x\nSCORE: -5', /no SCORE line/],
  ['x\nSCORE: 80\nSCORE: 500', /outside 0–100/],
  ['x\nSCORE: 185/100', /outside 0–100/],
  ['x\nSCORE: 8/10', /no SCORE line/],
  ['x\n**SCORE:** high', /no SCORE line/],
  ['', /the answer is empty/],
  ['   \n  ', /the answer is empty/],
];
for (const [answer, reason] of unreadable) {
  test(`unreadable: ${JSON.stringify(answer.slice(0, 40))}`, () => {
    const result = readAnswer(answer);
    assert.equal(result.grade, undefined);
    assert.match(result.error, /^unreadable answer: /);
    assert.match(result.error, reason);
    assert.equal(result.rawAnswer, answer);
  });
}

test('a non-string answer is unreadable and does not throw', () => {
  assert.match(readAnswer(null).error, /the answer is empty/);
  assert.match(readAnswer(undefined).error, /the answer is empty/);
});
