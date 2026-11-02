// The report: one data structure (`buildReport`) rendered as the on-screen/HTML report here and as CSV in
// exports.mjs (contracts/export-formats.md). The report never contains keys or endpoints: the run does not hold them.
import { esc } from './html.mjs';
import { displayParams, parseParams } from './config.mjs';
import { hideKeys } from './chat.mjs';
import { diffWords } from './diff.mjs';
import { failedRows } from './runner.mjs';
import { REPORT_CSS } from './report-style.mjs';

const pad = (n) => String(n).padStart(2, '0');

/** Local time, `YYYY-MM-DD HH:MM:SS` (spec FR-032). */
export function formatLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function offsetParts(ms) {
  const minutes = -new Date(ms).getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return { sign, hh: pad(Math.floor(abs / 60)), mm: pad(abs % 60) };
}

/** ISO 8601 with the local offset, e.g. `2026-11-01T14:25:00+01:00`. */
export function formatIso(ms) {
  const { sign, hh, mm } = offsetParts(ms);
  return `${formatLocal(ms).replace(' ', 'T')}${sign}${hh}:${mm}`;
}

/** `UTC+01:00`, stated once in the report header. */
export function offsetLabel(ms) {
  const { sign, hh, mm } = offsetParts(ms);
  return `UTC${sign}${hh}:${mm}`;
}

const CUT_OFF = 'cut off at the length limit';

function similarityView(row) {
  const { main, similarity } = row;
  if (typeof similarity === 'number') return { text: `${similarity}%`, value: similarity };
  if (main.state === 'error') return { text: 'error', value: null };
  if (similarity === 'no expected result') return { text: 'no expected result', value: null };
  if (similarity === 'not available' || main.state === 'not-run') return { text: '–', value: null };
  return { text: '…', value: null };
}

function judgeView(verdict) {
  switch (verdict.state) {
    case 'ok':
      return { gradeText: `${verdict.grade}%`, value: verdict.grade, previous: verdict.previousGrade ?? null, rationale: verdict.rationale, state: 'ok', version: verdict.version ?? 0 };
    case 'error':
      return { gradeText: 'error', value: null, previous: null, state: 'error',
        rationale: verdict.rawAnswer !== undefined ? `${verdict.error}\nRaw answer: ${verdict.rawAnswer}` : verdict.error };
    case 'nothing-to-judge':
      return { gradeText: '–', value: null, previous: null, rationale: '', state: 'nothing-to-judge' };
    case 'not-run':
      return { gradeText: '–', value: null, previous: null, rationale: '', state: 'not-run' };
    default:
      return { gradeText: '…', value: null, previous: null, rationale: '', state: 'pending' };
  }
}

function statusOf(main) {
  if (main.state === 'ok') return main.cutOff ? `ok (${CUT_OFF})` : 'ok';
  if (main.state === 'error') return main.error;
  if (main.state === 'not-run') return 'not run';
  return '…';
}

/** The average of the numbers in a list, rounded, or null when there is none. */
const averageValue = (values) => {
  const numbers = values.filter((v) => typeof v === 'number');
  return numbers.length ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length) : null;
};
const percentText = (n) => (n === null ? '–' : `${n}%`);

const TOO_LONG = 'differences not shown: the texts are too long to compare';

// The word differences of a row are computed once per outcome: an open report is redrawn every 150 ms during a run
// (spec FR-047). A row's `main` object is replaced whenever it changes, so it is the key.
const differencesCache = new WeakMap();

/** The word differences of a row: `diff` (parts or null) and a `diffNote` that says why there are none. */
function differencesOf(source) {
  const output = source.main.state === 'ok' ? source.main.output : '';
  if (output === '') return { diff: null, diffNote: '–' };
  if (source.expectedResult.trim() === '') return { diff: null, diffNote: 'no expected result' };
  const cached = differencesCache.get(source.main);
  if (cached && cached.expected === source.expectedResult && cached.output === output) return cached.result;
  const diff = diffWords(source.expectedResult, output);
  const result = diff ? { diff, diffNote: '' } : { diff: null, diffNote: TOO_LONG };
  differencesCache.set(source.main, { expected: source.expectedResult, output, result });
  return result;
}

