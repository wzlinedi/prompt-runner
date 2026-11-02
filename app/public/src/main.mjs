// Wires the sections of the page together. All data lives in the in-memory session state.
import { createState } from './state.mjs';
import { mountDatasetView } from './ui/dataset-view.mjs';
import { mountPromptsView } from './ui/prompts-view.mjs';
import { mountConfigView } from './ui/config-view.mjs';
import { mountRunView } from './ui/run-view.mjs';
import { mountReportView } from './ui/report-view.mjs';
import { mountChromeView } from './ui/chrome-view.mjs';
import { mountPanelView } from './ui/panel-view.mjs';
import { mountRerunView } from './ui/rerun-view.mjs';

const $ = (id) => document.getElementById(id);
const state = createState();
const relayToken = document.querySelector('meta[name="relay-token"]')?.getAttribute('content') ?? '';
const views = [];

/** Which sections are shown follows the session: steps unlock one after the other. */
function applyVisibility(session) {
  $('startScreen').hidden = session.started;
  $('app').hidden = !session.started;
  $('sessionBar').hidden = !session.started; // the header band, with the one New Session button, serves the form and the report
  const hasData = Boolean(session.dataset);
  for (const id of ['secMain', 'secJudge']) $(id).hidden = !hasData;
  // Step 4 (the keys) stays reachable while a run or results exist, whatever step 1 shows, e.g. after a dataset that
  // failed to load (spec FR-043). The run panel (step 5) is part of the page from the start: it lists what is missing.
  $('secCfg').hidden = !(hasData || session.run);
}
state.subscribe(applyVisibility);

/** New Session: everything starts empty (spec FR-001, FR-002). */
function startSession() {
  state.reset();
  for (const view of views) view.reset?.();
  state.set({ started: true });
}

$('newSession').onclick = startSession;
$('newSession2').onclick = () => {
  const session = state.get();
  if (session.dataset || session.run) $('resetConfirm').hidden = false; // warns about unexported results
  else startSession();
};
$('resetYes').onclick = () => { $('resetConfirm').hidden = true; startSession(); $('newSession2').focus(); };
$('resetNo').onclick = () => { $('resetConfirm').hidden = true; $('newSession2').focus(); }; // Cancel changes nothing (spec FR-077)

views.push(mountDatasetView({ state }));
const promptsView = mountPromptsView({ state });
views.push(promptsView);
const configView = mountConfigView({ state });
views.push(configView);
const reportView = mountReportView({ state });
views.push(reportView);
views.push(mountChromeView({ state }));
const panelView = mountPanelView({ state });
views.push(panelView);
// Progress changes the run without notifying the session; the panel and the bottom bar follow it.
let rerunView = null;
const onRunUpdate = (run, options) => { reportView.update(run, options); panelView.render(); rerunView?.render(); };
const runView = mountRunView({ state, relayToken, configView, onRunUpdate });
views.push(runView);
// A choice made in the report leads to the form (the keys are typed there), then continues as in the run panel (research R47).
rerunView = mountRerunView({ state, onChoose: (choice, fromReport) => { if (fromReport) reportView.close(); runView.choose(choice.mode); } });
views.push(rerunView);
for (const view of views) view.reset?.();
applyVisibility(state.get());

export { state, relayToken, reportView };
