import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeStrings, inspectorAddress, connectToNode } from '../accept/snapshot.mjs';

function fakeSession(snapshotText, { chunkSize = 7, fail = null } = {}) {
  const listeners = [];
  const calls = [];
  return {
    calls,
    on: (name, fn) => { listeners.push({ name, fn }); return () => listeners.splice(0, listeners.length, ...listeners.filter((l) => l.fn !== fn)); },
    send: async (method) => {
      calls.push(method);
      if (fail === method) throw new Error(`${method}: no answer`);
      if (method === 'HeapProfiler.takeHeapSnapshot') for (let i = 0; i < snapshotText.length; i += chunkSize) for (const l of listeners) if (l.name === 'HeapProfiler.addHeapSnapshotChunk') l.fn({ chunk: snapshotText.slice(i, i + chunkSize) });
      return {};
    },
  };
}

test('the chunks are joined and the strings returned; garbage is collected first', async () => {
  const text = JSON.stringify({ snapshot: {}, strings: ['a', 'the value nvapi-X'] });
  const session = fakeSession(text);
  const out = await takeStrings(session);
  assert.deepEqual(out.strings, ['a', 'the value nvapi-X']);
  assert.equal(out.bytes, text.length);
  assert.ok(session.calls.indexOf('HeapProfiler.collectGarbage') < session.calls.indexOf('HeapProfiler.takeHeapSnapshot'));
});

test('no chunk, a broken snapshot, or a failing command is a clear error', async () => {
  await assert.rejects(takeStrings(fakeSession('')), /no memory snapshot/);
  await assert.rejects(takeStrings(fakeSession('{broken')), /could not be read/);
  await assert.rejects(takeStrings(fakeSession('{"x":1}')), /no strings/);
  await assert.rejects(takeStrings(fakeSession('{}', { fail: 'HeapProfiler.takeHeapSnapshot' })), /no answer/);
});

test('the address of the process is read from its output', async () => {
  const output = 'Debugger listening on ws://127.0.0.1:41234/abc-def\nFor help, see: https://nodejs.org\n';
  assert.equal(inspectorAddress(output), 'ws://127.0.0.1:41234/abc-def');
  assert.equal(inspectorAddress('nothing'), null);
  await assert.rejects(connectToNode('nothing'), /--inspect=0/);
  const seen = [];
  const view = await connectToNode(output, { connect: async (url) => { seen.push(url); return { session: () => ({ send() {}, on() {} }), close() {} }; } });
  assert.deepEqual(seen, ['ws://127.0.0.1:41234/abc-def']);
  assert.equal(typeof view.send, 'function');
});
