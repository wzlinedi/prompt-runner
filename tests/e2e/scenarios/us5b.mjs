// User Story 5: the judge endpoint rejects the key — every row shows a readable judge error, the main outputs are kept.
const judgeRequest = (content) => content.includes('SCORE: <number>');

export const fakeOptions = {
  rules: [
    { match: (body, content) => judgeRequest(content),
      respond: { status: 401, body: { status: 401, title: 'Unauthorized', detail: 'Authorization failed: Invalid JWT serialization: Missing dot delimiter(s)' } } },
  ],
};

export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');
  t.type('mainKey', 'nvapi-FAKE-KEY');
  t.type('mainEp', t.config.fakeEndpoint);
  t.click('run');
  t.click('confirmYes');
  const { state } = await import('/src/main.mjs');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => document.querySelectorAll('#report .case').length === 5, 'the report');

  const blocks = [...document.querySelectorAll('#report .case')];
  for (const [i, block] of blocks.entries()) {
    const text = block.textContent;
    t.assert(text.includes('Summary: Summarize below data'), `the main output of row ${i} is kept`);
    t.assert((text.match(/The platform did not recognise the key\. A key from the NVIDIA platform starts with "nvapi-"\./g) ?? []).length === 2,
      `row ${i} shows a readable error for both judges`);
    t.assert(block.querySelectorAll('.metric .pill.err').length === 2, `row ${i} marks the judge errors`);
  }
  const summary = [...document.querySelectorAll('#report table.sum tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  t.assert(summary.slice(0, 5).every((r) => r[2] === 'error' && r[3] === 'error'), 'the summary shows error for both judges on every row');
  t.equal(summary[5].slice(2), ['–', '–'], 'no judge average');
  t.equal(t.value('mainKey'), '', 'the key is cleared after the run');
  t.assert(!document.getElementById('report').textContent.includes('nvapi-FAKE-KEY'), 'the report does not contain the key');
}
