// The orchestration of the acceptance walk-through itself (spec FR-058, FR-063): it stops everything it started, also
// after an error, and a check that fails, throws, or never ends does not stop the others. No browser is needed: the
// browser is replaced by a stand-in, the application is the real command.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execute, startApp, parseArgs } from '../accept/run.mjs';

const out = await mkdtemp(path.join(os.tmpdir(), 'accept-run-test-'));
after(() => rm(out, { recursive: true, force: true }));

const standIn = async () => ({
  cdp: {},
  close: async () => {},
  newPage: async () => ({ session: { send: async () => ({}), on: () => () => {}, waitFor: async () => ({}) }, browserContextId: 'ctx', close: async () => {} }),
});
const write = () => {}; // the walk-through's own output is not wanted in the test report
const quiet = (fn) => fn();
const answers = (url) => fetch(url, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);

test('a check that throws, one that never ends, and one that fails do not stop the others; the application is stopped afterwards', async () => {
  let app;
  let url;
  const checks = [
    { id: 'flow.first', group: 'flow', title: 'first', async run(t, ctx) { url = ctx.appUrl; t.expect(true, 'never'); } },
    { id: 'flow.throws', group: 'flow', title: 'throws', async run() { throw new Error('boom'); } },
    { id: 'flow.hangs', group: 'flow', title: 'hangs', timeoutMs: 200, run: () => new Promise(() => {}) },
    { id: 'flow.fails', group: 'flow', title: 'fails', async run(t) { t.expect(false, 'it did not work'); t.note({ expected: 'x', seen: 'y' }); } },
    { id: 'flow.last', group: 'flow', title: 'last', async run() {} },
  ];
  const result = await quiet(() => execute(['--only', 'flow'], { checks, launch: standIn, coverage: false, write, out, start: async (folder) => (app = await startApp(folder)) }));
  const by = Object.fromEntries(result.verdicts.map((v) => [v.id, v]));
  assert.equal(by['flow.first'].verdict, 'pass');
  assert.equal(by['flow.throws'].verdict, 'fail');
  assert.match(by['flow.throws'].problems[0], /boom/);
  assert.equal(by['flow.hangs'].verdict, 'fail');
  assert.match(by['flow.hangs'].problems[0], /did not finish within 200 ms/);
  assert.equal(by['flow.fails'].verdict, 'fail');
  assert.equal(by['flow.fails'].seen, 'y');
  assert.equal(by['flow.last'].verdict, 'pass', 'the check after the failures still ran');
  assert.equal(result.code, 1);
  assert.ok(url, 'the application had an address');
  assert.equal(await answers(url), false, 'the application of the run is stopped');
  assert.ok(app.child.killed || app.child.exitCode !== null || app.child.signalCode !== null, 'its process is gone');
});

test('an unexpected error after the start still stops the application and exits with status 2', async () => {
  let app;
  const checks = [{ get group() { throw new Error('the registry is broken'); }, id: 'flow.bad' }];
  const result = await quiet(() => execute(['--only', 'flow'], { checks, launch: standIn, coverage: false, write, out, start: async (folder) => (app = await startApp(folder)) }));
  assert.equal(result.code, 2);
  assert.equal(await answers(app.url), false, 'the application is stopped');
});

test('a browser that cannot be started gives status 2 and leaves no application behind', async () => {
  let app;
  const failing = async () => { throw new Error('no browser here'); };
  const result = await quiet(() => execute(['--only', 'flow'], { checks: [], launch: failing, coverage: false, write, out, start: async (folder) => (app = await startApp(folder)) }));
  assert.equal(result.code, 2);
  assert.equal(await answers(app.url), false, 'the application is stopped');
});

test('an interrupt (Ctrl+C) stops the walk-through between checks, stops the application, and gives status 130', async () => {
  let app;
  const ran = [];
  const checks = [
    { id: 'flow.one', group: 'flow', title: 'one', async run() { ran.push('one'); process.emit('SIGINT'); await new Promise((r) => setTimeout(r, 30)); } },
    { id: 'flow.two', group: 'flow', title: 'two', async run() { ran.push('two'); } },
  ];
  const result = await execute(['--only', 'flow'], { checks, launch: standIn, coverage: false, write, out, start: async (folder) => (app = await startApp(folder)) });
  assert.equal(result.code, 130);
  assert.deepEqual(ran, ['one'], 'the checks after the interrupt did not run');
  assert.equal(await answers(app.url), false, 'the application is stopped');
  assert.equal(process.listenerCount('SIGINT') <= 1, true, 'the handler of the walk-through was removed');
});

test('the options are read, and a wrong one is refused with status 2', async () => {
  assert.deepEqual(parseArgs(['--only', 'flow,exports']).only, ['flow', 'exports']);
  assert.equal(parseArgs(['--headed']).headed, true);
  assert.deepEqual(parseArgs(['--only', 'flow.stop']).only, ['flow.stop']);
  assert.throws(() => parseArgs(['--nonsense']), /Unknown option/);
  assert.throws(() => parseArgs(['--only', 'bogus']), /Unknown group bogus/);
  const result = await quiet(() => execute(['--nonsense'], { checks: [], launch: standIn, coverage: false, write, out }));
  assert.equal(result.code, 2);
});
