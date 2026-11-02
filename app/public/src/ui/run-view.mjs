// Run and Stop: the blocking checks, the confirmation before anything is sent, the progress, and the
// clearing of the keys when the run is over (spec FR-013, FR-015 – FR-018, FR-020).
import { effectiveJudgeConfig, parseParams, sendsUnencrypted } from '../config.mjs';
import { startRun, countRequests, failedRequests } from '../runner.mjs';
import { lastRunRowIds } from '../rerun.mjs';
import { callChat } from '../chat.mjs';
import { blockingProblems, judgeRerunProblems, failedRerunProblems } from '../problems.mjs';

// The checks live in problems.mjs (pure); they are re-exported for the existing callers and tests.
export { blockingProblems, judgeRerunProblems, failedRerunProblems };

/**
 * The modes of the page: `full` (Run), `all` (Re-run all: a full run on the rows of the last run), `judges-only`,
 * `failed-main`, and `failed-judges` (spec FR-075). For `all` the session that is checked and frozen has the rows of the
 * last run as its selection, so that the selection on the form does not decide what runs.
 */
const startsFullRun = (mode) => mode === 'full' || mode === 'all';
const effectiveSession = (session, mode) => (mode === 'all' ? { ...session, selection: lastRunRowIds(session) } : session);

/** The blocking problems of the action that a confirmation belongs to (spec FR-039: checked again when confirming). */
function problemsFor(session, mode) {
  if (startsFullRun(mode)) return blockingProblems(effectiveSession(session, mode));
  if (mode === 'judges-only') return judgeRerunProblems(session);
  return failedRerunProblems(session, mode);
}

/** The field to take the focus when a re-run is blocked by a missing key: the one of the block that is named in the message. */
function keyFieldFor(problems) {
  const key = problems.find((text) => /API key/.test(text));
  if (!key) return null;
  return /^LLM as Judge/.test(key) ? 'judgeKey' : 'mainKey';
}

/** One line per endpoint in `endpoints` that uses plain http outside this computer (spec FR-044); never blocks. */
export function unencryptedLines(endpoints) {
  return [...new Set(endpoints.map((endpoint) => endpoint.trim()))]
    .filter(sendsUnencrypted)
    .map((endpoint) => `Warning: ${endpoint} uses unencrypted http, so the key and the data travel unencrypted.`);
}

/** The copy a confirmation describes and a run uses (spec FR-039): later edits of the page do not reach it. */
export function freezeSession(session) {
  return {
    dataset: structuredClone(session.dataset),
    selection: [...session.selection],
    prompts: { ...session.prompts },
    config: structuredClone(session.config),
    run: session.run,
  };
}

/** True when the live session still holds exactly what the frozen copy holds. */
export function sameInputs(session, frozen) {
  const pick = (x) => JSON.stringify({ dataset: x.dataset, selection: x.selection, prompts: x.prompts, config: x.config });
  return pick(session) === pick(frozen);
}

const realDeps = (relayToken) => ({
  ask: (call) => callChat({ ...call, relayToken }),
  sleep: (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  }),
  now: () => performance.now(),
  date: () => Date.now(),
});

