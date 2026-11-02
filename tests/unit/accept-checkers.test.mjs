// The checkers of the walk-through must fail on deliberately broken input and pass on good input (spec SC-034).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExport, checkLog, checkTabOrder, checkOverflow, checkCovered, checkMotion, checkContrast, checkFolder, mediaAccepted, focusKind, checkFocusKinds, FOCUS_KINDS } from '../accept/checkers.mjs';
import { renderCsv } from '../../app/public/src/exports.mjs';
import { buildReport, renderHtml } from '../../app/public/src/report.mjs';

const KEY = 'nvapi-FAKE-ACCEPT-abc123';
const run = () => ({
  mode: 'full', status: 'finished', reportAt: Date.UTC(2026, 10, 1, 13, 25), times: { main: 1, judges: 2 },
  snapshot: { prompts: { main: 'm {prompt_input}', accuracy: 'a', completeness: 'c' }, params: { main: '{"model":"x"}', judges: '{"model":"x"}' }, judgeSameAsMain: true, models: { main: 'x', judges: 'x' }, rowIds: ['R1'] },
  rows: [{ rowId: 'R1', name: 'One', promptInput: 'in', expectedResult: 'out', main: { state: 'ok', output: '=SUM(1,1)\nsecond line', cutOff: false }, similarity: 50,
    accuracy: { state: 'ok', grade: 80, rationale: '- a bullet' }, completeness: { state: 'ok', grade: 70, rationale: 'fine' } }],
});
const goodCsv = () => renderCsv(buildReport(run()));
const goodHtml = () => renderHtml(buildReport(run()));

test('a good CSV passes: byte-order mark, CRLF, 17 columns, formula text quoted', () => {
  assert.deepEqual(checkExport({ kind: 'csv', text: goodCsv(), secrets: [KEY] }), { ok: true, problems: [] });
});

test('a CSV with the key in it, without the byte-order mark, with LF line ends, with the wrong columns, or with a bare formula fails', () => {
  const csv = goodCsv();
  assert.match(checkExport({ kind: 'csv', text: csv.replace('One', KEY), secrets: [KEY] }).problems.join(), /contains "nvapi-FA…"/);
  assert.match(checkExport({ kind: 'csv', text: csv.slice(1) }).problems.join(), /byte-order mark/);
  assert.match(checkExport({ kind: 'csv', text: csv.replace(/\r\n/g, '\n') }).problems.join(), /CRLF/);
  assert.match(checkExport({ kind: 'csv', text: csv.replace(/","/, '"' + ',"extra","') }).problems.join(), /columns instead of 17/);
  assert.match(checkExport({ kind: 'csv', text: csv.replace("\"'=SUM", '"=SUM') }).problems.join(), /spreadsheet evaluates/);
  assert.match(checkExport({ kind: 'csv', text: csv.replace("\"'- a bullet", '"- a bullet') }).problems.join(), /spreadsheet evaluates/);
});

test('a good HTML export passes; a script, an outside address, a missing policy, or a key fails', () => {
  const html = goodHtml();
  assert.deepEqual(checkExport({ kind: 'html', text: html, secrets: [KEY] }), { ok: true, problems: [] });
  assert.match(checkExport({ kind: 'html', text: html.replace('</body>', '<script>1</script></body>') }).problems.join(), /script/);
  assert.match(checkExport({ kind: 'html', text: html.replace('<body', '<img src="https://x.example/a.png"><body') }).problems.join(), /outside the file/);
  assert.match(checkExport({ kind: 'html', text: html.replace(/<meta http-equiv[^>]*>/, '') }).problems.join(), /content-security policy/);
  assert.match(checkExport({ kind: 'html', text: html.replace('One', KEY), secrets: [KEY] }).problems.join(), /contains/);
  assert.equal(checkExport({ kind: 'zip', text: '' }).ok, false);
});

test('the log of the process is clean or it leaks', () => {
  const log = '2026-11-01T10:00:00.000Z POST /api/chat 200 23ms\n';
  assert.equal(checkLog(log, [KEY, 'Selected indicators']).ok, true);
  assert.equal(checkLog(`${log}Authorization: Bearer ${KEY}\n`, [KEY]).ok, false);
  assert.equal(checkLog(`${log}Selected indicators Poland`, [KEY, 'Selected indicators']).ok, false);
});

const stop = (id, visible = true) => ({ id, tag: 'button', visible });

test('a tab walk passes when every expected control is reached in order with a visible focus', () => {
  const stops = [stop('newSession2'), stop('dsFile'), stop('dsText'), stop('dsLoad'), stop('run')];
  assert.deepEqual(checkTabOrder(stops, ['newSession2', 'dsText', 'run']), { ok: true, problems: [] });
});

test('a tab walk fails: a control missing, out of order, without a focus ring, or the focus lost', () => {
  const base = [stop('newSession2'), stop('dsFile'), stop('dsText'), stop('dsLoad'), stop('run')];
  assert.match(checkTabOrder(base.filter((s) => s.id !== 'dsText'), ['newSession2', 'dsText', 'run']).problems.join(), /dsText is never reached/);
  assert.match(checkTabOrder([base[0], base[3], base[2], base[4]], ['newSession2', 'dsText', 'dsLoad']).problems.join(), /dsLoad is reached out of order/);
  assert.match(checkTabOrder([base[0], stop('dsFile', false), base[2]], ['newSession2', 'dsFile']).problems.join(), /dsFile has the focus but shows no focus ring/);
  assert.match(checkTabOrder([base[0], { id: null, tag: 'body', visible: false }, base[2], base[4]], ['newSession2', 'run']).problems.join(), /focus was lost/);
});

