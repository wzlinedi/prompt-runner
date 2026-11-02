// One sandbox per way of ending a run (spec FR-067, FR-068, research R36): its own application process (started with the
// inspector so that its memory can be read), its own fake platform, and its own browser with a profile that is written to
// disk. It records what the page does in memory only, examines every place of contracts/key-audit.md, and stops everything.
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startFake } from '../fixtures/fake-upstream.mjs';
import { launchBrowser } from './browser.mjs';
import { createDriver } from './driver.mjs';
import { keyForms } from './leak.mjs';
import { scanFiles, scanDirectory, scanText, scanSnapshot, scanStorage, scanCookies, scanNetwork } from './scanners.mjs';
import { takeStrings, connectToNode } from './snapshot.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });

export const PLACES = ['files', 'profile', 'app log', 'app memory', 'page memory', 'console', 'network', 'history', 'cookies', 'storage', 'exports', 'page text'];

/** Starts `node --inspect=0 app/server.mjs` with its output in `logFile`; resolves with `{ url, child, logFile }`. */
export async function startInspectedApp({ root, logFile }) {
  const port = await freePort();
  const fd = openSync(logFile, 'w');
  const child = spawn(process.execPath, ['--inspect=0', 'app/server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const end = Date.now() + 15_000;
  for (;;) {
    const text = await readFile(logFile, 'utf8').catch(() => '');
    const match = /Prompt Runner is running at (http:\/\/\S+)/.exec(text);
    if (match && /Debugger listening on ws:/.test(text)) return { url: match[1], child, logFile };
    if (child.exitCode !== null) throw new Error(`The application stopped at once (status ${child.exitCode}).`);
    if (Date.now() > end) { child.kill('SIGKILL'); throw new Error('The application did not report its address in time.'); }
    await sleep(50);
  }
}

/** Records the page's traffic, console and exceptions in memory. */
function recordPage(session) {
  const requests = [];
  const byRequest = new Map();
  const responses = [];
  const byResponse = new Map();
  const consoleTexts = [];
  const jobs = new Set();
  const job = (promise) => { const j = promise.catch(() => {}).finally(() => jobs.delete(j)); jobs.add(j); };
  session.on('Network.requestWillBeSent', (p) => {
    const r = { url: p.request.url, method: p.request.method, headers: { ...p.request.headers }, body: p.request.postData ?? null };
    requests.push(r);
    byRequest.set(p.requestId, r);
    if (p.request.hasPostData && r.body === null) job(session.send('Network.getRequestPostData', { requestId: p.requestId }).then((x) => { r.body = x.postData; }));
  });
  session.on('Network.requestWillBeSentExtraInfo', (p) => { const r = byRequest.get(p.requestId); if (r) Object.assign(r.headers, p.headers); });
  session.on('Network.responseReceived', (p) => {
    const rec = { url: p.response.url, headers: { ...p.response.headers }, body: null, type: p.type };
    responses.push(rec);
    byResponse.set(p.requestId, rec);
  });
  session.on('Network.responseReceivedExtraInfo', (p) => { const r = byResponse.get(p.requestId); if (r) Object.assign(r.headers, p.headers); });
  session.on('Network.loadingFinished', (p) => {
    const rec = byResponse.get(p.requestId);
    if (!rec || ['Image', 'Font', 'Media', 'Stylesheet'].includes(rec.type)) return;
    job(session.send('Network.getResponseBody', { requestId: p.requestId }).then((x) => { rec.body = x.base64Encoded ? Buffer.from(x.body, 'base64').toString('utf8') : x.body; }));
  });
  for (const name of ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded']) session.on(name, (p) => consoleTexts.push({ where: name, text: JSON.stringify(p) }));
  return { requests, responses, consoleTexts, settle: async () => { while (jobs.size) await Promise.all([...jobs]); } };
}

const storageInPage = async () => {
  const entries = [];
  for (const [kind, store] of [['local', localStorage], ['session', sessionStorage]]) for (let i = 0; i < store.length; i++) { const k = store.key(i); entries.push({ kind, name: k, value: store.getItem(k) }); }
  for (const info of await indexedDB.databases()) {
    entries.push({ kind: 'indexeddb', name: info.name, value: '' });
    const db = await new Promise((res, rej) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const name of db.objectStoreNames) {
      const all = await new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      entries.push({ kind: 'indexeddb', name: `${info.name}/${name}`, value: JSON.stringify(all) });
    }
    db.close();
  }
  for (const name of await caches.keys()) entries.push({ kind: 'cache', name, value: '' });
  for (const reg of await navigator.serviceWorker.getRegistrations()) entries.push({ kind: 'service worker', name: reg.scope, value: '' });
  return entries;
};

const pageTexts = () => {
  const fields = [...document.querySelectorAll('input,textarea,select')].map((e, i) => ({ where: `field ${e.id || i}`, text: String(e.value ?? '') }));
  const attributes = [...document.querySelectorAll('*')].map((e) => [...e.attributes].map((a) => `${a.name}=${a.value}`).join(' ')).join('\n');
  return [
    { where: 'text', text: document.documentElement.textContent },
    { where: 'visible text', text: document.body.innerText },
    { where: 'attributes', text: attributes },
    { where: 'title', text: document.title },
    ...fields,
  ];
};

/**
 * Starts the sandbox of one way. Options: `way` (a name), `folder` (the run folder), `key` (`{ text, distinctive }`), `root` (the
 * project), `fakeOptions` (an object, or a function of the key text), and, for tests of the tool, `launch`, `startApp`, `roots`.
 */
export async function createSandbox({ way, folder, key, root, fakeOptions = {}, launch = launchBrowser, startApp = startInspectedApp, roots = null }) {
  const dir = path.join(folder, 'keyguard', way);
  await mkdir(path.join(dir, 'downloads'), { recursive: true });
  const forms = keyForms(key);
  const since = Date.now() - 1000;
  const started = [];
  const stopAll = async () => { for (const stop of started.splice(0).reverse()) await Promise.resolve().then(stop).catch(() => {}); };
  try {
    const fake = await startFake(typeof fakeOptions === 'function' ? fakeOptions(key.text, forms) : fakeOptions);
    started.push(() => fake.close());
    const app = await startApp({ root, logFile: path.join(dir, 'app.log') });
    started.push(() => app.child.kill('SIGKILL'));
    const processView = await connectToNode(await readFile(app.logFile, 'utf8'));
    started.push(() => processView.close());
    const browser = await launch({});
    let profile = null;
    started.push(async () => { if (!profile) await browser.close(); else await profile.removeProfile(); });
    const page = await browser.newPage({ persistent: true });
    const d = createDriver({ cdp: browser.cdp, page });
    await d.viewport(1280, 900);
    await d.setMedia({ scheme: 'light', motion: 'no-preference' });
    await page.session.send('Network.enable', { maxPostDataSize: 4_000_000 });
    await page.session.send('Log.enable');
    const recorded = recordPage(page.session);
    const fileRoots = roots ?? [root, folder, os.tmpdir(), path.join(os.homedir(), '.config'), path.join(os.homedir(), '.cache')];

    const sandbox = {
      way, key, fake, d, appUrl: app.url, mem: {}, dir, forms, app, processView, profileDir: browser.profileDir,
      /** The context the helpers of the checks expect. */
      get ctx() { return { d, appUrl: app.url, fake, key: key.text, mem: sandbox.mem }; },

      /** Examines every place that can be examined while the browser runs. Resolves with `{ [place]: result }`. */
      async observe() {
        await recorded.settle();
        const places = {};
        const own = path.join(folder, 'keyguard');
        places.files = await scanFiles(fileRoots, forms, { since, skip: (p) => p === browser.profileDir || p.startsWith(`${own}${path.sep}`) });
        places['app log'] = scanText('app log', [{ where: 'app.log', text: await readFile(app.logFile, 'utf8').catch(() => '') }], forms);
        places['app memory'] = scanSnapshot('app memory', (await takeStrings(processView)).strings, forms);
        places['page memory'] = scanSnapshot('page memory', (await takeStrings(page.session)).strings, forms);
        places.console = scanText('console', recorded.consoleTexts, forms);
        places.network = scanNetwork({
          requests: recorded.requests, responses: recorded.responses,
          fakeRequests: fake.requests.map((r) => ({ path: r.path, authorization: r.authorization, bodyText: JSON.stringify(r.body ?? null) })),
        }, forms, { needUses: false });
        const history = await page.session.send('Page.getNavigationHistory');
        const where = await d.evaluate(() => ({ href: location.href, referrer: document.referrer, length: history.length }));
        places.history = scanText('history', [...history.entries.map((e) => ({ where: 'history entry', text: `${e.url}\n${e.title}` })), { where: 'location', text: `${where.href}\n${where.referrer}` }], forms);
        places.cookies = scanCookies((await page.session.send('Network.getAllCookies')).cookies, forms);
        places.storage = scanStorage(await d.evaluate(storageInPage), forms);
        for (let i = 0; i < 40 && (await readdir(path.join(dir, 'downloads')).catch(() => [])).some((n) => /\.(crdownload|tmp)$/.test(n)); i++) await sleep(100); // the browser renames a finished download
        places.exports = await scanDirectory(path.join(dir, 'downloads'), forms, { place: 'exports' });
        places['page text'] = scanText('page text', await d.evaluate(pageTexts), forms);
        return places;
      },

      /** Closes the browser properly, reads its profile from disk, removes it, and stops the application and the fake. */
      async finish() {
        profile = await browser.close({ keepProfile: true });
        const result = await scanDirectory(profile.profileDir, forms, { place: 'profile' });
        await profile.removeProfile();
        await stopAll();
        return result;
      },

      /** Stops everything without reading the profile (after an error). */
      stop: stopAll,

      /** The traffic recorded so far (for the permitted-use check of a way). */
      traffic: () => ({ requests: recorded.requests, responses: recorded.responses, fakeRequests: fake.requests.map((r) => ({ path: r.path, authorization: r.authorization, bodyText: JSON.stringify(r.body ?? null) })) }),
    };
    return sandbox;
  } catch (error) {
    await stopAll();
    throw error;
  }
}

/** Writes nothing the audit found into a file; only the counts of a result are kept for the report. */
export const counts = (result) => ({ examined: result.examined, skipped: result.skipped?.length ?? 0, hits: result.hits.length, empty: Boolean(result.empty), nothingCanExist: Boolean(result.nothingCanExist) });
