// The whole flow with the keyboard alone (spec FR-060, SC-029, research R31): Tab, Shift+Tab, Enter, Space, typing.
import { checkTabOrder } from '../checkers.mjs';
import { waitForReport, visible, text } from './helpers.mjs';

export const keyboardChecks = [
  {
    id: 'keyboard.full-flow', group: 'keyboard', timeoutMs: 150_000, row: 'Keyboard only', title: 'From New Session to the report with the keyboard alone, with a visible focus at every stop',
    async run(t, ctx) {
      const { d } = ctx;
      const fake = await ctx.useFake();
      await d.open(ctx.appUrl);
      const stops = [];
      const distances = {}; // how many Tab presses it took to reach each wanted control from the one before
      /** Presses Tab until the wanted control has the focus (every stop is recorded); fails when it is not reached. */
      async function tabTo(wanted, { max = 120 } = {}) {
        const matches = typeof wanted === 'function' ? wanted : (f) => f.id === wanted;
        for (let i = 0; i < max; i++) {
          await d.press('Tab');
          const f = await d.focused();
          stops.push(f);
          if (matches(f)) { if (typeof wanted === 'string') distances[wanted] = i + 1; return f; }
        }
        throw new Error(`${typeof wanted === 'string' ? wanted : 'the wanted control'} was not reached with the Tab key within ${max} presses (the last stop: ${stops.at(-1)?.id ?? stops.at(-1)?.tag})`);
      }

      await tabTo('newSession');
      await d.press('Enter');
      t.expect(await visible(d, '#app'), 'Enter on New Session did not open the application');

      await tabTo('newSession2');
      await tabTo('dsSample');
      await d.press('Enter');
      t.expect(await d.evaluate(() => document.querySelectorAll('#dsPrev tr[data-row]').length) === 5, 'Enter on "Insert sample" did not load the sample');

      await tabTo('selNone');
      await d.press('Space');
      await tabTo((f) => f.tag === 'input' && f.type === 'checkbox');
      await d.press('Space'); // the first row
      t.expect(await d.evaluate(() => document.querySelectorAll('input[data-select]:checked').length) === 1, 'Space did not tick exactly the first row');

      await tabTo('mainText');
      await tabTo('mainEp');
      await d.clearFocused();
      await d.type(fake.endpoint);
      await tabTo('mainKey');
      await d.type(ctx.key);
      // Shift+Tab goes back one control, Tab forward again, and the typed key is still there.
      await d.press('Shift+Tab');
      const back = await d.focused();
      stops.push(back);
      t.expect(back.id === 'mainEp', `Shift+Tab from the key field reached "${back.id}" instead of the endpoint`);
      await d.press('Tab');
      const forward = await d.focused();
      stops.push(forward);
      t.expect(forward.id === 'mainKey' && await d.evaluate(() => document.getElementById('mainKey').value.length > 0), 'Tab after Shift+Tab did not return to the key field with its text');
      t.expect(await d.evaluate(() => document.getElementById('run').disabled) === false, 'Run is not available after the endpoint and the key were typed');

      await tabTo('run');
      await d.press('Enter');
      t.expect(await visible(d, '#runConfirm'), 'Enter on Run did not open the confirmation');
      // Escape on the confirmation must never send anything. The page defines no behavior for the key, so the confirmation
      // is either closed (and the focus back on Run) or still open; either way the walk goes on.
      await d.press('Escape');
      t.expect(fake.requests.length === 0, `Escape sent ${fake.requests.length} requests`);
      if (!await visible(d, '#runConfirm')) {
        t.expect((await d.focused()).id === 'run', 'after Escape closed the confirmation the focus is not back on Run');
        await d.press('Enter');
        t.expect(await visible(d, '#runConfirm'), 'Enter on Run did not open the confirmation again');
      }
      await tabTo('confirmYes');
      await d.press('Enter');
      await waitForReport(d, 90_000);

      await tabTo('rvBack');
      await d.press('Enter');
      t.expect(await visible(d, '#formView') && !await visible(d, '#reportView'), 'Enter on "Back to the form" did not return to the form');
      const landed = await d.focused(); // Back to the form puts the focus on "Open report" by itself
      stops.push(landed);
      t.expect(landed.id === 'openReport', `after Back to the form the focus is on "${landed.id}" instead of "Open report"`);
      distances.openReport = 0;
      await d.press('Enter');
      t.expect(await visible(d, '#reportView'), 'Enter on "Open report" did not open the report');

      // After an action that opens something (the confirmation, the report) the next control to use is close at hand.
      t.expect(distances.confirmYes <= 3, `after Enter on Run it took ${distances.confirmYes} Tab presses to reach "Confirm and send" (at most 3)`);
      t.expect(distances.rvBack <= 3, `after the run it took ${distances.rvBack} Tab presses to reach "Back to the form" (at most 3)`);

      const expected = ['newSession', 'newSession2', 'dsSample', 'selNone', 'mainText', 'mainEp', 'mainKey', 'run', 'confirmYes', 'rvBack', 'openReport'];
      const result = checkTabOrder(stops, expected);
      t.problems(result.problems);
      t.note({ expected: `the controls ${expected.join(' → ')} are reached in this order, each with a visible focus`, seen: `${stops.length} stops with Tab, Shift+Tab, Enter, Space, and Escape (Confirm and send after ${distances.confirmYes}, Back to the form after ${distances.rvBack}); ${result.ok ? 'in order, every focus visible' : result.problems[0]}` });
      t.evidence(await ctx.shot('end'));
      void text;
    },
  },
];
