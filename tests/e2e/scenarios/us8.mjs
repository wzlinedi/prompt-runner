// User Story 8: faithful and safe behavior (corrections after the code review): the form is locked while a
// confirmation is open (scenario 1), a started run keeps what it was confirmed with (2), Stop stays reachable when a
// dataset fails to load during a run (10), and a run abandoned by New Session leaves the new session alone (12).
const judgeRequest = (content) => content.includes('SCORE: <number>');
const FIRST_KEY = 'nvapi-FAKE-FIRST-KEY';
const NEW_KEY = 'nvapi-FAKE-NEW-SESSION-KEY';

export async function after({ fake, assert }) {
  const judges = fake.requests.filter((r) => judgeRequest(r.content));
  assert(judges.length >= 2, `judge requests were sent (${judges.length})`);
  assert(judges.every((r) => !r.content.includes('EDITED WHILE RUNNING')), 'an edit made during the run did not reach any judge request');
  assert(fake.requests.every((r) => !r.content.includes('EDITED BEHIND THE LOCK')), 'an edit made behind the lock was not sent without a new confirmation');
}

const tick = (id, on) => {
  const box = document.querySelector(`input[data-select="${id}"]`);
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};
const oneRowOnly = (t, keep = 'PL') => {
  t.click('selNone');
  tick(keep, true);
};
const count = (t) => fetch(`${t.config.fakeUrl}/__count`).then((r) => r.json()).then((j) => j.count);
const newSession = (t) => { t.click('newSession2'); t.click('resetYes'); };

/** Calls `onFirst` right when the first chat request is issued, then lets the request go on. */
function onFirstRequest(onFirst) {
  const realFetch = window.fetch.bind(window);
  let issued = 0;
  window.fetch = (...args) => {
    const pending = realFetch(...args);
    if (String(args[0]).includes('/api/chat') && ++issued === 1) queueMicrotask(onFirst);
    return pending;
  };
  return () => { window.fetch = realFetch; };
}

