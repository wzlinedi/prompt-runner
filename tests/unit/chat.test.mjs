import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload, mapAnswer, callChat, redact } from '../../app/public/src/chat.mjs';

const KEY = 'nvapi-SECRET-TEST-KEY';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const ok = (content, finish = 'stop', extra = {}) => ({
  status: 200, viaUpstream: true, json: { choices: [{ finish_reason: finish, message: { content, ...extra } }] },
});
const platform = (status, json, retryAfter = null) => ({ status, viaUpstream: true, json, retryAfter });
const relay = (status, code) => ({ status, viaUpstream: false, json: { error: { code, message: 'x' } } });

test('buildPayload: the user JSON plus messages and stream:false, key absent', () => {
  const params = { model: 'm', temperature: 1, chat_template_kwargs: { enable_thinking: true } };
  const payload = buildPayload(params, 'Hello\nworld');
  assert.deepEqual(payload, { ...params, messages: [{ role: 'user', content: 'Hello\nworld' }], stream: false });
  assert.deepEqual(Object.keys(payload).slice(0, 3), ['model', 'temperature', 'chat_template_kwargs'], 'order of the user keys is kept');
  assert.ok(!JSON.stringify(payload).includes('nvapi'));
  assert.deepEqual(params, { model: 'm', temperature: 1, chat_template_kwargs: { enable_thinking: true } }, 'input is not changed');
});

test('buildPayload: a 100,000-character prompt input is placed complete, with its line breaks', () => {
  const big = 'line of data\n'.repeat(8000).slice(0, 100_000);
  const payload = buildPayload({ model: 'm' }, `Summarize:\n${big}`);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].content, `Summarize:\n${big}`);
});

test('mapAnswer: 200 with content', () => {
  assert.deepEqual(mapAnswer(ok('The answer')), { output: 'The answer', cutOff: false });
});

test('mapAnswer: reasoning_content is ignored', () => {
  assert.deepEqual(mapAnswer(ok('Final', 'stop', { reasoning_content: 'secret thoughts' })), { output: 'Final', cutOff: false });
});

test('mapAnswer: finish_reason length means cut off', () => {
  assert.deepEqual(mapAnswer(ok('Partial', 'length')), { output: 'Partial', cutOff: true });
});

test('mapAnswer: empty or missing content gives an empty output; with the length limit a note', () => {
  assert.deepEqual(mapAnswer(ok('')), { output: '', cutOff: false });
  assert.deepEqual(mapAnswer(ok(null)), { output: '', cutOff: false });
  assert.deepEqual(mapAnswer({ status: 200, viaUpstream: true, json: { choices: [{ message: {} }] } }), { output: '', cutOff: false });
  assert.deepEqual(mapAnswer(ok(null, 'length')), { output: '', cutOff: true, note: 'no answer text returned: the length limit was reached before the answer' });
});

test('mapAnswer: unexpected shape', () => {
  for (const json of [{ unexpected: true }, null, { choices: [] }, { choices: 'x' }]) {
    assert.deepEqual(mapAnswer({ status: 200, viaUpstream: true, json }), { error: 'The platform answered in an unexpected format.' });
  }
});

test('mapAnswer: error rows', () => {
  const cases = [
    [platform(400, { detail: 'max_tokens too large' }), /^The platform rejected the request \(HTTP 400\)\. .*parameters.*model.* Platform message: max_tokens too large$/],
    [platform(422, { error: { message: 'bad field' } }), /\(HTTP 422\).*Platform message: bad field/],
    [platform(401, { detail: 'Authorization failed: Invalid JWT serialization: Missing dot delimiter(s)' }), /^The platform did not recognise the key\. A key from the NVIDIA platform starts with "nvapi-"\.$/],
    [platform(401, { detail: 'Unauthorized' }), /^The key was refused, or the model is not permitted for this key \(HTTP 401\)\./],
    [platform(403, { detail: 'nope' }), /^The key was refused, or the model is not permitted for this key \(HTTP 403\)\./],
    [platform(404, {}), /^Unknown address or model \(HTTP 404\)\./],
    [platform(413, {}), /^The input is too long for this model\./],
    [platform(400, { detail: "This model's maximum context length is 8192 tokens" }), /^The input is too long for this model\./],
    [platform(429, {}, '7'), /^Rate limit exceeded \(HTTP 429\)\. The platform asks to wait 7\.$/],
    [platform(429, {}), /^Rate limit exceeded \(HTTP 429\)\.$/],
    [platform(503, {}), /^Platform or network problem \(HTTP 503\)\./],
    [platform(500, {}), /^Platform or network problem \(HTTP 500\)\./],
    [relay(502, 'upstream_unreachable'), /^Platform or network problem: the platform could not be reached\./],
    [relay(504, 'upstream_timeout'), /^Platform or network problem: the platform did not answer in time\./],
    [relay(502, 'upstream_redirect'), /^Platform or network problem: the platform answered with a redirect\./],
    [relay(403, 'forbidden'), /^The local relay refused the request\. Reload the page/],
    [relay(400, 'bad_request'), /^The local relay did not accept the request/],
    [relay(413, 'too_large'), /^The input is too long/],
  ];
  for (const [response, expected] of cases) {
    const mapped = mapAnswer(response);
    assert.ok(mapped.error, JSON.stringify(response));
    assert.match(mapped.error, expected, JSON.stringify(response));
    assert.equal('output' in mapped, false);
  }
});

