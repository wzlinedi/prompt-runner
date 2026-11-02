import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../../app/server.mjs';

const logs = [];
const servers = [];
const start = async (options = {}) => {
  const server = await startServer({ port: 0, log: (line) => logs.push(line), ...options });
  servers.push(server);
  return server;
};
after(async () => { for (const s of servers) await s.close(); });

/** A raw request, so that paths and headers are sent exactly as given (fetch normalises them). */
function raw(server, { path = '/', method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET / returns the page with the token the server was started with', async () => {
  const server = await start({ token: 'TEST-TOKEN-123' });
  const res = await fetch(server.url);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<meta name="relay-token" content="TEST-TOKEN-123">/);
  assert.ok(!html.includes('__RELAY_TOKEN__'));
  assert.equal(server.token, 'TEST-TOKEN-123');
});

test('the token changes at every start when none is given', async () => {
  const a = await start();
  const b = await start();
  assert.notEqual(a.token, b.token);
  assert.ok(a.token.length >= 32);
  const html = await (await fetch(a.url)).text();
  assert.ok(html.includes(a.token) && !html.includes(b.token));
});

test('static files are served with the right type and are never cached', async () => {
  const server = await start();
  const css = await fetch(`${server.url}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const mod = await fetch(`${server.url}/src/placeholders.mjs`);
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /text\/javascript/, 'ES modules need a JavaScript MIME type');
  assert.equal(mod.headers.get('cache-control'), 'no-store');
  assert.match(await mod.text(), /export function checkPrompt/);
  const main = await fetch(`${server.url}/src/main.mjs`);
  assert.equal(main.status, 200, 'the page entry module is served');
  assert.match(main.headers.get('content-type'), /text\/javascript/);
});

test('an unknown path gives 404', async () => {
  const server = await start();
  assert.equal((await fetch(`${server.url}/nope`)).status, 404);
  assert.equal((await fetch(`${server.url}/src/missing.mjs`)).status, 404);
  assert.equal((await fetch(`${server.url}/package.json`)).status, 404);
});

test('path traversal attempts give 404', async () => {
  const server = await start();
  for (const p of ['/../app/server.mjs', '/%2e%2e/app/server.mjs', '/src/../../server.mjs', '/src/%2e%2e/%2e%2e/server.mjs',
    '/src/..%2f..%2fserver.mjs', '/src/%2e%2e%5c%2e%2e%5cserver.mjs', '/src/\\..\\..\\server.mjs', '/src/x%00.mjs']) {
    const res = await raw(server, { path: p });
    assert.equal(res.status, 404, `${p} must not be served`);
    assert.ok(!res.body.includes('startServer'), `${p} must not leak source`);
  }
});

test('only the loopback names with the right port are accepted as Host', async () => {
  const server = await start();
  assert.equal((await raw(server, { headers: { Host: `127.0.0.1:${server.port}` } })).status, 200);
  assert.equal((await raw(server, { headers: { Host: `localhost:${server.port}` } })).status, 200);
  assert.equal((await raw(server, { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await raw(server, { headers: { Host: `evil.example:${server.port}` } })).status, 403);
  assert.equal((await raw(server, { headers: { Host: `127.0.0.1:${server.port + 1}` } })).status, 403);
});

test('the server listens on 127.0.0.1 only', async () => {
  const server = await start();
  assert.equal(server.address.address, '127.0.0.1');
  assert.ok(server.url.startsWith('http://127.0.0.1:'));
});

test('methods other than GET and HEAD are refused for pages', async () => {
  const server = await start();
  assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
});

test('the access log has only time, method, path, status, duration', async () => {
  logs.length = 0;
  const server = await start();
  await fetch(`${server.url}/styles.css?secret=SECRET-QUERY&key=nvapi-ABCDEF`, { headers: { 'X-Secret': 'SECRET-HEADER' } });
  await fetch(`${server.url}/nope`);
  await server.close();
  const mine = logs.filter((l) => l.includes('/styles.css') || l.includes('/nope'));
  assert.equal(mine.length, 2);
  for (const line of mine) {
    assert.match(line, /^\d{4}-\d\d-\d\dT[\d:.]+Z (GET) \/\S+ \d{3} \d+ms$/);
    assert.ok(!/SECRET|nvapi/.test(line), 'no query string, header, or key in the log');
  }
  assert.match(mine[0], / GET \/styles\.css 200 /);
  assert.match(mine[1], / GET \/nope 404 /);
});

test('extra files and page scripts are available to tests only through the programmatic options', async () => {
  const server = await start({ extraFiles: { '/__e2e/x.mjs': 'export const x = 1;' }, pageScripts: ['/__e2e/x.mjs'] });
  const html = await (await fetch(server.url)).text();
  assert.match(html, /<script type="module" src="\/__e2e\/x\.mjs"><\/script>\s*<\/body>/);
  const res = await fetch(`${server.url}/__e2e/x.mjs`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
  assert.equal(await res.text(), 'export const x = 1;');
  const plain = await start();
  assert.ok(!(await (await fetch(plain.url)).text()).includes('__e2e'));
  assert.equal((await fetch(`${plain.url}/__e2e/x.mjs`)).status, 404);
});

test('every response carries the security headers: page, script, style, API, errors, 404 (spec FR-046)', async () => {
  const server = await start({ token: 'T' });
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const responses = [
    await raw(server, { path: '/' }),
    await raw(server, { path: '/styles.css' }),
    await raw(server, { path: '/src/main.mjs' }),
    await raw(server, { path: '/nothing-here' }),
    await raw(server, { path: '/api/chat' }),                                   // 405
    await raw(server, { path: '/api/chat', method: 'POST', headers: { 'content-type': 'application/json' } }), // 403: no token
    await raw(server, { path: '/', headers: { host: 'evil.example' } }),         // 403: foreign Host
  ];
  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200, 404, 405, 403, 403]);
  for (const res of responses) {
    assert.equal(res.headers['content-security-policy'], csp, `status ${res.status}`);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('the page itself has no inline script, no external reference, and no inline event handler (so the policy can stay strict)', async () => {
  const server = await start();
  const html = await (await fetch(server.url)).text();
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'every script has a src');
  assert.ok(!/(?:src|href)="https?:\/\//i.test(html), 'nothing is loaded from another site');
  assert.ok(!/\son[a-z]+="/i.test(html), 'no inline event handler');
});

test('GET /styles.css starts with the design tokens shared with the report and carries the security headers (spec FR-048)', async () => {
  const server = await start();
  const res = await fetch(`${server.url}/styles.css`);
  const css = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
  assert.match(css, /^:root\{--bg:#f4f6fb;--surface:#fff;/);
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{:root\{--bg:#0d111c;/);
  assert.match(css, /--on-accent:#fff;/, 'the tokens of the report are there');
  assert.match(css, /--ph:#e0defb;/, 'and the tokens of the page');
  assert.ok(css.includes('.steps{'), 'the page rules follow the tokens');
  assert.ok(css.indexOf('--bg:') < css.indexOf('.steps{'));
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
});
