// Shared helpers for the runner tests: a fake clock, rows, a session, and a finished first run.
import { startRun } from '../../app/public/src/runner.mjs';
import { freshSession } from '../../app/public/src/state.mjs';

export const KEY = 'nvapi-SECRET-TEST-KEY';
export const JUDGE_KEY = 'nvapi-JUDGE-SECRET';
export const MAIN_EP = 'https://main.example/v1/chat/completions';
export const JUDGE_EP = 'https://judge.example/v1/chat/completions';

export const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `R${i + 1}`, name: `Case ${i + 1}`, promptInput: `input-${i + 1}`, expectedResult: `EXPECTED-${i + 1}` }));
export const isJudge = (call) => call.payload.messages[0].content.includes('SCORE: <number>');
export const rowOf = (call) => /input-(\d+)/.exec(call.payload.messages[0].content)?.[1];

export function clockHarness() {
  const clock = { t: 1_000_000 };
  return {
    now: () => clock.t,
    date: () => 1_800_000_000_000 + clock.t,
    sleep: (ms) => { const due = clock.t + ms; return new Promise((resolve) => setImmediate(() => { clock.t = Math.max(clock.t, due); resolve(); })); },
  };
}

export function sessionWith(sameAsMain = true) {
  const session = freshSession();
  session.config.main = { endpoint: MAIN_EP, apiKey: KEY, params: '{"model":"main-model","temperature":0.5}' };
  session.config.judge = { sameAsMain, endpoint: JUDGE_EP, apiKey: JUDGE_KEY, params: '{"model":"judge-model"}' };
  return session;
}

/** A finished first run. `respond(call)` may answer a call differently from the default. */
export async function firstRun({ rows = rowsOf(3), grade = 80, respond, session = sessionWith() } = {}) {
  const time = clockHarness();
  const ask = async (call) => {
    if (respond) { const custom = respond(call); if (custom) return custom; }
    return isJudge(call) ? { output: `fine\nSCORE: ${grade}`, cutOff: false } : { output: `OUTPUT-${rowOf(call)}`, cutOff: false };
  };
  const handle = startRun({ dataset: rows, rowIds: rows.map((r) => r.id), prompts: session.prompts, config: session.config, mode: 'full', deps: { ask, ...time }, clearKeys() {} });
  return { run: await handle.done, session, time };
}
