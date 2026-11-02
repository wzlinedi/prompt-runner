// User Story 7: choose the rows to run, and re-run the failed ones (spec US7 scenarios 1-8, SC-013).
const judgeRequest = (content) => content.includes('SCORE: <number>');
const KEY = 'nvapi-FAKE-SECRET-KEY-123';

export const fakeOptions = {
  rules: [
    // Hungary: the first main request fails (rate limit); after that everything works.
    { match: (body, content) => !judgeRequest(content) && content.includes('Hungary'), times: 1,
      respond: { status: 429, headers: { 'retry-after': '7' }, body: { status: 429, title: 'Too Many Requests' } } },
  ],
};

export async function after({ fake, assert }) {
  assert(fake.requests.length === 10, `7 requests for the run and 3 for the re-run (${fake.requests.length})`);
  const rerun = fake.requests.slice(7);
  assert(rerun.every((r) => r.content.includes('Hungary')), 'the re-run sent only the failed row\'s requests');
  assert(rerun.filter((r) => !judgeRequest(r.content)).length === 1, 'the re-run sent one main request');
  assert(rerun.filter((r) => judgeRequest(r.content)).length === 2, 'the re-run sent two judge requests');
  assert(rerun.every((r) => r.authorization === `Bearer ${KEY}`), 'the key was entered again and used');
}

const tick = (id, on) => {
  const box = document.querySelector(`input[data-select="${id}"]`);
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};

