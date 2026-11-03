// The launcher of the walk-through with an injected process and connection: the proper close and the profile (spec FR-067 b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { launchBrowser, isSnapChrome } from '../accept/browser.mjs';

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

test('the snap package of Chromium is recognised by its path, by what it resolves to, and by a small launcher script', () => {
  const nothing = () => { throw new Error('ENOENT'); };
  assert.equal(isSnapChrome('/snap/bin/chromium', { resolve: nothing, read: nothing }), true);
  assert.equal(isSnapChrome('/usr/bin/chromium-link', { resolve: () => '/usr/bin/snap', read: nothing }), true);
  assert.equal(isSnapChrome('/usr/bin/chromium-browser', { resolve: (x) => x, read: () => '#!/bin/sh\nexec snap run chromium "$@"\n' }), true);
  assert.equal(isSnapChrome('/usr/bin/google-chrome', { resolve: (x) => x, read: () => '#!/bin/sh\nexec /opt/google/chrome/chrome "$@"\n' }), false);
  assert.equal(isSnapChrome('/usr/bin/google-chrome', { resolve: (x) => x, read: () => 'x'.repeat(5000) + ' snap ' }), false, 'a large binary is not a launcher script');
  assert.equal(isSnapChrome('chrome', { resolve: nothing, read: nothing }), false);
});

test('launching a snap browser warns once, and an ordinary browser does not', async () => {
  const warnings = [];
  const snap = await launchBrowser({ chrome: '/snap/bin/chromium', ...fakes(), warn: (m) => warnings.push(m), isSnap: () => true });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /snap package of Chromium/);
  assert.match(warnings[0], /CHROME_BIN/);
  await snap.close();

  const quiet = [];
  const ordinary = await launchBrowser({ chrome: 'chrome', ...fakes(), warn: (m) => quiet.push(m), isSnap: () => false });
  await ordinary.close();
  assert.deepEqual(quiet, [], 'a browser that closed properly produced a warning');
});

test('a browser that is still running after the kill is reported, with the way to stop it', async () => {
  const f = fakes();
  const original = f.spawnImpl;
  f.spawnImpl = (...args) => {
    const child = original(...args);
    child.pid = 4242;
    child.kill = () => false; // the signal is refused, as a snap package does
    return child;
  };
  const warnings = [];
  const browser = await launchBrowser({ chrome: 'chrome', ...f, warn: (m) => warnings.push(m), isSnap: () => false });
  await browser.close();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /process 4242\) is still running/);
  assert.match(warnings[0], /kill 4242/);

  const snapWarnings = [];
  const g = fakes();
  const originalG = g.spawnImpl;
  g.spawnImpl = (...args) => { const child = originalG(...args); child.pid = 77; child.kill = () => false; return child; };
  const snapBrowser = await launchBrowser({ chrome: 'chrome', ...g, warn: (m) => snapWarnings.push(m), isSnap: () => true });
  await snapBrowser.close();
  assert.match(snapWarnings.at(-1), /systemctl --user stop 'snap\.chromium\.chromium-\*\.scope'/);
});
