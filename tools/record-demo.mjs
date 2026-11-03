// Records a short demo video of the page (docs/assets/demo.mp4) on a fake platform, with the driver of the acceptance
// walk-through (tests/accept/): a real Chrome, real clicks and key presses, the frames taken by Chrome's own screencast.
// No dependencies in the project. Needs Chrome or Chromium and an `ffmpeg` (set FFMPEG_BIN to its path if it is not on the PATH).
//   node tools/record-demo.mjs [output.mp4]
// The key typed in the video is a made-up text; the platform is a fake one, so the answers in the video are placeholders.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFake } from '../tests/fixtures/fake-upstream.mjs';
import { launchBrowser } from '../tests/accept/browser.mjs';
import { createDriver } from '../tests/accept/driver.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(root, 'docs/assets/demo.mp4'));
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const WIDTH = 1280;
const HEIGHT = 800;
const FAKE_KEY = 'nvapi-DEMO-this-is-not-a-real-key';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });

if (spawnSync(ffmpeg, ['-version']).status !== 0) {
  console.error('ffmpeg was not found. Install it, or set FFMPEG_BIN to its path.');
  process.exit(2);
}

/** Starts the real command `node app/server.mjs`; resolves with its address. */
async function startApp(folder) {
  const port = await freePort();
  const logFile = path.join(folder, 'app.log');
  const fd = openSync(logFile, 'w');
  const child = spawn(process.execPath, ['app/server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const end = Date.now() + 15_000;
  for (;;) {
    const match = /Prompt Runner is running at (http:\/\/\S+)/.exec(await readFile(logFile, 'utf8').catch(() => ''));
    if (match) return { url: match[1], child };
    if (child.exitCode !== null) throw new Error('The application stopped at once.');
    if (Date.now() > end) throw new Error('The application did not report its address in time.');
    await sleep(50);
  }
}

/** The data of the demo, as copied from a spreadsheet (tab separated), and answers that look like a real run. */
const COUNTRIES = [
  { id: 'PL', name: 'Poland', facts: 'Population 36.5 million; unemployment 3.1%; gender pay gap 4.0%', expected: 'Poland has about 36.5 million inhabitants. Unemployment is low at 3.1% and the gender pay gap is 4.0%.', answer: 'Poland has roughly 36.5 million inhabitants. Unemployment is low (3.1%) and the gender pay gap is 4.0%.', score: 94, verdict: 'every fact in the answer matches the expected result.' },
  { id: 'CZ', name: 'Czechia', facts: 'Population 10.9 million; unemployment 2.7%; gender pay gap 11.8%', expected: 'Czechia has about 10.9 million inhabitants and low unemployment of 2.7%. The gender pay gap is 11.8%.', answer: 'Czechia has about 10.9 million inhabitants and unemployment of 2.7%.', score: 71, verdict: 'the gender pay gap is missing from the answer.' },
  { id: 'SK', name: 'Slovakia', facts: 'Population 5.4 million; unemployment 5.2%; youth unemployment 19.0%', expected: 'Slovakia has about 5.4 million inhabitants. Unemployment is 5.2% and youth unemployment is high at 19.0%.', answer: 'Slovakia has 5.4 million inhabitants. Unemployment is 5.2%, and youth unemployment reaches 19.0%.', score: 92, verdict: 'all facts are present and correct.' },
  { id: 'HU', name: 'Hungary', facts: 'Population 9.6 million; inflation 4.5%; government debt 73.0% of GDP', expected: 'Hungary has about 9.6 million inhabitants. Inflation is 4.5% and government debt is 73.0% of GDP.', answer: 'Hungary has about 9.6 million inhabitants. Inflation is 5.4% and government debt is 73.0% of GDP.', score: 62, verdict: 'the inflation figure is wrong (5.4% instead of 4.5%).' },
];
const SPREADSHEET = ['id', 'name', 'prompt_input', 'expected_result'].join('\t') + '\n'
  + COUNTRIES.map((c) => [c.id, c.name, c.facts, c.expected].join('\t')).join('\n');
const fakeRules = [
  ...COUNTRIES.map((c) => ({
    match: (body, content) => content.includes('SCORE: <number>') && content.includes(c.facts),
    respond: { content: `Facts checked:\n- population: CORRECT\n\nOverall: ${c.verdict}\nSCORE: ${c.score}` },
  })),
  ...COUNTRIES.map((c) => ({ match: (body, content) => !content.includes('SCORE: <number>') && content.includes(c.facts), respond: { content: c.answer } })),
];

const work = await mkdtemp(path.join(os.tmpdir(), 'prompt-runner-demo-'));
const framesDir = path.join(work, 'frames');
await mkdir(framesDir);
let app; let fake; let browser; let exitCode = 0;
try {
  fake = await startFake({ rules: fakeRules });
  app = await startApp(work);
  browser = await launchBrowser();
  const page = await browser.newPage();
  const d = createDriver({ cdp: browser.cdp, page });
  const { session } = page;
  await d.viewport(WIDTH, HEIGHT);
  await d.setMedia({ scheme: 'light', motion: 'no-preference' });

  // Chrome sends a frame whenever the picture changes; each frame is kept with its time.
  const frames = [];
  const writes = [];
  session.on('Page.screencastFrame', (p) => {
    const file = path.join(framesDir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ file, time: p.metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(p.data, 'base64')));
    session.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });

  const caption = (text) => d.evaluate((t) => {
    let el = document.getElementById('demoCaption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demoCaption';
      el.style.cssText = 'position:fixed;left:24px;bottom:18px;z-index:99999;max-width:780px;padding:10px 20px;border-radius:12px;background:rgba(20,20,40,.92);color:#fff;font:600 19px/1.35 system-ui,sans-serif;text-align:left;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.35)';
      document.body.append(el);
    }
    el.textContent = t;
    el.hidden = !t;
  }, text);
  const typeSlowly = async (text, ms = 45) => { for (const ch of text) { await d.type(ch); await sleep(ms); } };
  const scrollTo = (selector) => d.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start', behavior: 'smooth' }), selector);

  await d.open(app.url);
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
  await sleep(500);

  await caption('Prompt Runner: try a prompt on a dataset and let LLM judges grade the answers');
  await sleep(3500);
  await caption('A session starts with one button: New Session');
  await sleep(1200);
  await d.click('#newSession');
  await sleep(1800);

  const smoothScroll = (selector, block = 'start') => d.evaluate((sel, b) => document.querySelector(sel).scrollIntoView({ block: b, behavior: 'smooth' }), selector, block);

  // Step 1: the dataset, from a file or pasted.
  await caption('Step 1: the dataset. Load a CSV file (choose it, or drop it on the page), or paste the data');
  await smoothScroll('#dsDrop', 'center');
  await sleep(5500);
  await caption('Here: copy the cells from a spreadsheet (id, name, prompt_input, expected_result)');
  await sleep(3500);
  await d.click('#dsText');
  await d.clearFocused();
  await caption('and paste them into the page');
  await sleep(1500);
  await d.paste(SPREADSHEET);
  await sleep(3500);
  await d.click('#dsLoad');
  await caption('The page reads the columns and lists the rows');
  await sleep(3500);
  await caption('Tick the rows to run (at most 20 per run)');
  await d.click('#selNone');
  await sleep(1500);
  for (const id of ['PL', 'CZ', 'HU']) { await d.click(`input[data-select="${id}"]`); await sleep(1200); }
  await sleep(2500);

  // Step 2: the main prompt.
  await caption('Step 2: the main prompt. {prompt_input} is replaced by the data of each row');
  await smoothScroll('#secMain');
  await sleep(6000);

  // Step 3: LLM as Judge, with every option.
  await caption('Step 3: LLM as Judge. Two ready-made prompts grade every answer of the main prompt');
  await smoothScroll('#secJudge');
  await sleep(5500);
  await caption('Accuracy judge: checks the answer against the source data');
  await smoothScroll('#accText', 'center');
  await sleep(5000);
  await caption('Completeness judge: how much of the source data the answer covers');
  await smoothScroll('#compText', 'center');
  await sleep(5000);
  await caption('Both prompts are yours to edit; they use {prompt_input} and {output}, and each returns a percentage and a rationale');
  await sleep(6000);
  await d.evaluate(() => { document.getElementById('judgePreview').open = true; });
  await caption('The preview shows the exact input of the judges for a chosen row');
  await smoothScroll('#judgePreview');
  await sleep(5500);
  await caption('...and the answer format that the app adds to every judge prompt');
  await d.evaluate(() => document.getElementById('formatPrev').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(5500);
  await d.evaluate(() => { document.getElementById('judgePreview').open = false; });
  await caption('By default the judges use the same model as the main prompt');
  await smoothScroll('#sameModel', 'center');
  await sleep(5000);
  await d.click('#sameModel');
  await caption('Or switch that off: the judges get their own endpoint, key, and JSON');
  await smoothScroll('#judgeFields', 'center');
  await sleep(6500);
  await smoothScroll('#sameModel', 'center');
  await d.click('#sameModel');
  await caption('Switched on again: one endpoint and one key for everything');
  await sleep(3500);

  // Step 4: configuration, with the model and its parameters as one JSON payload.
  await caption('Step 4: configuration. First the endpoint, then the API key (masked, kept in memory only)');
  await smoothScroll('#secCfg');
  await sleep(2500);
  await d.click('#mainEp');
  await d.clearFocused();
  await typeSlowly(fake.endpoint, 30);
  await sleep(1200);
  await d.click('#mainKey');
  await d.clearFocused();
  await typeSlowly(FAKE_KEY, 50);
  await sleep(2500);
  await caption('The model and its parameters are one JSON payload. Type your own');
  await smoothScroll('#main_json', 'center');
  await sleep(3500);
  await d.click('#main_json');
  await d.clearFocused();
  await typeSlowly('{"model": "nvidia/nemotron-3.5-bolt-e4b", "temperature": 0.2, "top_p": 0.9, "max_tokens": 1024, "seed": 7}', 55);
  await sleep(1500);
  await caption('A badge confirms that the JSON is valid and names the model');
  await sleep(5000);

  // Step 5: run, and the whole confirmation.
  await caption('Step 5: Run. Nothing is sent until you confirm');
  await d.click('#run');
  await sleep(800);
  await d.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(1500);
  await caption('The confirmation says how many requests go where, to which model, and what data they contain');
  await sleep(9000);
  await caption('The requests go through the local relay, which keeps nothing. Costs may apply with the provider');
  await sleep(6500);
  await d.click('#confirmYes');
  await caption('Running: main prompts first, then the judges (a fake platform answers here)');
  await d.waitFor(() => !document.getElementById('reportView').hidden && document.querySelectorAll('#report .case').length > 0, { timeoutMs: 90_000, what: 'the report' });
  await sleep(500);

  await caption('The report opens by itself: averages and a summary table');
  await sleep(4500);
  await caption('One card per test case: expected result, actual output, similarity, differences');
  await d.evaluate(() => document.querySelector('#report .case').scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await sleep(5500);
  await caption('Grades and rationale from each judge');
  await d.evaluate(() => window.scrollBy({ top: 420, behavior: 'smooth' }));
  await sleep(4000);
  await caption('Export the report as HTML or CSV with the buttons at the top');
  await d.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(4500);

  // When something goes wrong (a failed request, a rate limit), nothing has to start over: the Re-run choices.
  await caption('Something went wrong, a failed request or a rate limit? You do not have to start over: Re-run');
  await sleep(5500);
  await d.click('#rvRerunBox summary');
  await sleep(1500);
  const highlight = (index) => d.evaluate((i) => {
    const buttons = [...document.querySelectorAll('#rvRerunBox [data-rerun]')];
    buttons.forEach((b, n) => { const li = b.closest('li'); li.style.outline = n === i ? '3px solid #f59e0b' : ''; li.style.outlineOffset = '2px'; });
  }, index);
  const choices = [
    'Re-run all: the main prompts and the judges again, on the rows of the last run',
    'Re-run failing main prompts and all related judges: only the rows whose main prompt failed',
    'Re-run all judges: the one to use after you edit a judge prompt',
    'Re-run only the failing judges: if one of ten judge requests failed, exactly one is sent',
  ];
  for (const [index, text] of choices.entries()) {
    await highlight(index);
    await caption(text);
    await sleep(6500);
  }
  await highlight(-1);
  await caption('Each choice shows how many requests it would send, and one that cannot be used says why');
  await sleep(6500);
  await caption('');
  await sleep(500);

  await session.send('Page.stopScreencast');
  await Promise.all(writes);
  if (frames.length < 10) throw new Error(`Only ${frames.length} frames were recorded.`);

  // Frames with their durations: the next frame's time minus this one's (the last one stays for two seconds).
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${(i + 1 < frames.length ? frames[i + 1].time - f.time : 2).toFixed(4)}`);
  list.push(`file '${frames.at(-1).file}'`);
  const listFile = path.join(work, 'frames.txt');
  await writeFile(listFile, `${list.join('\n')}\n`);
  await mkdir(path.dirname(output), { recursive: true });
  const encoded = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=25,scale=${WIDTH}:${HEIGHT},format=yuv420p`, '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', output], { encoding: 'utf8' });
  if (encoded.status !== 0) throw new Error(`ffmpeg failed: ${encoded.stderr}`);
  console.log(`Wrote ${output} (${frames.length} frames)`);
} catch (error) {
  console.error(error.message);
  exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  app?.child.kill('SIGKILL');
  await fake?.close?.().catch?.(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
