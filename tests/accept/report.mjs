// The report of a run (spec FR-063, FR-064, FR-065, research R35): a table for the terminal, a self-contained page, and the
// data. Nothing here ever receives a key; the run folder is searched for the fake key separately.
import { tokensCss } from '../../app/public/src/theme.mjs';

/** An evidence entry as `{ path, bytes? }` (older runs wrote plain paths). */
const entryOf = (e) => (typeof e === 'string' ? { path: e } : e);
const sizeText = (bytes) => (bytes === undefined ? '' : bytes < 1024 ? ` (${bytes} B)` : ` (${(bytes / 1024).toFixed(1)} KB)`);

const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MARK = { pass: 'PASS', fail: 'FAIL', 'not-run': 'NOT RUN', human: 'HUMAN' };
const WORD = { pass: 'passed', fail: 'failed', 'not-run': 'not run', human: 'human judgment' };

export const summary = (verdicts) => ({
  pass: verdicts.filter((v) => v.verdict === 'pass').length,
  fail: verdicts.filter((v) => v.verdict === 'fail').length,
  notRun: verdicts.filter((v) => v.verdict === 'not-run').length,
  human: verdicts.filter((v) => v.verdict === 'human').length,
});

/** The verdict table for the terminal. */
export function renderTerminal(verdicts, human = []) {
  const width = Math.max(...verdicts.map((v) => v.id.length), 10);
  const lines = verdicts.map((v) => `${MARK[v.verdict].padEnd(8)} ${v.id.padEnd(width)}  ${v.durationMs === undefined ? '' : `${(v.durationMs / 1000).toFixed(1)}s`.padStart(6)}  ${v.row ?? ''}`);
  for (const v of verdicts.filter((x) => x.verdict === 'fail')) {
    lines.push('', `FAILED ${v.id}`, ...(v.problems?.length ? v.problems.map((p) => `   - ${p}`) : []), `   expected: ${v.expected}`, `   seen:     ${v.seen}`);
  }
  for (const v of verdicts.filter((x) => x.matrix)) lines.push('', `Key audit (${v.id}), ${v.matrix.places.length} places:`, ...matrixLines(v.matrix));
  const s = summary(verdicts);
  const left = human.length || s.human;
  lines.push('', `${s.pass} passed, ${s.fail} failed, ${s.notRun} not run, ${left} left to a human.`);
  for (const h of human) lines.push(`   - ${h.name}`);
  return lines.join('\n');
}

/** What a cell of the matrix says: the number examined, or that nothing can exist there, or the hits. */
export function cellText(cell) {
  if (!cell) return { text: 'not examined', cls: 'bad' };
  if (cell.hits > 0) return { text: `${cell.hits} hit${cell.hits === 1 ? '' : 's'}`, cls: 'bad' };
  if (cell.empty) return { text: 'examination empty', cls: 'bad' };
  if (cell.nothingCanExist) return { text: 'none can exist', cls: 'none' };
  const [name, value] = Object.entries(cell.examined ?? {})[0] ?? ['', 0];
  return { text: `${value} ${name}${cell.skipped ? `, ${cell.skipped} skipped` : ''}`, cls: 'ok' };
}

const matrixLines = (matrix) => matrix.ways.map((w) => `   ${w.ok ? 'clean' : 'FOUND'}  ${w.id.padEnd(18)} ${w.title}`);

/** The data of the run as JSON text. */
export function resultsJson(run) {
  return JSON.stringify({ startedAt: run.startedAt, folder: run.folder, summary: summary(run.verdicts), verdicts: run.verdicts, human: run.human, gallery: run.gallery }, null, 2);
}

const CSS = `${tokensCss(':root')}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,"Segoe UI",sans-serif}
header{background:linear-gradient(120deg,var(--hero1),var(--hero2) 55%,var(--hero3));color:var(--herotext);padding:24px 32px}
header h1{margin:0;font-size:24px} header p{margin:6px 0 0}
main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
section{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:18px 22px;margin-bottom:22px}
h2{margin:0 0 10px;font-size:17px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.v{display:inline-block;font-weight:700;font-size:12px;border-radius:99px;padding:1px 10px}
.v.pass{background:var(--goodbg);color:var(--good)} .v.fail{background:var(--lowbg);color:var(--low)} .v.not-run,.v.human{background:var(--midbg);color:var(--mid)}
.human li{margin-bottom:6px}
.matrix{overflow-x:auto} .matrix td.ok{color:var(--good)} .matrix td.none{color:var(--muted)} .matrix td.bad{color:var(--low);font-weight:700}
.matrix th.way{max-width:130px;text-transform:none;letter-spacing:0;font-size:12px}
code,.mono{font:12.5px ui-monospace,Menlo,monospace}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}
.gal figure{margin:0;border:1px solid var(--line);border-radius:12px;padding:8px;background:var(--surface2)}
.gal img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px}
.gal figcaption{font-size:13px;color:var(--muted);margin-bottom:6px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:700px){.pair{grid-template-columns:1fr}}
details summary{cursor:pointer;color:var(--accent);font-weight:600}
`;

