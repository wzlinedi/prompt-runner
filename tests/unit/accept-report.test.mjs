// The report of the acceptance run (spec FR-063 – FR-065).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTerminal, renderHtml, resultsJson, summary } from '../accept/report.mjs';
import { HUMAN } from '../accept/rows.mjs';

const run = () => ({
  startedAt: '2026-11-01 21:00:00',
  folder: 'test-results/acceptance-20261101-210000',
  verdicts: [
    { id: 'flow.start', row: 'Start screen offers only New Session', title: 'one action', verdict: 'pass', durationMs: 900, expected: 'one button', seen: 'one button', evidence: [] },
    { id: 'exports.real-downloads', row: 'Exports', title: 'real files', verdict: 'fail', durationMs: 4200, expected: 'no key in the CSV', seen: 'a key in the CSV', problems: ['contains "nvapi-FA…"'], evidence: [{ path: 'downloads/a.csv', bytes: 2048 }, { path: 'downloads/a.html', bytes: 530 }, 'screenshots/old-style.png'], screenshot: 'screenshots/fail-exports.png' },
    { id: 'appearance.matrix', row: 'Modern page, look', title: 'widths', verdict: 'not-run', reason: 'the dark scheme could not be requested', expected: '', seen: '' },
  ],
  human: [{ name: 'The look of the page', reason: HUMAN.look }, { name: 'Usability with a first-time user', reason: HUMAN.usability }, { name: 'Live check with a real key', reason: HUMAN.live }],
  gallery: [{ caption: 'form, 500 px, dark', page: 'screenshots/form-500-dark.png', reference: 'reference/example-form-modern-500-dark.png' }, { caption: 'report', page: 'screenshots/report.png', reference: null }],
});

test('the terminal table lists every check, then the failures with what was expected and seen, then the totals', () => {
  const text = renderTerminal(run().verdicts);
  assert.match(text, /PASS\s+flow\.start/);
  assert.match(text, /FAIL\s+exports\.real-downloads/);
  assert.match(text, /NOT RUN\s+appearance\.matrix/);
  assert.match(text, /FAILED exports\.real-downloads\n\s+- contains "nvapi-FA…"\n\s+expected: no key in the CSV\n\s+seen:\s+a key in the CSV/);
  assert.match(text, /1 passed, 1 failed, 1 not run, 0 left to a human\./);
  assert.deepEqual(summary(run().verdicts), { pass: 1, fail: 1, notRun: 1, human: 0 });
  assert.match(renderTerminal(run().verdicts, run().human), /3 left to a human\.\n   - The look of the page\n   - Usability with a first-time user\n   - Live check with a real key/);
});

test('the page is self-contained, lists the human items before the table, and shows a failure with its evidence', () => {
  const html = renderHtml(run());
  assert.ok(!/<script/i.test(html) && !/https?:\/\//i.test(html.replace('http-equiv', '')), 'no script and no outside address');
  assert.match(html, /Content-Security-Policy/);
  assert.ok(html.indexOf('Left to a human') < html.indexOf('<h2>Verdicts</h2>'), 'the human items come first');
  for (const text of Object.values(HUMAN)) assert.ok(html.includes(text.replace(/'/g, '&#39;')) || html.includes(text), 'every human item is listed');
  assert.match(html, /<details open><summary><span class="v fail">failed<\/span>/);
  assert.match(html, /Expected:<\/b> no key in the CSV/);
  assert.match(html, /href="downloads\/a\.csv">downloads\/a\.csv<\/a> \(2\.0 KB\)/, 'a link with its size');
  assert.match(html, /downloads\/a\.html<\/a> \(530 B\)/, 'a small file in bytes');
  assert.match(html, /href="screenshots\/old-style\.png"/, 'a plain path still works');
  assert.match(html, /src="screenshots\/fail-exports\.png"/);
  assert.match(html, /<div class="pair">/, 'a screenshot with a reference is shown next to it');
  assert.match(html, /1 passed, 1 failed, 1 not run, 3 left to a human/, 'the human items are counted');
});

test('text from a check is escaped in the page', () => {
  const r = run();
  r.verdicts[1].seen = '<img src=x onerror=alert(1)>';
  const html = renderHtml(r);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('the data and the page hold no key', () => {
  const json = resultsJson(run());
  assert.ok(!/nvapi-FAKE-ACCEPT/.test(json) && !/nvapi-FAKE-ACCEPT/.test(renderHtml(run())));
  assert.equal(JSON.parse(json).summary.fail, 1);
});

test('the key audit matrix is shown as a table, with hits in red, empty examinations named, and no key anywhere', async () => {
  const { renderHtml, renderTerminal, cellText } = await import('../accept/report.mjs');
  const ok = { examined: { files: 12 }, skipped: 0, hits: 0, empty: false, nothingCanExist: false };
  const matrix = {
    places: ['files', 'storage', 'network'],
    ways: [
      { id: 'normal', title: 'A normal run', ok: true, cells: { files: ok, storage: { ...ok, examined: { entries: 0 }, nothingCanExist: true }, network: ok } },
      { id: 'stopped', title: 'Stop', ok: false, cells: { files: { ...ok, hits: 2 }, storage: ok, network: { ...ok, empty: true } } },
    ],
    outOfScope: ['the clipboard'], limits: ['files above 50 MB are skipped'],
  };
  const verdicts = [{ id: 'keyguard.audit', group: 'keyguard', row: 'Key is never stored', title: 'audit', verdict: 'fail', expected: 'x', seen: 'found in: stopped', problems: ['stopped: found'], evidence: [], matrix }];
  const run = { startedAt: 'now', folder: 'f', verdicts, human: [], gallery: [] };
  const html = renderHtml(run);
  assert.match(html, /Key audit: places by ways/);
  assert.match(html, /<td class="bad">2 hits<\/td>/);
  assert.match(html, /<td class="bad">examination empty<\/td>/);
  assert.match(html, /none can exist/);
  assert.match(html, /the clipboard/);
  assert.ok(!/<script/i.test(html));
  assert.equal(cellText(null).cls, 'bad');
  assert.equal(cellText({ ...ok, skipped: 1 }).text, '12 files, 1 skipped');
  assert.match(renderTerminal(verdicts), /FOUND\s+stopped/);
});
