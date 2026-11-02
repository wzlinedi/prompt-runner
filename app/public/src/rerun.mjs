// The four ways of running again, with what each would send and why one is not available (spec FR-075, FR-076,
// research R44, R48). Pure: it reads the session and decides; the view only draws the result.
import { failedRequests, failedRows, countRequests } from './runner.mjs';

export const CHOICES = [
  { id: 'all', label: 'Re-run all', mode: 'all' },
  { id: 'failedMain', label: 'Re-run failing main prompts and all related judges', mode: 'failed-main' },
  { id: 'judges', label: 'Re-run all judges', mode: 'judges-only' },
  { id: 'failedJudges', label: 'Re-run only the failing judges', mode: 'failed-judges' },
];

const hasOutput = (row) => row.main.state === 'ok' && row.main.output !== '';
const total = (counts) => counts.main + counts.judges;

const requestsText = (n) => `${n} ${n === 1 ? 'request' : 'requests'}`;

/** The line beside a choice: how many requests it would send, then, when it is unavailable, why (spec FR-076). */
export function choiceNote(choice) {
  return [requestsText(total(choice.requests)), choice.reason].filter(Boolean).join(' · ');
}

/** The ids of the rows of the last run that are still in the loaded dataset. */
export function lastRunRowIds(session) {
  const loaded = new Set((session.dataset ?? []).map((row) => row.id));
  return (session.run?.snapshot?.rowIds ?? []).filter((id) => loaded.has(id));
}

/** How many rows have something to repeat (the badge of the control). */
export function failedRowCount(session) {
  return session.run && ['finished', 'stopped'].includes(session.run.status) ? failedRows(session.run).length : 0;
}

/**
 * The four choices in their fixed order: `{ id, label, mode, requests: { main, judges }, available, reason }`.
 * The reason of an unavailable choice is the first that applies: a run in progress or a confirmation open, no run yet, and
 * then the choice's own (nothing failed, no row with an output, the rows of the last run no longer loaded).
 */
export function rerunChoices(session) {
  const { run } = session;
  const rows = run?.rows ?? [];
  const ended = Boolean(run) && ['finished', 'stopped'].includes(run.status);
  const busy = Boolean(run) && ['running', 'stopping'].includes(run.status);
  const rowIds = lastRunRowIds(session);
  const counts = {
    all: countRequests({ mode: 'full', rowIds }),
    failedMain: countRequests({ mode: 'failed-main', rows }),
    judges: countRequests({ mode: 'judges-only', rows }),
    failedJudges: countRequests({ mode: 'failed-judges', rows }),
  };
  const own = {
    all: rowIds.length ? '' : 'The rows of the last run are no longer loaded',
    failedMain: total(counts.failedMain) ? '' : 'Nothing failed',
    judges: rows.some(hasOutput) ? '' : 'No row has an output',
    failedJudges: total(counts.failedJudges) ? '' : 'Nothing failed',
  };
  const general = busy || session.confirming ? 'A run is in progress' : !run ? 'No run yet' : '';
  return CHOICES.map(({ id, label, mode }) => {
    const reason = general || own[id];
    return { id, label, mode, requests: counts[id], available: reason === '' && ended, reason };
  });
}
