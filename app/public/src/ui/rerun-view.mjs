// The re-run control: one disclosure with the four ways of running again, in the run panel and in the toolbar of the
// report (spec FR-075, FR-076, research R44). What each choice would send and why it is not available comes from
// rerun.mjs; this module only draws it and reports a choice. It holds no key and shows no endpoint.
import { rerunChoices, failedRowCount, choiceNote } from '../rerun.mjs';

export function mountRerunView({ state, onChoose }) {
  const $ = (id) => document.getElementById(id);
  const boxes = [{ el: $('rerunBox'), fromReport: false, open: false, signature: '' }, { el: $('rvRerunBox'), fromReport: true, open: false, signature: '' }];

  function build(box, choices, failed) {
    const details = document.createElement('details');
    details.className = 'rerun';
    details.open = box.open;
    details.addEventListener('toggle', () => { box.open = details.open; });
    const summary = document.createElement('summary');
    summary.textContent = 'Re-run';
    if (failed) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${failed} failed ${failed === 1 ? 'row' : 'rows'}`;
      summary.append(' ', badge);
    }
    const list = document.createElement('ul');
    list.className = 'rerunlist';
    choices.forEach((choice) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rerun = choice.id;
      button.textContent = choice.label;
      button.disabled = !choice.available;
      const hint = document.createElement('span');
      hint.className = 'why';
      hint.id = `${box.el.id}-${choice.id}-note`;
      hint.textContent = choiceNote(choice);
      button.setAttribute('aria-describedby', hint.id);
      item.append(button, hint);
      list.append(item);
    });
    details.append(summary, list);
    box.el.replaceChildren(details);
    box.details = details;
  }

  /** Draws both places; a place whose content did not change is left alone, so that an open list and the focus stay. */
  function render() {
    const session = state.get();
    const choices = rerunChoices(session);
    const failed = failedRowCount(session);
    const signature = JSON.stringify([choices.map((c) => [c.id, c.available, c.reason, c.requests]), failed]);
    for (const box of boxes) {
      if (box.signature === signature) continue;
      const hadFocus = box.el.contains(document.activeElement) && document.activeElement.dataset?.rerun;
      box.signature = signature;
      build(box, choices, failed);
      if (hadFocus) box.el.querySelector(`[data-rerun="${hadFocus}"]`)?.focus();
    }
  }

  for (const box of boxes) {
    box.el.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-rerun]');
      if (!button || button.disabled) return;
      const choice = rerunChoices(state.get()).find((c) => c.id === button.dataset.rerun);
      if (!choice?.available) return;
      box.open = false;
      if (box.details) box.details.open = false;
      onChoose(choice, box.fromReport);
    });
    // Escape closes the list and returns the focus to its summary.
    box.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !box.details?.open) return;
      event.preventDefault();
      box.details.open = false;
      box.details.querySelector('summary').focus();
    });
  }
  state.subscribe(render);
  render();

  return { render, reset() { for (const box of boxes) { box.open = false; box.signature = ''; } render(); } };
}
