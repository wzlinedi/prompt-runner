// The checks of the whole flow without a real key (quickstart section 3), with real clicks and key presses
// (spec FR-059, FR-060). One or two rows per run: the page paces its requests, and the walk-through has a time budget.
import { FAIL } from '../../fixtures/fake-upstream.mjs';
import { MEASURE } from '../contrast.mjs';
import { startSession, selectOnly, runAndWait, ensureReport, waitForReport, text, value, visible, disabled, count, chooseRerun, rerunChoice, SAMPLE_IDS } from './helpers.mjs';

const isJudge = (content) => content.includes('SCORE: <number>');
const confirmation = (d) => text(d, '#confirmText');
const chipsOf = (d) => d.evaluate(() => [...document.querySelectorAll('#facts span')].map((s) => s.textContent));
const stepsOf = (d) => d.evaluate(() => [...document.querySelectorAll('#stepList li')].map((li) => ({ cls: li.className, fact: li.querySelector('small').textContent, current: li.querySelector('a').getAttribute('aria-current') === 'step' })));

/** A fake platform that gives a re-judged Accuracy answer a different grade (for the judge re-run). */
const REPORT_OPTIONS = { fakeOptions: { rules: [{ match: (body, content) => content.includes('Be strict.'), respond: { content: 'Looked at it again.\nSCORE: 40' } }] } };

