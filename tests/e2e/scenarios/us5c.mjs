// User Story 5: Stop aborts the request in flight, leaves unfinished rows "not run", and nothing arrives afterwards.
// (The headless browser's virtual clock stands still while a request is pending, so Stop is pressed from the
// moment the fifth request is issued instead of from a timer.)
export async function after({ fake, assert }) {
  assert(fake.requests.length <= 5, `no more than five requests reached the platform (${fake.requests.length})`);
  assert(fake.requests.every((r) => !r.content.includes('SCORE: <number>')), 'no judge request was sent');
}

export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');
  t.type('mainKey', 'nvapi-FAKE-KEY');
  t.type('mainEp', t.config.fakeEndpoint);

  const realFetch = window.fetch.bind(window);
  let issued = 0;
  window.fetch = (...args) => {
    const pending = realFetch(...args);
    if (String(args[0]).includes('/api/chat')) {
      issued += 1;
      if (issued === 5) queueMicrotask(() => t.click('stop'));
    }
    return pending;
  };

  t.click('run');
  t.click('confirmYes');
  const { state } = await import('/src/main.mjs');
  await t.waitFor(() => state.get().run?.status === 'stopped', 'the run to stop');
  window.fetch = realFetch;
  await t.waitFor(() => document.querySelectorAll('#report .case').length === 5, 'the report');

  const run = state.get().run;
  t.equal(run.rows.map((r) => r.main.state), ['ok', 'ok', 'ok', 'ok', 'not-run'], 'finished rows keep their answers, the aborted row is "not run"');
  t.assert(run.rows.slice(0, 4).every((r) => r.accuracy.state === 'not-run' && r.completeness.state === 'not-run'), 'judges that did not start are "not run"');
  t.equal(run.rows[4].accuracy.state, 'nothing-to-judge', 'a row without an answer has nothing to judge');
  t.match(t.text('phase'), /^Stopped\./, 'the status line says Stopped.');
  const summary = [...document.querySelectorAll('#report table.sum tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  t.assert(summary.slice(0, 5).every((r) => r[2] === '–' && r[3] === '–'), 'not-run judges show – in the summary');
  t.assert(document.getElementById('report').textContent.includes('not run'), 'the blocks say "not run"');
  t.equal(t.value('mainKey'), '', 'the key is cleared after Stop');
  t.assert(t.byId('stop').disabled, 'Stop is not available any more');
  t.assert(t.byId('run').disabled, 'Run waits for a key, because the key was cleared');
  t.match(t.text('ready'), /Main prompt: the API key is empty\./, 'the panel names the missing key');
  t.type('mainKey', 'nvapi-FAKE-KEY');
  t.assert(!t.byId('run').disabled, 'Run is available again as soon as a key is entered');

  // Nothing arrives after Stop.
  const count = async () => (await (await fetch(`${t.config.fakeUrl}/__count`)).json()).count;
  const before = await count();
  await t.sleep(5000);
  t.equal(await count(), before, 'no request arrives within 5 s after Stop');
}
