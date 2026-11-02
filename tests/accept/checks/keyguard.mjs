// The key audit (spec User Story 11, contracts/key-audit.md): proves that the API key typed into the page is not stored
// anywhere. `keyguard.self-test` plants copies in every place and must find them all; `keyguard.audit` then runs the ways
// of ending a run and searches every place.
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeKey } from '../leak.mjs';
import { createSandbox, PLACES, counts } from '../sandbox.mjs';
import { scanNetwork } from '../scanners.mjs';
import { startSession, runAndWait, waitForReport, chooseRerun } from './helpers.mjs';
import { FAIL } from '../../fixtures/fake-upstream.mjs';

/** The places in which a planted copy was not found (an empty list: the audit sees everywhere). */
export function missingPlaces(observed, places = PLACES) {
  return places.filter((place) => !observed[place] || observed[place].hits.length === 0);
}

const planted = (key) => key.text;
/** The folder of the application under audit: the project, or a test copy of it (`KEYGUARD_APP_ROOT`, for proving that the audit catches a leak). */
const appRootOf = (ctx) => process.env.KEYGUARD_APP_ROOT || ctx.root;

/** Plants one copy of the key in each kind of place, in the way that place can really be written to. Returns the files to remove. */
export async function plantCopies(sb, { runFolder, profileDir }) {
  const text = planted(sb.key);
  const files = [];
  const write = async (file) => { await writeFile(file, `planted ${text} copy`); files.push(file); };
  await write(path.join(runFolder, `planted-${sb.way}.txt`));
  await write(path.join(os.tmpdir(), `planted-${sb.way}-${sb.key.distinctive}.txt`));
  await write(path.join(profileDir, `planted-${sb.way}.txt`));
  await write(path.join(sb.dir, 'downloads', 'planted-download.txt'));

  const { d } = sb;
  await d.open(sb.appUrl);
  await d.evaluate(async (k) => {
    localStorage.setItem('planted', k);
    document.cookie = `planted=${k}; path=/`;
    await new Promise((res, rej) => { const r = indexedDB.open('planted'); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { const tx = r.result.transaction('s', 'readwrite'); tx.objectStore('s').put({ k }, 'k'); tx.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => rej(r.error); });
    history.replaceState(null, '', `/?planted=${k}`);
    console.log('planted', k);
    globalThis.__planted = k;
    const p = document.createElement('p');
    p.textContent = k;
    document.body.append(p);
    await fetch('/planted-header', { headers: { 'x-planted': k } }).catch(() => {});
    await fetch('/planted-body', { method: 'POST', body: k }).catch(() => {});
  }, text);
  await sb.processView.send('Runtime.evaluate', { expression: `globalThis.__planted = ${JSON.stringify(text)}; console.log('planted', ${JSON.stringify(text)})` });
  await d.sleep(300); // the application's output reaches its log file
  return files;
}

/** `skipPlaces`, `sandboxFactory` and `plant` are for the tests of the tool: places left out of the examination, and stand-ins for the browser. */
async function selfTest(t, ctx, { skipPlaces = [], sandboxFactory = createSandbox, plant = plantCopies } = {}) {
  const key = makeKey();
  const sb = await sandboxFactory({ way: 'self-test', folder: ctx.folder, key, root: appRootOf(ctx) });
  let finished = false;
  const files = [];
  try {
    files.push(...await plant(sb, { runFolder: ctx.folder, profileDir: sb.profileDir }));
    const observed = await sb.observe();
    observed.profile = await sb.finish();
    finished = true;
    for (const place of skipPlaces) delete observed[place];
    const missing = missingPlaces(observed);
    t.expect(missing.length === 0, `a planted copy was not found in: ${missing.join(', ')}`);
    t.note({ expected: 'a planted copy is found in every place', seen: missing.length ? `not found in ${missing.join(', ')}` : `found in all ${PLACES.length} places` });
    return observed;
  } finally {
    if (!finished) await sb.stop();
    for (const file of files) await rm(file, { force: true });
    await rm(path.join(ctx.folder, 'keyguard', 'self-test'), { recursive: true, force: true });
  }
}

const isJudge = (content) => content.includes('SCORE: <number>');
const keyFields = (d) => d.evaluate(() => [document.getElementById('mainKey').value, document.getElementById('judgeKey').value]);

/** The permitted uses (the page's request body, the platform's Authorization) must both be seen in a way that sent requests. */
async function savePair(d, sb) {
  const dir = path.join(sb.dir, 'downloads');
  await d.download(dir, () => d.click('#rvHtml'));
  await d.download(dir, () => d.click('#rvCsv'));
}

/** The seven ways of ending a run. `act(sb)` does what a person does; `sends` says whether requests are expected; `exports` how many files. */
export const WAYS = [
  {
    id: 'normal', title: 'A normal run, then Export HTML and Export CSV', sends: true, exports: 2,
    async act({ d, ctx }) { await startSession(ctx, { rows: ['PL'] }); await runAndWait(d); await savePair(d, ctx.sb); },
  },
  {
    id: 'platform-echo', title: 'The platform rejects the key and repeats it in its error', sends: true, exports: 2,
    // the error repeats the whole key in every text form that the audit searches for (FR-074): plain, JSON, address, percent bytes, base64
    fakeOptions: (key, forms) => ({ rules: [{ match: () => true, respond: { status: 401, body: { status: 401, title: 'Unauthorized', detail: `The key ${key} is not accepted`, again: forms.filter((f) => f.name.startsWith('key/') && !f.name.includes('utf-16')).map((f) => f.bytes.toString('utf8')) } } }] }),
    async act({ d, ctx, t }) {
      await startSession(ctx, { rows: ['PL'] });
      await runAndWait(d);
      t.expect(/401|Unauthorized|rejected|error|failed/i.test(await d.evaluate(() => document.getElementById('report').innerText)), 'the page shows no error for the rejected request');
      await savePair(d, ctx.sb);
    },
  },
  {
    id: 'stopped', title: 'Stop while the requests are held', sends: true, exports: 0, fakeOptions: { hold: true },
    async act({ d, ctx }) {
      await startSession(ctx, { rows: ['PL', 'CZ'] });
      await d.click('#run'); await d.click('#confirmYes');
      await ctx.fake.arrived(1, 15_000);
      await d.click('#stop');
      await waitForReport(d, 20_000);
    },
  },
  {
    id: 'judges-rerun', title: 'Judges re-run (the key typed again)', sends: true, exports: 0,
    async act({ d, ctx }) {
      await startSession(ctx, { rows: ['PL'] });
      await runAndWait(d);
      await d.click('#rvBack');
      await d.fill('#accText', `${await d.evaluate(() => document.getElementById('accText').value)} Be strict.`, { paste: true });
      await d.fill('#mainKey', ctx.key);
      await chooseRerun(d, 'judges'); await d.click('#confirmYes');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 60_000, what: 'the report after the re-run' });
    },
  },
  {
    id: 'failed-rerun', title: 'Failed-requests re-run (the key typed again)', sends: true, exports: 0,
    fakeOptions: { rules: [{ match: (b, c) => !isJudge(c) && c.includes('Hungary'), times: 1, respond: FAIL.rateLimit }] },
    async act({ d, ctx }) {
      await startSession(ctx, { rows: ['PL', 'HU'] });
      await runAndWait(d);
      await d.click('#rvBack');
      await d.fill('#mainKey', ctx.key);
      await chooseRerun(d, 'failedMain'); await d.click('#confirmYes');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 60_000, what: 'the report after the re-run' });
    },
  },
  {
    id: 'abandoned', title: 'New Session while a run is in progress, then the held requests are released', sends: true, exports: 0, fakeOptions: { hold: true },
    async act({ d, ctx }) {
      await startSession(ctx, { rows: ['PL'] });
      await d.click('#run'); await d.click('#confirmYes');
      await ctx.fake.arrived(1, 15_000);
      await d.click('#newSession2');
      await d.sleep(300);
      ctx.fake.release();
      await d.sleep(2500);
    },
    async after({ d, t }) { t.expect((await keyFields(d)).every((v) => v === ''), 'the new session starts with a key in a field'); },
  },
];

