// Self-test of tests/live/check.mjs against a fake platform: proves that the script
// reads the answer shapes correctly and that the key never appears in its output,
// even when the platform echoes the key back in an error message.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const KEY = 'nvapi-SELFTEST-secret-0123456789';
const script = fileURLToPath(new URL('./check.mjs', import.meta.url));

function startFake(mode = 'normal') {
  const seen = [];
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data: [{ id: 'nvidia/nemotron-3.5-bolt-e4b' }, { id: 'nvidia/nemotron-3.5-lightning-30b-a3b' }, { id: 'other/model' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body);
      seen.push({ auth: req.headers.authorization, payload });
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'jwt-401') { res.statusCode = 401; res.end(JSON.stringify({ status: 401, title: 'Unauthorized', detail: 'Invalid JWT serialization: Missing dot delimiter(s)' })); return; }
      if (mode === 'chat-403') { res.statusCode = 403; res.end(JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Authorization failed' })); return; }
      if (payload.model.includes('lightning')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: `bad parameter reasoning_budget for key ${KEY}` })); // echoes the key on purpose
        return;
      }
      res.setHeader('x-ratelimit-remaining-minute', '39');
      const judge = payload.messages[0].content.includes('SCORE:');
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: judge ? 'CORRECT: unemployment\nINCORRECT: inflation\nSCORE: 67' : 'pong', reasoning_content: 'hidden' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

test('live check reads answers, reports facts, and never prints the key', async () => {
  const { server, seen, port } = await startFake();
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, NVIDIA_API_KEY: KEY, ENDPOINT: `http://127.0.0.1:${port}/v1/chat/completions` } });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', (code) => resolve({ text, code }));
  });
  server.close();

  assert.equal(seen.length, 5, 'five chat requests (the model list is a GET)');
  assert.ok(seen.every((s) => s.auth === `Bearer ${KEY}`), 'the key is sent to the platform as a bearer credential');
  assert.ok(seen.every((s) => s.payload.stream === false), 'requests are not streamed');
  assert.ok(!out.text.includes(KEY), 'the key must not appear in the output');
  assert.ok(!/nvapi-SELFTEST/.test(out.text), 'no part of the key may appear in the output');
  assert.match(out.text, /\[key\]/, 'the echoed key was redacted');
  assert.match(out.text, /SCORE line read: 67/);
  assert.match(out.text, /message fields: role, content, reasoning_content/);
  assert.match(out.text, /rate headers: x-ratelimit-remaining-minute: 39/);
  assert.match(out.text, /R12\.4 second model accepts its parameters: NOT OK \(status 400\)/);
  assert.equal(out.code, 1, 'exit code 1 when a probe failed');
  assert.match(out.text, /Key shape: starts with the lowercase prefix "nvapi-": yes; length: \d+; whitespace inside: no/);
  assert.match(out.text, /--- 4\. Main prompt, default prompt on the full Poland table/);
  assert.match(out.text, /prompt input: 1[0-9]{3} characters/);
  assert.ok(seen[3].payload.messages[0].content.includes('Population on 1 January') && seen[3].payload.messages[0].content.startsWith('Summarize below data.'), 'probe 4 sends the default main prompt with the full Poland table');
  assert.ok(seen[4].payload.messages[0].content.startsWith('You are a meticulous QA reviewer.') && seen[4].payload.messages[0].content.includes('MODEL OUTPUT:\npong'), 'probe 5 sends the Accuracy prompt with the answer of probe 4');
  assert.match(out.text, /R12\.5 long real input \(1[0-9]{3} characters, max_tokens 4096\): main answer finish_reason stop, 20 completion tokens; judge finish_reason stop, 20 completion tokens, SCORE line read \(67\) - OK/);
  assert.match(out.text, /models listed: 3; nvidia\/nemotron-3\.5-bolt-e4b listed: yes/);
});

async function runCheck(mode, extraEnv = {}) {
  const { server, port } = await startFake(mode);
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, NVIDIA_API_KEY: KEY, ENDPOINT: `http://127.0.0.1:${port}/v1/chat/completions`, ...extraEnv } });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', (code) => resolve({ text, code }));
  });
  server.close();
  return out;
}

test('403 on chat is diagnosed as a key the platform recognised but refused', async () => {
  const out = await runCheck('chat-403');
  assert.ok(!out.text.includes(KEY));
  assert.match(out.text, /right shape \(nvapi-\.\.\.\) and was recognised, but the platform REFUSED it/);
  assert.match(out.text, /Public API Endpoints/);
  assert.match(out.text, /model list is public/);
  assert.equal(out.code, 1);
});

test('401 "Invalid JWT" is diagnosed as a text the platform did not recognise as a key', async () => {
  const out = await runCheck('jwt-401');
  assert.ok(!out.text.includes(KEY));
  assert.match(out.text, /did NOT recognise the pasted text as an API key/);
  assert.match(out.text, /lowercase prefix "nvapi-"/);
});

test('a key with the prefix in the wrong letter case is reported as such, without printing it', async () => {
  const wrong = 'NVAPI-' + KEY.slice(6);
  const out = await runCheck('jwt-401', { NVIDIA_API_KEY: wrong });
  assert.ok(!out.text.includes(wrong));
  assert.match(out.text, /NO \(only in other letter case\)/);
});

test('pasted "Bearer " prefix and quotes are removed and reported, not printed', async () => {
  const out = await runCheck('normal', { NVIDIA_API_KEY: `"Bearer ${KEY}"` });
  assert.ok(!out.text.includes(KEY));
  assert.match(out.text, /fixed: the pasted text was wrapped in quotes \(removed\), the pasted text started with "Bearer " \(removed\)/);
  assert.match(out.text, /starts with "nvapi-": yes/);
  assert.equal(out.code, 1); // the fake still refuses the lightning model, as in the first test
});
