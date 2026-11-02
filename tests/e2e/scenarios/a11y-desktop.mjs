// SC-014: a run of 20 rows; the summary table shows all 20 rows at once on a 1920x1080 screen.
export const windowSize = '1920,1080';
// The first row is huge (100,000 characters in three fields); its judge answers with a very long rationale.
export const fakeOptions = {
  rules: [
    { match: (body, content) => content.includes('SCORE: <number>') && content.includes('HUGE-ROW'),
      respond: { content: `${'long rationale line\n'.repeat(6000)}SCORE: 70` } },
  ],
};

export default async function run(t) {
  t.click('newSession');
  const huge = `HUGE-ROW\n${'a line of the very long text\n'.repeat(5000)}`.slice(0, 100_000);
  const rows = Array.from({ length: 20 }, (_, i) => (i === 0
    ? `R1,Huge test case,"${huge}","${huge}"`
    : `R${i + 1},Test case number ${i + 1},input ${i + 1},expected ${i + 1}`)).join('\n');
  t.type('dsText', `id,name,prompt_input,expected_result\n${rows}`);
  t.click('dsLoad');
  t.type('mainKey', 'nvapi-FAKE-KEY');
  t.type('mainEp', t.config.fakeEndpoint);
  t.click('run');
  t.match(t.text('confirmText'), /Main prompt: 20 requests/, 'twenty main requests');
  t.click('confirmYes');
  const { state } = await import('/src/main.mjs');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => t.visible('reportView') && document.querySelectorAll('#report .case').length === 20, 'the report');

  const table = document.querySelector('#report table.sum');
  const box = table.getBoundingClientRect();
  t.equal(table.querySelectorAll('tbody tr').length, 21, 'twenty rows and the Average line');
  t.assert(window.innerWidth >= 1900, `desktop width applied (${window.innerWidth})`);
  t.assert(box.height <= window.innerHeight - 40, `the summary table fits on one screen (${Math.round(box.height)} px of ${window.innerHeight})`);
  t.assert(box.right <= window.innerWidth && table.scrollWidth <= table.clientWidth + 1, 'the summary table needs no horizontal scroll');
  t.assert(document.documentElement.scrollWidth <= window.innerWidth, 'no horizontal page scroll');
  t.equal(state.get().run.rows.length, 20, 'twenty rows ran');

  // SC-015: the results table is as wide as it is with 2 cases (it only grows downward); the main prompt line is fully visible.
  const cases = [...document.querySelectorAll('#report .case')];
  t.equal(new Set(cases.map((c) => Math.round(c.getBoundingClientRect().width))).size, 1, 'every case is exactly as wide as the others');
  t.assert(cases[0].getBoundingClientRect().width >= window.innerWidth - 2 * 32 - 4, 'the cases use the full width of the window');
  const main = cases[0].querySelector('.main');
  t.assert(main.scrollWidth <= main.clientWidth + 1, 'the main prompt line needs no horizontal scroll');
  const tops = [...main.querySelectorAll('[data-field]')].map((f) => Math.round(f.getBoundingClientRect().top));
  t.assert(tops.every((top) => top === tops[0]), 'prompt input, expected, actual, similarity, and differences are side by side');
  t.assert(cases[0].querySelector('[data-field="actual"]').getBoundingClientRect().width > 250, 'the fields are wide enough to read');

  // FR-023, FR-006: a very long text stays in its box and never makes the case taller than the limit.
  const huge0 = cases[0];
  const limit = (box) => parseFloat(getComputedStyle(box).maxHeight);
  const boxes = [...huge0.querySelectorAll('.scroll')];
  t.assert(boxes.length >= 5, `the huge case has its boxes (${boxes.length})`);
  for (const box of boxes) t.assert(box.getBoundingClientRect().height <= limit(box) + 1, `a box stays within its limit (${Math.round(box.getBoundingClientRect().height)} of ${Math.round(limit(box))} px)`);
  const input = huge0.querySelector('[data-field="prompt-input"] .scroll');
  t.assert(input.textContent.length >= 99_000 && input.scrollHeight > input.clientHeight * 3, 'the whole 100,000-character input is in its box and scrolls inside it');
  const expected = huge0.querySelector('[data-field="expected"] .scroll');
  t.assert(expected.textContent.length >= 99_000 && expected.scrollHeight > expected.clientHeight * 3, 'the whole expected result is in its box and scrolls inside it');
  const rationale = huge0.querySelector('[data-metric="Accuracy"] .scroll.rat');
  t.assert(rationale.textContent.length > 100_000 - 100 && rationale.scrollHeight > rationale.clientHeight * 3, 'the very long rationale scrolls inside its box');
  t.assert(huge0.getBoundingClientRect().height <= cases[1].getBoundingClientRect().height + 400, `the huge case is not much taller than a normal one (${Math.round(huge0.getBoundingClientRect().height)} vs ${Math.round(cases[1].getBoundingClientRect().height)} px)`);
}