test('overflow: equal widths and 1 px of rounding pass; 12 px fail', () => {
  assert.equal(checkOverflow({ scrollWidth: 500, innerWidth: 500 }).ok, true);
  assert.equal(checkOverflow({ scrollWidth: 501, innerWidth: 500 }).ok, true);
  assert.match(checkOverflow({ scrollWidth: 512, innerWidth: 500 }).problems[0], /12 px wider/);
});

test('covered controls are named', () => {
  assert.equal(checkCovered([{ selector: '#run', hit: true }]).ok, true);
  assert.match(checkCovered([{ selector: '#run', hit: false, coveredBy: 'div#runBar' }]).problems[0], /#run is covered by div#runBar/);
});

test('reduced motion: zero durations and no animation pass; a transition of 150 ms or a running animation fails', () => {
  assert.equal(checkMotion([{ name: 'button', transitionDuration: '0s', animationName: 'none' }, { name: 'bar', transitionDuration: '0s, 0s', animationName: 'none' }]).ok, true);
  assert.match(checkMotion([{ name: 'button', transitionDuration: '0.15s', animationName: 'none' }]).problems[0], /transition of 0\.15s/);
  assert.match(checkMotion([{ name: 'card', transitionDuration: '0s', animationName: 'rise' }]).problems[0], /animation rise/);
});

test('contrast: nothing below the limit and something measured passes; a failure or nothing measured fails', () => {
  assert.equal(checkContrast({ measured: 120, failures: [] }).ok, true);
  assert.match(checkContrast({ measured: 120, failures: [{ selector: '.sub', text: 'Columns', ratio: 4.4, color: 'rgb(122,122,122)' }] }).problems[0], /\.sub "Columns" has 4\.4:1/);
  assert.equal(checkContrast({ measured: 0, failures: [] }).ok, false);
});

test('the files of a run folder are searched for the key', () => {
  assert.equal(checkFolder({ 'report.html': '<p>ok</p>', 'relay.log': 'GET / 200' }, [KEY]).ok, true);
  assert.match(checkFolder({ 'report.html': `<p>${KEY}</p>` }, [KEY]).problems[0], /report\.html contains/);
});

test('a requested appearance or motion setting counts only when the browser really applied it', () => {
  assert.deepEqual(mediaAccepted({ dark: true, reduce: false }, { scheme: 'dark', motion: 'no-preference' }), { ok: true, reason: '' });
  assert.deepEqual(mediaAccepted({ dark: false, reduce: true }, { scheme: 'light', motion: 'reduce' }), { ok: true, reason: '' });
  assert.match(mediaAccepted({ dark: false, reduce: false }, { scheme: 'dark' }).reason, /did not apply the dark appearance/);
  assert.match(mediaAccepted({ dark: true, reduce: false }, { motion: 'reduce' }).reason, /did not apply the motion setting "reduce"/);
  assert.equal(mediaAccepted({ dark: true, reduce: false }, { scheme: 'light' }).ok, false);
});

test('every kind of control is recognised from what has the focus', () => {
  const kinds = [
    [{ tag: 'button' }, 'button'], [{ tag: 'a' }, 'link'], [{ tag: 'select' }, 'select'], [{ tag: 'summary' }, 'summary'],
    [{ tag: 'textarea', inEditor: true }, 'editor'], [{ tag: 'textarea', inEditor: false }, 'textarea'],
    [{ tag: 'input', type: 'password' }, 'password-input'], [{ tag: 'input', type: 'file' }, 'file-input'],
    [{ tag: 'input', type: 'checkbox' }, 'checkbox'], [{ tag: 'input', type: 'text' }, 'text-input'], [{ tag: 'input', type: null }, 'text-input'],
  ];
  for (const [stop, kind] of kinds) assert.equal(focusKind(stop), kind, JSON.stringify(stop));
  assert.equal(focusKind({ tag: 'body' }), null);
  assert.deepEqual(new Set(kinds.map(([, k]) => k)), new Set(FOCUS_KINDS), 'the list of kinds is the one that is recognised');
});

test('a focus walk must meet every kind of control and every stop must show a ring', () => {
  const stop = (tag, extra = {}) => ({ tag, visible: true, id: `${tag}-${Object.values(extra).join('')}`, ...extra });
  const all = [stop('button'), stop('a'), stop('input', { type: 'text' }), stop('input', { type: 'password' }), stop('input', { type: 'file' }), stop('input', { type: 'checkbox' }), stop('select'), stop('textarea', { inEditor: true }), stop('textarea', { inEditor: false }), stop('summary')];
  assert.deepEqual(checkFocusKinds(all), { ok: true, problems: [] });
  assert.match(checkFocusKinds(all.filter((s) => s.type !== 'checkbox')).problems.join(), /never met: checkbox/);
  assert.match(checkFocusKinds([...all.slice(0, 3), { ...all[3], visible: false }, ...all.slice(4)]).problems.join(), /no focus ring on the password-input/);
  assert.equal(checkFocusKinds([{ tag: 'body', visible: false }], []).ok, true, 'something that is not a control is not judged');
});
