import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../fixtures/fake-upstream.mjs', import.meta.url));

/** Starts the fake platform as a script (as the quickstart does) and returns its endpoint and a stop function. */
async function startScript(env = {}) {
  const child = spawn(process.execPath, [script], { env: { ...process.env, PORT: String(20000 + Math.floor(Math.random() * 20000)), ...env } });
  let out = '';
  const endpoint = await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const found = /(http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions)/.exec(out);
      if (found) resolve(found[1]);
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error(`the script printed no address: ${out}`)), 5000);
  });
  return { endpoint, out: () => out, stop: () => child.kill() };
}

const ask = (endpoint, content) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content }] }) });

test('script mode prints the address and fails the first main request about Hungary once', async () => {
  const fake = await startScript();
  try {
    const first = await ask(fake.endpoint, 'Summarize below data.\nSelected indicators\tHungary');
    assert.equal(first.status, 429);
    assert.equal(first.headers.get('retry-after'), '7');
    const second = await ask(fake.endpoint, 'Summarize below data.\nSelected indicators\tHungary');
    assert.equal(second.status, 200);
    assert.equal((await ask(fake.endpoint, 'Summarize below data.\nSelected indicators\tPoland')).status, 200);
    assert.match(fake.out(), /fails once \(rate limit\)/);
  } finally { fake.stop(); }
});

test('a judge request about Hungary is not failed, and FAKE_FAIL_ONCE= switches the failure off', async () => {
  const fake = await startScript();
  try {
    assert.equal((await ask(fake.endpoint, 'Finish your answer with one final line in exactly this form\nSCORE: <number> Hungary')).status, 200);
  } finally { fake.stop(); }
  const off = await startScript({ FAKE_FAIL_ONCE: '' });
  try {
    assert.equal((await ask(off.endpoint, 'Selected indicators\tHungary')).status, 200);
    assert.ok(!/fails once/.test(off.out()));
  } finally { off.stop(); }
});
