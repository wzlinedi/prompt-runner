// User Story 5: run and read the report, with the fake platform (spec US5 scenarios 1-11).
const judgeRequest = (content) => content.includes('SCORE: <number>');

export const fakeOptions = {
  rules: [
    // Hungary: the main request fails once (rate limit), so the row has nothing to judge.
    { match: (body, content) => !judgeRequest(content) && content.includes('Hungary'), times: 1,
      respond: { status: 429, headers: { 'retry-after': '7' }, body: { status: 429, title: 'Too Many Requests' } } },
    // Czechia: the main answer is cut off at the length limit.
    { match: (body, content) => !judgeRequest(content) && content.includes('Czechia'),
      respond: { content: 'Czechia (10.9 million people) has an unemployment rate of 2', finish: 'length' } },
    // Germany: the Accuracy judge answers without a SCORE line.
    { match: (body, content) => judgeRequest(content) && content.includes('Germany') && content.includes('ACCURACY'),
      respond: { content: 'The output looks correct.' } },
  ],
};

const KEY = 'nvapi-FAKE-SECRET-KEY-123';

export async function after({ result, fake, logs, assert }) {
  const all = logs.join('\n');
  assert(logs.length > 0, 'the relay logged its requests');
  assert(!all.includes(KEY), 'the relay log has no key');
  assert(!all.includes('Selected indicators') && !all.includes('Summarize'), 'the relay log has no prompt text');
  assert(fake.requests.every((r) => r.authorization === `Bearer ${KEY}`), 'every request carried the key');
  assert(fake.requests.every((r) => !JSON.stringify(r.body).includes('Poland has about')), 'the expected result was never sent');
}