/** A value with its object keys in a fixed order, so that two JSON texts can be compared as data. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/** True when the judges ran with the very model and parameters of the main prompt (spec FR-042): decided from the archive. */
function judgesSameAsMain(snapshot) {
  const main = parseParams(snapshot.params.main).value;
  const judges = parseParams(snapshot.params.judges).value;
  if (!main || !judges) return snapshot.params.main === snapshot.params.judges;
  return JSON.stringify(canonical(main)) === JSON.stringify(canonical(judges));
}

/** The report data structure (data-model: Report). */
export function buildReport(run) {
  const { snapshot, times } = run;
  const rows = run.rows.map((source, index) => {
    const similarity = similarityView(source);
    return {
      anchor: `row-${index}`,
      id: source.rowId,
      name: source.name,
      label: `${source.rowId} – ${source.name}`,
      promptInput: source.promptInput,
      mainState: source.main.state,
      output: source.main.state === 'ok' ? source.main.output : '',
      cutOff: source.main.state === 'ok' && Boolean(source.main.cutOff),
      note: source.main.note ?? '',
      error: source.main.state === 'error' ? source.main.error : '',
      expected: source.expectedResult,
      similarity,
      accuracy: judgeView(source.accuracy),
      completeness: judgeView(source.completeness),
      status: statusOf(source.main),
      ...differencesOf(source, similarity),
    };
  });
  const sameJudge = judgesSameAsMain(snapshot);
  /** The earlier versions of a judge prompt that still stand behind grades (spec FR-035), with the number of grades. */
  const earlierVersions = (key) => {
    const list = snapshot.judgePromptVersions?.[key] ?? [snapshot.prompts[key]];
    const counts = list.slice(0, -1).map(() => 0);
    for (const row of rows) { const view = row[key]; if (view.state === 'ok' && view.version < counts.length) counts[view.version] += 1; }
    return counts.map((grades, index) => ({ text: list[index], grades })).filter((entry) => entry.grades > 0);
  };
  const earlier = { accuracy: earlierVersions('accuracy'), completeness: earlierVersions('completeness') };
  const earlierNote = (key) => {
    const total = earlier[key].reduce((sum, entry) => sum + entry.grades, 0);
    return total ? `${total} ${total === 1 ? 'grade' : 'grades'} from an earlier version of the prompt` : '';
  };
  const averageValues = {
    similarity: averageValue(rows.map((r) => r.similarity.value)),
    accuracy: averageValue(rows.map((r) => r.accuracy.value)),
    completeness: averageValue(rows.map((r) => r.completeness.value)),
  };
  return {
    generatedAt: run.reportAt,
    rows,
    summaryRows: rows.map((r) => ({
      anchor: r.anchor, rowId: r.id, name: r.name, label: r.label,
      similarity: r.similarity.text, accuracy: r.accuracy.gradeText, completeness: r.completeness.gradeText,
    })),
    averageValues,
    averages: { similarity: percentText(averageValues.similarity), accuracy: percentText(averageValues.accuracy), completeness: percentText(averageValues.completeness) },
    facts: {
      generatedAt: run.reportAt,
      cases: rows.length,
      model: hideKeys(snapshot.models.main),
      judges: sameJudge ? 'same model' : hideKeys(snapshot.models.judges),
      failed: failedRows(run).length,
      noExpected: rows.filter((r) => r.expected.trim() === '').length,
    },
    promptRows: [
      { label: 'Main prompt', model: hideKeys(snapshot.models.main), params: hideKeys(displayParams(snapshot.params.main)), generatedAt: times.main },
      { label: 'Judge – Accuracy', model: hideKeys(snapshot.models.judges), params: hideKeys(displayParams(snapshot.params.judges)), generatedAt: times.judges, note: earlierNote('accuracy') },
      { label: 'Judge – Completeness', model: hideKeys(snapshot.models.judges), params: hideKeys(displayParams(snapshot.params.judges)), generatedAt: times.judges, note: earlierNote('completeness') },
    ],
    archive: {
      prompts: [
        { label: 'Main prompt', text: snapshot.prompts.main },
        { label: 'Judge – Accuracy', text: snapshot.prompts.accuracy, earlier: earlier.accuracy },
        { label: 'Judge – Completeness', text: snapshot.prompts.completeness, earlier: earlier.completeness },
      ],
      mainJson: hideKeys(snapshot.params.main),
      judgesJson: sameJudge ? null : hideKeys(snapshot.params.judges),
    },
  };
}

