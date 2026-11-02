// Steps 2 and 3 of the page: the main prompt and the judge prompts, with highlighted placeholders,
// previews, and "run blocked" messages. No placeholder is ever shown by color alone: the braces stay visible.
import { sourceSegments, outputSegments, checkPrompt, PROMPT_KINDS } from '../placeholders.mjs';
import { FORMAT_INSTRUCTION } from '../judge.mjs';
import { esc } from '../html.mjs';

const EDITORS = [
  { kind: 'main', key: 'main', textId: 'mainText', backId: 'mainBack', msgId: 'mainMsg', countId: 'mainCount' },
  { kind: 'accuracy', key: 'accuracy', textId: 'accText', backId: 'accBack', msgId: 'accMsg', countId: 'accCount', previewId: 'accPrev' },
  { kind: 'completeness', key: 'completeness', textId: 'compText', backId: 'compBack', msgId: 'compMsg', countId: 'compCount', previewId: 'compPrev' },
];

/** Stand-in for the main prompt's answer in the judge preview, before any answer exists. */
export const OUTPUT_STAND_IN = '[the main prompt answer goes here]';

/** The text that would be sent, as HTML with inserted values highlighted. */
export function segmentsToHtml(segments) {
  return segments.map((seg) => {
    if (seg.type === 'value') return `<mark class="val">${esc(seg.text)}</mark>`;
    if (seg.type === 'unknown') return `<mark class="bad">${esc(seg.text)}</mark>`;
    return esc(seg.text);
  }).join('');
}

/** Highlights placeholders in the source text: known ones in blue, unknown ones in red dashes. */
function paint(editor, text) {
  const allowed = PROMPT_KINDS[editor.kind].allowed;
  const html = sourceSegments(text, allowed)
    .map((seg) => (seg.type === 'plain' ? esc(seg.text) : `<mark class="${seg.type === 'known' ? 'ph' : 'bad'}">${esc(seg.text)}</mark>`)).join('');
  document.getElementById(editor.backId).innerHTML = `${html}\n`;
}

export function mountPromptsView({ state }) {
  const $ = (id) => document.getElementById(id);

  const currentRow = () => {
    const rows = state.get().dataset;
    if (!rows?.length) return null;
    return rows[Number($('exRow').value) || 0] ?? rows[0];
  };

  function renderEditor(editor) {
    const text = state.get().prompts[editor.key];
    paint(editor, text);
    const problems = checkPrompt(editor.kind, text);
    const msg = $(editor.msgId);
    msg.className = `msg ${problems.length ? 'err' : 'info'}`;
    msg.textContent = problems.length ? `Run blocked: ${problems.join(' ')}` : '';
    $(editor.countId).textContent = `${text.length} characters`;
  }

  /** The example of the main prompt and the previews of the judge inputs for the chosen row. */
  function renderPreviews() {
    const row = currentRow();
    const prompts = state.get().prompts;
    $('mainExample').innerHTML = row ? segmentsToHtml(outputSegments(prompts.main, { prompt_input: row.promptInput })) : '';
    for (const editor of EDITORS.filter((e) => e.previewId)) {
      $(editor.previewId).innerHTML = row
        ? segmentsToHtml(outputSegments(prompts[editor.key], { prompt_input: row.promptInput, output: OUTPUT_STAND_IN }))
        : '';
    }
    $('formatPrev').textContent = FORMAT_INSTRUCTION;
  }

  function renderRows() {
    const rows = state.get().dataset ?? [];
    const select = $('exRow');
    const previous = select.value;
    select.innerHTML = rows.map((row, i) => `<option value="${i}">${esc(row.id)} – ${esc(row.name)}</option>`).join('');
    if (previous && select.options[previous]) select.value = previous;
  }

  function renderAll() {
    for (const editor of EDITORS) renderEditor(editor);
    renderPreviews();
  }

  for (const editor of EDITORS) {
    const textarea = $(editor.textId);
    textarea.addEventListener('input', () => {
      state.get().prompts[editor.key] = textarea.value; // no full notification needed for every keystroke
      renderAll();
    });
    textarea.addEventListener('scroll', () => { $(editor.backId).scrollTop = textarea.scrollTop; });
  }
  $('exRow').addEventListener('change', renderAll);

  let lastDataset = null;
  state.subscribe((session) => {
    if (session.dataset !== lastDataset) { lastDataset = session.dataset; renderRows(); }
    renderAll();
  });

  return {
    /** Fills the editors from the session and draws everything (also after New Session). */
    reset() {
      for (const editor of EDITORS) $(editor.textId).value = state.get().prompts[editor.key];
      renderRows();
      renderAll();
    },
    renderAll,
    currentRow,
  };
}
