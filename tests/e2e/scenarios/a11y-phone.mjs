// Responsive and accessibility pass at phone width (T064): 16 px side gutters, no horizontal page scroll,
// visible keyboard focus on the controls, placeholders distinguishable without color.
export const windowSize = '390,844';
export const fakeOptions = {};

export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');
  t.type('mainKey', 'nvapi-FAKE-KEY');
  t.type('mainEp', t.config.fakeEndpoint);
  t.type('dsText', t.value('dsText'));

  const overflow = () => document.documentElement.scrollWidth - window.innerWidth;
  const gutter = getComputedStyle(document.querySelector('.wrap')); // the side margins of the page content
  t.assert(parseFloat(gutter.paddingLeft) >= 16 && parseFloat(gutter.paddingRight) >= 16, `side gutters are at least 16 px (${gutter.paddingLeft}/${gutter.paddingRight})`);
  t.assert(window.innerWidth <= 500, `a phone-sized width was applied (${window.innerWidth}; headless Chrome does not go below 500)`);
  t.assert(overflow() <= 0, `no horizontal page scroll with the filled-in form (${overflow()} px too wide)`);

  t.click('run');
  t.click('confirmYes');
  const { state } = await import('/src/main.mjs');
  await t.waitFor(() => state.get().run?.status === 'finished', 'the run to finish');
  await t.waitFor(() => t.visible('reportView') && document.querySelectorAll('#report .case').length === 5, 'the report');
  t.assert(overflow() <= 0, `no horizontal page scroll with the report (${overflow()} px too wide)`);

  // Nothing sticks out of the page unless it sits inside a container that scrolls on its own.
  const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const wide = [...document.querySelectorAll('#reportView *')].filter((el) => !el.closest('[hidden]') && el.getBoundingClientRect().right > window.innerWidth + 1 && !scrolls(el));
  t.assert(wide.length === 0, `elements wider than the screen: ${wide.slice(0, 3).map((e) => `${e.tagName}#${e.id || e.className}`).join(', ')}`);

  // SC-016: the cards stack — the five fields of a case are one under the other, each with its label.
  const first = document.querySelector('#report .case');
  const tops = [...first.querySelectorAll('[data-field]')].map((f) => f.getBoundingClientRect().top);
  t.assert(tops.every((top, i) => i === 0 || top > tops[i - 1]), `the fields of a case are one under the other (${tops.map(Math.round).join(',')})`);
  t.assert([...first.querySelectorAll('[data-field] .fl')].every((l) => l.textContent.trim() !== '' && l.getBoundingClientRect().width > 0), 'every field shows its label');
  const kpiTops = [...document.querySelectorAll('#report .kpi')].map((k) => k.getBoundingClientRect().top);
  t.assert(kpiTops.every((top, i) => i === 0 || top > kpiTops[i - 1]), 'the average cards are stacked');
  // The scrolling boxes can be reached with the keyboard and show where the focus is.
  const box = first.querySelector('.scroll');
  box.focus();
  t.assert(document.activeElement === box && parseFloat(getComputedStyle(box).outlineWidth) > 0, 'a scrolling box takes the focus and shows an outline');
  t.assert(parseFloat(getComputedStyle(t.byId('report')).paddingLeft) >= 0 && document.documentElement.scrollWidth <= window.innerWidth, 'no sideways scrolling in the report view');
  t.click('rvBack');

  // Keyboard focus is visible on every kind of control.
  for (const id of ['newSession2', 'dsLoad', 'dsText', 'openReport', 'mainKey', 'sameModel', 'expHtml']) {
    const el = t.byId(id);
    el.focus();
    const style = getComputedStyle(el);
    const wrapper = el.closest('.editor');
    const outline = wrapper ? getComputedStyle(wrapper) : style;
    const visible = (parseFloat(outline.outlineWidth) > 0 && outline.outlineStyle !== 'none') || style.boxShadow !== 'none';
    t.assert(visible, `${id} shows a focus indicator`);
  }
  document.getElementById('mainText').focus();
  const editor = getComputedStyle(document.getElementById('mainText').closest('.editor'));
  t.assert(parseFloat(editor.outlineWidth) > 0, 'the focused prompt editor shows an outline');

  // Placeholders are distinguishable without color: the braces stay in the text, known and unknown ones differ in the line style.
  t.type('accText', '{prompt_input} {zzz}');
  const known = getComputedStyle(document.querySelector('#mainBack mark.ph'));
  const unknown = getComputedStyle(document.querySelector('#accBack mark.bad'));
  t.assert(document.querySelector('#mainBack mark.ph').textContent === '{prompt_input}', 'the braces of a placeholder are visible text');
  t.assert(known.borderBottomStyle === 'solid' && unknown.borderBottomStyle === 'dashed', 'unknown placeholders are underlined differently, not only colored');
}
