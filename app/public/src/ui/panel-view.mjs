// The run panel's readiness list and summary, and the bottom bar for narrow windows (spec FR-051, FR-052).
// The list is rewritten only when the set of problems changes, so that assistive technology does not repeat itself.
// The bar's action delegates to the panel's own buttons (run, stop, openReport): the confirmation, the lock, and every
// check exist once, in run-view.mjs.
import { readiness } from '../readiness.mjs';
import { countRequests } from '../runner.mjs';
import { effectiveJudgeConfig, parseParams } from '../config.mjs';

const hostOf = (endpoint) => { try { return new URL(String(endpoint).trim()).host; } catch { return ''; } };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function mountPanelView({ state }) {
  const $ = (id) => document.getElementById(id);
  let listKey = null;

  function buildList(groups, count) {
    const items = [];
    if (!count) {
      const li = document.createElement('li');
      li.className = 'ok';
      li.textContent = 'Ready to run.';
      items.push(li);
    }
    for (const group of groups) {
      if (!group.items.length) continue;
      const head = document.createElement('li');
      head.className = 'group';
      head.textContent = group.available ? `${group.step} · ${group.title}` : `${group.step} · ${group.title} – available after step ${group.step - 1}`;
      items.push(head);
      for (const item of group.items) {
        const li = document.createElement('li');
        li.className = group.available ? 'bad' : 'dim';
        const mark = document.createElement('span');
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '●';
        li.append(mark);
        if (group.available) {
          const a = document.createElement('a');
          a.href = `#${item.field}`;
          a.dataset.field = item.field;
          a.textContent = item.text;
          li.append(a);
        } else {
          const span = document.createElement('span');
          span.textContent = item.text;
          li.append(span);
        }
        items.push(li);
      }
    }
    $('ready').replaceChildren(...items);
  }

  /** What the bar shows and does in each state (contracts/page-ui.md). */
  function barModel(session, count) {
    const status = session.run?.status;
    if (session.confirming) return { text: 'Confirmation waiting', label: 'Run', target: 'run', disabled: true };
    if (status === 'running' || status === 'stopping') return { text: $('phase').textContent || 'Running…', label: 'Stop', target: 'stop', disabled: status === 'stopping' };
    if (status === 'finished' || status === 'stopped') return { text: 'Report ready', label: 'Open report', target: 'openReport', disabled: false };
    if (count) return { text: plural(count, 'problem'), label: 'Run', target: 'run', disabled: true };
    return { text: 'Ready', label: 'Run', target: 'run', disabled: false };
  }

  function render() {
    const session = state.get();
    const { groups, count } = readiness(session);

    const key = JSON.stringify(groups.map((g) => [g.available, g.items.map((i) => i.text)]));
    if (key !== listKey) { listKey = key; buildList(groups, count); }

    const counts = $('counts');
    if (count) counts.hidden = true;
    else {
      const judge = effectiveJudgeConfig(session.config);
      const n = countRequests({ mode: 'full', rowIds: session.selection });
      const mainModel = parseParams(session.config.main.params).value?.model ?? '';
      const judgeModel = parseParams(judge.params).value?.model ?? '';
      counts.textContent = `${plural(n.main, 'main request')} to ${hostOf(session.config.main.endpoint)} (model ${mainModel}) and up to ${plural(n.judges, 'judge request')} to ${hostOf(judge.endpoint)} (model ${judgeModel}). You confirm before anything is sent.`;
      counts.hidden = false;
    }

    const status = session.run?.status;
    const badge = $('stateBadge');
    const busy = status === 'running' || status === 'stopping';
    badge.textContent = session.confirming ? 'confirm' : busy ? 'running' : count ? plural(count, 'problem') : 'ready';
    badge.className = `pill ${count && !busy ? 'mid' : 'good'}`;

    const bar = barModel(session, count);
    $('barState').textContent = bar.text;
    $('barAction').textContent = bar.label;
    $('barAction').disabled = bar.disabled;
    $('barAction').dataset.target = bar.target;
  }

  // An item of an available step moves the focus to its field.
  $('ready').addEventListener('click', (event) => {
    const link = event.target.closest('a[data-field]');
    if (!link) return;
    event.preventDefault();
    const field = $(link.dataset.field);
    if (!field) return;
    field.scrollIntoView?.({ block: 'center' });
    field.focus();
  });
  $('barState').addEventListener('click', () => $('secRes').scrollIntoView?.({ block: 'start' }));
  $('barAction').addEventListener('click', () => $($('barAction').dataset.target)?.click());

  state.subscribe(render);
  document.addEventListener('input', render);
  document.addEventListener('change', render);

  return { reset: render, render };
}
