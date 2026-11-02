// User Story 6: re-run only the judges (spec US6 scenarios 1-6, SC-008).
const judgeRequest = (content) => content.includes('SCORE: <number>');
const KEY = 'nvapi-FAKE-SECRET-KEY-123';

export const fakeOptions = {
  rules: [
    { match: (body, content) => judgeRequest(content) && content.includes('EDITED-ACCURACY'), respond: { content: 'edited rationale\nSCORE: 55' } },
  ],
};

export async function after({ fake, assert }) {
  assert(fake.requests.length === 25, `15 requests for the run and 10 for the re-run (${fake.requests.length})`);
  const rerun = fake.requests.slice(15);
  assert(rerun.every((r) => judgeRequest(r.content)), 're-run: only judge requests reached the platform');
  assert(rerun.filter((r) => r.content.includes('EDITED-ACCURACY')).length === 5, 're-run: the edited Accuracy prompt was used');
  assert(rerun.every((r) => r.authorization === `Bearer ${KEY}`), 're-run: the key was entered again and used');
}

export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');
  t.type('mainKey', KEY);
  t.type('mainEp', t.config.fakeEndpoint);
  const { state } = await import('/src/main.mjs');
  t.assert(t.rerunButton('judges').disabled, 'Re-run all judges is not available before a run');

  t.click('run');
  t.click('confirmYes');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the first run to finish');
  await t.waitFor(() => t.visible('reportView') && document.querySelectorAll('#report .case').length === 5, 'the report view');
  t.equal(t.value('mainKey'), '', 'the key was cleared after the run');

  const cells = (row) => [...row.querySelectorAll('td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  const metaBefore = [...document.querySelectorAll('#report table.meta tbody tr')].map(cells);
  const field = (block, name) => block.querySelector(`[data-field="${name}"]`);
  const metric = (block, name) => block.querySelector(`[data-metric="${name}"]`);
  const blocksBefore = [...document.querySelectorAll('#report .case')];
  const outputsBefore = blocksBefore.map((b) => field(b, 'actual').textContent);
  const similarityBefore = blocksBefore.map((b) => field(b, 'similarity').textContent);
  t.assert(blocksBefore.every((b) => metric(b, 'Accuracy').querySelector('.ring').textContent.trim() === '87%'), 'every row first got 87% from the judges');

  // The prompt is edited in the form: back to the form first.
  t.click('rvBack');
  t.assert(!t.rerunButton('judges').disabled, 'Re-run all judges is available after a run');

  // 3 actions: edit the prompt, enter the key, trigger (the consent click belongs to the trigger) — spec SC-008.
  let actions = 0;
  const act = (fn) => { actions += 1; return fn(); };
  act(() => t.type('accText', `${t.value('accText')}\nEDITED-ACCURACY`));
  act(() => t.type('mainKey', KEY));
  act(() => t.chooseRerun('judges'));
  t.require(t.visible('runConfirm'), 'the confirmation is shown');
  const confirm = t.text('confirmText');
  t.match(confirm, /Only the judges will run again; the main prompt is not called/, 'the confirmation says only the judges run');
  t.match(confirm, /Judges: 10 requests to http:\/\/127\.0\.0\.1:\d+/, 'the confirmation counts the judge requests');
  t.match(confirm, /Re-run only the failing judges/, 'the confirmation points to the failing-only choices');
  t.match(confirm, /costs/, 'the cost note is shown');
  t.assert(!confirm.includes(KEY), 'the confirmation does not show the key');
  t.click('confirmYes'); // the consent
  t.assert(actions <= 3, `the judge re-run took at most 3 actions after the run (${actions})`);
  t.assert(t.rerunButton('judges').disabled && t.byId('run').disabled, 'no second run can start while the re-run is in progress');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the re-run to finish');
  await t.waitFor(() => t.visible('reportView'), 'the report view to open by itself');
  await t.sleep(300);

  const blocks = [...document.querySelectorAll('#report .case')];
  t.equal(blocks.length, 5, 'still five rows');
  for (const [i, block] of blocks.entries()) {
    const accuracy = metric(block, 'Accuracy');
    t.equal(accuracy.querySelector('.ring').textContent.trim(), '55%', `row ${i}: the new Accuracy grade`);
    t.match(accuracy.textContent, /previously 87%/, `row ${i}: the new Accuracy grade shows the previous one`);
    const completeness = metric(block, 'Completeness');
    t.assert(completeness.querySelector('.ring').textContent.trim() === '87%' && !completeness.textContent.includes('previously'), `row ${i}: the unchanged Completeness grade shows no previous grade`);
    t.equal(field(block, 'actual').textContent, outputsBefore[i], `row ${i}: the output is unchanged`);
    t.equal(field(block, 'similarity').textContent, similarityBefore[i], `row ${i}: the similarity is unchanged`);
    t.match(accuracy.querySelector('.rat').textContent, /^edited rationale/, `row ${i}: the new rationale is shown`);
  }
  const metaAfter = [...document.querySelectorAll('#report table.meta tbody tr')].map(cells);
  t.equal(metaAfter[0][3], metaBefore[0][3], 'the main prompt date is unchanged');
  t.assert(metaAfter[1][3] > metaBefore[1][3], `the judges date moved on (${metaBefore[1][3]} -> ${metaAfter[1][3]})`);
  t.match(metaAfter[1][2], /./, 'the judges parameters are shown');
  t.assert(document.querySelector('#report details').textContent.includes('EDITED-ACCURACY'), 'the archive holds the edited Accuracy prompt');
  t.equal(t.value('mainKey'), '', 'the key was cleared after the re-run');
  t.assert(t.storageEmpty(), 'nothing is stored in the browser');
}
