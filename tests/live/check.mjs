#!/usr/bin/env node
// Live check of the platform facts the plan could not verify without a real key
// (specs/001-simple-prompt-runner/research.md, section R12).
//
// The key never leaves this computer except in the request to the platform, is never
// printed, never written to a file, and is removed from every line of output.
// The output contains only non-secret facts and can be pasted into a chat.
//
// Run (the key is read silently and does not enter the shell history):
//   read -rs NVIDIA_API_KEY && export NVIDIA_API_KEY && node tests/live/check.mjs
// or just `node tests/live/check.mjs` and paste the key at the hidden prompt.
//
// Environment: NVIDIA_API_KEY (the key), ENDPOINT (default: the hosted chat address).

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fill } from '../../app/public/src/placeholders.mjs';
import { parseDataset } from '../../app/public/src/dataset.mjs';
import { SAMPLE_DATASET, DEFAULT_MAIN_PROMPT, DEFAULT_ACCURACY_PROMPT } from '../../app/public/src/defaults.mjs';

const ENDPOINT = process.env.ENDPOINT || 'https://integrate.api.nvidia.com/v1/chat/completions';

// Keep in sync with the default parameters JSON in the spec (Assumptions, "Default JSON").
const MAIN = { model: 'nvidia/nemotron-3.5-bolt-e4b', temperature: 1, top_p: 0.95, max_tokens: 4096, seed: 42, chat_template_kwargs: { enable_thinking: true } };
const SECOND = { model: 'nvidia/nemotron-3.5-lightning-30b-a3b', temperature: 1, top_p: 0.95, max_tokens: 16384, reasoning_budget: 16384, chat_template_kwargs: { enable_thinking: true } };

const SCORE_INSTRUCTION = '\n\nFinish your answer with one final line in exactly this form, where the number is your overall percentage from 0 to 100:\nSCORE: <number>';
const SCORE_LINE = /^\s*SCORE\s*:\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*$/i;

const JUDGE_PROMPT = `You are a meticulous QA reviewer. Check the ACCURACY of a model's output against the source data it was given.

SOURCE DATA (the only ground truth):
Unemployment rate 3.1% (2025). Minimum wage 1 139 EUR per month (2026-S1). Inflation 3.3% (2025).

MODEL OUTPUT:
Unemployment is 3.1%, the minimum wage is 1 139 EUR and inflation is 4.3%.

Instructions:
1. Extract every verifiable fact from the MODEL OUTPUT.
2. Check each fact against the SOURCE DATA only.
3. Give each fact one verdict: CORRECT, INCORRECT (state the correct value) or UNSUPPORTED.

Report:
- A list of the facts checked, each with its verdict.
- An overall accuracy percentage: CORRECT facts divided by all facts checked, times 100.`;

let KEY = '';
const redact = (s) => {
  let out = String(s ?? '');
  if (KEY) out = out.split(KEY).join('[key]');
  return out.replace(/nvapi-[A-Za-z0-9_-]+/g, '[key]');
};
const say = (s = '') => console.log(redact(s));

