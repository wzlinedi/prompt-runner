// User Story 12: one re-run control with four choices, in the run panel and in the report, and one New Session button
// that is also there in the report (spec FR-075 – FR-077, SC-042 – SC-044).
const judgeRequest = (content) => content.includes('SCORE: <number>');
const KEY = 'nvapi-FAKE-SECRET-KEY-123';

export const fakeOptions = {
  // One judge request fails once: the Completeness judge of the row about Hungary.
  rules: [{ match: (body, content) => judgeRequest(content) && content.includes('Hungary') && content.includes('COMPLETENESS'), times: 1, respond: { status: 404, body: { status: 404, title: 'Not Found' } } }],
};

export async function after({ fake, assert }) {
  assert(fake.requests.length === 16, `15 requests for the run and exactly 1 for the re-run (${fake.requests.length})`);
  const last = fake.requests.at(-1);
  assert(judgeRequest(last.content) && last.content.includes('Hungary') && last.content.includes('COMPLETENESS'), 'the re-run sent the failed Completeness request about Hungary');
  assert(last.authorization === `Bearer ${KEY}`, 'the key was entered again and used');
}

export default async function run(t) {
  const { state } = await import('/src/main.mjs');
  const CHOICES = ['all', 'failedMain', 'judges', 'failedJudges'];
  const note = (id, inReport = false) => t.rerunButton(id, inReport).closest('li').querySelector('.why').textContent;

  t.click('newSession');
  t.click('dsSample');
  t.type('mainKey', KEY);
  t.type('mainEp', t.config.fakeEndpoint);

  // Before a run: the control is there and every choice says why it cannot be used.
  t.assert(CHOICES.every((id) => t.rerunButton(id).disabled && /No run yet/.test(note(id))), 'before a run every choice is unavailable with "No run yet"');
  t.assert(t.visible('newSession2') && !t.visible('startScreen'), 'the one New Session button is in the header band');

  t.click('run');
  t.click('confirmYes');
  t.assert(CHOICES.every((id) => t.rerunButton(id).disabled && /A run is in progress/.test(note(id))), 'during the run every choice is unavailable with "A run is in progress"');
  t.assert(t.visible('newSession2'), 'New Session is visible during a run');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => t.visible('reportView') && document.querySelectorAll('#report .case').length === 5, 'the report view');

  // In the report: the same control, the badge, the counts; New Session stays in view (the band is compact).
  t.assert(t.visible('newSession2') && document.body.classList.contains('reporting'), 'New Session is visible in the report');
  t.assert([...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'New Session' && !b.closest('[hidden]')).length === 1, 'exactly one New Session button is visible');
  const badge = document.querySelector('#rvRerunBox .badge');
  t.equal(badge?.textContent, '1 failed row', 'the control shows how many rows failed');
  t.assert(!t.rerunButton('failedJudges', true).disabled && /^1 request$/.test(note('failedJudges', true)), 'Re-run only the failing judges offers exactly 1 request');
  t.assert(t.rerunButton('failedMain', true).disabled && /0 requests · Nothing failed/.test(note('failedMain', true)), 'no main request failed');
  t.assert(!t.rerunButton('judges', true).disabled && /10 requests/.test(note('judges', true)), 'Re-run all judges would send 10 requests');
  t.assert(!t.rerunButton('all', true).disabled && /15 requests/.test(note('all', true)), 'Re-run all would send 15 requests');
  t.equal(document.querySelector('#rerunBox .badge')?.textContent, '1 failed row', 'the panel shows the same badge');

  const before = [...document.querySelectorAll('#report .case')].map((b) => b.innerHTML);

  // A choice made in the report leads to the form and asks for the key there.
  t.chooseRerun('failedJudges', true);
  t.assert(t.visible('formView') && !t.visible('reportView'), 'the choice led back to the form');
  t.match(t.text('resMsg'), /Re-run blocked: .*API key is empty/, 'the key is asked for');
  t.equal(document.activeElement?.id, 'mainKey', 'the key field has the focus');
  t.assert(!t.visible('runConfirm'), 'nothing is offered for sending without a key');

  // At most 4 actions from the report: open the control, choose, enter the key, confirm (spec SC-042); the opening is the first click here.
  t.type('mainKey', KEY);
  t.chooseRerun('failedJudges');
  t.require(t.visible('runConfirm'), 'the confirmation is shown');
  const confirm = t.text('confirmText');
  t.equal(confirm.split('\n').filter((l) => l.startsWith('• ')), ['• HU – Hungary (example, rate limit): Completeness'], 'exactly the failed request is listed');
  t.match(confirm, /Only the request that failed will be sent \(1\)/, 'the count is 1');
  t.assert(!/Main prompt:/.test(confirm), 'no main request is announced');
  t.click('confirmYes');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the re-run to finish');
  await t.waitFor(() => t.visible('reportView'), 'the report to open by itself');
  await t.sleep(300);
  const after = [...document.querySelectorAll('#report .case')].map((b) => b.innerHTML);
  t.equal(after.filter((html, i) => html === before[i]).length, 4, 'four of the five cases are unchanged');
  t.equal(document.querySelector('#rvRerunBox .badge'), null, 'nothing failed any more: no badge');
  t.assert(t.rerunButton('failedJudges', true).disabled && /Nothing failed/.test(note('failedJudges', true)), 'the failing-only choices say "Nothing failed"');

  // New Session in the report: Cancel changes nothing and returns the focus; Confirm removes the report and the session.
  t.click('newSession2');
  t.assert(t.visible('resetConfirm'), 'the confirmation is shown in the report');
  t.click('resetNo');
  t.assert(t.visible('reportView') && !t.visible('resetConfirm'), 'Cancel leaves the report as it was');
  t.equal(document.activeElement?.id, 'newSession2', 'the focus returns to New Session');
  t.click('newSession2');
  t.click('resetYes');
  t.assert(!t.visible('reportView') && t.visible('formView') && !document.body.classList.contains('reporting'), 'the report is closed');
  t.equal(document.getElementById('report').innerHTML, '', 'the report is emptied');
  t.equal(state.get().run, null, 'the run is gone');
  t.assert(state.get().dataset === null && t.byId('expHtml').disabled && t.byId('expCsv').disabled, 'the dataset and the exports are gone');
  t.assert(CHOICES.every((id) => t.rerunButton(id).disabled && /No run yet/.test(note(id))), 'the empty session offers no re-run');
  t.assert(t.storageEmpty(), 'nothing is stored in the browser');
}