/** The self-contained page: the human items first, then the verdicts, the evidence, and the gallery. */
export function renderHtml(run) {
  const s = summary(run.verdicts);
  const rows = run.verdicts.map((v) => `<tr><td><span class="v ${esc(v.verdict)}">${esc(WORD[v.verdict])}</span></td><td class="mono">${esc(v.id)}</td><td>${esc(v.row ?? '')}</td><td>${v.durationMs === undefined ? '' : `${(v.durationMs / 1000).toFixed(1)} s`}</td></tr>`).join('');
  const details = run.verdicts.filter((v) => v.verdict !== 'pass' || v.evidence?.length).map((v) => `<details${v.verdict === 'fail' ? ' open' : ''}><summary><span class="v ${esc(v.verdict)}">${esc(WORD[v.verdict])}</span> <span class="mono">${esc(v.id)}</span> ${esc(v.title ?? '')}</summary>
<p><b>Expected:</b> ${esc(v.expected)}<br><b>Seen:</b> ${esc(v.seen)}${v.reason ? `<br><b>Reason:</b> ${esc(v.reason)}` : ''}</p>
${v.problems?.length ? `<ul>${v.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
${v.evidence?.length ? `<p>Evidence: ${v.evidence.map(entryOf).map((e) => `<a href="${esc(e.path)}">${esc(e.path)}</a>${esc(sizeText(e.bytes))}`).join(', ')}</p>` : ''}
${v.screenshot ? `<p><a href="${esc(v.screenshot)}"><img src="${esc(v.screenshot)}" alt="Screenshot at the moment of ${esc(v.id)}" style="max-width:420px;border:1px solid var(--line);border-radius:8px"></a></p>` : ''}</details>`).join('\n');
  const matrices = run.verdicts.filter((v) => v.matrix).map((v) => {
    const m = v.matrix;
    const head = m.ways.map((w) => `<th class="way" title="${esc(w.title)}">${esc(w.id)}</th>`).join('');
    const body = m.places.map((place) => `<tr><th scope="row">${esc(place)}</th>${m.ways.map((w) => { const c = cellText(w.cells?.[place]); return `<td class="${c.cls}">${esc(c.text)}</td>`; }).join('')}</tr>`).join('');
    return `<section><h2>Key audit: places by ways of ending a run</h2><p>${esc(v.seen)}</p><div class="matrix"><table><thead><tr><th>Place</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
<p><b>Ways:</b> ${m.ways.map((w) => `<span class="mono">${esc(w.id)}</span> ${esc(w.title)}`).join('; ')}.</p>
<p><b>Out of scope:</b> ${m.outOfScope.map(esc).join('; ')}.<br><b>Limits:</b> ${m.limits.map(esc).join('; ')}.</p></section>`;
  }).join('\n');
  const gallery = run.gallery.map((g) => `<figure><figcaption>${esc(g.caption)}</figcaption>${g.reference
    ? `<div class="pair"><div><div class="mono">the page</div><img src="${esc(g.page)}" alt="${esc(g.caption)}"></div><div><div class="mono">the reference page</div><img src="${esc(g.reference)}" alt="Reference page, ${esc(g.caption)}"></div></div>`
    : `<img src="${esc(g.page)}" alt="${esc(g.caption)}">`}</figure>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"><title>Acceptance report – Prompt Runner</title><style>${CSS}</style></head><body>
<header><h1>Acceptance report</h1><p>${esc(run.startedAt)} · ${s.pass} passed, ${s.fail} failed, ${s.notRun} not run, ${run.human.length || s.human} left to a human</p></header>
<main>
<section class="human"><h2>Left to a human</h2><p>The run gives no verdict for these.</p><ul>${run.human.map((h) => `<li><b>${esc(h.name)}.</b> ${esc(h.reason)}</li>`).join('')}</ul></section>
<section><h2>Verdicts</h2><table><thead><tr><th>Verdict</th><th>Check</th><th>Quickstart row</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></section>
${matrices}
<section><h2>Evidence and failures</h2>${details || '<p>Nothing to show.</p>'}</section>
<section><h2>Gallery</h2><div class="gal">${gallery || '<p>No screenshots.</p>'}</div></section>
</main></body></html>
`;
}
