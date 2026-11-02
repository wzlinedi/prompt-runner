// User Story 7: "Re-run only the failing judges" sends only the requests that failed, with the corrected judge prompt
// (spec FR-035, scenarios 5a, 7, 7a, SC-019).
const judgeRequest = (content) => content.includes('SCORE: <number>');
const KEY = 'nvapi-FAKE-SECRET-KEY-123';

export const fakeOptions = {
  rules: [
    // The Accuracy judge answers about Hungary without a score line, until its prompt is corrected.
    { match: (body, content) => judgeRequest(content) && content.includes('Hungary') && content.includes('ACCURACY') && !content.includes('FIXED-ACCURACY'),
      respond: { content: 'The output looks fine, but I forgot the score line.' } },
  ],
};

export async function after({ fake, assert }) {
  assert(fake.requests.length === 7, `2 main and 4 judge requests for the run, then exactly 1 for the re-run (${fake.requests.length})`);
  const last = fake.requests.at(-1);
  assert(judgeRequest(last.content) && last.content.includes('Hungary') && last.content.includes('ACCURACY'), 'the re-run sent the Accuracy judge request about Hungary');
  assert(last.content.includes('FIXED-ACCURACY'), 'the re-run request carries the corrected Accuracy prompt');
  assert(fake.requests.filter((r) => judgeRequest(r.content) && r.content.includes('Poland') && r.content.includes('ACCURACY')).length === 1, 'the grade that succeeded (Poland, Accuracy) was not requested again');
  assert(fake.requests.slice(0, 6).every((r) => !r.content.includes('FIXED-ACCURACY')), 'the first run used the original prompt');
  assert(last.authorization === `Bearer ${KEY}`, 'the key was entered again and used');
}

const tick = (id, on) => {
  const box = document.querySelector(`input[data-select="${id}"]`);
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};

export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');
  for (const id of ['CZ', 'SK', 'DE']) tick(id, false);
  t.type('mainKey', KEY);
  t.type('mainEp', t.config.fakeEndpoint);
  t.click('run');
  t.click('confirmYes');
  const { state } = await import('/src/main.mjs');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => t.visible('reportView') && document.querySelectorAll('#report .case').length === 2, 'the report view');
  const metric = (block, name) => block.querySelector(`[data-metric="${name}"]`);
  const [pl, hu] = [...document.querySelectorAll('#report .case')];
  t.assert(metric(hu, 'Accuracy').textContent.includes('unreadable answer'), 'the Accuracy answer for HU was unreadable');
  t.equal(metric(pl, 'Accuracy').querySelector('.ring').textContent.trim(), '87%', 'PL got its Accuracy grade');
  t.assert(!document.querySelector('#report table.meta').textContent.includes('earlier version'), 'no version note before the re-run');

  // The Accuracy prompt is corrected in the form, then only the failed request is repeated.
  t.click('rvBack');
  t.type('accText', `${t.value('accText')}\nFIXED-ACCURACY`);
  t.type('mainKey', KEY);
  t.chooseRerun('failedJudges');
  t.require(t.visible('runConfirm'), 'the confirmation is shown');
  const confirm = t.text('confirmText');
  const lines = confirm.split('\n').filter((l) => l.startsWith('• '));
  t.equal(lines, ['• HU – Hungary (example, rate limit): Accuracy'], 'exactly the failed request is listed, on its own line');
  t.match(confirm, /Only the request that failed will be sent \(1\)/, 'the count is 1');
  t.assert(!/Main prompt:/.test(confirm), 'no main request is announced');
  t.match(confirm, /Judges: up to 1 request /, 'one judge request');
  t.match(confirm, /current judge prompt/, 'the current judge prompts are named');
  t.click('confirmYes');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the re-run to finish');
  await t.waitFor(() => t.visible('reportView'), 'the report view to open by itself');
  await t.sleep(300);

  const [pl2, hu2] = [...document.querySelectorAll('#report .case')];
  t.assert(hu2.querySelector('[data-metric="Accuracy"] .ring'), 'HU now has its Accuracy grade');
  t.equal(pl2.innerHTML, pl.innerHTML, 'PL is unchanged');
  const note = document.querySelector('#report table.meta').textContent;
  t.match(note, /1 grade from an earlier version of the prompt/, 'the report notes the grade from the earlier version of the prompt');
  t.assert(document.querySelector('#report details').textContent.includes('earlier version (1 grade)'), 'the archive keeps the earlier version');
  t.assert(document.querySelector('#report details').textContent.includes('FIXED-ACCURACY'), 'the archive holds the corrected prompt');
  t.assert(t.storageEmpty(), 'nothing is stored in the browser');
}
