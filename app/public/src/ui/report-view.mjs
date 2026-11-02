// Step 5 shows the status; the report itself is its own view over the full width of the window (spec FR-038).
// This module draws the report, switches between the form and the report, runs the exports, and keeps the
// guard against losing unexported results.
import { buildReport, renderBody, renderHtml, formatLocal } from '../report.mjs';
import { renderCsv, download } from '../exports.mjs';
import { REPORT_CSS } from '../report-style.mjs';

const stamp = (ms) => formatLocal(ms).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');

export function mountReportView({ state }) {
  const $ = (id) => document.getElementById(id);
  let timer = null;
  let guard = null;
  let open = false;

  // The report's own style definitions (the same text the export inlines), added once.
  if (!document.getElementById('reportStyle')) {
    const style = document.createElement('style');
    style.id = 'reportStyle';
    style.textContent = REPORT_CSS;
    document.head.append(style);
  }

  const warnBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };

  /** The unload warning is active exactly while there are results that were not exported since the last change (research R11). */
  function syncGuard() {
    const session = state.get();
    const wanted = Boolean(session.run) && !session.exportedSinceChange;
    if (wanted && !guard) { guard = warnBeforeUnload; window.addEventListener('beforeunload', guard); }
    if (!wanted && guard) { window.removeEventListener('beforeunload', guard); guard = null; }
  }

  function syncButtons() {
    const { run } = state.get();
    for (const id of ['expHtml', 'expCsv', 'rvHtml', 'rvCsv', 'openReport']) $(id).disabled = !run;
  }

  function render() {
    clearTimeout(timer);
    timer = null;
    const { run } = state.get();
    if (open) $('report').innerHTML = run ? renderBody(buildReport(run)) : '';
    syncButtons();
    syncGuard();
  }

  function setOpen(value) {
    open = value;
    $('reportView').hidden = !value;
    $('formView').hidden = value;
    document.body.classList.toggle('reporting', value); // the header band becomes compact and stays in view (spec FR-077)
    if (value) { render(); window.scrollTo(0, 0); } else { $('report').innerHTML = ''; }
    document.documentElement.style.setProperty('--hero-h', `${value ? $('sessionBar').offsetHeight : 0}px`);
  }

  function exportFile(kind) {
    const { run } = state.get();
    if (!run) return;
    const report = buildReport(run);
    const base = `prompt-runner-report-${stamp(report.generatedAt)}`;
    if (kind === 'html') download(`${base}.html`, 'text/html;charset=utf-8', renderHtml(report));
    else download(`${base}.csv`, 'text/csv;charset=utf-8', renderCsv(report));
    state.update((s) => { s.exportedSinceChange = true; });
  }

  for (const id of ['expHtml', 'rvHtml']) $(id).addEventListener('click', () => exportFile('html'));
  for (const id of ['expCsv', 'rvCsv']) $(id).addEventListener('click', () => exportFile('csv'));
  $('openReport').addEventListener('click', () => setOpen(true));
  // Back to the form: the focus goes to "Open report", the control that undoes it, so that a keyboard user does not start from the top.
  $('rvBack').addEventListener('click', () => { setOpen(false); $('openReport').focus(); });
  state.subscribe(() => { syncGuard(); syncButtons(); });
  // The toolbar sticks below the header band, whatever height the band has (the band grows while its confirmation is open).
  const band = $('sessionBar');
  const setBandHeight = () => document.documentElement.style.setProperty('--hero-h', `${document.body.classList.contains('reporting') ? band.offsetHeight : 0}px`);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(setBandHeight).observe(band);
  window.addEventListener('resize', setBandHeight);

  return {
    /** Called on every change of the run; the drawing is coalesced, and when the run is over the view opens by itself. */
    update(run, { final = false } = {}) {
      if (final) { setOpen(true); return; }
      if (open && !timer) timer = setTimeout(render, 150);
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => open,
    /** New Session: the view is closed and emptied. */
    reset() { setOpen(false); render(); },
    guardActive: () => guard !== null,
  };
}
