// Memory snapshots for the key audit (spec FR-071, research R38): only the strings of a heap snapshot are kept, in memory,
// and nothing is written to disk. Works on a tab of the browser and on the application's own process (started with
// `--inspect=0`), because both speak the same protocol.
import { Cdp } from './cdp.mjs';

/** The strings of a heap snapshot of what `session` is attached to, after a garbage collection: `{ strings, bytes }`. */
export async function takeStrings(session, { timeoutMs = 60_000 } = {}) {
  const chunks = [];
  const stop = session.on('HeapProfiler.addHeapSnapshotChunk', (params) => chunks.push(params.chunk));
  try {
    await session.send('HeapProfiler.enable', {}, timeoutMs);
    await session.send('HeapProfiler.collectGarbage', {}, timeoutMs);
    await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false }, timeoutMs);
  } finally {
    stop();
  }
  if (chunks.length === 0) throw new Error('The browser or process gave no memory snapshot.');
  const text = chunks.join('');
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { throw new Error('The memory snapshot could not be read.'); }
  if (!Array.isArray(snapshot.strings)) throw new Error('The memory snapshot has no strings.');
  return { strings: snapshot.strings, bytes: text.length };
}

/** The debugging address a Node process printed in its output ("Debugger listening on ws://…"); null when it has not yet. */
export function inspectorAddress(output) {
  return /Debugger listening on (ws:\/\/\S+)/.exec(output)?.[1] ?? null;
}

/** Connects to the application's process; resolves with a session-like view (`send`, `on`). */
export async function connectToNode(output, { connect = (url) => Cdp.connect(url) } = {}) {
  const url = inspectorAddress(output);
  if (!url) throw new Error('The application printed no debugging address (was it started with --inspect=0?).');
  const cdp = await connect(url);
  return { ...cdp.session(undefined), close: () => cdp.close() };
}