export function mountRunView({ state, relayToken, configView, onRunUpdate, deps = realDeps(relayToken) }) {
  const $ = (id) => document.getElementById(id);
  const LOCKED = ['secData', 'secMain', 'secJudge', 'cfgFields'];
  let handle = null;
  let plan = null;          // { mode, rowIds, frozen } while a confirmation is open; holds keys, so it is dropped as soon as it is not needed
  let activeToken = null;   // identifies the run that may still update the page (a run abandoned by New Session must not)
  let opener = null;        // the control that opened the confirmation; the focus returns to it on Cancel

  const isBusy = () => Boolean(handle) && ['running', 'stopping'].includes(state.get().run?.status);

  /** Run is available when nothing blocks it, no run is in progress, and no confirmation is open (spec FR-052). */
  function refreshButtons(busy = isBusy()) {
    const { confirming } = state.get();
    $('run').disabled = busy || confirming || blockingProblems(state.get()).length > 0;
    $('stop').disabled = !busy;
  }

  /** While a confirmation is open, steps 1–4 cannot be edited (spec FR-039): only Confirm and Cancel act. */
  function setConfirming(on) {
    for (const id of LOCKED) { $(id).inert = on; $(id).classList.toggle('locked', on); }
    $('lockNote').hidden = !on;
    state.update((s) => { s.confirming = on; });
    refreshButtons();
  }

  function closeConfirmation() {
    plan = null;
    $('runConfirm').hidden = true;
    $('confirmText').textContent = '';
    if (state.get().confirming) setConfirming(false);
    // The focus goes back to what opened the confirmation, so that a keyboard user continues where they were.
    if (opener && document.contains(opener) && !opener.disabled && !opener.hidden) opener.focus();
    opener = null;
  }

  /** What the user is asked to confirm: counts per endpoint, models, data sent, relay, cost. */
  function failedConfirmationText(session, mode) {
    const run = session.run;
    const list = failedRequests(run.rows, mode === 'failed-main' ? 'main' : 'judges');
    const counts = countRequests({ mode, rows: run.rows });
    const judgeShared = run.snapshot.judgeSameAsMain;
    const judgeEndpoint = (judgeShared ? session.config.main : session.config.judge).endpoint.trim();
    const { models } = run.snapshot;
    const lines = list.map((request) => `• ${request.rowId} – ${request.name}: ${request.part === 'main' ? 'main prompt' : request.part}`);
    return [
      `Please confirm before anything is sent. Only the ${list.length === 1 ? 'request' : 'requests'} that failed will be sent (${list.length}); requests that succeeded are not repeated.`,
      ...lines,
      ...(counts.main ? [`Main prompt: ${counts.main} ${counts.main === 1 ? 'request' : 'requests'} to ${session.config.main.endpoint.trim()} (archived model ${models.main}). Each request contains the main prompt of the original run with the prompt input of one failed row.`] : []),
      ...(counts.judges ? [`Judges: up to ${counts.judges} ${counts.judges === 1 ? 'request' : 'requests'} to ${judgeEndpoint} (archived model ${models.judges}). Each request contains the current judge prompt, the prompt input of the row, and the main prompt's answer.`] : []),
      'The main prompt, models, and parameters of the original run are used; the judge requests use the current text of the judge prompts (a changed main prompt takes effect only in a new run). The endpoints and keys are the current ones.',
      ...unencryptedLines([...(counts.main ? [session.config.main.endpoint] : []), ...(counts.judges ? [judgeEndpoint] : [])]),
      'The requests go through the local relay on this computer, which only passes them on and keeps nothing. The expected result is never sent.',
      'The requests may incur costs with the provider.',
    ].join('\n');
  }

  function rerunConfirmationText(session) {
    const counts = countRequests({ mode: 'judges-only', rows: session.run.rows });
    const judge = effectiveJudgeConfig(session.config);
    const model = parseParams(judge.params).value.model;
    return [
      'Please confirm before anything is sent. Only the judges will run again; the main prompt is not called and the answers stay as they are. To repeat only the requests that ended with an error, use "Re-run only the failing judges" or "Re-run failing main prompts and all related judges" instead.',
      `Judges: ${counts.judges} requests to ${judge.endpoint.trim()} (model ${model}). Each request contains a judge prompt, the prompt input of the row, and the stored answer of the main prompt.`,
      judge.sameAsMain ? 'The judges use the same endpoint, key, and model as the main prompt, so the key of the main prompt is needed.' : 'The judges use their own endpoint, key, and parameters.',
      ...unencryptedLines([judge.endpoint]),
      'The requests go through the local relay on this computer, which only passes them on and keeps nothing. The expected result is never sent.',
      'The requests may incur costs with the provider.',
    ].join('\n');
  }

  function confirmationText(session, rowIds, mode = 'full') {
    const counts = countRequests({ mode: 'full', rowIds });
    const judge = effectiveJudgeConfig(session.config);
    const mainModel = parseParams(session.config.main.params).value.model;
    const judgeModel = parseParams(judge.params).value.model;
    const total = session.dataset.length;
    const again = mode === 'all' ? 'Re-run all: the rows of the last run are run again with the settings that are on the form now, and the current report is replaced. ' : '';
    const rowsLine = total > rowIds.length
      ? `${again}${rowIds.length} of ${total} rows in the dataset ${mode === 'all' ? 'will run' : 'are selected and will run'}.`
      : `${again}${rowIds.length} ${rowIds.length === 1 ? 'row' : 'rows'} will run.`;
    return [
      'Please confirm before anything is sent.',
      rowsLine,
      `Main prompt: ${counts.main} ${counts.main === 1 ? 'request' : 'requests'} to ${session.config.main.endpoint.trim()} (model ${mainModel}). Each request contains the main prompt with the prompt input of one row.`,
      `Judges: up to ${counts.judges} requests to ${judge.endpoint.trim()} (model ${judgeModel}). Each request contains a judge prompt, the prompt input of the row, and the main prompt's answer.`,
      ...unencryptedLines([session.config.main.endpoint, judge.endpoint]),
      'The requests go through the local relay on this computer, which only passes them on and keeps nothing. The expected result is never sent.',
      'The requests may incur costs with the provider.',
    ].join('\n');
  }

  const textFor = ({ mode, rowIds, frozen }) => (startsFullRun(mode) ? confirmationText(frozen, rowIds, mode)
    : mode === 'judges-only' ? rerunConfirmationText(frozen) : failedConfirmationText(frozen, mode));

  function showProgress(run) {
    const { name, done, total } = run.phase;
    const percent = (a, b) => `${b ? Math.round((a / b) * 100) : 100}%`;
    if (name === 'main') {
      $('prog').style.width = percent(done, total);
      $('prog2').style.width = '0%';
      $('phase').textContent = run.status === 'stopping' ? 'Stopping…' : `Phase 1/2: main prompt – ${done} of ${total} rows done.`;
    } else {
      $('prog').style.width = '100%';
      $('prog2').style.width = percent(done, total);
      $('phase').textContent = run.status === 'stopping' ? 'Stopping…' : `Phase 2/2: judges – ${done} of ${total} requests done.`;
    }
  }

  function showFinal(run) {
    if (run.status === 'finished') {
      $('prog').style.width = '100%';
      $('prog2').style.width = '100%';
      $('phase').textContent = 'Finished.';
    } else {
      $('phase').textContent = 'Stopped. Rows that did not finish are marked "not run".';
    }
    $('resMsg').textContent = run.failure ?? '';
  }

  const messageFor = (mode, problems) => {
    const target = mode === 'full' ? 'runMsg' : 'resMsg';
    $(target).textContent = `${mode === 'full' ? 'Run' : 'Re-run'} blocked: ${problems.join(' ')}`;
    // A re-run that lacks only the key leads the user to the field (spec FR-076, research R47).
    const field = mode === 'full' ? null : keyFieldFor(problems);
    if (field && $(field)) { $(field).scrollIntoView?.({ block: 'center' }); $(field).focus({ preventScroll: true }); }
  };

  /** The rows a full run covers: the selection (Run) or the rows of the last run (Re-run all); none for the other modes. */
  const planRows = (session, mode) => (mode === 'full' ? [...session.selection] : mode === 'all' ? lastRunRowIds(session) : null);

  /** Checks the action, then shows what it will send and locks steps 1–4 until the user confirms or cancels. */
  function openConfirmation(mode) {
    const session = state.get();
    $('runMsg').textContent = '';
    $('resMsg').textContent = '';
    const problems = problemsFor(session, mode);
    if (problems.length) { messageFor(mode, problems); return; }
    plan = { mode, rowIds: planRows(session, mode), frozen: freezeSession(effectiveSession(session, mode)) };
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    $('confirmText').textContent = textFor(plan);
    $('runConfirm').hidden = false;
    setConfirming(true);
    // The confirmation takes the focus (the opener is locked or disabled now): the next Tab reaches "Confirm and send".
    $('runConfirm').setAttribute('tabindex', '-1');
    $('runConfirm').focus({ preventScroll: true });
    $('runConfirm').scrollIntoView?.({ block: 'nearest' });
  }

  $('run').addEventListener('click', () => openConfirmation('full'));

  $('confirmNo').addEventListener('click', closeConfirmation);

  $('confirmYes').addEventListener('click', () => {
    if (!plan) return;
    const session = state.get();
    const { mode, rowIds, frozen } = plan;
    // The checks run again now (spec FR-039): something may have changed since the confirmation was shown.
    const problems = problemsFor(session, mode);
    if (problems.length) { closeConfirmation(); messageFor(mode, problems); return; }
    if (!sameInputs(effectiveSession(session, mode), frozen)) {
      // Not what was disclosed any more: nothing is sent; the confirmation is shown again from the current form.
      plan = { mode, rowIds: planRows(session, mode), frozen: freezeSession(effectiveSession(session, mode)) };
      $('confirmText').textContent = `The form changed while this confirmation was open, so nothing was sent. Please read it again.\n\n${textFor(plan)}`;
      return;
    }
    const token = {};
    activeToken = token;
    const request = plan;
    plan = null;
    $('runConfirm').hidden = true;
    $('confirmText').textContent = '';
    setConfirming(false);
    $('resMsg').textContent = '';
    handle = startRun({
      dataset: request.frozen.dataset,
      rowIds: request.rowIds,
      previous: startsFullRun(mode) ? null : session.run,
      prompts: request.frozen.prompts,
      config: request.frozen.config,
      mode: startsFullRun(mode) ? 'full' : mode,
      deps,
      clearKeys: () => { if (activeToken !== token) return; state.clearKeys(); configView.clearKeysInView(); },
      onUpdate: (run) => { if (activeToken !== token) return; showProgress(run); onRunUpdate(run); },
    });
    request.frozen = null;
    opener = null;
    refreshButtons(true);
    $('stop').focus(); // the confirmation is gone; Stop is the control to reach next
    state.update((s) => { s.run = handle.run; s.exportedSinceChange = false; });
    const current = handle;
    current.done.then((run) => {
      if (handle !== current || activeToken !== token) return; // a new session replaced this run
      refreshButtons(false);
      showFinal(run);
      state.update((s) => { s.exportedSinceChange = false; });
      onRunUpdate(run, { final: true });
    });
  });

  $('stop').addEventListener('click', () => handle?.stop());
  // Run follows what blocks it, also while the user types (some fields change the session without a notification).
  const refresh = () => refreshButtons();
  state.subscribe(refresh);
  document.addEventListener('input', refresh);
  document.addEventListener('change', refresh);

  return {
    /** Starts a way of running (`full`, `all`, `judges-only`, `failed-main`, `failed-judges`): the checks, then the confirmation. */
    choose: openConfirmation,
    /** New Session: stop whatever runs, drop any open confirmation, and clear the messages. */
    reset() {
      const old = handle;
      handle = null;
      activeToken = null;
      old?.stop();
      plan = null;
      $('runConfirm').hidden = true;
      $('confirmText').textContent = '';
      for (const id of LOCKED) { $(id).inert = false; $(id).classList.remove('locked'); }
      $('lockNote').hidden = true;
      refreshButtons(false);
      for (const id of ['runMsg', 'resMsg', 'phase']) $(id).textContent = '';
      $('prog').style.width = '0%';
      $('prog2').style.width = '0%';
    },
  };
}
