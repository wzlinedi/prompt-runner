import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../../app/server.mjs';
import { startFake, FAIL } from '../fixtures/fake-upstream.mjs';

const KEY = 'SECRET-TEST-KEY';
const TOKEN = 'TEST-TOKEN';
const closers = [];
after(async () => { for (const close of closers) await close(); });

const logs = [];
async function setup({ fake: fakeOptions = {}, server: serverOptions = {} } = {}) {
  const fake = await startFake(fakeOptions);
  const server = await startServer({ port: 0, token: TOKEN, log: (line) => logs.push(line), ...serverOptions });
  closers.push(fake.close, server.close);
  return { fake, server };
}

/** A raw request so that Host, Origin, and the body are sent exactly as given. */
function post(server, { body, headers = {}, path = '/api/chat', token = TOKEN, contentType = 'application/json' } = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const allHeaders = { 'content-type': contentType, 'content-length': Buffer.byteLength(data), ...headers };
    if (token) allHeaders['x-relay-token'] = token;
    const req = http.request({ host: '127.0.0.1', port: server.port, path, method: 'POST', headers: allHeaders }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

const chat = (endpoint, content = 'hello', extra = {}) => ({
  endpoint, apiKey: KEY, payload: { model: 'm', messages: [{ role: 'user', content }], stream: false, ...extra },
});

test('1. wrong or missing token, foreign Host, foreign Origin: 403 and no upstream call', async () => {
  const { fake, server } = await setup();
  const body = chat(fake.endpoint);
  assert.equal((await post(server, { body, token: 'wrong' })).status, 403);
  assert.equal((await post(server, { body, token: null })).status, 403);
  assert.equal((await post(server, { body, headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await post(server, { body, headers: { origin: 'http://evil.example' } })).status, 403);
  const forbidden = await post(server, { body, token: 'wrong' });
  assert.equal(forbidden.json().error.code, 'forbidden');
  assert.equal(forbidden.headers['x-relay-upstream'], '0');
  assert.equal(fake.requests.length, 0);
});

test('2. a valid request reaches the fake with the exact header and body; status and body come back unchanged', async () => {
  const { fake, server } = await setup({ fake: { rules: [{ match: 'rate', respond: FAIL.rateLimit }] } });
  const body = chat(fake.endpoint, 'say hello', { temperature: 1, top_p: 0.95 });
  const ok = await post(server, { body, headers: { origin: server.url } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['x-relay-upstream'], '1');
  assert.equal(ok.json().choices[0].message.content, 'Summary: say hello');
  assert.equal(fake.requests[0].authorization, `Bearer ${KEY}`);
  assert.deepEqual(fake.requests[0].body, body.payload);

  const limited = await post(server, { body: chat(fake.endpoint, 'rate me') });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['x-relay-upstream'], '1');
  assert.equal(limited.json().title, 'Too Many Requests');
  assert.equal(limited.headers['retry-after'], '7');
});

test('3. the log of a run contains neither the key nor any prompt text', async () => {
  logs.length = 0;
  const { fake, server } = await setup();
  await post(server, { body: chat(fake.endpoint, 'PROMPT-TEXT-XYZ') });
  await post(server, { body: chat(fake.endpoint, 'PROMPT-TEXT-XYZ'), token: 'wrong' });
  await post(server, { body: chat('http://127.0.0.1:1/never', 'PROMPT-TEXT-XYZ') });
  const all = logs.join('\n');
  assert.ok(logs.length >= 3);
  assert.ok(!all.includes(KEY) && !all.includes('PROMPT-TEXT-XYZ') && !all.includes(fake.endpoint) && !all.includes('127.0.0.1:1/never'));
  assert.match(logs[0], /^\S+ POST \/api\/chat 200 \d+ms$/);
});

test('4. closing the client connection aborts the upstream request', async () => {
  const { fake, server } = await setup({ fake: { hold: true } });
  const data = JSON.stringify(chat(fake.endpoint));
  const req = http.request({ host: '127.0.0.1', port: server.port, path: '/api/chat', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-relay-token': TOKEN } });
  req.on('error', () => {});
  req.end(data);
  await fake.arrived(1);
  req.destroy();
  const end = Date.now() + 3000;
  while (fake.aborted < 1 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.equal(fake.aborted, 1);
});

test('5. redirect, timeout, and refused connection give 502/504 with their codes', async () => {
  const redirecting = http.createServer((req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/' }); res.end(); });
  await new Promise((r) => redirecting.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => redirecting.close(r)));
  const { fake, server } = await setup({ fake: { rules: [{ match: 'slow', respond: { delayMs: 3000, content: 'late' } }] }, server: { timeoutMs: 200 } });

  const redirect = await post(server, { body: chat(`http://127.0.0.1:${redirecting.address().port}/x`) });
  assert.equal(redirect.status, 502);
  assert.equal(redirect.json().error.code, 'upstream_redirect');
  assert.equal(redirect.headers['x-relay-upstream'], '0');

  const timeout = await post(server, { body: chat(fake.endpoint, 'slow') });
  assert.equal(timeout.status, 504);
  assert.equal(timeout.json().error.code, 'upstream_timeout');

  const refused = await post(server, { body: chat('http://127.0.0.1:1/v1/chat/completions') });
  assert.equal(refused.status, 502);
  assert.equal(refused.json().error.code, 'upstream_unreachable');
  assert.ok(!refused.text.includes(KEY) && !refused.text.includes('127.0.0.1:1'), 'the message names neither key nor address');
});

test('6. non-http(s) endpoint, endpoint with user-info, non-JSON body, and bad fields are rejected', async () => {
  const { fake, server } = await setup();
  for (const endpoint of ['ftp://example.com/x', 'file:///etc/passwd', 'not a url', 'http://user:pw@127.0.0.1:1/x', '']) {
    const res = await post(server, { body: { ...chat(fake.endpoint), endpoint } });
    assert.equal(res.status, 400, endpoint);
    assert.equal(res.json().error.code, 'bad_request');
    assert.ok(!res.text.includes('pw@'), 'credentials are not echoed');
  }
  assert.equal((await post(server, { body: '{not json' })).status, 400);
  assert.equal((await post(server, { body: { ...chat(fake.endpoint), apiKey: '' } })).status, 400);
  assert.equal((await post(server, { body: { ...chat(fake.endpoint), payload: [1] } })).status, 400);
  assert.equal((await post(server, { body: chat(fake.endpoint), contentType: 'text/plain' })).status, 415);
  assert.equal(fake.requests.length, 0);
});

test('a 100,000-character prompt reaches the fake unchanged; a body over the limit is refused with 413', async () => {
  const { fake, server } = await setup({ server: { bodyLimit: 150_000 } });
  const big = ('Zażółć gęślą jaźń\n' + 'x'.repeat(98)).repeat(850).slice(0, 100_000);
  const ok = await post(server, { body: chat(fake.endpoint, big) });
  assert.equal(ok.status, 200);
  assert.equal(fake.requests[0].content, big);

  const tooBig = await post(server, { body: chat(fake.endpoint, 'y'.repeat(200_000)) });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.json().error.code, 'too_large');
  assert.equal(fake.requests.length, 1);
});

test('four simultaneous requests all reach the fake before any is answered', async () => {
  const { fake, server } = await setup({ fake: { hold: true } });
  const pending = [1, 2, 3, 4].map((n) => post(server, { body: chat(fake.endpoint, `request ${n}`) }));
  await fake.arrived(4);
  assert.equal(fake.inFlight, 4);
  fake.release();
  const results = await Promise.all(pending);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
  assert.deepEqual(results.map((r) => r.json().choices[0].message.content).sort(), [1, 2, 3, 4].map((n) => `Summary: request ${n}`));
});

// ---- Corrections after the code review (spec FR-046) ----

async function bigAnswerServer(bytes) {
  const big = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"choices":[{"message":{"content":"');
      const chunk = 'x'.repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < bytes) {
          sent += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        res.end('"}}]}');
      };
      pump();
    });
  });
  await new Promise((r) => big.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => { big.closeAllConnections?.(); big.close(r); }));
  return `http://127.0.0.1:${big.address().port}/v1/chat/completions`;
}

test('7. an answer over the limit is refused with 502 upstream_too_large; one under it comes back unchanged', async () => {
  const { server } = await setup({ server: { answerLimit: 100_000 } });
  const huge = await post(server, { body: chat(await bigAnswerServer(2_000_000)) });
  assert.equal(huge.status, 502);
  assert.equal(huge.json().error.code, 'upstream_too_large');
  assert.equal(huge.headers['x-relay-upstream'], '0');
  assert.ok(huge.text.length < 1000, 'nothing of the large body is forwarded');

  const fine = await post(server, { body: chat(await bigAnswerServer(10_000)) });
  assert.equal(fine.status, 200);
  assert.equal(fine.headers['x-relay-upstream'], '1');
  assert.ok(fine.text.length > 10_000);
});

test('7b. the default limit is 8 MB', async () => {
  const { server } = await setup();
  const over = await post(server, { body: chat(await bigAnswerServer(9 * 1024 * 1024)) });
  assert.equal(over.status, 502);
  assert.equal(over.json().error.code, 'upstream_too_large');
});

test('7c. every answer of the relay, forwarded or not, carries the security headers', async () => {
  const { fake, server } = await setup();
  for (const res of [await post(server, { body: chat(fake.endpoint) }), await post(server, { body: chat(fake.endpoint), token: 'wrong' }), await post(server, { body: '{not json' })]) {
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('14. a platform that repeats the key in its answer does not get it sent back to the page', async () => {
  const { fake, server } = await setup({ fake: { rules: [{ match: () => true, respond: { status: 401, body: { detail: `The key ${KEY} is not accepted`, again: `"${KEY}"` } } }] } });
  const res = await post(server, { body: chat(fake.endpoint) });
  assert.equal(res.status, 401);
  assert.ok(!res.text.includes(KEY), res.text);
  assert.match(res.json().detail, /\[key removed\] is not accepted/);
});

test('15. a platform that repeats the key as an address, as percent bytes, or as base64 does not get it sent back to the page', async () => {
  const bytes = Buffer.from(KEY);
  const forms = {
    address: encodeURIComponent(KEY),
    percent: [...bytes].map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''),
    base64: bytes.toString('base64'),
    inside1: Buffer.from(`a${KEY}z`).toString('base64'),
    inside2: Buffer.from(`ab${KEY}yz`).toString('base64'),
  };
  const { fake, server } = await setup({ fake: { rules: [{ match: () => true, respond: { status: 401, body: { detail: Object.values(forms).join(' | ') } } }] } });
  const res = await post(server, { body: chat(fake.endpoint) });
  assert.equal(res.status, 401);
  for (const [name, form] of Object.entries(forms)) assert.ok(!res.text.includes(form), `${name} came back: ${res.text}`);
  assert.ok(!res.text.includes(KEY));
});

test('16. an answer that merely looks similar to the key, and a body without the key, are passed on unchanged', async () => {
  const { withoutKey } = await import('../../app/relay.mjs');
  const body = Buffer.from(JSON.stringify({ detail: 'SECRET-TEST-KE and secret-test-key and c2VjcmV0 are not it' }));
  assert.equal(withoutKey(body, KEY), body);
  const tiny = Buffer.from('a k b');
  assert.equal(withoutKey(tiny, 'k'), tiny); // a key shorter than 4 characters is left alone
});

test('17. a key with characters that an address escapes is removed in its escaped form too', async () => {
  const { withoutKey } = await import('../../app/relay.mjs');
  const key = 'key/with+odd chars=1&ü';
  const body = Buffer.from(`x ${encodeURIComponent(key)} y ${key} z`);
  assert.equal(withoutKey(body, key).toString(), 'x [key removed] y [key removed] z');
});
