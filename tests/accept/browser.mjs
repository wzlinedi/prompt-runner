// Starts Chrome for the walk-through, with its own profile and a free debugging port, and stops it again (spec FR-058,
// research R30). One browser; one context and one tab per group of checks (their storage is separate, as in a fresh browser).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { rmSync, realpathSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cdp } from './cdp.mjs';

/** Chrome or Chromium: `CHROME_BIN`, or the first of the usual names that is installed; null when there is none. */
export function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

/**
 * True when `chrome` is the snap package of Chromium. Snap confines the browser (AppArmor), and a confined process refuses
 * signals from outside, so the walk-through cannot stop it: it stays running after the run. `resolve` and `read` are
 * replaced in the unit tests.
 */
export function isSnapChrome(chrome, { resolve = realpathSync, read = readFileSync } = {}) {
  if (/(^|\/)snap\//.test(chrome)) return true;
  try { if (path.basename(resolve(chrome)) === 'snap') return true; } catch { /* a bare name on the PATH, or nothing there */ }
  try { const text = read(chrome, 'utf8'); return text.length < 4096 && /\bsnap\b/.test(text); } catch { return false; } // a small launcher script
}

export const snapWarning = (chrome) => `Warning: ${chrome} is the snap package of Chromium. Snap confines the browser, so it cannot be closed from here `
  + 'and may keep running after the run (using memory). Use Google Chrome or Chromium installed as an ordinary package, or set CHROME_BIN to its path.';

/** Starts the browser and connects to it. Resolves with `{ cdp, newPage, close }`. */
export async function launchBrowser({ chrome = findChrome(), headed = false, timeoutMs = 20_000, spawnImpl = spawn, connectImpl = (url) => Cdp.connect(url), warn = (message) => console.warn(message), isSnap = isSnapChrome } = {}) {
  if (!chrome) throw new Error('No Chrome or Chromium found. Install one, or set CHROME_BIN to its path.');
  const snap = isSnap(chrome);
  if (snap) warn(snapWarning(chrome));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'prompt-runner-accept-'));
  const args = [
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-gpu', '--disable-background-networking', '--disable-extensions', '--disable-sync', '--hide-scrollbars',
    ...(headed ? [] : ['--headless=new']), 'about:blank',
  ];
  const child = spawnImpl(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const onExit = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* gone */ } };
  process.once('exit', onExit);

  const wsUrl = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not report its debugging address in time.')), timeoutMs);
    child.stderr.on('data', (chunk) => {
      text += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome stopped at once (status ${code}).`)); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  }).catch(async (error) => { onExit(); throw error; });

  child.on('error', () => { /* a kill that is refused is reported by close() */ });
  const cdp = await connectImpl(wsUrl);

  /** A new tab in a new browser context; resolves with the tab's session and the ids needed to close it. */
  async function newPage() {
    const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const session = cdp.session(sessionId);
    await Promise.all([session.send('Page.enable'), session.send('Runtime.enable')]);
    return {
      session, browserContextId, targetId,
      async close() {
        try { await cdp.send('Target.disposeBrowserContext', { browserContextId }); } catch { /* the browser is going away */ }
      },
    };
  }

  /** A tab in the browser's default context: its storage, cookies and cache are written to the profile on disk (the key audit reads them there). */
  async function newPersistentPage() {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const session = cdp.session(sessionId);
    await Promise.all([session.send('Page.enable'), session.send('Runtime.enable')]);
    return {
      session, browserContextId: undefined, targetId,
      async close() { try { await cdp.send('Target.closeTarget', { targetId }); } catch { /* the browser is going away */ } },
    };
  }

  const exited = (ms) => new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); setTimeout(resolve, ms); });
  /** Says so when the browser is still running after it was told to stop (a snap package refuses the signal). */
  const reportIfRunning = () => {
    if (child.exitCode !== null || child.signalCode != null) return;
    const stop = snap ? "systemctl --user stop 'snap.chromium.chromium-*.scope'" : `kill ${child.pid}`;
    warn(`Warning: the browser (process ${child.pid}) is still running and could not be stopped. Stop it with: ${stop}`);
  };
  const removeProfile = () => rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});

  /**
   * Stops the browser. `keepProfile: true` closes it properly (`Browser.close`, so that it writes what it holds to the profile),
   * waits for the process to exit, and leaves the profile folder to the caller, who calls `removeProfile()` after reading it.
   */
  async function close({ keepProfile = false } = {}) {
    process.off('exit', onExit);
    if (keepProfile) {
      await cdp.send('Browser.close', {}, undefined, 5000).catch(() => {}); // the connection may end before the answer
      await exited(10_000);
      cdp.close();
      if (child.exitCode === null) child.kill('SIGKILL');
      await exited(2000);
      reportIfRunning();
      return { profileDir: profile, removeProfile };
    }
    cdp.close();
    child.kill('SIGKILL');
    await exited(2000);
    reportIfRunning();
    // Chrome may still be writing into its profile for a moment after it was killed.
    await removeProfile();
    return { profileDir: profile, removeProfile };
  }

  return { cdp, newPage: (options = {}) => (options.persistent ? newPersistentPage() : newPage()), close, chrome, profileDir: profile, removeProfile };
}
