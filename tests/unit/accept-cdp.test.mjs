// The DevTools client of the acceptance walk-through, against a fake WebSocket (spec FR-058, research R30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cdp } from '../accept/cdp.mjs';

class FakeSocket {
  static last = null;
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.handlers = {};
    FakeSocket.last = this;
    setImmediate(() => this.emit('open', {}));
  }
  addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
  emit(name, event) { for (const fn of this.handlers[name] ?? []) fn(event); }
  send(text) { this.sent.push(JSON.parse(text)); }
  serverSays(object) { this.emit('message', { data: JSON.stringify(object) }); }
  close() { this.emit('close', {}); }
}

const connect = () => Cdp.connect('ws://fake/devtools', { WebSocketImpl: FakeSocket });

test('a command is answered by the answer with its number; an error answer rejects with the protocol message', async () => {
  const cdp = await connect();
  const ws = FakeSocket.last;
  const a = cdp.send('Page.enable');
  const b = cdp.send('Runtime.evaluate', { expression: '1' });
  assert.deepEqual(ws.sent.map((m) => [m.id, m.method]), [[1, 'Page.enable'], [2, 'Runtime.evaluate']]);
  ws.serverSays({ id: 2, result: { value: 42 } });
  ws.serverSays({ id: 1, error: { message: 'not allowed', data: 'because' } });
  assert.deepEqual(await b, { value: 42 });
  await assert.rejects(a, /Page\.enable: not allowed \(because\)/);
});

test('events reach the listeners of their name and session; a listener can be stopped', async () => {
  const cdp = await connect();
  const ws = FakeSocket.last;
  const seen = [];
  const stop = cdp.on('Page.loadEventFired', (params) => seen.push(['any', params.t]));
  cdp.on('Page.loadEventFired', (params) => seen.push(['s1', params.t]), 's1');
  ws.serverSays({ method: 'Page.loadEventFired', params: { t: 1 }, sessionId: 's1' });
  ws.serverSays({ method: 'Page.loadEventFired', params: { t: 2 }, sessionId: 's2' });
  ws.serverSays({ method: 'Other.event', params: { t: 3 } });
  stop();
  ws.serverSays({ method: 'Page.loadEventFired', params: { t: 4 }, sessionId: 's1' });
  assert.deepEqual(seen, [['any', 1], ['s1', 1], ['any', 2], ['s1', 4]]); // after stop() only the listener of the session remains
});

test('a session tags its commands and only hears its own events', async () => {
  const cdp = await connect();
  const ws = FakeSocket.last;
  const tab = cdp.session('S-1');
  const answer = tab.send('Page.navigate', { url: 'x' });
  assert.equal(ws.sent[0].sessionId, 'S-1');
  ws.serverSays({ id: 1, result: {} });
  await answer;
  const heard = [];
  tab.on('Page.frameNavigated', (p) => heard.push(p.n));
  ws.serverSays({ method: 'Page.frameNavigated', params: { n: 1 }, sessionId: 'S-1' });
  ws.serverSays({ method: 'Page.frameNavigated', params: { n: 2 }, sessionId: 'S-2' });
  assert.deepEqual(heard, [1]);
});

test('waitFor resolves on the first event that fits and times out otherwise', async () => {
  const cdp = await connect();
  const ws = FakeSocket.last;
  const wanted = cdp.waitFor('Browser.downloadProgress', (p) => p.state === 'completed', { timeoutMs: 500 });
  ws.serverSays({ method: 'Browser.downloadProgress', params: { state: 'inProgress' } });
  ws.serverSays({ method: 'Browser.downloadProgress', params: { state: 'completed', guid: 'g' } });
  assert.deepEqual(await wanted, { state: 'completed', guid: 'g' });
  await assert.rejects(cdp.waitFor('Never.happens', () => true, { timeoutMs: 20 }), /Waited 20 ms for Never\.happens/);
});

test('a command without an answer times out; closing the connection rejects the commands that wait', async () => {
  const cdp = await connect();
  await assert.rejects(cdp.send('Slow.command', {}, undefined, 20), /no answer within 20 ms/);
  const waiting = cdp.send('Another.command');
  FakeSocket.last.close();
  await assert.rejects(waiting, /connection was closed/);
  await assert.rejects(cdp.send('After.close'), /closed/);
});

test('the connection fails with a readable message when the browser is not there', async () => {
  class Refusing { constructor() { setImmediate(() => this.handlers.error?.forEach((f) => f({}))); this.handlers = {}; } addEventListener(n, f) { (this.handlers[n] ??= []).push(f); } }
  await assert.rejects(Cdp.connect('ws://nowhere', { WebSocketImpl: Refusing }), /Could not connect to the browser at ws:\/\/nowhere/);
});
