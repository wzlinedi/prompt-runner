// End-to-end tests: drives headless Chrome through the user stories against the real server and page.
// No internet and no API key: the platform is a local fake (tests/fixtures/fake-upstream.mjs).
//
//   node tests/e2e/run.mjs            run every scenario in tests/e2e/scenarios/
//   node tests/e2e/run.mjs us1 us5    run the named scenarios
//   CHROME_BIN=/path/to/chrome node tests/e2e/run.mjs
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../../app/server.mjs';
import { SECURITY_HEADERS } from '../../app/relay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_TIMEOUT_MS = 240_000;

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  }
  throw new Error('No Chrome found. Install Chrome or Chromium, or set CHROME_BIN.');
}

const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function startFake(options) {
  const file = path.join(here, '..', 'fixtures', 'fake-upstream.mjs');
  if (!existsSync(file)) return null;
  const { startFake: start } = await import(pathToFileURL(file).href);
  return start(options);
}

function runChrome(chrome, url, windowSize = '1280,1800', extraArgs = []) {
  return new Promise(async (resolve) => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'prompt-runner-e2e-'));
    const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--enable-logging=stderr', '--v=0',
      `--user-data-dir=${profile}`, `--window-size=${windowSize}`, '--virtual-time-budget=1800000', ...extraArgs, '--dump-dom', url];
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => child.kill('SIGKILL'), SCENARIO_TIMEOUT_MS);
    child.on('close', async () => { clearTimeout(timer); await rm(profile, { recursive: true, force: true }); resolve({ out, err }); });
  });
}

async function runScenario(name, chrome) {
  const file = path.join(here, 'scenarios', `${name}.mjs`);
  const scenario = await import(pathToFileURL(file).href);
  const logs = [];
  const fake = await startFake(scenario.fakeOptions);
  const config = { fakeUrl: fake?.url ?? null, fakeEndpoint: fake ? `${fake.url}/v1/chat/completions` : null };
  const entry = `import { createDriver } from './driver.mjs';
import run from './scenario.mjs';
const config = await (await fetch('/__e2e/config.json')).json();
const t = createDriver(config);
try { await run(t); } catch (error) { t.crash(error); }
t.finish();`;
  const server = await startServer({
    port: 0,
    log: (line) => logs.push(line),
    extraFiles: {
      '/__e2e/entry.mjs': entry,
      '/__e2e/driver.mjs': await readFile(path.join(here, 'driver.mjs'), 'utf8'),
      '/__e2e/scenario.mjs': await readFile(file, 'utf8'),
      '/__e2e/config.json': JSON.stringify(config),
    },
    pageScripts: ['/__e2e/entry.mjs'],
    // The scenarios read the fake platform's request counter from the page; the real page never talks to another origin.
    securityHeaders: fake ? { ...SECURITY_HEADERS, 'Content-Security-Policy': SECURITY_HEADERS['Content-Security-Policy'].replace("connect-src 'self'", `connect-src 'self' ${fake.url}`) } : SECURITY_HEADERS,
    ...(scenario.serverOptions ?? {}),
  });
  const failures = [];
  try {
    const { out, err } = await runChrome(chrome, server.url, scenario.windowSize, scenario.chromeArgs);
    const match = /<pre id="__e2e_result">([\s\S]*?)<\/pre>/.exec(out);
    if (!match) {
      failures.push('the scenario produced no result (it did not finish, or the page failed to load)');
    } else {
      const result = JSON.parse(unescapeHtml(match[1]));
      failures.push(...result.failures);
      if (scenario.after) {
        const extra = [];
        await scenario.after({ result, fake, logs, server, assert: (cond, msg) => { if (!cond) extra.push(msg); } });
        failures.push(...extra);
      }
    }
    for (const line of err.split('\n')) if (/Uncaught|CONSOLE.*(error|Error)|Content Security Policy|Refused to/.test(line) && !/favicon/.test(line)) failures.push(`page console: ${line.slice(0, 240)}`);
  } finally {
    await server.close();
    await fake?.close();
  }
  return failures;
}

const only = process.argv.slice(2);
const names = (await readdir(path.join(here, 'scenarios'))).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).sort()
  .filter((n) => !only.length || only.includes(n));
if (!names.length) { console.error('No scenarios found.'); process.exit(2); }
const chrome = findChrome();
let failed = 0;
for (const name of names) {
  const failures = await runScenario(name, chrome);
  if (failures.length) { failed++; console.log(`FAIL ${name}`); for (const f of failures) console.log(`   - ${f}`); } else console.log(`PASS ${name}`);
}
console.log(failed ? `\n${failed} of ${names.length} scenarios failed.` : `\nAll ${names.length} scenarios passed.`);
process.exit(failed ? 1 : 0);
