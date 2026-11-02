// A minimal client of the Chrome DevTools protocol over Node's built-in WebSocket (spec FR-060, research R30).
// Commands are numbered and answered one by one; events are delivered to listeners; a session (one tab) is a view of the
// same connection that tags its commands and events with the session id ("flat" sessions).

export class Cdp {
  #ws;
  #next = 1;
  #pending = new Map();
  #listeners = [];
  #closed = false;

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (event) => this.#receive(event.data));
    ws.addEventListener('close', () => this.#shutdown(new Error('The browser connection was closed.')));
    ws.addEventListener('error', () => this.#shutdown(new Error('The browser connection failed.')));
  }

  /** Opens the connection; `WebSocketImpl` is replaced by a fake in the unit tests. */
  static connect(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 10_000 } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocketImpl(url);
      const timer = setTimeout(() => reject(new Error(`No answer from the browser at ${url} within ${timeoutMs} ms.`)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new Cdp(ws)); });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Could not connect to the browser at ${url}.`)); });
    });
  }

  #receive(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.id !== undefined) {
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      this.#pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}${message.error.data ? ` (${message.error.data})` : ''}`));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method) for (const listener of [...this.#listeners]) listener(message);
  }

  #shutdown(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.#pending.clear();
  }

  /** Sends one command; resolves with its result or rejects with the protocol error or after `timeoutMs`. */
  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    if (this.#closed) return Promise.reject(new Error('The browser connection is closed.'));
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Listens to events (of one session, or of the browser itself when `sessionId` is left out); returns the function that stops it. */
  on(name, listener, sessionId) {
    const wrapped = (message) => {
      if (message.method === name && (sessionId === undefined || message.sessionId === sessionId)) listener(message.params ?? {}, message);
    };
    this.#listeners.push(wrapped);
    return () => { this.#listeners = this.#listeners.filter((l) => l !== wrapped); };
  }

  /** Resolves with the params of the first event of that name for which `predicate` is true. */
  waitFor(name, predicate = () => true, { timeoutMs = 10_000, sessionId } = {}) {
    return new Promise((resolve, reject) => {
      const stop = this.on(name, (params) => { if (predicate(params)) { clearTimeout(timer); stop(); resolve(params); } }, sessionId);
      const timer = setTimeout(() => { stop(); reject(new Error(`Waited ${timeoutMs} ms for ${name}.`)); }, timeoutMs);
    });
  }

  /** The same connection, with every command and event tagged with the session of one tab. */
  session(sessionId) {
    return {
      id: sessionId,
      send: (method, params, timeoutMs) => this.send(method, params, sessionId, timeoutMs),
      on: (name, listener) => this.on(name, listener, sessionId),
      waitFor: (name, predicate, options) => this.waitFor(name, predicate, { ...options, sessionId }),
    };
  }

  close() {
    this.#shutdown(new Error('closed'));
    try { this.#ws.close(); } catch { /* already closed */ }
  }
}
