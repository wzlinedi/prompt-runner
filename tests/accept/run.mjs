// The automated acceptance walk-through (spec User Story 10, contracts/acceptance-run.md): starts the real application and
// the fake platform, drives a real Chrome with real input, and writes a folder with a report. `npm run accept`.
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { openSync, closeSync, createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFake } from '../fixtures/fake-upstream.mjs';
import { findChrome, launchBrowser } from './browser.mjs';
import { createDriver } from './driver.mjs';
import { renderTerminal, renderHtml, resultsJson } from './report.mjs';
import { checkFolder } from './checkers.mjs';
import { coverageProblems, EXTRA, HUMAN } from './rows.mjs';
import { CHECKS } from './checks/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GROUPS = ['flow', 'exports', 'privacy', 'keyboard', 'appearance', 'keyguard'];
const DEFAULT_TIMEOUT_MS = 60_000;

export function parseArgs(argv) {
  const args = { only: GROUPS, headed: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--headed') args.headed = true;
    else if (argv[i] === '--only') args.only = String(argv[++i] ?? '').split(',').filter(Boolean);
    else throw new Error(`Unknown option ${argv[i]}. Use --only <groups> or --headed.`);
  }
  const unknown = args.only.filter((g) => !GROUPS.includes(g) && !g.includes('.'));
  if (unknown.length) throw new Error(`Unknown group ${unknown.join(', ')}. Groups: ${GROUPS.join(', ')} (or a check id such as flow.stop).`);
  return args;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });
const within = (ms) => (ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`);
const withTimeout = (promise, ms, what) => {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish within ${within(ms)}.`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer)); // a timer left behind would keep a test process alive
};