export default async function run(t) {
  t.click('newSession');

  // 21 selected rows are refused with the count.
  const header = 'id,name,prompt_input,expected_result';
  const many = Array.from({ length: 21 }, (_, i) => `R${i + 1},Row ${i + 1},input ${i + 1},expected ${i + 1}`).join('\n');
  t.type('dsText', `${header}\n${many}`);
  t.click('dsLoad');
  t.match(t.text('selCount'), /^20 of 21 rows selected \(at most 20 per run\)\.$/, 'a dataset with more than 20 rows selects the first 20');
  t.click('selAll');
  t.match(t.text('selCount'), /^Select between 1 and 20 rows; 21 are selected now\./, 'the count is shown when too many rows are selected');
  t.type('mainKey', KEY);
  t.type('mainEp', t.config.fakeEndpoint);
  t.assert(t.byId('run').disabled, 'Run is not available with 21 rows selected');
  t.match(t.text('ready'), /Dataset: Select between 1 and 20 rows; 21 are selected now\./, '21 selected rows are refused with the count, named in the list');
  t.assert(!t.visible('runConfirm'), 'nothing is offered for sending');
  t.click('selNone');
  t.assert(t.byId('run').disabled, 'Run is not available with no row selected');
  t.match(t.text('ready'), /Select between 1 and 20 rows; 0 are selected now\./, 'no row selected is refused with the count');

  // Run only the selected rows of the sample.
  t.click('dsSample');
  t.equal(document.querySelectorAll('input[data-select]:checked').length, 5, 'all five sample rows are selected by default');
  let selectActions = 0;
  selectActions += 1; tick('CZ', false);
  selectActions += 1; tick('SK', false);
  t.assert(selectActions <= 2, `limiting the run to chosen rows took at most 2 actions (${selectActions})`);
  t.match(t.text('selCount'), /^3 of 5 rows selected/, 'the count follows the check boxes');
  t.click('run');
  t.match(t.text('confirmText'), /3 of 5 rows in the dataset are selected and will run\./, 'the confirmation names the selection');
  t.match(t.text('confirmText'), /Main prompt: 3 requests/, 'three main requests');
  t.click('confirmYes');
  const { state } = await import('/src/main.mjs');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => t.visible('reportView') && document.querySelectorAll('#report .case').length === 3, 'the report view');
  const ids = [...document.querySelectorAll('#report .case')].map((b) => b.querySelector('header .chip').textContent);
  t.equal(ids, ['PL', 'HU', 'DE'], 'the report has only the selected rows, in dataset order');

  // The failed row (HU) is offered for a re-run; the other rows stay as they are.
  const field = (block, name) => block.querySelector(`[data-field="${name}"]`);
  const metric = (block, name) => block.querySelector(`[data-metric="${name}"]`);
  const before = [...document.querySelectorAll('#report .case')].map((b) => b.innerHTML);
  t.match(before[1], /Rate limit exceeded/, 'HU shows its error');
  t.click('rvBack');
  t.assert(!t.rerunButton('failedMain').disabled, 'Re-run failing main prompts and all related judges is available because a main request failed');
  t.assert(t.rerunButton('failedJudges').disabled, 'no judge request failed, so Re-run only the failing judges is unavailable');

  t.chooseRerun('failedMain');
  t.match(t.text('resMsg'), /Re-run blocked: Main prompt: the API key is empty\./, 'the key is asked for again');
  t.assert(!t.visible('runConfirm'), 'nothing is offered for sending without a key');

  // At most 3 actions: enter the key, trigger, confirm (spec SC-013).
  let failedActions = 0;
  const act = (fn) => { failedActions += 1; return fn(); };
  act(() => t.type('mainKey', KEY));
  act(() => t.chooseRerun('failedMain'));
  t.require(t.visible('runConfirm'), 'the confirmation is shown');
  const confirm = t.text('confirmText');
  t.match(confirm, /Main prompt: 1 request to http:\/\/127\.0\.0\.1:\d+.*archived model nvidia\/nemotron-3\.5-bolt-e4b/, 'one main request, archived model');
  t.match(confirm, /Judges: up to 2 requests/, 'two judge requests at most');
  t.equal(confirm.split('\n').filter((l) => l.startsWith('• ')), ['• HU – Hungary (example, rate limit): main prompt', '• HU – Hungary (example, rate limit): Accuracy', '• HU – Hungary (example, rate limit): Completeness'], 'every request is listed on its own line');
  t.match(confirm, /current judge prompt/, 'the current judge prompts are named');
  t.match(confirm, /endpoints and keys are the current ones/, 'the endpoints are stated as current');
  t.match(confirm, /costs/, 'the cost note is shown');
  act(() => t.click('confirmYes'));
  t.assert(failedActions <= 3, `completing the failed rows took at most 3 actions (${failedActions})`);
  t.assert(t.rerunButton('failedMain').disabled && t.rerunButton('judges').disabled && t.byId('run').disabled, 'no run can start while the re-run is in progress');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the re-run to finish');
  await t.waitFor(() => t.visible('reportView'), 'the report view to open by itself');
  await t.sleep(300);

  const after = [...document.querySelectorAll('#report .case')];
  t.equal(after[0].innerHTML, before[0], 'PL is unchanged');
  t.equal(after[2].innerHTML, before[2], 'DE is unchanged');
  t.assert(!after[1].textContent.includes('Rate limit exceeded'), 'HU no longer shows the error');
  t.assert(/^\d+%$/.test(field(after[1], 'similarity').querySelector('.ring')?.textContent.trim() ?? ''), 'HU has a similarity');
  t.equal(metric(after[1], 'Accuracy').querySelector('.ring').textContent.trim(), '87%', 'HU has its Accuracy grade');
  t.equal(metric(after[1], 'Completeness').querySelector('.ring').textContent.trim(), '87%', 'HU has its Completeness grade');
  t.equal(t.value('mainKey'), '', 'the key was cleared after the re-run');
  const meta = [...document.querySelectorAll('#report table.meta tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent.trim()));
  t.match(meta[0][3], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/, 'the main prompt date is shown');
  t.assert(t.storageEmpty(), 'nothing is stored in the browser');
  t.click('rvBack');
  t.assert(t.rerunButton('failedMain').disabled && t.rerunButton('failedJudges').disabled, 'the failing-only choices are unavailable when nothing failed');
}