export default async function run(t) {
  const { state } = await import('/src/main.mjs');

  // ---- Scenario 1: the form is locked while the confirmation is open ----
  t.click('newSession');
  t.click('dsSample');
  oneRowOnly(t);
  t.type('mainKey', FIRST_KEY);
  t.type('mainEp', t.config.fakeEndpoint);
  t.click('run');
  t.require(t.visible('runConfirm'), 'the confirmation is shown (in step 5)');
  t.assert(state.get().confirming, 'the session knows that a confirmation is open');
  for (const id of ['mainEp', 'mainKey', 'main_json', 'mainText', 'accText', 'compText', 'dsText', 'dsLoad', 'sameModel']) {
    t.assert(Boolean(t.byId(id).closest('[inert]')), `${id} cannot be used while the confirmation is open`);
  }
  t.assert(Boolean(document.querySelector('input[data-select="PL"]').closest('[inert]')), 'the row selection is locked too');
  t.assert(t.byId('run').disabled, 'Run is disabled while a confirmation is open');
  t.assert(['all', 'failedMain', 'judges', 'failedJudges'].every((id) => t.rerunButton(id).disabled), 'the re-run choices are disabled as well');
  t.assert(!t.byId('confirmYes').closest('[inert]') && !t.byId('confirmNo').closest('[inert]'), 'Confirm and Cancel act');

  // Something that changes the form behind the lock (a script, a late file read): nothing is sent, the text is shown again.
  t.type('mainText', 'EDITED BEHIND THE LOCK {prompt_input}');
  t.click('confirmYes');
  t.require(t.visible('runConfirm'), 'the confirmation stays open after a change behind the lock');
  t.match(t.text('confirmText'), /^The form changed while this confirmation was open, so nothing was sent\./, 'the user is told that nothing was sent');
  t.equal(await count(t), 0, 'nothing reached the platform');

  t.click('confirmNo');
  t.assert(!t.visible('runConfirm'), 'Cancel closes the confirmation');
  t.assert(!state.get().confirming, 'the lock is lifted');
  for (const id of ['mainEp', 'mainKey', 'main_json', 'mainText', 'accText', 'dsText']) t.assert(!t.byId(id).closest('[inert]'), `${id} is editable again after Cancel`);
  t.assert(!t.byId('run').disabled, 'Run is available again');
  t.equal(await count(t), 0, 'Cancel sent nothing');
  t.type('mainText', 'Summarize below data.\n\n{prompt_input}');

  // ---- Scenario 2: edits during the run do not reach it ----
  t.click('run');
  t.click('confirmYes');
  const restore = onFirstRequest(() => {
    t.type('accText', 'EDITED WHILE RUNNING {prompt_input} {output}');
    t.type('compText', 'EDITED WHILE RUNNING {prompt_input} {output}');
  });
  await t.waitFor(() => state.get().run?.status === 'finished', 'the first run to finish');
  restore();
  const first = state.get().run;
  t.assert(!first.snapshot.prompts.accuracy.includes('EDITED'), 'the archive shows the Accuracy prompt the run used');
  t.assert(t.value('accText').includes('EDITED WHILE RUNNING'), 'the edit stays in the form for the next run');
  t.equal(t.value('mainKey'), '', 'the key is cleared after the run');
  t.equal(state.get().config.main.apiKey, '', 'the key is cleared in the session');
  t.equal(state.get().config.judge.apiKey, '', 'and so is the judge key');
  t.assert(!JSON.stringify(state.get()).includes(FIRST_KEY), 'the key text is nowhere in the session or its run');
  await t.waitFor(() => t.visible('reportView'), 'the report to open');
  t.click('rvHtml');
  t.click('rvCsv');
  t.equal(t.downloads.length, 2, 'both exports are produced under the content-security policy');
  t.click('rvBack');

  // ---- Scenario 10: Stop stays reachable when a dataset fails to load during a run ----
  newSession(t);
  t.click('dsSample');
  oneRowOnly(t);
  t.type('mainKey', FIRST_KEY);
  t.type('mainEp', t.config.fakeEndpoint);
  t.click('run');
  const restore2 = onFirstRequest(() => {
    t.type('dsText', 'this is not a dataset');
    t.click('dsLoad');
  });
  t.click('confirmYes');
  await t.waitFor(() => state.get().dataset === null, 'the broken dataset to replace the loaded one');
  t.assert(t.visible('stop') && !t.byId('stop').disabled, 'Stop is on the screen and available');
  t.assert(t.visible('secRes') && t.visible('secCfg'), 'steps 4 and 5 are still shown');
  t.assert(t.visible('phase'), 'the progress is shown');
  t.click('stop');
  await t.waitFor(() => state.get().run?.status === 'stopped' || state.get().run?.status === 'finished', 'the run to end');
  restore2();
  await t.waitFor(() => t.visible('reportView'), 'the report to open by itself');
  t.click('rvBack');
  t.assert(t.visible('openReport') && !t.byId('openReport').disabled, 'the result stays reachable from step 5');

  // ---- Scenario 12: a run abandoned by New Session leaves the new session alone ----
  newSession(t);
  t.click('dsSample');
  oneRowOnly(t);
  t.type('mainKey', FIRST_KEY);
  t.type('mainEp', t.config.fakeEndpoint);
  t.click('run');
  let abandoned = null;
  const restore3 = onFirstRequest(() => {
    abandoned = state.get().run;
    newSession(t);
    t.type('mainKey', NEW_KEY);                       // typed in the new session while the old run is still being stopped
  });
  t.click('confirmYes');
  await t.waitFor(() => abandoned !== null, 'New Session to be pressed during the run');
  await t.waitFor(() => abandoned.status === 'stopped' || abandoned.status === 'finished', 'the abandoned run to end');
  restore3();
  await t.sleep(300);
  t.equal(t.value('mainKey'), NEW_KEY, 'the key typed in the new session survives the end of the old run');
  t.equal(state.get().config.main.apiKey, NEW_KEY, 'and so does the key in the session');
  t.equal(t.text('phase'), '', 'the old run does not write its progress into the new session');
  t.assert(state.get().run === null, 'the new session has no run');
  t.assert(t.storageEmpty(), 'nothing is stored in the browser');
}