async function readKey() {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY.trim();
  if (!process.stdin.isTTY) {
    console.error('No key: set NVIDIA_API_KEY or run this in a terminal to paste it at the hidden prompt.');
    process.exit(2);
  }
  const muted = new Writable({ write(_c, _e, cb) { cb(); } });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write('Paste the API key (input is hidden), then press Enter: ');
  const key = await new Promise((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return key.trim();
}

async function probe(name, params, prompt) {
  const started = performance.now();
  const r = { name, model: params.model };
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...params, messages: [{ role: 'user', content: prompt }], stream: false }),
      redirect: 'manual',
      signal: AbortSignal.timeout(180000),
    });
    r.status = res.status;
    r.latencyMs = Math.round(performance.now() - started);
    r.headers = [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}: ${v}`);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !json) {
      r.error = redact(text).slice(0, 300) || '(empty response body; a 404 or 5xx without text is often temporary)';
      return r;
    }
    const choice = json.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    r.finishReason = choice.finish_reason ?? null;
    r.messageFields = Object.keys(msg);
    r.contentType = msg.content === null ? 'null' : typeof msg.content;
    const content = typeof msg.content === 'string' ? msg.content : '';
    r.contentLength = content.length;
    r.content = content; // kept for the next probe, never printed in full
    r.contentPreview = content.slice(0, 120).replace(/\s+/g, ' ');
    r.thinkTagsInContent = /<\/?think>/i.test(content);
    r.usage = json.usage ? { prompt: json.usage.prompt_tokens, completion: json.usage.completion_tokens, total: json.usage.total_tokens } : null;
    const lines = content.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = SCORE_LINE.exec(lines[i]);
      if (m) { r.score = Number(m[1]); break; }
    }
  } catch (e) {
    r.latencyMs = Math.round(performance.now() - started);
    r.error = redact(`${e.name}: ${e.message}`).slice(0, 300);
  }
  return r;
}

async function probeModels() {
  const started = performance.now();
  const r = { name: '0. Platform reachable (the model list is public and does NOT check the key)', model: '-' };
  try {
    const res = await fetch(new URL('/v1/models', ENDPOINT), { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
    r.status = res.status;
    r.latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !json) { r.error = redact(text).slice(0, 300); return r; }
    const ids = (json.data ?? []).map((m) => m.id);
    r.modelCount = ids.length;
    r.mainListed = ids.includes(MAIN.model);
    r.secondListed = ids.includes(SECOND.model);
  } catch (e) {
    r.latencyMs = Math.round(performance.now() - started);
    r.error = redact(`${e.name}: ${e.message}`).slice(0, 300);
  }
  return r;
}

function show(r) {
  say(`--- ${r.name} (${r.model})`);
  if (r.status !== undefined) say(`status: ${r.status}   latency: ${r.latencyMs} ms`);
  if (r.error) say(`error: ${r.error}`);
  if (r.headers?.length) say(`rate headers: ${r.headers.join(' | ')}`);
  if (r.inputChars !== undefined) say(`prompt input: ${r.inputChars} characters`);
  if (r.finishReason !== undefined) say(`finish_reason: ${r.finishReason}`);
  if (r.messageFields) say(`message fields: ${r.messageFields.join(', ')}`);
  if (r.contentType) say(`content: ${r.contentType}, ${r.contentLength} characters, <think> tags inside: ${r.thinkTagsInContent}`);
  if (r.contentPreview) say(`content starts: "${r.contentPreview}"`);
  if (r.usage) say(`tokens: prompt ${r.usage.prompt}, completion ${r.usage.completion}, total ${r.usage.total}`);
  if (r.score !== undefined) say(`SCORE line read: ${r.score}`);
  if (r.modelCount !== undefined) say(`models listed: ${r.modelCount}; ${MAIN.model} listed: ${r.mainListed ? 'yes' : 'no'}; ${SECOND.model} listed: ${r.secondListed ? 'yes' : 'no'}`);
}

KEY = await readKey();
if (!KEY) { console.error('Empty key.'); process.exit(2); }

// Normalise common paste mistakes and report the shape of the key without revealing it.
const notes = [];
if (/^["'].*["']$/.test(KEY)) { KEY = KEY.slice(1, -1).trim(); notes.push('the pasted text was wrapped in quotes (removed)'); }
if (/^bearer\s+/i.test(KEY)) { KEY = KEY.replace(/^bearer\s+/i, ''); notes.push('the pasted text started with "Bearer " (removed)'); }
const shape = {
  startsWithNvapi: KEY.startsWith('nvapi-'),
  startsWithNvapiAnyCase: KEY.toLowerCase().startsWith('nvapi-'),
  length: KEY.length,
  whitespaceInside: /\s/.test(KEY),
  nonAscii: /[^\x21-\x7e]/.test(KEY),
};
say(`Key shape: starts with the lowercase prefix "nvapi-": ${shape.startsWithNvapi ? 'yes' : 'NO' + (shape.startsWithNvapiAnyCase ? ' (only in other letter case)' : '')}; length: ${shape.length}; whitespace inside: ${shape.whitespaceInside ? 'YES' : 'no'}; unusual characters: ${shape.nonAscii ? 'YES' : 'no'}${notes.length ? '; fixed: ' + notes.join(', ') : ''}`);
say(`Endpoint: ${new URL(ENDPOINT).origin}${new URL(ENDPOINT).pathname}`);
say('Running 1 reachability check, 3 short chat requests, and 2 requests with the full Poland table (a few minutes, mostly waiting for the model)...\n');

const m = await probeModels();
const a = await probe('1. Main prompt, default parameters', MAIN, 'Reply with exactly one word: pong');
const b = await probe('2. Judge answer format, default parameters', MAIN, JUDGE_PROMPT + SCORE_INSTRUCTION);
const c = await probe('3. Second model with its default parameters', SECOND, JUDGE_PROMPT + SCORE_INSTRUCTION);

// The real situation: the full Poland table (about 1,650 characters) as the prompt input of the default main prompt,
// then the default Accuracy judge prompt on that answer (research R12: room for reasoning plus answer at max_tokens 4096).
const poland = parseDataset(SAMPLE_DATASET).rows.find((row) => row.id === 'PL');
const d = await probe('4. Main prompt, default prompt on the full Poland table', MAIN, fill(DEFAULT_MAIN_PROMPT, { prompt_input: poland.promptInput }));
d.inputChars = poland.promptInput.length;
const e = d.status === 200 && !d.error && d.content
  ? await probe('5. Accuracy judge, default prompt on the answer of probe 4', MAIN, fill(DEFAULT_ACCURACY_PROMPT, { prompt_input: poland.promptInput, output: d.content }) + SCORE_INSTRUCTION)
  : { name: '5. Accuracy judge, default prompt on the answer of probe 4', model: MAIN.model, error: 'skipped: probe 4 gave no answer' };
[m, a, b, c, d, e].forEach((r) => { show(r); say(); });

const ok = (r) => r.status === 200 && !r.error;
const pick = (first, later) => (ok(first) ? first : later); // probes 1 and 2 may hit a temporary 404; 4 and 5 use the same model
say('=== What this settles (research.md, R12) ===');
say(`R12.1 answer text only: ${ok(pick(a, d)) ? (pick(a, d).thinkTagsInContent ? 'CHECK - <think> tags appear inside content' : `content has no <think> tags; extra message fields: ${pick(a, d).messageFields.filter((f) => f !== 'content' && f !== 'role').join(', ') || 'none'}`) : 'not determined (request failed)'}`);
say(`R12.2 room for reasoning plus answer (max_tokens ${MAIN.max_tokens}): ${ok(pick(b, e)) ? (pick(b, e).finishReason === 'length' || pick(b, e).score === undefined ? 'CHECK - cut off or no SCORE line' : 'OK - finished and SCORE line read') : 'not determined (request failed)'}`);
say(`R12.3 latencies: main ${a.latencyMs ?? '-'} ms, judge ${b.latencyMs ?? '-'} ms, second model ${c.latencyMs ?? '-'} ms`);
say(`R12.4 second model accepts its parameters: ${ok(c) ? 'OK' : `NOT OK (status ${c.status ?? 'none'})`}`);
const longOk = (r) => ok(r) && r.finishReason !== 'length';
say(`R12.5 long real input (${d.inputChars} characters, max_tokens ${MAIN.max_tokens}): main answer ${ok(d) ? `finish_reason ${d.finishReason}, ${d.usage?.completion ?? '?'} completion tokens${d.finishReason === 'length' ? ' - CUT OFF: raise max_tokens' : ''}` : 'not determined (request failed)'}; judge ${ok(e) ? `finish_reason ${e.finishReason}, ${e.usage?.completion ?? '?'} completion tokens, SCORE line ${e.score === undefined ? 'NOT read - CHECK' : `read (${e.score})`}` : 'not determined (request failed or skipped)'}${longOk(d) && longOk(e) && e.score !== undefined ? ' - OK' : ''}`);

const chatAll = [a, b, c, d];
const detail = (r) => (r.error ?? '').toLowerCase();
say('\n=== Diagnosis of the key ===');
say(`(The model list is public: it answers 200 without any key, so it says nothing about the key. Only the chat requests do.)`);
if (chatAll.every((r) => r.status === 200 && !r.error)) {
  say('The key works: all chat requests were accepted.');
} else if (chatAll.some((r) => r.status === 401 && detail(r).includes('jwt'))) {
  say('The platform did NOT recognise the pasted text as an API key (it tried to read it as a login token).');
  say('The platform recognises a key only by the lowercase prefix "nvapi-". Possible causes:');
  say(`  - the text does not start with "nvapi-" (see "Key shape" above: ${shape.startsWithNvapi ? 'it does, so look at the next point' : 'it does not' + (shape.startsWithNvapiAnyCase ? ', only the letter case differs' : '')});`);
  say('  - a different credential was copied (for example an organisation id, an old-style NGC key, or a token from another page);');
  say('  - the clipboard held other text, or the key was cut at the start.');
  say('Copy the key again from the "Get API Key" window on build.nvidia.com: it starts with nvapi-.');
} else if (chatAll.some((r) => r.status === 403)) {
  say('The key has the right shape (nvapi-...) and was recognised, but the platform REFUSED it (403 Authorization failed).');
  say('That means the key is not valid for chat requests. Known causes (reports on the NVIDIA developer forum; no confirmed fix):');
  say('  - the key was revoked, deleted, or is a copy of an old key: generate a NEW key and delete the old one;');
  say('  - the account lacks the "Public API Endpoints" permission: ask NVIDIA (forum or support) to enable it;');
  say('  - the Developer Program membership or e-mail/phone verification of the account is incomplete.');
} else if (chatAll.some((r) => r.status === 429)) {
  say('The platform answered "too many requests" (429): wait a minute and run the check again.');
} else {
  say(`The chat requests failed in another way (statuses: ${chatAll.map((r) => r.status ?? 'none').join(', ')}); see the errors above.`);
}
say(`Key shape again: starts with "nvapi-": ${shape.startsWithNvapi ? 'yes' : 'NO'}; length: ${shape.length}.`);
say('\nThis output contains no key and can be pasted into the chat.');
process.exit([a, b, c, d, e].every(ok) ? 0 : 1);
