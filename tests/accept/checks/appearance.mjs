// The page at several widths, in the light and the dark setting and with reduced motion (spec FR-062, research R32, R33):
// no sideways scrolling, nothing covered, a visible focus ring, text with enough contrast, and screenshots for the gallery.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkOverflow, checkCovered, checkMotion, checkContrast, mediaAccepted, checkFocusKinds, focusKind, FOCUS_KINDS } from '../checkers.mjs';
import { MEASURE } from '../contrast.mjs';
import { startSession, runAndWait, text, value, visible } from './helpers.mjs';

const WIDTHS = [[500, 1000], [900, 1000], [1100, 1100], [1920, 1080]];
const SCHEMES = ['light', 'dark'];
const COMBOS = WIDTHS.flatMap(([w, h]) => SCHEMES.map((scheme) => ({ w, h, scheme })));
const REFERENCE = path.resolve(import.meta.dirname, '..', '..', '..', 'specs', '001-simple-prompt-runner', 'example-form-modern.html');

const overflow = (d) => d.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

/** Scrolls to the bottom and reports which of the controls at the bottom of the page something else covers (the bottom bar, for one). */
const coveredAtBottom = (d, selectors) => d.evaluate((sels) => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  const out = [];
  for (const selector of sels) {
    const el = document.querySelector(selector);
    if (!el || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
    const x = r.left + r.width / 2; const y = Math.min(r.top + r.height / 2, window.innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    const hit = Boolean(top) && (top === el || el.contains(top));
    out.push({ selector, hit, coveredBy: hit ? null : `${top?.tagName.toLowerCase()}${top?.id ? `#${top.id}` : ''}` });
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  return out;
}, selectors);

async function contrastOf(d) { return d.evaluateExpression(MEASURE); }

/** What the browser answers to `matchMedia` for the two settings. */
const seenMedia = (d) => d.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches }));

async function setCombo(d, { w, h, scheme }) {
  await d.viewport(w, h);
  await d.setMedia({ scheme, motion: 'no-preference' });
  await d.sleep(150);
}

/** The reference page rendered for the gallery in every combination. */
async function renderReference(ctx, combos = COMBOS) {
  const other = await ctx.newPage();
  try {
    for (const combo of combos) {
      await setCombo(other.d, combo);
      await other.d.open(pathToFileURL(REFERENCE).href);
      await other.d.screenshot(path.join(ctx.folder, 'reference', `example-form-modern-${combo.w}-${combo.scheme}.png`));
    }
  } finally { await other.dispose().catch(() => {}); }
}

export const appearanceChecks = [
  {
    id: 'appearance.matrix', group: 'appearance', timeoutMs: 240_000, row: 'Modern page, look', title: 'At 500, 900, 1100, and 1920 px, light and dark: no sideways scrolling, nothing covered, a visible focus, readable text',
    async run(t, ctx) {
      const { d } = ctx;
      // A scheme that the browser does not apply is not examined, and the verdict says so (never a silent pass).
      const unsupported = {};
      for (const scheme of SCHEMES) {
        await setCombo(d, { w: 1280, h: 900, scheme }).catch(() => {});
        const answer = mediaAccepted(await seenMedia(d), { scheme, motion: 'no-preference' });
        if (!answer.ok) unsupported[scheme] = answer.reason;
      }
      const combos = COMBOS.filter((c) => !unsupported[c.scheme]);
      const schemes = SCHEMES.filter((s) => !unsupported[s]);
      await renderReference(ctx, combos);
      const where = (combo, state) => `${state} at ${combo.w} px, ${combo.scheme}`;
      const rel = (combo, state) => path.join('screenshots', `appearance-${state}-${combo.w}-${combo.scheme}.png`);
      const record = async (combo, state, caption) => {
        await d.screenshot(path.join(ctx.folder, rel(combo, state)), { full: state === 'report' });
        ctx.gallery.push({ caption: `${caption} · ${combo.w} px · ${combo.scheme}`, page: rel(combo, state), reference: state === 'form' ? path.join('reference', `example-form-modern-${combo.w}-${combo.scheme}.png`) : null });
      };
      const measure = async (combo, state) => {
        const o = checkOverflow(await overflow(d));
        t.problems(o.problems.map((p) => `${where(combo, state)}: ${p}`));
        const c = checkContrast(await contrastOf(d));
        t.problems(c.problems.map((p) => `${where(combo, state)}: ${p}`));
      };

      // The start screen.
      for (const combo of combos) {
        await setCombo(d, combo);
        await d.open(ctx.appUrl);
        await record(combo, 'start', 'start screen');
        await measure(combo, 'start screen');
      }

      // The filled form, then the open confirmation, then the report.
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      for (const combo of combos) {
        await setCombo(d, combo);
        await record(combo, 'form', 'filled form');
        await measure(combo, 'the form');
        const covered = checkCovered(await coveredAtBottom(d, ['#rerunBox summary', '#openReport', '#expCsv', '#stop']));
        t.problems(covered.problems.map((p) => `${where(combo, 'the form')}: ${p}`));
      }
      t.expect(!await d.evaluate(() => document.getElementById('run').disabled), `Run is not available for the confirmation shots; the panel says: ${(await text(d, '#ready')).slice(0, 200)}`);
      await d.click('#run');
      for (const combo of combos) {
        await setCombo(d, combo);
        await record(combo, 'confirmation', 'open confirmation');
        await measure(combo, 'the confirmation');
      }
      await d.click('#confirmNo');
      await d.click('#run');
      await d.click('#confirmYes');
      await d.waitFor(() => !document.getElementById('reportView').hidden && document.querySelectorAll('#report .case').length > 0, { timeoutMs: 90_000, what: 'the report' });
      for (const combo of combos) {
        await setCombo(d, combo);
        await record(combo, 'report', 'report');
        await measure(combo, 'the report');
      }

      // A visible focus ring on every kind of control, in both schemes.
      await d.click('#rvBack');
      for (const scheme of schemes) {
        await setCombo(d, { w: 1280, h: 900, scheme });
        await d.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); document.activeElement?.blur(); });
        const stops = [];
        const met = new Set();
        for (let i = 0; i < 140 && !FOCUS_KINDS.every((k) => met.has(k)); i++) {
          await d.press('Tab');
          const f = await d.focused();
          stops.push(f);
          const kind = focusKind(f);
          if (kind) met.add(kind);
        }
        t.problems(checkFocusKinds(stops).problems.map((p) => `${scheme}: ${p}`));
      }
      const skipped = SCHEMES.filter((s) => unsupported[s]);
      if (skipped.length) t.notRun(`the ${skipped.join(' and ')} appearance could not be requested from the browser (${skipped.map((s) => unsupported[s]).join('; ')}); the others were examined`);
      t.note({ expected: 'no sideways scrolling, nothing covered, a visible focus ring on every kind of control, and text of at least 4.5:1 in all 8 combinations of width and scheme', seen: `${combos.length} of ${COMBOS.length} combinations examined; screenshots in the gallery` });
    },
  },
  {
    id: 'appearance.bottom-bar', group: 'appearance', timeoutMs: 120_000, row: 'Bottom bar', title: 'At 500 px a bar at the bottom shows the state and the main action, and it is the panel\'s own button',
    async run(t, ctx) {
      const { d } = ctx;
      await d.viewport(500, 900);
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL'], key: false });
      const bar = await d.evaluate(() => { const b = document.getElementById('runBar'); const s = getComputedStyle(b); const r = b.getBoundingClientRect(); return { display: s.display, position: s.position, bottom: Math.round(r.bottom), height: r.height, inner: window.innerHeight, padding: parseFloat(getComputedStyle(document.querySelector('.wrap')).paddingBottom) }; });
      t.expect(bar.display === 'flex' && bar.position === 'fixed' && bar.bottom === bar.inner, `the bar is ${JSON.stringify(bar)}`);
      t.expect(bar.padding >= bar.height, `the page leaves ${bar.padding} px below its last card for a bar of ${bar.height} px`);
      t.expect(await text(d, '#barState') === '1 problem' && await d.evaluate(() => document.getElementById('barAction').disabled), `the bar says "${await text(d, '#barState')}"`);
      t.problems(checkCovered(await coveredAtBottom(d, ['#rerunBox summary', '#openReport', '#expCsv'])).problems);
      await d.fill('#mainKey', ctx.key);
      t.expect(await text(d, '#barState') === 'Ready' && !await d.evaluate(() => document.getElementById('barAction').disabled), 'the bar does not say Ready with an enabled action');
      await d.click('#barAction');
      t.expect(await visible(d, '#runConfirm') && await text(d, '#barState') === 'Confirmation waiting', 'the bar action does not open the panel\'s confirmation');
      await d.click('#confirmNo');
      await d.click('#barAction');
      await d.click('#confirmYes');
      await d.waitFor(() => !document.getElementById('reportView').hidden, { timeoutMs: 90_000, what: 'the report' });
      await d.click('#rvBack');
      t.expect(await text(d, '#barState') === 'Report ready' && await text(d, '#barAction') === 'Open report', 'the bar does not offer the report');
      await d.click('#barAction');
      t.expect(await visible(d, '#reportView'), 'the bar action does not open the report');
      t.problems(checkOverflow(await overflow(d)).problems);
      t.evidence(await ctx.shot('bar'));
    },
  },
  {
    id: 'appearance.reduced-motion', group: 'appearance', timeoutMs: 90_000, row: 'Reduced motion', title: 'With reduced motion requested no transition or animation runs; without it the page does move',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      await d.click('#run');
      const selectors = ['#run', '#stop', '#prog', '.stepcards > .card', '#ready li', '#runConfirm', '#stepList a'];
      const read = () => d.evaluate((sels) => sels.map((s) => { const el = document.querySelector(s); const c = el && getComputedStyle(el); return el ? { name: s, transitionDuration: c.transitionDuration, animationName: c.animationName } : null; }).filter(Boolean), selectors);
      await d.setMedia({ motion: 'no-preference' });
      const moving = await read();
      t.expect(moving.some((m) => m.transitionDuration.split(',').some((x) => parseFloat(x) > 0) || m.animationName !== 'none'), 'nothing moves even without the setting: the check would prove nothing');
      await d.setMedia({ motion: 'reduce' }).catch(() => {});
      const applied = mediaAccepted(await seenMedia(d), { motion: 'reduce' });
      if (!applied.ok) { t.notRun(`reduced motion could not be requested from the browser (${applied.reason})`); return; }
      const still = await read();
      t.problems(checkMotion(still).problems);
      t.expect(await d.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior !== 'smooth'), 'smooth scrolling is on with reduced motion');
      await d.setMedia({ motion: 'no-preference' });
      void value;
    },
  },
];