/** The problems of one place of one way (`allowed`: the places that may hold the key right now). */
export function placeProblems(way, places, { allowed = [], skip = [] } = {}) {
  const problems = [];
  for (const place of PLACES) {
    if (skip.includes(place)) continue; // the profile is read once, when the browser is closed
    const result = places[place];
    if (!result) { problems.push(`${way}: ${place} was not examined`); continue; }
    if (allowed.includes(place)) continue;
    for (const h of result.hits.slice(0, 3)) problems.push(`${way}: the key was found in ${place} (${h.form}) at "${h.where}": ${h.excerpt}`);
    if (result.hits.length > 3) problems.push(`${way}: ${result.hits.length - 3} more hits in ${place}`);
    if (result.empty) problems.push(`${way}: the examination of ${place} is empty: the key did not travel the permitted way`);
  }
  return problems;
}

async function runWay(way, t, ctx, key) {
  const sb = await createSandbox({ way: way.id, folder: ctx.folder, key, root: appRootOf(ctx), fakeOptions: way.fakeOptions ?? {} });
  const problems = [];
  const local = { expect: (c, m) => { if (!c) problems.push(`${way.id}: ${m}`); return Boolean(c); } };
  let finished = false;
  try {
    const wctx = { ...sb.ctx, sb };
    await way.act({ d: sb.d, ctx: wctx, t: local });
    await sb.d.sleep(500);
    const places = await sb.observe();
    places.network = scanNetwork(sb.traffic(), sb.forms, { needUses: way.sends });
    await way.after?.({ d: sb.d, t: local });
    local.expect((await keyFields(sb.d)).every((v) => v === ''), 'a key field still holds the key');
    local.expect(!way.sends || sb.fake.requests.length > 0, 'no request reached the platform: the way proves nothing');
    local.expect(places.exports.examined.files === way.exports, `${places.exports.examined.files} exported files examined, ${way.exports} expected`);
    places.profile = await sb.finish();
    finished = true;
    problems.push(...placeProblems(way.id, places));
    return { way, places, problems };
  } catch (error) {
    problems.push(`${way.id}: ${error.message}`);
    return { way, places: null, problems };
  } finally {
    if (!finished) await sb.stop();
  }
}

