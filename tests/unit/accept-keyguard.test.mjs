// The key audit must fail when it cannot see a place and when a place holds the key (spec SC-038, SC-040, FR-072).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { selfTest, missingPlaces, placeProblems, buildMatrix, WAYS } from '../accept/checks/keyguard.mjs';
import { PLACES } from '../accept/sandbox.mjs';
import { makeKey, keyForms } from '../accept/leak.mjs';
import { scanText, scanSnapshot, scanStorage, scanCookies, scanNetwork, scanDirectory } from '../accept/scanners.mjs';

const hitOf = (place) => ({ examined: {}, skipped: [], empty: false, hits: [{ place, where: 'planted', form: 'key/utf-8', excerpt: '' }] });
const clean = () => ({ examined: { files: 1 }, skipped: [], hits: [], empty: false });
const allPlanted = () => Object.fromEntries(PLACES.map((p) => [p, hitOf(p)]));

function standIn(observed) {
  return async () => ({ way: 'self-test', key: makeKey(), dir: os.tmpdir(), observe: async () => ({ ...observed }), finish: async () => observed.profile ?? clean(), stop: async () => {} });
}
const makeT = () => { const problems = []; return { problems, expect: (c, m) => { if (!c) problems.push(m); return Boolean(c); }, note() {} }; };

test('the self-test passes when every place reports its planted copy', async () => {
  const t = makeT();
  const ctx = { folder: await mkdtemp(path.join(os.tmpdir(), 'kg-')), root: '.' };
  try {
    await selfTest(t, ctx, { sandboxFactory: standIn(allPlanted()), plant: async () => [] });
    assert.deepEqual(t.problems, []);
  } finally { await rm(ctx.folder, { recursive: true, force: true }); }
});

test('with a place removed from the audit, or a place that cannot see its planted copy, the self-test fails and names the place', async () => {
  for (const place of PLACES) {
    const ctx = { folder: await mkdtemp(path.join(os.tmpdir(), 'kg-')), root: '.' };
    try {
      for (const broken of [{ ...allPlanted(), [place]: clean() }, Object.fromEntries(Object.entries(allPlanted()).filter(([p]) => p !== place))]) {
        const t = makeT();
        await selfTest(t, ctx, { sandboxFactory: standIn(broken), plant: async () => [] });
        assert.equal(t.problems.length, 1, `${place}: ${t.problems}`);
        assert.ok(t.problems[0].includes(place), t.problems[0]);
      }
    } finally { await rm(ctx.folder, { recursive: true, force: true }); }
  }
  assert.deepEqual(missingPlaces({}), PLACES);
});

test('a clean way has no problems; a hit in any one place, or an empty examination, is a problem naming the place and the way', () => {
  const cleanWay = Object.fromEntries(PLACES.map((p) => [p, clean()]));
  assert.deepEqual(placeProblems('normal', cleanWay), []);
  for (const place of PLACES) {
    const problems = placeProblems('normal', { ...cleanWay, [place]: hitOf(place) });
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`normal: the key was found in ${place}`));
  }
  assert.match(placeProblems('normal', { ...cleanWay, network: { ...clean(), empty: true } })[0], /examination of network is empty/);
  assert.match(placeProblems('normal', { ...cleanWay, storage: undefined })[0], /storage was not examined/);
  assert.deepEqual(placeProblems('typed', { ...cleanWay, 'page memory': hitOf('page memory') }, { allowed: ['page memory'] }), []);
});

test('leaking fixtures are caught by the functions the audit uses, place by place', async () => {
  const key = makeKey();
  const forms = keyForms(key);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kg-fixture-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, 'leak.json'), JSON.stringify({ apiKey: key.text }));
    const caught = {
      files: await scanDirectory(dir, forms),
      'app log': scanText('app log', [`GET / ${key.text}`], forms),
      'page memory': scanSnapshot('page memory', ['x', `{"apiKey":"${key.text}"}`], forms),
      storage: scanStorage([{ kind: 'local', name: 'apiKey', value: key.text }], forms),
      cookies: scanCookies([{ name: 'k', value: key.text }], forms),
      network: scanNetwork({ requests: [{ method: 'POST', url: 'http://x/log', headers: {}, body: key.text }] }, forms),
      history: scanText('history', [`http://x/?k=${key.text}`], forms),
    };
    for (const [place, result] of Object.entries(caught)) assert.ok(result.hits.length > 0, `${place}: not caught`);
    // the report holds no key: every excerpt and place is masked
    for (const result of Object.values(caught)) for (const h of result.hits) assert.ok(!`${h.where}${h.excerpt}`.includes(key.distinctive));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the matrix has every place in every way and says which ways were clean; the seven ways are all defined', () => {
  const ok = { examined: { files: 1 }, skipped: [], hits: [], empty: false };
  const results = [
    { way: { id: 'a', title: 'A' }, places: Object.fromEntries(PLACES.map((p) => [p, ok])), problems: [] },
    { way: { id: 'b', title: 'B' }, places: null, problems: ['b: crashed'] },
  ];
  const m = buildMatrix(results);
  assert.deepEqual(m.places, PLACES);
  assert.equal(m.ways[0].ok, true);
  assert.equal(m.ways[1].ok, false);
  assert.equal(m.ways[1].cells, null);
  assert.equal(WAYS.length + 1, 7); // the seventh, "typed and never used", has its own function
  assert.ok(m.outOfScope.length >= 6 && m.limits.length >= 2);
});
