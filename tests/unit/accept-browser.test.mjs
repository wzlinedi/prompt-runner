// The launcher of the walk-through with an injected process and connection: the proper close and the profile (spec FR-067 b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { launchBrowser } from '../accept/browser.mjs';

function fakes() {
  const log = [];
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = (signal) => { log.push(`kill ${signal}`); child.exitCode = 0; child.emit('exit', 0); };
  const spawnImpl = () => { queueMicrotask(() => child.stderr.emit('data', 'DevTools listening on ws://127.0.0.1:1/devtools/browser/x\n')); return child; };
  const cdp = {
    send: async (method, params) => {
      log.push(method + (params?.browserContextId ? ' (context)' : ''));
      if (method === 'Browser.close') setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 10);
      if (method === 'Target.attachToTarget') return { sessionId: 's1' };
      if (method === 'Target.createTarget') return { targetId: 't1' };
      if (method === 'Target.createBrowserContext') return { browserContextId: 'c1' };
      return {};
    },
    session: () => ({ send: async () => ({}) }),
    close: () => log.push('cdp.close'),
  };
  return { log, spawnImpl, connectImpl: async () => cdp };
}

test('a persistent tab is made in the default context; an ordinary tab in its own context', async () => {
  const f = fakes();
  const browser = await launchBrowser({ chrome: 'chrome', ...f });
  await browser.newPage({ persistent: true });
  assert.ok(f.log.includes('Target.createTarget'));
  assert.ok(!f.log.includes('Target.createBrowserContext'));
  await browser.newPage();
  assert.ok(f.log.includes('Target.createBrowserContext'));
  await browser.close();
});

test('close with keepProfile sends Browser.close before anything is killed, and the profile stays until it is removed', async () => {
  const f = fakes();
  const browser = await launchBrowser({ chrome: 'chrome', ...f });
  const { profileDir, removeProfile } = await browser.close({ keepProfile: true });
  assert.ok(f.log.indexOf('Browser.close') >= 0);
  assert.ok(!f.log.includes('kill SIGKILL'), 'the browser was killed instead of closed');
  await access(profileDir);
  await removeProfile();
  await assert.rejects(access(profileDir));
});

test('an ordinary close kills the browser and removes the profile', async () => {
  const f = fakes();
  const browser = await launchBrowser({ chrome: 'chrome', ...f });
  await browser.close();
  assert.ok(f.log.includes('kill SIGKILL'));
  await assert.rejects(access(browser.profileDir));
});