/** Way 7: the key typed and never used; the field cleared, memory collected, the page reloaded. Three examinations. */
async function runTypedNeverUsed(t, ctx, key) {
  const way = { id: 'typed-never-used', title: 'The key typed and never used; the field cleared and the page reloaded' };
  const sb = await createSandbox({ way: way.id, folder: ctx.folder, key, root: appRootOf(ctx) });
  const problems = [];
  let finished = false;
  try {
    const { d } = sb;
    await startSession(sb.ctx, { sample: true, key: true, endpoint: false });
    const typed = await sb.observe();
    problems.push(...placeProblems('typed-never-used (key in the field)', typed, { allowed: ['page memory', 'page text'], skip: ['profile'] }));
    if (!(await keyFields(d)).includes(key.text)) problems.push('typed-never-used: the key was not in the field while it was typed');
    await d.fill('#mainKey', '');
    const cleared = await sb.observe();
    problems.push(...placeProblems('typed-never-used (field cleared)', cleared, { skip: ['profile'] }));
    await d.open(sb.appUrl);
    const reloaded = await sb.observe();
    if (!(await keyFields(d)).every((v) => v === '')) problems.push('typed-never-used: a key field is not empty after the reload');
    reloaded.profile = await sb.finish();
    finished = true;
    problems.push(...placeProblems('typed-never-used (after the reload)', reloaded));
    return { way, places: reloaded, problems };
  } catch (error) {
    problems.push(`typed-never-used: ${error.message}`);
    return { way, places: null, problems };
  } finally {
    if (!finished) await sb.stop();
  }
}

export const OUT_OF_SCOPE = [
  'the user\'s terminal and shell history', 'the clipboard', 'swap files and crash dumps', 'other programs on the computer',
  'the user\'s everyday browser and its password manager', 'the platform\'s side',
];
export const LIMITS = ['binary buffer contents are not part of a memory snapshot', 'files above 50 MB are skipped and listed'];

/** The matrix of the report: places in rows, ways in columns. */
export function buildMatrix(results) {
  return {
    places: PLACES,
    ways: results.map((r) => ({ id: r.way.id, title: r.way.title, ok: r.problems.length === 0, cells: r.places ? Object.fromEntries(PLACES.map((p) => [p, r.places[p] ? counts(r.places[p]) : null])) : null })),
    outOfScope: OUT_OF_SCOPE, limits: LIMITS,
  };
}

async function audit(t, ctx) {
  const selfBefore = ctx.mem?.selfTestFailed;
  if (selfBefore) { t.expect(false, 'the self-test failed, so a "not found" cannot be trusted'); return; }
  const key = makeKey();
  ctx.addSecret?.(key.text);
  const results = [];
  for (const way of WAYS) results.push(await runWay(way, t, ctx, key));
  results.push(await runTypedNeverUsed(t, ctx, key));
  for (const r of results) t.problems(r.problems);
  t.matrix(buildMatrix(results));
  const bad = results.filter((r) => r.problems.length);
  t.note({ expected: 'the key is nowhere but in the permitted uses, in all seven ways', seen: bad.length ? `found or failed in: ${bad.map((r) => r.way.id).join(', ')}` : `no trace in ${PLACES.length} places after ${results.length} ways` });
  return results;
}

export const keyguardChecks = [
  {
    id: 'keyguard.self-test', group: 'keyguard', timeoutMs: 60_000, row: null,
    title: 'The audit finds a planted copy of a key in every place it searches',
    run: (t, ctx) => selfTest(t, ctx),
  },
  {
    id: 'keyguard.audit', group: 'keyguard', timeoutMs: 180_000, row: 'Key is never stored',
    title: 'The API key is nowhere after a run ends in any of seven ways, except in the two permitted uses while it lasts',
    run: audit,
  },
];

export { selfTest, audit };
