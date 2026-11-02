// A fake of the model platform for tests: POST /v1/chat/completions. It never calls the real platform and
// never echoes the key. Importable (`startFake`) and runnable (`node tests/fixtures/fake-upstream.mjs`).
//
// Answers by prompt content, first matching rule wins (`rules`: [{ match, respond, times }]):
//   match    - text the user message must contain, or a function(body, content) -> boolean
//   respond  - { status, content, reasoning, finish, headers, body, delayMs }  (see `reply`)
//   times    - how often the rule applies (default: always); "failure only on the first call" is `times: 1`
// Without a matching rule: a judge request (it asks for a final SCORE line) gets a rationale ending with
// `SCORE: <judgeScore>`, any other request gets a short summary of its prompt.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const JWT_MESSAGE = 'Authorization failed: Invalid JWT serialization: Missing dot delimiter(s)';

/** Failure shortcuts for rules: `{ match: 'Slovakia', respond: FAIL.rateLimit, times: 1 }`. */
export const FAIL = {
  jwt: { status: 401, body: { status: 401, title: 'Unauthorized', detail: JWT_MESSAGE } },
  forbidden: { status: 403, body: { status: 403, title: 'Forbidden', detail: 'Not authorized for this model.' } },
  rateLimit: { status: 429, headers: { 'retry-after': '7' }, body: { status: 429, title: 'Too Many Requests' } },
  server: { status: 503, body: { status: 503, title: 'Service Unavailable' } },
  cutOff: { content: 'The answer begins and is cut o', finish: 'length' },
  noScore: { content: 'The facts look fine, but I forgot the final line.' },
  empty: { content: '' },
  badShape: { body: { unexpected: true } },
};

export async function startFake({ rules = [], hold = false, judgeScore = 87, expectKey = null, port: wantedPort = 0 } = {}) {
  const requests = [];
  const waiting = [];
  const used = new Map(); // rule -> how often it applied
  let holding = hold;
  let inFlight = 0;
  let maxInFlight = 0;
  let abortedCount = 0;

  const server = createServer((req, res) => {
    // Test helper: how many chat requests arrived so far (readable from a page of another origin).
    if (req.method === 'GET' && req.url === '/__count') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ count: requests.length, aborted: abortedCount }));
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { /* recorded as null */ }
      const content = body?.messages?.[0]?.content ?? '';
      requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization ?? '', body, content });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      let aborted = false;
      res.on('close', () => { if (!res.writableEnded) { aborted = true; abortedCount += 1; } });
      try {
        if (holding) await new Promise((resolve) => waiting.push(resolve));
        if (aborted) return;
        if (req.method !== 'POST' || !/(^|\/)chat\/completions$/.test(req.url)) return reply(res, { status: 404, body: { status: 404, detail: 'This fake platform answers POST .../v1/chat/completions only.' } });
        if (expectKey && req.headers.authorization !== `Bearer ${expectKey}`) return reply(res, FAIL.jwt);
        const rule = rules.find((r) => {
          const hit = typeof r.match === 'function' ? r.match(body, content) : content.includes(r.match);
          return hit && (r.times === undefined || (used.get(r) ?? 0) < r.times);
        });
        if (rule) used.set(rule, (used.get(rule) ?? 0) + 1);
        const answer = rule ? rule.respond : defaultAnswer(content, judgeScore);
        if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
        if (!aborted) reply(res, answer, body?.model);
      } finally {
        inFlight -= 1;
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(wantedPort, '127.0.0.1', resolve); });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
    requests,
    get inFlight() { return inFlight; },
    get maxInFlight() { return maxInFlight; },
    /** How many requests were abandoned by the caller before they were answered. */
    get aborted() { return abortedCount; },
    /** Keeps answers back (hold mode) until `release()`. */
    hold() { holding = true; },
    release() { holding = false; for (const resolve of waiting.splice(0)) resolve(); },
    /** Resolves when `count` requests have arrived (also those that are held). */
    async arrived(count, timeoutMs = 5000) {
      const end = Date.now() + timeoutMs;
      while (requests.length < count) {
        if (Date.now() > end) throw new Error(`only ${requests.length} of ${count} requests arrived`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    close: () => new Promise((resolve) => { holding = false; for (const r of waiting.splice(0)) r(); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

function defaultAnswer(content, judgeScore) {
  if (/SCORE:\s*<number>|final line in exactly this form/i.test(content)) {
    return { content: `Facts checked:\n- fact 1: CORRECT\n- fact 2: CORRECT\n\nOverall: looks good.\nSCORE: ${judgeScore}`, reasoning: 'thinking about the facts' };
  }
  return { content: `Summary: ${content.replace(/\s+/g, ' ').slice(0, 60)}`, reasoning: 'thinking about the data' };
}

function reply(res, answer, model = 'fake-model') {
  const status = answer.status ?? 200;
  const headers = { 'content-type': 'application/json', ...(answer.headers ?? {}) };
  const payload = answer.body ?? {
    id: 'fake-1', object: 'chat.completion', model,
    choices: [{ index: 0, finish_reason: answer.finish ?? 'stop', message: { role: 'assistant', content: answer.content, reasoning_content: answer.reasoning ?? null } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

// Script mode: prints the address it listens on.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Fixed port 9911 (as in quickstart.md) unless PORT is set; another free port when it is taken.
  const wanted = Number(process.env.PORT) || 9911;
  // The first main request whose prompt contains FAKE_FAIL_ONCE (default: Hungary, the sample row HU) gets a rate limit,
  // so that "Re-run failed rows" can be tried by hand (quickstart section 3). FAKE_FAIL_ONCE= (empty) switches it off.
  const failOnce = process.env.FAKE_FAIL_ONCE ?? 'Hungary';
  const rules = failOnce === '' ? [] : [{ match: (body, content) => !content.includes('SCORE: <number>') && content.includes(failOnce), times: 1, respond: FAIL.rateLimit }];
  const fake = await startFake({ port: wanted, rules }).catch(() => startFake({ rules }));
  process.stdout.write(`Fake platform. Use this as the Endpoint in the page (the whole line, nothing else):\n${fake.endpoint}\n`);
  if (failOnce !== '') process.stdout.write(`The first main request about "${failOnce}" fails once (rate limit); set FAKE_FAIL_ONCE= to switch that off.\n`);
  process.on('SIGINT', async () => { await fake.close(); process.exit(0); });
}