/** The level of a score: green from 80, amber from 50, red below (spec FR-037). */
export const tone = (n) => (n === null || n === undefined ? 'na' : n >= 80 ? 'good' : n >= 50 ? 'mid' : 'low');

const numberOf = (text) => { const m = /^(\d+)%$/.exec(text ?? ''); return m ? Number(m[1]) : null; };
const pill = (text) => {
  const n = numberOf(text);
  const kind = text === 'error' ? 'err' : tone(n);
  return `<span class="pill ${kind}">${esc(text)}</span>`;
};
const ring = (n, size) => (n === null
  ? `<div class="ring ${size} na"><span>–</span></div>`
  : `<div class="ring ${size} ${tone(n)}" style="--p:${n}"><span>${n}<small>%</small></span></div>`);
const bar = (text) => {
  const n = numberOf(text);
  return `<div class="sc">${n === null ? '' : `<span class="bar"><i class="${tone(n)}" style="width:${n}%"></i></span>`}${pill(text)}</div>`;
};

const NOTE_CUT_OFF = CUT_OFF;
const tagHtml = (text, extra = '') => `<span class="tag${extra}">${esc(text)}</span>`;
const scroll = (cls, label, inner) => `<div class="${cls}" tabindex="0" role="region" aria-label="${esc(label)}">${inner}</div>`;

function diffHtml(parts) {
  return parts.map((p) => (p.type === 'eq' ? esc(p.text) : p.type === 'del' ? `<del>${esc(p.text)}</del>` : `<ins>${esc(p.text)}</ins>`)).join('');
}

function fieldHtml(name, cls, label, inner, extra = '') {
  return `<div class="field ${cls}" data-field="${name}"><div class="fl">${esc(label)}${extra}</div>${inner}</div>`;
}

function actualHtml(row, who) {
  if (row.mainState === 'error') return `<div class="alert"><b>error</b> ${esc(row.error)}</div>`;
  if (row.mainState === 'not-run') return tagHtml('not run');
  if (row.mainState !== 'ok') return tagHtml('…');
  const text = row.output === '' ? tagHtml('empty') : scroll('scroll', `Actual output of ${who}`, esc(row.output));
  const notes = [row.cutOff ? NOTE_CUT_OFF : '', row.note].filter(Boolean);
  return notes.length ? `${text} ${tagHtml(notes.join('; '))}` : text;
}

function metricHtml(name, view, who) {
  const grade = view.state === 'ok'
    ? `${ring(view.value, 'sm')}${view.previous !== null && view.previous !== view.value ? `<span class="prev">previously ${view.previous}%</span>` : ''}`
    : view.state === 'error' ? pill('error') : view.state === 'pending' ? pill('…') : pill('–');
  const rationale = view.state === 'ok' || view.state === 'error'
    ? scroll('scroll rat', `${name} rationale of ${who}`, esc(view.rationale))
    : view.state === 'nothing-to-judge' ? tagHtml('nothing to judge') : view.state === 'not-run' ? tagHtml('not run') : tagHtml('…');
  return `<div class="metric" data-metric="${name}"><div class="m-name">${name}</div><div class="m-grade">${grade}</div>${rationale}</div>`;
}

function caseHtml(row) {
  const who = `${row.id} – ${row.name}`;
  const input = fieldHtml('prompt-input', 'f-in', 'Prompt input', scroll('scroll mono', `Prompt input of ${who}`, esc(row.promptInput)), `<em>${row.promptInput.length} characters</em>`);
  const expected = fieldHtml('expected', 'f-exp', 'Expected result', row.expected === '' ? tagHtml('none', ' none') : scroll('scroll', `Expected result of ${who}`, esc(row.expected)));
  const actual = fieldHtml('actual', 'f-act', 'Actual output', actualHtml(row, who));
  const sim = fieldHtml('similarity', 'f-sim', 'Similarity', row.similarity.value === null ? tagHtml(row.similarity.text) : ring(row.similarity.value, 'md'));
  const differences = fieldHtml('differences', 'f-diff', 'Differences', row.diff ? scroll('scroll', `Differences of ${who}`, diffHtml(row.diff)) : tagHtml(row.diffNote));
  return `<article class="case" id="${row.anchor}"><header><span class="chip lg">${esc(row.id)}</span><h3>${esc(row.name)}</h3>`
    + `<div class="badges"><span>Similarity ${pill(row.similarity.text)}</span><span>Accuracy ${pill(row.accuracy.gradeText)}</span><span>Completeness ${pill(row.completeness.gradeText)}</span></div></header>`
    + `<div class="main">${input}${expected}${actual}${sim}${differences}</div>`
    + `<div class="judges"><div class="jh"><span>Metric</span><span>Grade</span><span>Rationale</span></div>${metricHtml('Accuracy', row.accuracy, who)}${metricHtml('Completeness', row.completeness, who)}</div></article>`;
}

