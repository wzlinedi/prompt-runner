// In-memory session state with change notifications. Nothing here is ever written to a database, file,
// cookie, or browser storage (spec FR-029); API keys live in the two `apiKey` fields only.
import {
  DEFAULT_ENDPOINT, DEFAULT_MAIN_PROMPT, DEFAULT_MAIN_JSON, DEFAULT_JUDGE_JSON, jsonText,
  DEFAULT_ACCURACY_PROMPT, DEFAULT_COMPLETENESS_PROMPT,
} from './defaults.mjs';

/** A fresh, empty session (data-model: Session). */
export function freshSession() {
  return {
    started: false,
    dataset: null,            // array of { id, name, promptInput, expectedResult } or null
    selection: [],            // ids of the rows to run
    prompts: { main: DEFAULT_MAIN_PROMPT, accuracy: DEFAULT_ACCURACY_PROMPT, completeness: DEFAULT_COMPLETENESS_PROMPT },
    config: {
      main: { endpoint: DEFAULT_ENDPOINT, apiKey: '', params: jsonText(DEFAULT_MAIN_JSON) },
      judge: { sameAsMain: true, endpoint: DEFAULT_ENDPOINT, apiKey: '', params: jsonText(DEFAULT_JUDGE_JSON) },
    },
    run: null,                // the latest run, see runner.mjs
    exportedSinceChange: true,
    confirming: false,        // a confirmation is open: steps 1-4 are locked (spec FR-039)
  };
}

export function createState() {
  let session = freshSession();
  const listeners = new Set();
  const notify = () => { for (const listener of [...listeners]) listener(session); };
  return {
    get: () => session,
    /** Shallow-merges a patch into the session and notifies. */
    set(patch) { session = { ...session, ...patch }; notify(); },
    /** Lets a function change the session object in place, then notifies. */
    update(mutator) { mutator(session); notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Back to the empty state (New Session). */
    reset() { session = freshSession(); notify(); },
    /** Empties every API key field and nothing else (spec FR-016). */
    clearKeys() { session.config.main.apiKey = ''; session.config.judge.apiKey = ''; notify(); },
  };
}
