// Step 1 of the page: load the dataset (pasted or from a file), show errors and a preview.
import { parseDataset, defaultSelection, validateSelection, selectAll, selectNone, MAX_ROWS_PER_RUN } from '../dataset.mjs';
import { esc, shortHtml } from '../html.mjs';
import { SAMPLE_DATASET } from '../defaults.mjs';

export function mountDatasetView({ state, sampleText, onChange } = {}) {
  const $ = (id) => document.getElementById(id);

  const showMessage = (text, isError) => {
    const el = $('dsMsg');
    el.className = `msg ${isError ? 'err' : 'info'}`;
    el.textContent = text;
  };

  function renderPreview(rows) {
    const preview = $('dsPrev');
    if (!rows) { preview.innerHTML = ''; return; }
    const body = rows.map((row) => `<tr data-row="${esc(row.id)}"><td><input type="checkbox" data-select="${esc(row.id)}" aria-label="Select row ${esc(row.id)}"></td><td>${esc(row.id)}</td><td>${esc(row.name)}</td><td>${shortHtml(row.promptInput)}</td><td>${row.expectedResult ? shortHtml(row.expectedResult) : '<span class="tag t-none">none</span>'}</td></tr>`).join('');
    preview.innerHTML = `<table><thead><tr><th>Run</th><th>id</th><th>name</th><th>prompt_input</th><th>expected_result</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  /** The selection bar: select all / none, and the count next to the limit of 20 per run (spec FR-034). */
  function renderSelection() {
    const { dataset, selection } = state.get();
    const bar = $('dsSel');
    bar.hidden = !dataset;
    if (!dataset) return;
    const chosen = new Set(selection);
    for (const box of $('dsPrev').querySelectorAll('input[data-select]')) box.checked = chosen.has(box.dataset.select);
    const check = validateSelection(selection);
    $('selCount').className = check.ok ? 'pill good' : 'pill low';
    $('selCount').textContent = check.ok
      ? `${check.count} of ${dataset.length} rows selected (at most ${MAX_ROWS_PER_RUN} per run).`
      : `${check.message} (at most ${MAX_ROWS_PER_RUN} per run.)`;
  }

  $('dsSel').innerHTML = '<button type="button" id="selAll">Select all</button><button type="button" id="selNone">Select none</button><span id="selCount" role="status"></span>';
  $('selAll').addEventListener('click', () => state.update((s) => { s.selection = selectAll(s.dataset); }));
  $('selNone').addEventListener('click', () => state.update((s) => { s.selection = selectNone(); }));
  $('dsPrev').addEventListener('change', (event) => {
    const id = event.target.dataset?.select;
    if (id === undefined) return;
    state.update((s) => {
      const chosen = new Set(s.selection);
      if (event.target.checked) chosen.add(id); else chosen.delete(id);
      s.selection = s.dataset.map((row) => row.id).filter((rowId) => chosen.has(rowId)); // dataset order
    });
  });
  state.subscribe(renderSelection);

  function load(text) {
    const result = parseDataset(text);
    if (!result.ok) {
      state.update((s) => { s.dataset = null; s.selection = []; });
      renderPreview(null);
      showMessage(result.errors.join(' '), true);
      return;
    }
    const note = result.notes.length ? ` Note: ${result.notes.join('; ')}.` : '';
    showMessage(`Loaded ${result.rows.length} rows.${note}`, false);
    renderPreview(result.rows);
    state.update((s) => { s.dataset = result.rows; s.selection = defaultSelection(result.rows); });
    onChange?.(result.rows);
  }

  $('dsLoad').onclick = () => load($('dsText').value);
  $('dsSample').onclick = () => {
    $('dsText').value = sampleText ?? SAMPLE_DATASET;
    load($('dsText').value);
  };
  /** The one place that reads a file into the text area and loads it: the chooser and the drop zone both use it. */
  async function loadFile(file) {
    if (!file) return;
    const text = await file.text();
    $('dsText').value = text;
    load(text);
  }
  $('dsFile').onchange = (event) => loadFile(event.target.files[0]);
  const zone = $('dsDrop');
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('over');
    loadFile(event.dataTransfer?.files?.[0]);
  });

  return {
    /** Back to the empty step (New Session). */
    reset() {
      $('dsText').value = '';
      $('dsFile').value = '';
      showMessage('', false);
      renderPreview(null);
    },
    renderPreview,
  };
}
