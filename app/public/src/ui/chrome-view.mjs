// The header band (chips with the facts of the session) and the step indicator (spec FR-049, FR-050).
// Everything shown comes from readiness.mjs; no key and no endpoint is ever shown here.
import { stepStates, sessionFacts } from '../readiness.mjs';

const TARGET = { 1: 'secData', 2: 'secMain', 3: 'secJudge', 4: 'secCfg', 5: 'secRes' };
const CLASS = { done: 'done', attention: 'attn', locked: 'na', todo: '' };

export function mountChromeView({ state }) {
  const $ = (id) => document.getElementById(id);

  const chip = (text, title) => {
    const span = document.createElement('span');
    span.textContent = text;
    if (title) span.title = title;
    return span;
  };

  function renderChips(session) {
    const facts = sessionFacts(session);
    const chips = [];
    if (facts.rowsLoaded) chips.push(chip(`${facts.rowsLoaded} ${facts.rowsLoaded === 1 ? 'row' : 'rows'} loaded`));
    if (facts.rowsLoaded) chips.push(chip(`${facts.rowsSelected} of ${facts.limit} selected`));
    if (facts.mainModel) chips.push(chip(`Model ${facts.mainModel}`, facts.mainModel));
    chips.push(chip(facts.judges === 'same model' ? 'Judges: same model' : `Judges: ${facts.judges || '–'}`, facts.judges));
    chips.push(chip(facts.report ? 'Report ready' : 'No report yet'));
    $('facts').replaceChildren(...chips);
  }

  function renderSteps(session) {
    const items = stepStates(session).map((step) => {
      const li = document.createElement('li');
      const locked = step.state === 'locked';
      li.className = [CLASS[step.state], step.current && step.state !== 'attention' ? 'cur' : ''].filter(Boolean).join(' ');
      const a = document.createElement('a');
      if (locked) a.setAttribute('aria-disabled', 'true');
      else a.href = `#${TARGET[step.step]}`;
      if (step.current) a.setAttribute('aria-current', 'step');
      a.dataset.step = String(step.step);
      const n = document.createElement('span');
      n.className = 'n';
      n.setAttribute('aria-hidden', 'true');
      n.textContent = step.state === 'done' ? '✓' : step.state === 'attention' ? '!' : String(step.step);
      const text = document.createElement('span');
      const title = document.createElement('b');
      title.textContent = `${step.step} · ${step.title}`;
      const fact = document.createElement('small');
      fact.textContent = step.fact;
      text.append(title, fact);
      a.append(n, text);
      li.append(a);
      return li;
    });
    $('stepList').replaceChildren(...items);
  }

  function render() {
    const session = state.get();
    renderChips(session);
    renderSteps(session);
    // New Session discards data and results: it looks like what it does as soon as there is something to lose (spec FR-054).
    if (session.dataset || session.run) $('newSession2').dataset.weight = 'heavy'; else delete $('newSession2').dataset.weight;
  }

  /** The band behind the step indicator appears only once the indicator has stuck to the top of the window (spec FR-050). */
  const syncStuck = () => $('stepNav').classList.toggle('stuck', $('stepNav').getBoundingClientRect().top <= 0.5 && window.scrollY > 0);
  window.addEventListener('scroll', syncStuck, { passive: true });
  window.addEventListener('resize', syncStuck);

  // A step that is available can be pressed: its card (or the run panel) comes into view and takes the focus.
  $('stepList').addEventListener('click', (event) => {
    const link = event.target.closest('a[data-step]');
    if (!link) return;
    event.preventDefault();
    if (link.getAttribute('aria-disabled') === 'true') return;
    const target = $(TARGET[link.dataset.step]);
    if (!target || target.hidden) return;
    target.scrollIntoView?.({ block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  state.subscribe(render);
  // The page changes some values in place without a notification (typing in the fields): those count too.
  document.addEventListener('input', render);
  document.addEventListener('change', render);

  return { reset: render, render };
}
