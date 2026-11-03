// Records a short demo video of the page (docs/assets/demo.mp4) on a fake platform, with the driver of the acceptance
// walk-through (tests/accept/): a real Chrome, real clicks and key presses, the frames taken by Chrome's own screencast.
// No dependencies in the project. Needs Chrome or Chromium and an `ffmpeg` (set FFMPEG_BIN to its path if it is not on the PATH).
//   node tools/record-demo.mjs [output.mp4]
// With the clips of tools/make-voiceover.mjs the video has a voice-over, and every step waits for the end of its line;
// without them it is silent. The key typed in the video is a made-up text; the platform is a fake one, so the answers in the video are placeholders.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { openSync, closeSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFake } from '../tests/fixtures/fake-upstream.mjs';
import { launchBrowser } from '../tests/accept/browser.mjs';
import { createDriver } from '../tests/accept/driver.mjs';
import { NARRATION } from './demo-narration.mjs';
import { clipPath, wavSeconds } from './make-voiceover.mjs';

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

  // `start(id)` shows the caption of a line and starts its clip; it returns the function that waits until the line has been spoken
  // (with a short pause after it). The actions of the step run in between, so that picture and voice go together.
  const lines = new Map(NARRATION.map((line) => [line.id, line]));
  const voice = [];
  const start = async (id, { minMs = 0 } = {}) => {
    const line = lines.get(id);
    if (!line) throw new Error(`No narration line "${id}".`);
    await caption(line.caption);
    const file = clipPath(line);
    const seconds = existsSync(file) ? wavSeconds(file) : 0;
    if (seconds > 0) voice.push({ file, startedAt: Date.now() / 1000 });
    const endsAt = Date.now() + Math.max(seconds * 1000 + 700, minMs);
    return () => sleep(Math.max(0, endsAt - Date.now()));
  };
  const speak = async (id, options) => (await start(id, options))();
  const smoothScroll = (selector, block = 'start') => d.evaluate((sel, b) => document.querySelector(sel).scrollIntoView({ block: b, behavior: 'smooth' }), selector, block);

  await d.open(app.url);
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
  await sleep(700);

  await speak('intro', { minMs: 3500 });
  let done = await start('start');
  await sleep(1500);
  await d.click('#newSession');
  await done();

  // Step 1: the dataset, from a file or pasted.
  done = await start('dataset');
  await smoothScroll('#dsDrop', 'center');
  await done();
  done = await start('copy');
  await d.click('#dsText');
  await d.clearFocused();
  await done();
  done = await start('paste');
  await sleep(800);
  await d.paste(SPREADSHEET);
  await done();
  await sleep(1800);
  await d.click('#dsLoad');
  await speak('loaded', { minMs: 3500 });
  done = await start('tick');
  await d.click('#selNone');
  await sleep(1200);
  for (const id of ['PL', 'CZ', 'HU']) { await d.click(`input[data-select="${id}"]`); await sleep(1200); }
  await done();

  // Step 2: the main prompt.
  done = await start('main');
  await smoothScroll('#secMain');
  await done();
  await sleep(2000);

  // Step 3: LLM as Judge, with every option.
  done = await start('judges');
  await smoothScroll('#secJudge');
  await done();
  done = await start('accuracy');
  await smoothScroll('#accText', 'center');
  await done();
  done = await start('completeness');
  await smoothScroll('#compText', 'center');
  await done();
  await speak('edit', { minMs: 5000 });
  await d.evaluate(() => { document.getElementById('judgePreview').open = true; });
  done = await start('preview');
  await smoothScroll('#judgePreview');
  await done();
  done = await start('format');
  await d.evaluate(() => document.getElementById('formatPrev').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await done();
  await d.evaluate(() => { document.getElementById('judgePreview').open = false; });
  done = await start('same');
  await smoothScroll('#sameModel', 'center');
  await done();
  done = await start('own');
  await sleep(800);
  await d.click('#sameModel');
  await smoothScroll('#judgeFields', 'center');
  await done();
  await sleep(1500);
  done = await start('again');
  await smoothScroll('#sameModel', 'center');
  await sleep(1200);
  await d.click('#sameModel');
  await done();

  // Step 4: configuration, with the model and its parameters as one JSON payload.
  done = await start('config');
  await smoothScroll('#secCfg');
  await sleep(2000);
  await d.click('#mainEp');
  await d.clearFocused();
  await typeSlowly(fake.endpoint, 30);
  await sleep(1000);
  await d.click('#mainKey');
  await d.clearFocused();
  await typeSlowly(FAKE_KEY, 50);
  await done();
  done = await start('json');
  await smoothScroll('#main_json', 'center');
  await sleep(1800);
  await d.click('#main_json');
  await d.clearFocused();
  await typeSlowly('{"model": "nvidia/nemotron-3.5-bolt-e4b", "temperature": 0.2, "top_p": 0.9, "max_tokens": 1024, "seed": 7}', 55);
  await done();
  await speak('badge', { minMs: 4500 });

  // Step 5: run, and the whole confirmation.
  done = await start('run');
  await d.click('#run');
  await sleep(800);
  await d.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await done();
  await speak('confirm', { minMs: 8500 });
  await speak('relay', { minMs: 5500 });
  await d.click('#confirmYes');
  done = await start('running');
  await d.waitFor(() => !document.getElementById('reportView').hidden && document.querySelectorAll('#report .case').length > 0, { timeoutMs: 90_000, what: 'the report' });
  await done();
  await sleep(500);

  done = await start('report');
  await done();
  done = await start('cards');
  await d.evaluate(() => document.querySelector('#report .case').scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await done();
  done = await start('grades');
  await d.evaluate(() => window.scrollBy({ top: 420, behavior: 'smooth' }));
  await done();
  done = await start('export');
  await d.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await done();

  // When something goes wrong (a failed request, a rate limit), nothing has to start over: the Re-run choices.
  await speak('rerun');
  await d.click('#rvRerunBox summary');
  await sleep(1200);
  const highlight = (index) => d.evaluate((i) => {
    const buttons = [...document.querySelectorAll('#rvRerunBox [data-rerun]')];
    buttons.forEach((b, n) => { const li = b.closest('li'); li.style.outline = n === i ? '3px solid #f59e0b' : ''; li.style.outlineOffset = '2px'; });
  }, index);
  for (const [index, id] of ['rerun-all', 'rerun-main', 'rerun-judges', 'rerun-failing'].entries()) {
    await highlight(index);
    await speak(id);
  }
  await highlight(-1);
  await speak('rerun-counts');
  await speak('outro', { minMs: 3000 });
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

  // The clips are placed where their lines started, counted from the first frame.
  const inputs = ['-f', 'concat', '-safe', '0', '-i', listFile];
  const filters = [`[0:v]fps=25,scale=${WIDTH}:${HEIGHT},format=yuv420p[v]`];
  const mixed = [];
  voice.forEach((clip, index) => {
    const ms = Math.max(0, Math.round((clip.startedAt - frames[0].time) * 1000));
    inputs.push('-i', clip.file);
    filters.push(`[${index + 1}:a]adelay=${ms}|${ms}[a${index}]`);
    mixed.push(`[a${index}]`);
  });
  const args = ['-y', '-loglevel', 'error', ...inputs];
  if (mixed.length) {
    filters.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:dropout_transition=0[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-filter_complex', filters.join(';'), '-map', '[v]');
  }
  args.push('-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', output);
  const encoded = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (encoded.status !== 0) throw new Error(`ffmpeg failed: ${encoded.stderr}`);
  console.log(`Wrote ${output} (${frames.length} frames, ${voice.length} voice clips)`);
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