/** Starts the real command `node app/server.mjs` with its output in `relay.log`; resolves with its address. */
export async function startApp(folder) {
  const port = await freePort();
  const logFile = path.join(folder, 'relay.log');
  const fd = openSync(logFile, 'w');
  const child = spawn(process.execPath, ['app/server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const end = Date.now() + 15_000;
  for (;;) {
    const text = await readFile(logFile, 'utf8').catch(() => '');
    const match = /Prompt Runner is running at (http:\/\/\S+)/.exec(text);
    if (match) return { url: match[1], child, logFile };
    if (child.exitCode !== null) throw new Error(`The application stopped at once (status ${child.exitCode}): ${text.trim()}`);
    if (Date.now() > end) throw new Error('The application did not report its address in time.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function textFilesOf(dir, base = dir) {
  const files = {};
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) Object.assign(files, await textFilesOf(full, base));
    else if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(name)) files[path.relative(base, full)] = await readFile(full, 'utf8');
  }
  return files;
}

/**
 * Runs the walk-through and returns `{ code, verdicts, folder }`. The options are for the tests of the tool itself:
 * `checks` (the list to run), `launch` and `start` (how the browser and the application are started), `coverage`
 * (whether the quickstart is checked against the checks), `out` (the folder for the results), and `write` (the output).
 */
export async function execute(argv = process.argv.slice(2), options = {}) {
  const { checks = CHECKS, launch = launchBrowser, start = startApp, coverage = true, out = path.join(root, 'test-results'), write = (text) => process.stdout.write(text) } = options;
  let args;
  try { args = parseArgs(argv); } catch (error) { console.error(error.message); return { code: 2, verdicts: [] }; }
  const chrome = options.launch ? 'injected' : findChrome();
  if (!chrome) { console.error('No Chrome or Chromium found. Install one, or set CHROME_BIN to its path.'); return { code: 2, verdicts: [] }; }

  const startedAt = new Date().toISOString().replace('T', ' ').replace(/\..*$/, '');
  const folder = path.join(out, `acceptance-${stamp()}`);
  for (const sub of ['screenshots', 'downloads', 'reference']) await mkdir(path.join(folder, sub), { recursive: true });
  const key = `nvapi-FAKE-ACCEPT-${randomBytes(6).toString('hex')}`;
  const secrets = [key]; // every fake key of this run; none may be in the run folder at the end

  // Everything that was started is stopped again: at the end, after an error, and on an interrupt (spec FR-058).
  const cleanups = [];
  let stopping = null; // one stop for everybody: whoever asks later waits for the same one to finish
  const stopAll = () => (stopping ??= (async () => { for (const cleanup of cleanups.splice(0).reverse()) await Promise.resolve().then(cleanup).catch(() => {}); })());
  let interrupted = null; // 130 after Ctrl+C, 143 after a termination request
  const onSignal = (code) => () => { interrupted ??= code; stopAll(); };
  const onInterrupt = onSignal(130);
  const onTerminate = onSignal(143);
  const killApp = () => { try { app?.child.kill('SIGKILL'); } catch { /* gone */ } };
  let app;
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.once('exit', killApp);

  const verdicts = [];
  try {
    const gallery = [];
    let browser;
    try {
      app = await start(folder);
      cleanups.push(() => app.child.kill('SIGKILL'));
      browser = await launch({ chrome, headed: args.headed });
      cleanups.push(() => browser.close());
    } catch (error) {
      console.error(`The walk-through could not start: ${error.message}`);
      return { code: 2, verdicts };
    }

    const shared = new Map(); // pages that several checks of a group use one after the other
    async function makePage(shareKey) {
      const page = await browser.newPage();
      const d = createDriver({ cdp: browser.cdp, page });
      await d.viewport(1280, 900);
      await d.setMedia({ scheme: 'light', motion: 'no-preference' });
      const fakes = [];
      return {
        key: shareKey, page, d, mem: {}, fakes,
        async dispose() { for (const f of fakes.splice(0)) await f.close().catch(() => {}); await page.close(); },
      };
    }

    const selected = checks.filter((c) => args.only.includes(c.group) || args.only.includes(c.id));
    for (const check of selected) {
      if (interrupted) break;
      const started = Date.now();
      const problems = [];
      const evidence = [];
      const verdict = { id: check.id, group: check.group, row: check.row ?? null, title: check.title, verdict: 'pass', expected: check.title, seen: '', evidence, problems };
      let entry = null;
      let discard = true;
      try {
        entry = check.share ? (shared.get(check.share) ?? (shared.set(check.share, await makePage(check.share)), shared.get(check.share))) : await makePage(null);
        const ctx = {
          d: entry.d, mem: entry.mem, appUrl: app.url, key, addSecret: (secret) => secrets.push(secret), folder, relayLog: app.logFile, root, gallery, check,
          get fake() { return entry.mem.fake; },
          /** Starts a fake platform that lives as long as the page of this check. */
          async useFake(fakeOptions = {}) { const f = await startFake(fakeOptions); entry.fakes.push(f); entry.mem.fake = f; return f; },
          async newPage() { return makePage(null); },
          shot: async (name, shotOptions) => { const rel = path.join('screenshots', `${check.id.replace('.', '-')}-${name}.png`); await entry.d.screenshot(path.join(folder, rel), shotOptions); return rel; },
        };
        const t = {
          expect(condition, message) { if (!condition) problems.push(message); return Boolean(condition); },
          problems: (list) => problems.push(...list),
          /** The key audit's matrix of places by ways of ending a run, shown in the report. */
          matrix: (data) => { verdict.matrix = data; },
          note({ expected, seen } = {}) { if (expected !== undefined) verdict.expected = expected; if (seen !== undefined) verdict.seen = seen; },
          /** A file or a screenshot of the run folder that shows what was seen; `bytes` is its size when it is a file. */
          evidence: (rel, bytes) => evidence.push(bytes === undefined ? { path: rel } : { path: rel, bytes }),
          notRun(reason) { verdict.verdict = 'not-run'; verdict.reason = reason; },
        };
        await withTimeout(check.run(t, ctx), check.timeoutMs ?? DEFAULT_TIMEOUT_MS, check.id);
        discard = false;
      } catch (error) {
        problems.push(error.message);
      }
      if (problems.length) {
        verdict.verdict = 'fail';
        if (!verdict.seen) verdict.seen = problems[0];
        if (entry) {
          try { const rel = path.join('screenshots', `fail-${check.id.replace('.', '-')}.png`); await withTimeout(entry.d.screenshot(path.join(folder, rel)), 10_000, 'the screenshot'); verdict.screenshot = rel; } catch { /* the page may be gone */ }
        }
      } else if (!verdict.seen) {
        verdict.seen = verdict.verdict === 'not-run' ? verdict.reason : 'as expected';
      }
      verdict.durationMs = Date.now() - started;
      verdicts.push(verdict);
      write(`${verdict.verdict === 'pass' ? 'ok  ' : verdict.verdict === 'fail' ? 'FAIL' : '--  '} ${check.id}\n`);
      if (entry && (!check.share || discard || problems.length)) { await entry.dispose().catch(() => {}); if (check.share) shared.delete(check.share); }
    }
    for (const entry of shared.values()) await entry.dispose().catch(() => {});
    if (interrupted) { await stopAll(); write('\nInterrupted: everything the walk-through started was stopped.\n'); return { code: interrupted, verdicts }; }

    // The quickstart must be covered completely (spec FR-059).
    if (coverage) {
      const quickstart = await readFile(path.join(root, 'specs', '001-simple-prompt-runner', 'quickstart.md'), 'utf8');
      const missing = coverageProblems(quickstart, checks.map((c) => c.id));
      verdicts.push({ id: 'meta.coverage', group: 'meta', row: null, title: 'every quickstart row has a check or a human entry', verdict: missing.length ? 'fail' : 'pass', expected: 'every row covered', seen: missing.length ? missing[0] : 'every row covered', problems: missing, evidence: [], durationMs: 0 });
    }

    await stopAll();

    const human = Object.entries(EXTRA).filter(([, v]) => typeof v !== 'string').map(([name, v]) => ({ name: name.replace(/^Human: /, ''), reason: v.human }));
    const run = { startedAt, folder: path.relative(root, folder), verdicts, human, gallery };
    await writeFile(path.join(folder, 'report.html'), renderHtml(run));
    await writeFile(path.join(folder, 'results.json'), resultsJson(run));

    // Nothing in the folder may contain the fake key (spec SC-035).
    const leaked = checkFolder(await textFilesOf(folder), secrets);
    if (!leaked.ok) {
      verdicts.push({ id: 'meta.no-key-in-folder', group: 'meta', row: null, title: 'the run folder holds no key', verdict: 'fail', expected: 'no key in any file', seen: leaked.problems[0], problems: leaked.problems, evidence: [], durationMs: 0 });
      await writeFile(path.join(folder, 'report.html'), renderHtml(run));
    }

    write(`\n${renderTerminal(verdicts, human)}\n\nReport: ${path.join(path.relative(root, folder), 'report.html')}\n`);
    return { code: verdicts.some((v) => v.verdict === 'fail') ? 1 : 0, verdicts, folder };
  } catch (error) {
    console.error(`The walk-through stopped on an unexpected error: ${error.stack ?? error}`);
    return { code: 2, verdicts };
  } finally {
    await stopAll();
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    process.off('exit', killApp);
  }
}

export async function main(argv = process.argv.slice(2)) {
  return (await execute(argv)).code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(2); });
}
