// User Story 9 on a narrow window with reduced motion (scenarios 7 and 8; SC-029, SC-030): the bottom bar, no sideways
// scrolling, and no transition or animation when the system asks for reduced motion.
export const windowSize = '500,1000';
export const chromeArgs = ['--force-prefers-reduced-motion'];

const KEY = 'nvapi-FAKE-US9B-KEY';

export default async function run(t) {
  const { state } = await import('/src/main.mjs');
  const overflow = () => document.documentElement.scrollWidth - window.innerWidth;

  t.assert(window.innerWidth <= 500, `a narrow width was applied (${window.innerWidth})`);
  t.assert(matchMedia('(prefers-reduced-motion: reduce)').matches, 'the browser reports reduced motion');
  t.click('newSession');
  t.click('dsSample');
  t.assert(overflow() <= 0, `no sideways scrolling (${overflow()} px)`);

  // The bar is fixed to the bottom and shows the state and the primary action.
  const bar = t.byId('runBar');
  const style = getComputedStyle(bar);
  t.assert(style.display === 'flex' && style.position === 'fixed', 'the bottom bar is shown and fixed');
  t.assert(Math.round(bar.getBoundingClientRect().bottom) === window.innerHeight, 'at the bottom of the window');
  t.equal(t.text('barState'), '1 problem', 'the bar counts the problems');
  t.assert(t.byId('barAction').disabled && t.text('barAction') === 'Run', 'Run in the bar is disabled');
  const wrap = getComputedStyle(document.querySelector('.wrap'));
  t.assert(parseFloat(wrap.paddingBottom) >= bar.getBoundingClientRect().height, 'the page leaves room below its last card for the bar');
  t.assert(t.byId('barAction').getBoundingClientRect().height >= 40, 'the action is at least 40 px high');

  // Pressing the state moves to the panel; the panel's own list names the problem.
  t.click('barState');
  t.assert(t.visible('secRes'), 'the panel is there');

  t.type('mainKey', KEY);
  t.equal(t.text('barState'), 'Ready', 'the bar says Ready');
  t.assert(!t.byId('barAction').disabled, 'the action is available');

  // The bar's action is the panel's Run: the same confirmation, the same lock.
  t.click('barAction');
  t.require(t.visible('runConfirm'), 'the action opens the confirmation of the panel');
  t.assert(Boolean(t.byId('mainKey').closest('[inert]')), 'the form is locked as with the panel button');
  t.equal(t.text('barState'), 'Confirmation waiting', 'the bar waits with it');
  t.click('confirmNo');
  t.assert(!t.byId('mainKey').closest('[inert]'), 'Cancel lifts the lock');
  t.click('barAction');
  t.click('confirmYes');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => t.visible('reportView'), 'the report to open');
  t.assert(overflow() <= 0, `no sideways scrolling in the report (${overflow()} px)`);
  t.click('rvBack');
  t.equal(t.text('barState'), 'Report ready', 'the bar says that the report is ready');
  t.equal(t.text('barAction'), 'Open report', 'and offers it');
  t.click('barAction');
  t.assert(t.visible('reportView'), 'the action opens the report');
  t.click('rvBack');

  // Reduced motion: nothing moves.
  const durations = [];
  for (const el of [t.byId('run'), t.byId('prog'), document.querySelector('.stepcards > .card'), t.byId('ready'), t.byId('runConfirm')]) {
    const s = getComputedStyle(el);
    durations.push([el.id || el.className, s.transitionDuration, s.animationName]);
  }
  t.assert(durations.every(([, transition, animation]) => transition.split(',').every((d) => parseFloat(d) === 0) && animation === 'none'), `no transition or animation runs (${JSON.stringify(durations)})`);
  t.assert(getComputedStyle(document.documentElement).scrollBehavior !== 'smooth', 'no smooth scrolling');
  t.assert(t.storageEmpty(), 'nothing is stored in the browser');
}
