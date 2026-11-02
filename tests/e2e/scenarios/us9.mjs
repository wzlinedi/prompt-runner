// User Story 9: the modern application page (scenarios 1-6, 10; SC-028, SC-029): the start hero, the chips, the step
// indicator, the live readiness list, the JSON badge, the lock while confirming, and the flow with focusable controls.
export const windowSize = '1280,800'; // lower than the page, so that scrolling is possible

const KEY = 'nvapi-FAKE-US9-KEY';

export default async function run(t) {
  const { state } = await import('/src/main.mjs');
  const chips = () => [...document.querySelectorAll('#facts span')].map((c) => c.textContent);
  const steps = () => [...document.querySelectorAll('#stepList li')].map((li) => ({
    cls: li.className, link: li.querySelector('a'), current: li.querySelector('a').getAttribute('aria-current') === 'step', fact: li.querySelector('small').textContent,
  }));
  const readyText = () => t.text('ready');
  // A control is in the tab order when it is not hidden, inert, disabled, or taken out of the order with a negative tabindex.
  const inTabOrder = (id) => { const el = t.byId(id); return Boolean(el) && !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility === 'visible'; };
  const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  // Scenario 1: the start screen is a hero with one action.
  t.assert(t.visible('startScreen') && !t.visible('app'), 'only the start screen is shown');
  t.equal(document.querySelectorAll('#startScreen button').length, 1, 'the one action is New Session');
  t.click('newSession');

  // The start of a session: chips, step indicator, and the list of everything that is missing.
  t.assert(chips().includes('Judges: same model') && chips().includes('No report yet') && !chips().some((c) => /rows loaded/.test(c)), `the chips at the start (${chips().join(' | ')})`);
  t.equal(document.querySelectorAll('#stepList li').length, 5, 'five steps');
  t.assert(steps()[0].current && steps()[0].fact === 'load a dataset', 'step 1 is the current one');
  t.assert([1, 2, 3, 4].every((i) => steps()[i].cls.includes('na') && steps()[i].link.getAttribute('aria-disabled') === 'true' && !steps()[i].link.hasAttribute('href')), 'steps 2-5 are not available and cannot be pressed');
  t.match(readyText(), /1 · Dataset/, 'the list names the dataset step');
  t.match(readyText(), /Dataset: load a dataset first\./, 'and its problem');
  t.match(readyText(), /4 · Configuration – available after step 3/, 'the later step is listed too, with when it becomes available');
  t.match(readyText(), /Main prompt: the API key is empty\./, 'including the empty key');
  t.assert(document.querySelectorAll('#ready li.dim').length === 1 && !document.querySelector('#ready li.dim a'), 'the group of the locked step is dimmed and its item is not a link');
  t.assert(document.querySelector('#ready li.bad a[data-field="dsText"]'), 'the item of an available step is a link');
  t.assert(t.byId('run').disabled && t.byId('run').getAttribute('aria-describedby') === 'ready', 'Run is disabled and points to the reasons');
  t.equal(t.text('stateBadge'), '2 problems', 'the badge counts the problems');
  t.assert(!t.byId('newSession2').dataset.weight, 'New Session is the quiet button while there is nothing to lose');
  t.assert(before(t.byId('ready'), t.byId('run')), 'the reasons come before Run in the order of the page');
  t.equal(getComputedStyle(t.byId('runBar')).display, 'none', 'the bottom bar is not used on a wide window');

  // Scenario 2 and 3: a loaded dataset unlocks the steps; the chips and the indicator follow.
  t.click('dsSample');
  t.equal(t.byId('newSession2').dataset.weight, 'heavy', 'New Session looks consequential once the session holds data');
  t.assert(chips().includes('5 rows loaded') && chips().includes('5 of 20 selected'), `the chips follow the dataset (${chips().join(' | ')})`);
  t.assert(chips().some((c) => c.startsWith('Model nvidia/')), 'the chip names the model');
  t.assert(chips().every((c) => !c.includes('http') && !c.includes('nvapi')), 'no endpoint and no key in the chips');
  t.equal(steps().map((s) => s.cls.split(' ')[0]), ['done', 'done', 'done', 'attn', 'attn'], 'steps 1-3 are done, 4 and 5 need attention');
  t.assert(steps()[0].fact === '5 rows, 5 selected' && steps()[3].fact === '1 problem', 'the facts of the steps');
  t.assert(steps()[3].current && steps()[3].link.getAttribute('aria-current') === 'step', 'the first step that is not done is marked as the current one');
  t.assert(steps().every((s) => s.link.hasAttribute('href')), 'every step is a link now');
  t.assert(!document.querySelector('#ready li.dim'), 'nothing is dimmed any more');
  t.assert(document.querySelector('#ready li.bad a[data-field="mainKey"]'), 'the key problem is a link now');

  // The step indicator stays in view while the page is scrolled (spec FR-050).
  window.scrollTo({ top: 900, behavior: 'instant' }); // the page scrolls smoothly otherwise
  await t.sleep(50);
  const nav = t.byId('stepNav');
  await t.waitFor(() => nav.classList.contains('stuck'), 'the band to appear once the step indicator sticks'); // the scroll event arrives with the next frame
  t.assert(window.scrollY > 300, `the page can be scrolled (${window.scrollY})`);
  t.assert(getComputedStyle(nav).position === 'sticky' && nav.getBoundingClientRect().top >= -1 && nav.getBoundingClientRect().top <= 1, `the step indicator sticks to the top (${nav.getBoundingClientRect().top})`);
  t.assert(nav.classList.contains('stuck'), 'and gets its band');
  window.scrollTo({ top: 0, behavior: 'instant' });
  await t.waitFor(() => !nav.classList.contains('stuck'), 'the band to go away at the top of the page');

  // A step link moves to its card.
  steps()[3].link.click();
  t.assert(document.activeElement === t.byId('secCfg'), 'pressing a step takes the focus to its card');

  // Scenario 4: the list follows what the user does, and an item moves the focus to its field.
  document.querySelector('#ready a[data-field="mainKey"]').click();
  t.assert(document.activeElement === t.byId('mainKey'), 'an item moves the focus to its field');
  t.type('mainKey', KEY);
  t.assert(!/API key is empty/.test(readyText()), 'a typed key removes its item at once');
  t.match(readyText(), /Ready to run\./, 'the list says that the run is ready');
  t.match(t.text('counts'), /^5 main requests to .+ \(model nvidia\/.+\) and up to 10 judge requests to .+\. You confirm before anything is sent\.$/, 'the summary gives the counts and the models');
  t.assert(!t.byId('run').disabled, 'Run is available');
  t.equal(t.text('stateBadge'), 'ready', 'the badge says ready');
  t.equal(steps().map((s) => s.cls.split(' ')[0]), ['done', 'done', 'done', 'done', 'cur'], 'steps 1-4 are done; the last one is the current one');
  t.equal(steps()[4].fact, 'ready to run', 'step 5 says that the run is ready');

  t.click('selNone');
  t.match(readyText(), /Select between 1 and 20 rows; 0 are selected now\./, 'the selection problem is listed');
  t.assert(t.byId('run').disabled, 'Run waits for a selection');
  t.assert(chips().includes('0 of 20 selected'), 'the chip follows the selection');
  t.click('selAll');
  t.assert(!t.byId('run').disabled, 'Run is available again');

  // Scenario 5: the badge of the parameters JSON.
  t.assert(/^valid · nvidia\//.test(t.text('mainJsonBadge')) && t.byId('mainJsonBadge').className.includes('good'), 'the JSON badge says valid and names the model');
  t.type('main_json', '{"model": ');
  t.match(t.text('mainJsonBadge'), /not valid JSON/, 'a broken JSON is said to be broken');
  t.assert(t.byId('mainJsonBadge').className.includes('low') && t.byId('run').disabled, 'and blocks the run');
  t.type('main_json', '{"model":"nvidia/other-model","temperature":0.5}');
  t.equal(t.text('mainJsonBadge'), 'valid · nvidia/other-model', 'a repaired JSON is valid again');
  t.assert(chips().includes('Model nvidia/other-model'), 'the chip follows the model');
  t.type('main_json', t.value('main_json').replace('nvidia/other-model', 'nvidia/nemotron-3.5-bolt-e4b'));
  t.equal(t.text('mainCount'), `${t.value('mainText').length} characters`, 'the editor shows its number of characters');

  // Scenario 6: the lock is explained, and only Confirm and Cancel stand out.
  t.click('run');
  t.assert(t.visible('lockNote') && /Locked while you confirm/.test(t.text('lockNote')), 'the lock is explained');
  t.equal(t.text('barState'), 'Confirmation waiting', 'the bar says that a confirmation waits');
  t.assert(t.byId('barAction').disabled, 'and its action is disabled');
  t.equal(t.text('stateBadge'), 'confirm', 'the badge says so too');
  t.click('confirmNo');
  t.assert(!t.visible('lockNote'), 'the explanation goes away with the lock');

  // Scenario 10 (flow): every control of the flow can take the focus, and the flow ends at the report.
  for (const id of ['newSession2', 'dsFile', 'dsText', 'dsLoad', 'dsSample', 'selAll', 'selNone', 'mainEp', 'mainKey', 'main_json', 'sameModel', 'run']) t.assert(inTabOrder(id), `${id} is in the tab order`);
  t.assert(inTabOrder('mainText') && inTabOrder('accText') && inTabOrder('compText') && inTabOrder('exRow'), 'the editors and the example selector are in the tab order');
  t.assert([...document.querySelectorAll('#stepList a[href]')].every((a) => a.tabIndex >= 0), 'the step links are in the tab order');
  t.click('run');
  t.assert(inTabOrder('confirmYes') && inTabOrder('confirmNo'), 'Confirm and Cancel are in the tab order');
  t.assert(!inTabOrder('mainKey') && !inTabOrder('run'), 'the locked form and Run are out of the order while the confirmation is open');
  t.click('confirmYes');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => t.visible('reportView'), 'the report to open');
  t.click('rvBack');
  t.assert(['openReport', 'expHtml', 'expCsv'].every(inTabOrder), 'the result actions are in the tab order');
  t.assert(document.querySelector('#rerunBox summary').tabIndex >= 0, 'the re-run control is in the tab order');
  t.assert(chips().includes('Report ready'), 'the chip says that a report exists');
  t.equal(steps()[4].fact, 'done', 'step 5 is done');
  t.assert(t.byId('barAction').textContent === 'Open report' && t.text('barState') === 'Report ready', 'the bar offers the report');
  t.assert(t.byId('run').disabled && /API key is empty/.test(readyText()), 'the key was cleared, so Run waits for a new one');
  t.assert(t.storageEmpty(), 'nothing is stored in the browser');
}