function kpiHtml(key, title, value) {
  return `<div class="kpi" data-kpi="${key}" data-value="${value === null ? '' : value}">${ring(value, 'lg')}<div><div class="kpi-t">${title}</div><div class="kpi-s">average over the rows with a value</div></div></div>`;
}

/** The content of the report without the document frame (used on the page and inside the HTML export). */
export function renderBody(report) {
  const { facts, averageValues } = report;
  const date = report.generatedAt;
  const summary = report.summaryRows.map((r) => `<tr><td><a href="#${r.anchor}"><span class="chip">${esc(r.rowId)}</span> ${esc(r.name)}</a></td><td>${bar(r.similarity)}</td><td>${bar(r.accuracy)}</td><td>${bar(r.completeness)}</td></tr>`).join('');
  const prompts = report.promptRows.map((p) => `<tr><td>${esc(p.label)}</td><td><code>${esc(p.model)}</code></td><td class="params">${esc(p.params)}${p.note ? `<span class="prev">${esc(p.note)}</span>` : ''}</td><td class="r">${p.generatedAt ? formatLocal(p.generatedAt) : '–'}</td></tr>`).join('');
  const archive = report.archive.prompts.map((p) => `<h4>${esc(p.label)}</h4><div class="box">${esc(p.text)}</div>`
    + (p.earlier ?? []).map((e) => `<h4>${esc(p.label)} – earlier version (${e.grades} ${e.grades === 1 ? 'grade' : 'grades'})</h4><div class="box">${esc(e.text)}</div>`).join('')).join('');
  return `<div class="hero"><h1>Report – Prompt Runner</h1><div class="facts"><span>Report generated: <b>${formatLocal(date)}</b> (${offsetLabel(date)})</span><span>${facts.cases} test cases</span><span>Model ${esc(facts.model)}</span><span>Judges: ${esc(facts.judges)}</span></div></div>
<div class="body"><section class="kpis" aria-label="Averages">${kpiHtml('similarity', 'Similarity', averageValues.similarity)}${kpiHtml('accuracy', 'Accuracy', averageValues.accuracy)}${kpiHtml('completeness', 'Completeness', averageValues.completeness)}<div class="kpi" data-kpi="cases"><div class="big">${facts.cases}</div><div><div class="kpi-t">Test cases</div><div class="kpi-s">${facts.failed} failed · ${facts.noExpected} without expected result</div></div></div></section>
<section class="card"><h2>Summary</h2><table class="sum"><thead><tr><th>Test case</th><th>Similarity</th><th>Accuracy</th><th>Completeness</th></tr></thead><tbody>${summary}<tr class="avg"><td>Average</td><td>${bar(report.averages.similarity)}</td><td>${bar(report.averages.accuracy)}</td><td>${bar(report.averages.completeness)}</td></tr></tbody></table></section>
<section class="card"><h2>Prompts and models</h2><table class="meta"><thead><tr><th>Prompt</th><th>Model</th><th>Parameters used</th><th class="r">Generated</th></tr></thead><tbody>${prompts}</tbody></table></section>
<section class="card"><details><summary>Prompts used (archive)</summary>${archive}</details></section>
<h2 class="sec-t">Results</h2>
${report.rows.map(caseHtml).join('\n')}
<p class="foot">Differences: <del>struck-through words</del> exist only in the expected result, <ins>underlined words</ins> exist only in the actual output.</p></div>`;
}

/** The self-contained HTML document: the shared CSS inline, no scripts, no external references (spec FR-025, FR-037). */
export function renderHtml(report) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Report – Prompt Runner</title><style>${REPORT_CSS}</style></head><body class="rpt">${renderBody(report)}</body></html>\n`;
}