export default async function run(t) {
  let actions = 0;
  const act = (fn) => { actions += 1; return fn(); };

  act(() => t.click('newSession'));
  act(() => t.click('dsSample'));
  act(() => t.type('mainKey', KEY));
  t.type('mainEp', t.config.fakeEndpoint); // pointing the page at the fake is not part of a real flow

  // Observe the status line during the run.
  const seen = [];
  const watcher = setInterval(() => { const text = t.text('phase'); if (text && seen[seen.length - 1] !== text) seen.push(text); }, 20);

  // 1. The confirmation comes first and states counts, models, data, relay, and cost; nothing was sent yet.
  act(() => t.click('run'));
  t.require(t.visible('runConfirm'), 'the confirmation is shown');
  const confirm = t.text('confirmText');
  t.match(confirm, /Main prompt: 5 requests to http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions \(model nvidia\/nemotron-3\.5-bolt-e4b\)/, 'main request count, endpoint, and model');
  t.match(confirm, /Judges: up to 10 requests to http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions \(model nvidia\/nemotron-3\.5-bolt-e4b\)/, 'judge request count');
  t.match(confirm, /local relay/, 'the relay is named');
  t.match(confirm, /costs/, 'the cost note is shown');
  t.match(confirm, /expected result is never sent/, 'the expected result is declared unsent');
  t.assert(!confirm.includes(KEY), 'the confirmation does not show the key');
  const before = await (await fetch(`${t.config.fakeUrl}/__count`)).json();
  t.equal(before.count, 0, 'nothing is sent before the confirmation');

  act(() => t.click('confirmYes'));
  t.assert(actions <= 7, `at most 7 user actions from New Session to a started run (${actions})`);
  const { state, reportView } = await import('/src/main.mjs');

  // FR-038: "Open report" works during a run and shows what has been received so far; going back keeps the run going.
  t.assert(!t.byId('openReport').disabled, 'Open report is enabled as soon as a run exists');
  t.click('openReport');
  t.assert(t.visible('reportView') && !t.visible('formView'), 'Open report shows the report view during the run');
  t.equal(document.querySelectorAll('#report .case').length, 5, 'all five cases are there during the run');
  t.assert(document.querySelector('#report .case [data-field="actual"]').textContent.trim() !== '', 'a case that has not finished shows a state, not a blank');
  t.assert(['running', 'stopping'].includes(state.get().run.status) || state.get().run.status === 'finished', 'the run goes on while the report is open');
  t.click('rvBack');
  t.assert(t.visible('formView') && !t.visible('reportView'), 'Back to the form returns to the form during the run');
  t.equal(t.value('mainEp'), t.config.fakeEndpoint, 'the form is unchanged');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  clearInterval(watcher);

  // 2. Phases in order with progress.
  const first = seen.findIndex((s) => s.startsWith('Phase 1/2: main prompt'));
  const second = seen.findIndex((s) => s.startsWith('Phase 2/2: judges'));
  t.assert(first >= 0 && second > first, `phases in order (${seen.join(' | ')})`);
  t.equal(t.text('phase'), 'Finished.', 'the status line ends with Finished.');
  // The report opens by itself in its own full-width view (spec FR-038, SC-018).
  await t.waitFor(() => t.visible('reportView') && document.querySelectorAll('#report .case').length === 5, 'the report view to open with the report');
  t.assert(!t.visible('formView'), 'the form is replaced by the report view');
  t.assert(window.innerWidth - t.byId('report').getBoundingClientRect().width <= 1, 'the report uses the full width of the window');

  // 3. Keys are cleared and nothing is stored.
  t.equal(t.value('mainKey'), '', 'the key input is empty after the run');
  t.equal(state.get().config.main.apiKey, '', 'the key in memory is empty after the run');
  t.assert(t.storageEmpty(), 'localStorage, sessionStorage, and cookies are empty');

  // 4. The report: header band, average cards, summary table, prompts table, archive, then the cases.
  const report = t.byId('report');
  const order = ['.hero', '.kpis', 'table.sum', 'table.meta', 'details', '.case'].map((s) => report.querySelector(s));
  t.assert(order.every(Boolean), 'all parts of the report are there');
  for (let i = 1; i < order.length; i++) {
    t.assert(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `report part ${i} follows part ${i - 1}`);
  }
  t.match(report.querySelector('.hero .facts').textContent, /Report generated: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \(UTC[+-]\d\d:\d\d\).*5 test cases.*Model nvidia\/nemotron-3\.5-bolt-e4b.*Judges: same model/, 'the header names the date, the cases, and the models');
  t.assert(!report.querySelector('details').open, 'the archive is collapsed by default');
  const cells = (row) => [...row.querySelectorAll('td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  const rows = [...report.querySelectorAll('table.sum tbody tr')].map(cells);
  t.equal(rows.length, 6, 'five test cases and the Average line');
  t.equal(rows[0][0], 'PL Poland', 'the first test case');
  t.equal(rows[3].slice(1), ['error', '–', '–'], 'a failing row shows error and – in place of blanks');
  t.equal(rows[4][1], 'no expected result', 'a row without expected result');
  t.equal(rows[4][2], 'error', 'an unreadable judge answer is an error in the table');
  t.equal(rows[5][0], 'Average', 'the last line is the average');
  // SC-017: the three averages in the cards equal the Average line.
  const cards = Object.fromEntries([...report.querySelectorAll('.kpi[data-kpi]')].map((k) => [k.dataset.kpi, k.dataset.value]));
  t.equal([`${cards.similarity}%`, `${cards.accuracy}%`, `${cards.completeness}%`], rows[5].slice(1), 'the cards show the same averages as the summary table');
  t.match(report.querySelector('.kpi[data-kpi="cases"]').textContent, /5\s*Test cases\s*2 failed · 1 without expected result/, 'the case card counts failed rows (HU, and DE with an unreadable judge answer) and rows without expected result');
  t.assert(report.querySelectorAll('.ring').length > 10 && [...report.querySelectorAll('.ring span')].every((s) => s.textContent.trim() !== ''), 'every gauge shows its number');
  const meta = [...report.querySelectorAll('table.meta tbody tr')].map(cells);
  t.equal(meta.map((r) => r[0]), ['Main prompt', 'Judge – Accuracy', 'Judge – Completeness'], 'three prompt lines');
  t.match(meta[0][1], /nvidia\/nemotron-3\.5-bolt-e4b/, 'model');
  t.match(meta[0][2], /temperature=1, top_p=0.95, max_tokens=4096, seed=42, enable_thinking=true/, 'parameters');
  t.match(meta[0][3], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/, 'generated date');

  // The summary-table links jump to the cases.
  const link = report.querySelector('table.sum a[href="#row-1"]');
  link.click();
  t.equal(location.hash, '#row-1', 'a summary link jumps to the case');
  t.assert(document.getElementById('row-1') !== null, 'the target of the link exists');

  // 5. The lines of every case: the five fields in order, then the metrics one under the other.
  const blocks = [...report.querySelectorAll('.case')];
  const FIELD_ORDER = ['prompt-input', 'expected', 'actual', 'similarity', 'differences'];
  for (const [i, block] of blocks.entries()) {
    t.equal([...block.querySelectorAll('[data-field]')].map((f) => f.dataset.field), FIELD_ORDER, `fields in order in case ${i}`);
    t.equal([...block.querySelectorAll('[data-metric]')].map((m) => m.dataset.metric), ['Accuracy', 'Completeness'], `metrics in order in case ${i}`);
    t.assert(!block.querySelector('details'), `nothing is collapsed in case ${i}`);
    const tops = [...block.querySelectorAll('[data-field]')].map((f) => Math.round(f.getBoundingClientRect().top));
    t.assert(tops.every((top) => top === tops[0]), `the five fields of case ${i} are side by side (${tops.join(',')})`);
    const metricTops = [...block.querySelectorAll('[data-metric]')].map((m) => m.getBoundingClientRect().top);
    t.assert(metricTops[1] > metricTops[0], `the metrics of case ${i} are one under the other`);
  }
  const widths = new Set(blocks.map((b) => Math.round(b.getBoundingClientRect().width)));
  t.equal(widths.size, 1, 'every case is exactly as wide as the others');
  const text = (block) => block.textContent;
  t.match(text(blocks[3]), /Rate limit exceeded \(HTTP 429\)\. The platform asks to wait 7\./, 'the failing row shows its error');
  t.assert((text(blocks[3]).match(/nothing to judge/g) ?? []).length === 2, 'the failing row says nothing to judge twice');
  t.match(text(blocks[1]), /cut off at the length limit/, 'the cut-off row shows the note');
  t.assert(blocks[1].querySelectorAll('.metric .ring').length === 2, 'a cut-off answer is still judged');
  t.match(text(blocks[4]), /unreadable answer: no SCORE line was found/, 'the unreadable judge answer shows the error');
  t.match(text(blocks[4]), /Raw answer: The output looks correct\./, '… and the raw text');
  t.equal(blocks[4].querySelector('[data-field="expected"] .tag')?.textContent, 'none', 'no expected result shows "none"');
  t.equal(blocks[4].querySelector('[data-field="differences"] .tag')?.textContent, 'no expected result', 'the differences say there is no expected result');
  t.assert(blocks[0].querySelector('[data-field="differences"] del') && blocks[0].querySelector('[data-field="differences"] ins'), 'the differences mark removed and added words');
  t.assert(blocks[0].querySelector('[data-field="prompt-input"] .scroll').textContent.includes('Population on 1 January'), 'the prompt input is in a box with its full text');

  // 6. Back to the form: it is exactly as it was left; editing it does not change the report; the report can be reopened.
  const snapshot = report.innerHTML;
  const promptBefore = t.value('mainText');
  t.click('rvBack');
  t.assert(t.visible('formView') && !t.visible('reportView'), 'Back to the form shows the steps');
  t.equal(t.value('mainText'), promptBefore, 'the main prompt is as it was left');
  t.assert(t.visible('openReport') && !t.byId('openReport').disabled && t.visible('expHtml') && Boolean(document.querySelector('#rerunBox summary')), 'step 5 offers Open report, the exports, and the re-run control');
  t.type('mainText', 'A completely different prompt: {prompt_input}');
  t.type('dsText', 'id,name,prompt_input,expected_result\nX,Y,Z,W');
  t.click('openReport');
  t.assert(t.visible('reportView') && !t.visible('formView'), 'Open report shows the report again');
  t.assert(report.innerHTML === snapshot, 'the report is unchanged after editing the prompt and the dataset text');

  // 7. Exports: the unsaved-results guard is active until an export; neither export has the key or the endpoint.
  t.assert(reportView.guardActive(), 'the unsaved-results guard is active before an export');
  t.equal(state.get().exportedSinceChange, false, 'the results count as not exported');
  t.click('rvHtml');
  t.assert(!reportView.guardActive(), 'the guard is removed after an export');
  t.equal(state.get().exportedSinceChange, true, 'the results count as exported');
  t.click('rvCsv');
  t.equal(t.downloads.length, 2, 'both exports were offered');
  const html = await t.lastDownload(t.downloads.find((d) => d.name.endsWith('.html')).name);
  const csv = await t.lastDownload(t.downloads.find((d) => d.name.endsWith('.csv')).name);
  for (const [name, content] of [['HTML', html], ['CSV', csv]]) {
    t.assert(!content.includes(KEY), `the ${name} export has no key`);
    t.assert(!content.includes('127.0.0.1') && !content.includes('/v1/chat/completions'), `the ${name} export has no endpoint`);
  }
  t.assert(!/<script/i.test(html), 'the HTML export has no script');
  t.match(html, /Report generated: <b>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d<\/b> \(UTC[+-]\d\d:\d\d\)/, 'the HTML export has the date line');
  const { tokenize } = await import('/src/dataset.mjs');
  const records = tokenize(csv.replace(/^\uFEFF/, ''), ',');
  t.equal(records.length, 6, 'the CSV has a header and one line per row');
  t.assert(records.every((r) => r.length === 17), 'every CSV line has 17 columns');
  t.equal(records.slice(1).map((r) => r[0]), ['PL', 'CZ', 'SK', 'HU', 'DE'], 'CSV rows in dataset order');
  t.assert(!html.includes('Back to the form') && !html.includes('Export HTML'), 'the HTML export has no toolbar');
  t.assert(html.includes('class="kpis"') && html.includes('<body class="rpt">'), 'the HTML export has the same cards and the report style');

  // New Session closes the report view.
  t.click('rvBack');
  t.click('newSession2');
  t.click('resetYes');
  t.assert(!t.visible('reportView') && t.visible('formView'), 'New Session closes the report view');
  t.equal(state.get().run, null, 'New Session leaves no run');
}