export const flowChecks = [
  {
    id: 'flow.start', group: 'flow', row: 'Start screen offers only New Session', title: 'The start screen offers one action, New Session',
    async run(t, { d, appUrl }) {
      await d.open(appUrl);
      t.expect(await count(d, '#startScreen button') === 1, 'the start screen does not have exactly one button');
      t.expect(await text(d, '#newSession') === 'New Session', 'the button does not read "New Session"');
      t.expect(/memory only/.test(await text(d, '#startScreen')), 'the start screen does not say that a session lives in memory only');
      t.expect(!await visible(d, '#app'), 'the application is shown before New Session');
      await d.click('#newSession');
      t.expect(await visible(d, '#app') && !await visible(d, '#startScreen'), 'New Session does not reveal the application');
    },
  },
  {
    id: 'flow.dataset-errors', group: 'flow', row: 'Wrong dataset gives a specific message', title: 'A dataset without a required column names it, and nothing runs',
    async run(t, ctx) {
      const { d } = ctx;
      await startSession(ctx, { sample: false, key: false, endpoint: false });
      await d.fill('#dsText', 'id,name\n1,a', { paste: true });
      await d.click('#dsLoad');
      t.expect(/missing: prompt_input, expected_result/.test(await text(d, '#dsMsg')), `the message does not name the missing columns: "${await text(d, '#dsMsg')}"`);
      t.expect(!await visible(d, '#secMain'), 'the next steps are shown after a wrong dataset');
      t.expect(await disabled(d, '#run'), 'Run is available after a wrong dataset');
    },
  },
  {
    id: 'flow.placeholder', group: 'flow', row: 'Placeholder check', title: 'A main prompt without {prompt_input} blocks the run, naming the problem',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx);
      await d.fill('#mainText', 'Summarize the data.', { paste: true });
      t.expect(/Run blocked: .*\{prompt_input\} is missing/.test(await text(d, '#mainMsg')), `the message at the editor is "${await text(d, '#mainMsg')}"`);
      t.expect(/\{prompt_input\} is missing/.test(await text(d, '#ready')), 'the readiness list does not name the problem');
      t.expect(await disabled(d, '#run'), 'Run is available without the place');
    },
  },
  {
    id: 'flow.judges-share-model', group: 'flow', row: 'Judges share the model by default', title: 'The judges share the main model: no judge fields, one model in the confirmation',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      t.expect(await d.evaluate(() => document.getElementById('judgeFields').offsetParent === null), 'the judge fields are shown by default');
      await d.click('#run');
      const models = [...(await confirmation(d)).matchAll(/\(model ([^)]+)\)/g)].map((m) => m[1]);
      t.expect(models.length === 2 && models[0] === models[1], `the confirmation does not name one model for both parts: ${JSON.stringify(models)}`);
      await d.click('#confirmNo');
    },
  },
  {
    id: 'flow.confirmation', group: 'flow', row: 'Confirmation before sending', title: 'Counts and models are shown, and nothing is sent until the user confirms',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake();
      await startSession(ctx, { rows: ['PL', 'CZ'] });
      await d.click('#run');
      const c = await confirmation(d);
      t.expect(/Main prompt: 2 requests to http:\/\/127\.0\.0\.1:\d+/.test(c), 'the confirmation does not give the main requests and the endpoint');
      t.expect(/Judges: up to 4 requests/.test(c), 'the confirmation does not give the judge requests');
      t.expect(/expected result is never sent/.test(c), 'the confirmation does not say that the expected result is not sent');
      t.expect(!c.includes(ctx.key), 'the confirmation shows the key');
      t.expect(fake.requests.length === 0, `${fake.requests.length} requests reached the platform before the confirmation`);
      await d.click('#confirmNo');
      await d.sleep(300);
      t.expect(fake.requests.length === 0, 'Cancel sent something');
      t.expect(!await disabled(d, '#run'), 'Run is not available again after Cancel');
    },
  },
  {
    id: 'flow.locked-form', group: 'flow', row: 'Locked form while confirming', title: 'While the confirmation is open the form cannot be changed',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      const before = { ep: await value(d, '#mainEp'), prompt: await value(d, '#mainText'), box: await d.evaluate(() => document.querySelector('input[data-select="PL"]').checked) };
      await d.click('#run');
      t.expect(await visible(d, '#lockNote'), 'the lock is not explained');
      await d.click('#mainEp', { force: true }); await d.type('XYZ');
      await d.click('#mainText', { force: true }); await d.type('QQQ');
      await d.click('input[data-select="PL"]', { force: true });
      t.expect(await value(d, '#mainEp') === before.ep, 'the endpoint changed while locked');
      t.expect(await value(d, '#mainText') === before.prompt, 'the prompt changed while locked');
      t.expect(await d.evaluate(() => document.querySelector('input[data-select="PL"]').checked) === before.box, 'the row selection changed while locked');
      await d.click('#confirmNo');
      await d.click('#mainEp'); await d.type('Z');
      t.expect(await value(d, '#mainEp') !== before.ep, 'the endpoint cannot be edited again after Cancel');
    },
  },
  {
    id: 'flow.unclosed-quote', group: 'flow', row: 'Unclosed quote', title: 'An unclosed quote is reported with its record and nothing is loaded',
    async run(t, ctx) {
      const { d } = ctx;
      await startSession(ctx, { sample: false, key: false, endpoint: false });
      await d.fill('#dsText', 'id,name,prompt_input,expected_result\n1,a,b,"oops\n2,c,d,e', { paste: true });
      await d.click('#dsLoad');
      t.expect(/Record 1 starts a value in double quotes that is never closed/.test(await text(d, '#dsMsg')), `the message is "${await text(d, '#dsMsg')}"`);
      t.expect(await count(d, '#dsPrev tr[data-row]') === 0, 'rows were loaded');
    },
  },
  {
    id: 'flow.http-warning', group: 'flow', row: 'Plain `http` warning', title: 'The confirmation warns about unencrypted http outside this computer, and only then',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      await d.fill('#mainEp', 'http://example.com/v1/chat/completions');
      await d.click('#run');
      t.expect(/Warning: http:\/\/example\.com\/v1\/chat\/completions uses unencrypted http/.test(await confirmation(d)), 'no warning for a remote http address');
      await d.click('#confirmNo');
      await d.fill('#mainEp', fake.endpoint);
      await d.click('#run');
      t.expect(!/unencrypted/.test(await confirmation(d)), 'a warning for the address on this computer');
      await d.click('#confirmNo');
      t.expect(fake.requests.length === 0, 'something was sent');
    },
  },
  {
    id: 'flow.chips-steps', group: 'flow', row: 'Step indicator and chips', title: 'The chips and the step states follow the dataset, the selection, and the key',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL', 'CZ', 'SK'], key: false });
      const chips = await chipsOf(d);
      t.expect(chips.includes('5 rows loaded') && chips.includes('3 of 20 selected'), `the chips are ${JSON.stringify(chips)}`);
      t.expect(chips.some((c) => /^Model nvidia\//.test(c)) && chips.includes('Judges: same model'), 'the model chips are missing');
      t.expect(chips.every((c) => !/nvapi|http/.test(c)), 'a key or an address is in a chip');
      let steps = await stepsOf(d);
      t.expect(steps.slice(0, 3).every((s) => s.cls.includes('done')) && steps[3].cls.includes('attn'), `the steps without a key are ${JSON.stringify(steps.map((s) => s.cls))}`);
      t.expect(steps[0].fact === '5 rows, 3 selected' && steps[3].current, `the first step: "${steps[0].fact}", the current one is step 4: ${steps[3].current}`);
      await d.fill('#mainKey', ctx.key);
      steps = await stepsOf(d);
      t.expect(steps.slice(0, 4).every((s) => s.cls.includes('done')) && steps[4].fact === 'ready to run', `with a key the steps are ${JSON.stringify(steps.map((s) => [s.cls, s.fact]))}`);
    },
  },
  {
    id: 'flow.readiness', group: 'flow', row: 'Live readiness list', title: 'The list names what is missing, follows the user, and an item moves the focus',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx, { sample: false, key: false, endpoint: false });
      const first = await text(d, '#ready');
      t.expect(/Dataset: load a dataset first\./.test(first) && /4 · Configuration – available after step 3/.test(first) && /API key is empty/.test(first), `the list at the start is "${first.slice(0, 160)}"`);
      t.expect(await count(d, '#ready li.dim') === 1 && await count(d, '#ready li.dim a') === 0, 'the group of a locked step is not dimmed without links');
      t.expect(await disabled(d, '#run'), 'Run is available at the start');
      await d.click('#dsSample');
      t.expect(await count(d, '#ready li.dim') === 0, 'the group is still dimmed after the dataset is loaded');
      await d.click('#ready a[data-field="mainKey"]');
      t.expect((await d.focused()).id === 'mainKey', `an item did not move the focus to its field (focus: ${(await d.focused()).id})`);
      await d.type(ctx.key);
      await d.fill('#mainEp', ctx.fake.endpoint);
      t.expect(/Ready to run\./.test(await text(d, '#ready')) && !await disabled(d, '#run'), 'the list does not say Ready after the key and the endpoint');
      await d.click('#selNone');
      t.expect(/Select between 1 and 20 rows; 0 are selected now\./.test(await text(d, '#ready')) && await disabled(d, '#run'), 'an empty selection is not listed');
      await d.click('#selAll');
      t.expect(!await disabled(d, '#run'), 'Run waits after the selection is restored');
    },
  },
  {
    id: 'flow.json-badge', group: 'flow', row: 'JSON badge', title: 'The badge says whether the parameters are valid and which model they name',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      t.expect(/^valid · nvidia\//.test(await text(d, '#mainJsonBadge')), `the badge says "${await text(d, '#mainJsonBadge')}"`);
      await d.fill('#main_json', '{"model": ');
      t.expect(/not valid JSON/.test(await text(d, '#mainJsonBadge')) && await disabled(d, '#run'), `a broken JSON: "${await text(d, '#mainJsonBadge')}"`);
      await d.fill('#main_json', '{"model":"nvidia/other-model","temperature":0.5}');
      t.expect(await text(d, '#mainJsonBadge') === 'valid · nvidia/other-model', `a repaired JSON: "${await text(d, '#mainJsonBadge')}"`);
      t.expect((await chipsOf(d)).includes('Model nvidia/other-model'), 'the chip does not follow the model');
    },
  },
  {
    id: 'flow.row-selection', group: 'flow', row: 'Row selection', title: 'The run covers the selected rows; more than 20 is refused with the count',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake();
      await startSession(ctx, { sample: false, key: false, endpoint: false });
      const rows = Array.from({ length: 21 }, (_, i) => `R${i + 1},Row ${i + 1},input ${i + 1},expected ${i + 1}`).join('\n');
      await d.fill('#dsText', `id,name,prompt_input,expected_result\n${rows}`, { paste: true });
      await d.click('#dsLoad');
      t.expect(await text(d, '#selCount') === '20 of 21 rows selected (at most 20 per run).', `the count is "${await text(d, '#selCount')}"`);
      await d.click('#selAll');
      t.expect(/Select between 1 and 20 rows; 21 are selected now\./.test(await text(d, '#selCount')), 'more than 20 selected is not refused with the count');
      await d.click('#selNone');
      t.expect(/0 are selected now/.test(await text(d, '#selCount')), 'no row selected is not refused with the count');
      await d.click('#dsSample');
      await d.click('input[data-select="CZ"]');
      await d.click('input[data-select="SK"]');
      t.expect(/^3 of 5 rows selected/.test(await text(d, '#selCount')), `after two clicks the count is "${await text(d, '#selCount')}"`);
      await d.fill('#mainEp', fake.endpoint);
      await d.fill('#mainKey', ctx.key);
      await d.click('#run');
      t.expect(/3 of 5 rows in the dataset are selected and will run\./.test(await confirmation(d)), 'the confirmation does not name the selection');
      await d.click('#confirmNo');
      t.expect(fake.requests.length === 0, 'something was sent');
    },
  },
  {
    id: 'flow.report-view', group: 'flow', share: 'report', timeoutMs: 120_000, row: 'Report view', title: 'After the run the page shows the full-width report by itself',
    async run(t, ctx) {
      const { d } = ctx;
      await ensureReport(ctx, REPORT_OPTIONS);
      t.expect(await visible(d, '#reportView') && !await visible(d, '#formView'), 'the report does not replace the form');
      t.expect(await count(d, '#report .hero') === 1 && await count(d, '#report .kpi') === 4, 'the header band or the average cards are missing');
      t.expect(await count(d, '#report table.sum') === 1, 'the summary table is missing');
      // The heading of every column of the prompts table sits over its values.
      const columns = await d.evaluate(() => {
        const table = document.querySelector('#report table.meta');
        if (!table) return null;
        const heads = [...table.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().left));
        const cells = [...table.querySelector('tbody tr').querySelectorAll('td')].map((td) => Math.round(td.getBoundingClientRect().left));
        return { heads, cells, rows: table.querySelectorAll('tbody tr').length };
      });
      t.expect(Boolean(columns) && columns.rows === 3, 'the table of prompts and models is missing or does not have three lines');
      t.expect(Boolean(columns) && columns.heads.length === columns.cells.length && columns.heads.every((x, i) => Math.abs(x - columns.cells[i]) <= 2), `the column headings are not over their values: ${JSON.stringify(columns)}`);
      t.expect(await d.evaluate(() => { const det = [...document.querySelectorAll('#report details')].find((x) => /Prompts used/.test(x.textContent)); return Boolean(det) && !det.open; }), 'the archive is not collapsed');
      t.expect(await count(d, '#report .case') === 1, 'the report does not hold one card for the one row');
      const width = await d.evaluate(() => ({ report: document.getElementById('report').getBoundingClientRect().width, window: window.innerWidth }));
      t.expect(width.report >= width.window - 40, `the report is ${width.report} px wide in a window of ${width.window}`);
      t.evidence(await ctx.shot('report', { full: true }));
    },
  },
  {
    id: 'flow.case-card', group: 'flow', share: 'report', timeoutMs: 120_000, row: 'Test case card', title: 'A test case card has its heading, five fields side by side, and the judges below; the fields stack when narrow',
    async run(t, ctx) {
      const { d } = ctx;
      await ensureReport(ctx, REPORT_OPTIONS);
      const card = await d.evaluate(() => {
        const c = document.querySelector('#report .case');
        const tops = [...c.querySelectorAll('[data-field]')].map((f) => Math.round(f.getBoundingClientRect().top));
        return { heading: Boolean(c.querySelector('header .chip') && c.querySelector('header h3')), fields: [...c.querySelectorAll('[data-field]')].map((f) => f.dataset.field), tops, metrics: [...c.querySelectorAll('.metric')].map((m) => m.dataset.metric) };
      });
      t.expect(card.heading, 'the heading with the id and the name is missing');
      t.expect(JSON.stringify(card.fields) === JSON.stringify(['prompt-input', 'expected', 'actual', 'similarity', 'differences']), `the fields are ${JSON.stringify(card.fields)}`);
      t.expect(Math.max(...card.tops) - Math.min(...card.tops) <= 2, `the fields are not side by side (tops ${card.tops})`);
      t.expect(JSON.stringify(card.metrics) === JSON.stringify(['Accuracy', 'Completeness']), `the metrics are ${JSON.stringify(card.metrics)}`);
      await d.viewport(500, 900);
      const stacked = await d.evaluate(() => [...document.querySelectorAll('#report .case [data-field]')].map((f) => Math.round(f.getBoundingClientRect().top)));
      t.expect(stacked.every((top, i) => i === 0 || top > stacked[i - 1]), `below 900 px the fields do not stack (tops ${stacked})`);
      await d.viewport(1280, 900);
    },
  },
  {
    id: 'flow.differences', group: 'flow', share: 'report', timeoutMs: 120_000, row: 'Differences', title: 'Struck words exist only in the expected result, underlined words only in the actual output',
    async run(t, ctx) {
      const { d } = ctx;
      await ensureReport(ctx, REPORT_OPTIONS);
      const seen = await d.evaluate(() => {
        const c = document.querySelector('#report .case');
        const expected = c.querySelector('[data-field="expected"]').textContent;
        const actual = c.querySelector('[data-field="actual"]').textContent;
        const dels = [...c.querySelectorAll('[data-field="differences"] del')];
        const inss = [...c.querySelectorAll('[data-field="differences"] ins')];
        return {
          dels: dels.length, inss: inss.length,
          delsInExpected: dels.every((e) => expected.includes(e.textContent.trim())), inssInActual: inss.every((e) => actual.includes(e.textContent.trim())),
          delLine: dels[0] ? getComputedStyle(dels[0]).textDecorationLine : '', insLine: inss[0] ? getComputedStyle(inss[0]).textDecorationLine : '',
        };
      });
      t.expect(seen.dels > 0 && seen.inss > 0, `differences were expected (struck ${seen.dels}, added ${seen.inss})`);
      t.expect(seen.delsInExpected && seen.inssInActual, 'a struck word is not in the expected result, or an added word is not in the actual output');
      t.expect(/line-through/.test(seen.delLine) && /underline/.test(seen.insLine), `the marks differ by more than colour: ${seen.delLine} / ${seen.insLine}`);
    },
  },
  {
    id: 'flow.back-to-form', group: 'flow', share: 'report', timeoutMs: 120_000, row: 'Back to the form', title: 'Back to the form leaves the steps as they were and offers the result actions',
    async run(t, ctx) {
      const { d } = ctx;
      await ensureReport(ctx, REPORT_OPTIONS);
      const mainEp = ctx.fake.endpoint;
      await d.click('#rvBack');
      t.expect(await visible(d, '#formView') && !await visible(d, '#reportView'), 'the form is not shown');
      t.expect(await value(d, '#mainEp') === mainEp, 'the endpoint is not as it was left');
      t.expect(/Summarize below data/.test(await value(d, '#mainText')), 'the main prompt is not as it was left');
      t.expect(await count(d, 'input[data-select]:checked') === 1, 'the selection is not as it was left');
      for (const id of ['#openReport', '#expHtml', '#expCsv']) t.expect(!await disabled(d, id), `${id} is not available`);
      t.expect(await visible(d, '#rerunBox summary'), 'the re-run control is not offered in step 5');
    },
  },
  {
    id: 'flow.judge-rerun', group: 'flow', share: 'report', timeoutMs: 120_000, row: 'Judge re-run', title: 'Re-running the judges sends only judge requests and shows the previous grade',
    async run(t, ctx) {
      const { d } = ctx;
      await ensureReport(ctx, REPORT_OPTIONS);
      if (await visible(d, '#reportView')) await d.click('#rvBack');
      const before = ctx.fake.requests.length;
      await d.fill('#accText', `${await value(d, '#accText')} Be strict.`, { paste: true });
      await d.fill('#mainKey', ctx.key);
      await chooseRerun(d, 'judges');
      t.expect(await visible(d, '#runConfirm'), 'the confirmation of the re-run is not shown');
      await d.click('#confirmYes');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 60_000, what: 'the report after the re-run' });
      await d.sleep(300);
      const sent = ctx.fake.requests.slice(before);
      t.expect(sent.length === 2 && sent.every((r) => isJudge(r.content)), `the re-run sent ${sent.length} requests, ${sent.filter((r) => !isJudge(r.content)).length} of them to the main prompt`);
      t.expect(/previously 87%/.test(await text(d, '#report')), 'the previous grade is not shown next to the changed one');
    },
  },
  {
    id: 'flow.failed-rerun', group: 'flow', timeoutMs: 120_000, row: 'Failed row and re-run', title: 'Only the requests of the failed row are sent again',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake({ rules: [{ match: (b, c) => !isJudge(c) && c.includes('Hungary'), times: 1, respond: FAIL.rateLimit }] });
      await startSession(ctx, { rows: ['PL', 'HU'] });
      await runAndWait(d);
      const first = fake.requests.length;
      await d.click('#rvBack');
      const offered = await rerunChoice(d, 'failedMain');
      t.expect(offered.exists && !offered.disabled && /^3 requests/.test(offered.note), `Re-run failing main prompts and all related judges is not offered with 3 requests (${JSON.stringify(offered)})`);
      await chooseRerun(d, 'failedMain');
      t.expect(/API key is empty/.test(await text(d, '#resMsg')), 'the key is not asked for again');
      await d.fill('#mainKey', ctx.key);
      await chooseRerun(d, 'failedMain');
      const lines = (await confirmation(d)).split('\n').filter((l) => l.startsWith('• '));
      t.expect(lines.length === 3 && lines.every((l) => l.includes('HU')), `the confirmation lists ${JSON.stringify(lines)}`);
      await d.click('#confirmYes');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 60_000, what: 'the report after the re-run' });
      await d.sleep(300);
      const sent = fake.requests.slice(first);
      t.expect(sent.length === 3 && sent.every((r) => r.content.includes('Hungary')), `the re-run sent ${sent.length} requests, ${sent.filter((r) => !r.content.includes('Hungary')).length} not about Hungary`);
      await d.click('#rvBack');
      const done = await rerunChoice(d, 'failedMain');
      t.expect(done.disabled && /Nothing failed/.test(done.note), `the failing-only choice is still available after everything succeeded (${JSON.stringify(done)})`);
    },
  },
  {
    id: 'flow.rerun-choices', group: 'flow', timeoutMs: 150_000, row: 'Re-run choices', title: 'The four re-run choices have counts and reasons, in the panel and in the report; one failed judge request is repeated alone',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake({ rules: [{ match: (b, c) => isJudge(c) && c.includes('Hungary') && c.includes('COMPLETENESS'), times: 1, respond: { status: 404, body: { status: 404, title: 'Not Found' } } }] });
      await startSession(ctx, { rows: SAMPLE_IDS });
      for (const id of ['all', 'failedMain', 'judges', 'failedJudges']) {
        const c = await rerunChoice(d, id);
        t.expect(c.exists && c.disabled && /No run yet/.test(c.note), `before a run ${id} is not unavailable with "No run yet" (${JSON.stringify(c)})`);
      }
      await d.click('#run');
      await d.click('#confirmYes');
      for (const id of ['all', 'failedMain', 'judges', 'failedJudges']) {
        const c = await rerunChoice(d, id);
        t.expect(c.disabled && /A run is in progress/.test(c.note), `during the run ${id} is not unavailable with the reason (${JSON.stringify(c)})`);
      }
      await waitFor(d);
      const badge = await d.evaluate(() => document.querySelector('#rvRerunBox .badge')?.textContent ?? '');
      t.expect(badge === '1 failed row', `the control in the report shows "${badge}"`);
      const counts = { failedJudges: await rerunChoice(d, 'failedJudges', true), failedMain: await rerunChoice(d, 'failedMain', true), judges: await rerunChoice(d, 'judges', true), all: await rerunChoice(d, 'all', true) };
      t.expect(!counts.failedJudges.disabled && /^1 request$/.test(counts.failedJudges.note), `failing judges: ${JSON.stringify(counts.failedJudges)}`);
      t.expect(counts.failedMain.disabled && /0 requests · Nothing failed/.test(counts.failedMain.note), `failing main prompts: ${JSON.stringify(counts.failedMain)}`);
      t.expect(/^10 requests$/.test(counts.judges.note) && /^15 requests$/.test(counts.all.note), `all judges / all: ${counts.judges.note} / ${counts.all.note}`);
      // The opened list is legible in both appearances (the closed one is not shown, so the walk-through measures it open).
      await d.click('#rvRerunBox summary');
      for (const scheme of ['light', 'dark']) {
        await d.setMedia({ scheme });
        await d.sleep(500); // the colours of the buttons finish their short transition
        const seen = await d.evaluateExpression(MEASURE);
        const bad = seen.failures.filter((f) => /rerun/.test(f.selector));
        t.expect(bad.length === 0, `the open re-run list in the ${scheme} appearance: ${bad.map((f) => `${f.selector} "${f.text}" ${f.ratio}:1`).join('; ')}`);
      }
      await d.setMedia({ scheme: 'light' });
      await d.click('#rvRerunBox summary');
      const before = await d.evaluate(() => [...document.querySelectorAll('#report .case')].map((b) => b.innerHTML));
      const first = fake.requests.length;

      // A choice made in the report leads to the form and the key field; Escape closes the list again.
      await chooseRerun(d, 'failedJudges', { inReport: true });
      t.expect(await visible(d, '#formView') && !await visible(d, '#reportView'), 'the choice did not lead to the form');
      t.expect(/API key is empty/.test(await text(d, '#resMsg')), 'the key is not asked for');
      t.expect(await d.evaluate(() => document.activeElement?.id) === 'mainKey', 'the key field does not have the focus');
      await d.fill('#mainKey', ctx.key);
      await d.click('#rerunBox summary');
      const inside = await d.evaluate(() => { const list = document.querySelector('#rerunBox .rerunlist').getBoundingClientRect(); const panel = document.getElementById('secRes').getBoundingClientRect(); return { fits: list.left >= panel.left - 1 && list.right <= panel.right + 1, scrolls: document.documentElement.scrollWidth > window.innerWidth }; });
      t.expect(inside.fits && !inside.scrolls, `the open list sticks out of the run panel or the page scrolls sideways (${JSON.stringify(inside)})`);
      await d.press('Escape');
      t.expect(!await d.evaluate(() => document.querySelector('#rerunBox details').open) && await d.evaluate(() => document.activeElement?.tagName) === 'SUMMARY', 'Escape did not close the list and return the focus to its summary');
      await chooseRerun(d, 'failedJudges');
      const lines = (await confirmation(d)).split('\n').filter((l) => l.startsWith('• '));
      t.expect(lines.length === 1 && lines[0].includes('Completeness') && lines[0].includes('HU'), `the confirmation lists ${JSON.stringify(lines)}`);
      await d.click('#confirmYes');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 60_000, what: 'the report after the re-run' });
      await d.sleep(300);
      const sent = fake.requests.slice(first);
      t.expect(sent.length === 1 && isJudge(sent[0].content) && sent[0].content.includes('Hungary') && sent[0].content.includes('COMPLETENESS'), `the re-run sent ${sent.length} requests`);
      const after = await d.evaluate(() => [...document.querySelectorAll('#report .case')].map((b) => b.innerHTML));
      t.expect(after.filter((html, i) => html === before[i]).length === 4, 'the other four cases were not left as they were');
      t.expect(await d.evaluate(() => !document.querySelector('#rvRerunBox .badge')), 'the badge is still there after everything succeeded');
    },
  },
  {
    id: 'flow.new-session-everywhere', group: 'flow', timeoutMs: 120_000, row: 'New Session everywhere', title: 'One New Session button is on every screen, also in the report, and it removes the report',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      const visibleNewSessions = () => d.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'New Session' && !b.closest('[hidden]') && b.getBoundingClientRect().width > 0).length);
      await startSession(ctx, { rows: ['PL'] });
      t.expect(await visibleNewSessions() === 1, `${await visibleNewSessions()} New Session buttons on the form`);
      await d.click('#run');
      await d.click('#confirmYes');
      t.expect(await visibleNewSessions() === 1 && await visible(d, '#newSession2'), 'New Session is not visible during the run');
      await waitFor(d);
      t.expect(await visibleNewSessions() === 1, `${await visibleNewSessions()} New Session buttons in the report`);
      await d.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await d.sleep(200);
      const spot = await d.locate('#newSession2');
      t.expect(!spot.error && spot.hit, `New Session cannot be pressed when the report is scrolled down (${JSON.stringify(spot)})`);
      await d.click('#newSession2');
      t.expect(await visible(d, '#resetConfirm') && /Unexported results will be lost/.test(await text(d, '#resetConfirm')), 'the confirmation does not warn about unexported results');
      await d.click('#resetNo');
      t.expect(await visible(d, '#reportView') && !await visible(d, '#resetConfirm'), 'Cancel changed something');
      t.expect(await d.evaluate(() => document.activeElement?.id) === 'newSession2', 'the focus did not return to New Session');
      await d.click('#newSession2');
      await d.click('#resetYes');
      t.expect(!await visible(d, '#reportView') && await visible(d, '#formView'), 'the report is still open');
      t.expect(await d.evaluate(() => document.getElementById('report').innerHTML === '' && document.getElementById('expHtml').disabled && document.getElementById('expCsv').disabled && document.getElementById('mainKey').value === ''), 'something of the report, the exports, or the key is left');
      t.expect(!await visible(d, '#secMain'), 'the next steps are not locked again');
    },
  },
  {
    id: 'flow.score-forms', group: 'flow', timeoutMs: 90_000, row: 'Judge score forms', title: 'A judge that writes **SCORE:** 85 or SCORE: 85/100 gets the grade 85',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake({ rules: [
        { match: (b, c) => isJudge(c) && c.includes('ACCURACY'), respond: { content: 'Facts: fine.\n**SCORE:** 85' } },
        { match: (b, c) => isJudge(c) && c.includes('COMPLETENESS'), respond: { content: 'Facts: fine.\nSCORE: 85/100' } },
      ] });
      await startSession(ctx, { rows: ['PL'] });
      await runAndWait(d);
      const cells = await d.evaluate(() => [...document.querySelectorAll('#report table.sum tbody tr:not(.avg) td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
      t.expect(cells[2] === '85%' && cells[3] === '85%', `the summary row is ${JSON.stringify(cells)}`);
    },
  },
  {
    id: 'flow.edits-during-run', group: 'flow', timeoutMs: 90_000, row: 'Edits during a run', title: 'An edit made while a run is in progress does not reach it',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake({ hold: true });
      await startSession(ctx, { rows: ['PL'] });
      await d.click('#run');
      await d.click('#confirmYes');
      await fake.arrived(1, 15_000);
      await d.fill('#accText', 'EDITED WHILE RUNNING {prompt_input} {output}', { paste: true });
      fake.release();
      await waitFor(d);
      t.expect(fake.requests.filter((r) => isJudge(r.content)).every((r) => !r.content.includes('EDITED WHILE RUNNING')), 'an edit reached a judge request');
      await d.evaluate(() => { for (const det of document.querySelectorAll('#report details')) det.open = true; });
      const archive = await text(d, '#report');
      t.expect(/You are a meticulous QA reviewer/.test(archive) && !archive.includes('EDITED WHILE RUNNING'), 'the archive does not show the prompt the run used');
      await d.click('#rvBack');
      t.expect((await value(d, '#accText')).startsWith('EDITED WHILE RUNNING'), 'the edit did not stay in the form');
    },
  },
  {
    id: 'flow.stop', group: 'flow', timeoutMs: 90_000, row: 'Stop', title: 'Stop ends the run, unfinished rows are "not run", and nothing arrives afterwards',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake({ hold: true });
      await startSession(ctx, { rows: ['PL', 'CZ'] });
      await d.click('#run');
      await d.click('#confirmYes');
      await fake.arrived(1, 15_000);
      await d.click('#stop');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 20_000, what: 'the report after Stop' });
      const after = fake.requests.length;
      await d.sleep(5000);
      t.expect(fake.requests.length === after, `${fake.requests.length - after} requests arrived within 5 s after Stop`);
      t.expect(/not run/.test(await text(d, '#report')), 'the report does not say "not run"');
      await d.click('#rvBack');
      t.expect(/^Stopped\./.test(await text(d, '#phase')), `the status line is "${await text(d, '#phase')}"`);
    },
  },
  {
    id: 'flow.stop-after-failed-load', group: 'flow', timeoutMs: 90_000, row: 'Stop after a failed load', title: 'Stop stays on the screen and works when a broken dataset is loaded during a run',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake({ hold: true });
      await startSession(ctx, { rows: ['PL'] });
      await d.click('#run');
      await d.click('#confirmYes');
      await fake.arrived(1, 15_000);
      await d.fill('#dsText', 'this is not a dataset', { paste: true });
      await d.click('#dsLoad');
      t.expect(await visible(d, '#stop') && !await disabled(d, '#stop'), 'Stop is not on the screen after the failed load');
      t.expect(await visible(d, '#secCfg') && await visible(d, '#phase'), 'step 4 or the progress is gone');
      await d.click('#stop');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 20_000, what: 'the report after Stop' });
    },
  },
  {
    id: 'flow.unload-guard', group: 'flow', timeoutMs: 120_000, row: 'Closing with unexported results', title: 'Closing the tab with unexported results asks the browser for confirmation',
    async run(t, ctx) {
      const own = await ctx.newPage();
      try {
        const d = own.d;
        const sub = { ...ctx, d, mem: {}, get fake() { return own.mem.fake; }, useFake: async (o) => { const f = await (await import('../../fixtures/fake-upstream.mjs')).startFake(o); own.fakes.push(f); own.mem.fake = f; return f; } };
        await sub.useFake();
        await startSession(sub, { rows: ['PL'] });
        await runAndWait(d);
        d.answerDialogs(false);
        await d.session.send('Page.close').catch(() => {});
        await d.sleep(800);
        t.expect(d.dialogs.some((x) => x.type === 'beforeunload'), `closing the page raised no beforeunload dialog (${JSON.stringify(d.dialogs)})`);
      } finally {
        await own.dispose().catch(() => {});
      }
    },
  },
];

/** Waits until the report has opened after a run (also a stopped one). */
async function waitFor(d) { await waitForReport(d, 90_000); }