test('errors never contain the key or the endpoint, even when the platform echoes them', () => {
  const secrets = [KEY, ENDPOINT];
  const echo = `bad key ${KEY} at ${ENDPOINT}, also nvapi-OTHER-123_x`;
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const mapped = mapAnswer(platform(status, { detail: echo }, KEY), secrets);
    assert.ok(!mapped.error.includes('SECRET-TEST-KEY'), `status ${status}`);
    assert.ok(!mapped.error.includes(ENDPOINT), `status ${status}`);
    assert.ok(!mapped.error.includes('nvapi-OTHER'), `status ${status}`);
  }
  assert.match(mapAnswer(platform(400, { detail: echo }), secrets).error, /\[key\]/);
  assert.equal(mapAnswer(platform(429, {}, KEY), secrets).error.includes('SECRET'), false, 'a header value that echoes the key');
});

test('platform text is cut to 300 characters', () => {
  const mapped = mapAnswer(platform(400, { detail: 'x'.repeat(5000) }));
  assert.ok(mapped.error.endsWith('x'.repeat(300) + '…'));
  assert.ok(mapped.error.length < 500);
});

test('a non-JSON platform body is used as text, redacted', () => {
  const mapped = mapAnswer({ status: 502, viaUpstream: true, json: null, text: `<html>Bad gateway ${KEY}</html>` }, [KEY]);
  assert.match(mapped.error, /HTTP 502/);
  assert.ok(!mapped.error.includes('SECRET'));
});

test('redact', () => {
  assert.equal(redact('a KEY b KEY', ['KEY']), 'a [key] b [key]');
  assert.equal(redact('token nvapi-abc_DEF-123 end'), 'token [key] end');
  assert.equal(redact('x'.repeat(400)).length, 301);
  assert.equal(redact('keep', ['', null, undefined]), 'keep');
});

test('redact also removes the trimmed key, the key without a pasted "Bearer ", the endpoint, and its host (spec FR-045)', () => {
  const entered = '  Bearer nvapi-REAL-SECRET-1234  ';
  const text = 'bad token nvapi-REAL-SECRET-1234 / Bearer nvapi-REAL-SECRET-1234 at https://api.vendor.example/v1/chat?x=1 and api.vendor.example is down';
  const out = redact(text, [entered], ['https://api.vendor.example/v1/chat?x=1']);
  assert.ok(!out.includes('REAL-SECRET'), out);
  assert.ok(!out.includes('vendor.example'), out);
  assert.match(out, /\[key\]/);
  assert.match(out, /\[endpoint\]/);
  assert.match(out, /^bad token \[key\]/);
});

test('redact does not shred a message with very short derived pieces', () => {
  assert.equal(redact('the key is ab and a b c', ['  ab  '], ['x']), 'the key is ab and a b c', 'a 2-character trimmed form is not removed from ordinary text');
  assert.equal(redact('ok to go', ['  o '], []), 'ok to go', 'a one-letter trimmed key is not removed from ordinary words');
  assert.equal(redact('host ab here', [], ['http://ab/y']), 'host ab here', 'a host shorter than 4 characters is left alone');
});

test('the relay code for a too large answer becomes a readable row error (spec FR-046)', () => {
  const mapped = mapAnswer({ status: 502, viaUpstream: false, json: { error: { code: 'upstream_too_large' } } });
  assert.equal(mapped.error, "The platform's answer is too large (more than 8 MB).");
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  fn.calls = calls;
  return fn;
}
const response = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

test('callChat: posts to the relay with the token and the body, maps the answer, never retries', async () => {
  const fetchImpl = fakeFetch(() => response(200, { choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }, { 'x-relay-upstream': '1' }));
  const payload = buildPayload({ model: 'm' }, 'p');
  const result = await callChat({ endpoint: ENDPOINT, apiKey: KEY, payload, relayToken: 'TOK', fetchImpl });
  assert.deepEqual(result, { output: 'hi', cutOff: false });
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, '/api/chat');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-Relay-Token'], 'TOK');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { endpoint: ENDPOINT, apiKey: KEY, payload });
});

test('callChat: upstream and relay errors are mapped; a relay that cannot be reached is explained; one call each', async () => {
  const f1 = fakeFetch(() => response(429, {}, { 'x-relay-upstream': '1', 'retry-after': '3' }));
  assert.match((await callChat({ endpoint: ENDPOINT, apiKey: KEY, payload: {}, fetchImpl: f1 })).error, /Rate limit exceeded \(HTTP 429\)\. The platform asks to wait 3\./);
  const f2 = fakeFetch(() => response(504, { error: { code: 'upstream_timeout', message: 'm' } }, { 'x-relay-upstream': '0' }));
  assert.match((await callChat({ endpoint: ENDPOINT, apiKey: KEY, payload: {}, fetchImpl: f2 })).error, /did not answer in time/);
  const f3 = fakeFetch(() => { throw new TypeError('fetch failed'); });
  const r3 = await callChat({ endpoint: ENDPOINT, apiKey: KEY, payload: {}, fetchImpl: f3 });
  assert.match(r3.error, /^The local relay could not be reached\. Is it still running\?/);
  assert.equal(f1.calls.length + f2.calls.length + f3.calls.length, 3, 'nothing is retried');
});

test('callChat: Stop (abort) is reported as aborted, not as an error row', async () => {
  const controller = new AbortController();
  const fetchImpl = fakeFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const pending = callChat({ endpoint: ENDPOINT, apiKey: KEY, payload: {}, signal: controller.signal, fetchImpl });
  controller.abort();
  assert.deepEqual(await pending, { aborted: true });
});
