// Step 4 of the page: endpoint, key, and parameters JSON for the main prompt and (optionally) the judges.
// Keys are masked, live in the session state only, and are emptied on screen by clearKeysInView().
import { keyHint, describeParams } from '../config.mjs';

export function mountConfigView({ state }) {
  const $ = (id) => document.getElementById(id);
  const fields = [
    ['mainEp', 'main', 'endpoint'], ['mainKey', 'main', 'apiKey'], ['main_json', 'main', 'params'],
    ['judgeEp', 'judge', 'endpoint'], ['judgeKey', 'judge', 'apiKey'], ['judge_json', 'judge', 'params'],
  ];

  function render() {
    const { config } = state.get();
    $('judgeFields').hidden = config.judge.sameAsMain;
    $('keyHint').textContent = keyHint(config.main.apiKey) || (config.judge.sameAsMain ? '' : keyHint(config.judge.apiKey));
    badge('mainJsonBadge', config.main.params);
    badge('judgeJsonBadge', config.judge.params);
  }

  /** The badge next to a parameters field: valid and the model it names, or what is wrong (spec FR-053). */
  function badge(id, text) {
    const described = describeParams(text);
    $(id).textContent = described.ok ? `valid · ${described.model}` : described.problem;
    $(id).className = `pill ${described.ok ? 'good' : 'low'}`;
  }

  for (const [id, block, name] of fields) {
    $(id).addEventListener('input', () => {
      state.get().config[block][name] = $(id).value; // keystrokes change the session without a full notification
      render();
    });
  }
  $('sameModel').addEventListener('change', () => {
    state.get().config.judge.sameAsMain = $('sameModel').checked;
    render();
  });

  state.subscribe(render);

  return {
    /** Fills the inputs from the session (also after New Session). */
    reset() {
      const { config } = state.get();
      for (const [id, block, name] of fields) $(id).value = config[block][name];
      $('sameModel').checked = config.judge.sameAsMain;
      render();
    },
    /** Empties the key inputs on screen; the state's keys are emptied by state.clearKeys(). */
    clearKeysInView() {
      $('mainKey').value = '';
      $('judgeKey').value = '';
      $('keyHint').textContent = '';
    },
  };
}
