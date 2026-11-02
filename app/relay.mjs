// POST /api/chat: forwards one chat request to the endpoint the page names (contracts/relay-api.md).
// Holds no state, writes no logs (the server logs time, method, path, status, duration only), and uses the
// key only to build the Authorization header of the upstream call.

const JSON_TYPE = 'application/json; charset=utf-8';

/** The largest answer the relay takes from the platform (spec FR-046): a chat answer is far smaller. */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;

/**
 * Headers of every response of this server (page, scripts, styles, API, errors): no caching, no sniffing, no referrer, no
 * framing by other sites, and a policy that lets the page load its own files only (spec FR-046, research R21).
 * Styles may be inline because the page and the report gauges use style attributes; there is no inline script.
 */
export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function reply(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': JSON_TYPE, ...SECURITY_HEADERS, 'X-Relay-Upstream': '0', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

const fail = (res, status, code, message) => reply(res, status, { error: { code, message } });

/** Reads the request body up to `limit` bytes; resolves `null` when it is larger. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) { tooLarge = true; chunks.length = 0; return; } // keep draining so the answer can be sent
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** A parsed, checked endpoint URL, or null. */
function checkedEndpoint(value) {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Only harmless upstream headers are passed on. */
function passedHeaders(upstream) {
  const headers = {};
  const type = upstream.headers.get('content-type');
  headers['Content-Type'] = type && /^[\w/+.;= -]{1,100}$/.test(type) ? type : JSON_TYPE;
  const retry = upstream.headers.get('retry-after');
  if (retry && /^[\w ,:+-]{1,64}$/.test(retry)) headers['Retry-After'] = retry;
  return headers;
}

const ALPHABET = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
const HEX = {
  lower: Buffer.from('0123456789abcdef'),
  upper: Buffer.from('0123456789ABCDEF'),
};
const PERCENT = 0x25;

/** The base64 text of `bytes` as it stands inside a larger base64 text at the alignment `shift` (0..2), without the characters that depend on neighbouring bytes. */
function base64Core(bytes, shift) {
  const padded = Buffer.concat([Buffer.alloc(shift), bytes]);
  const out = Buffer.alloc(Math.ceil(padded.length / 3) * 4);
  for (let i = 0, o = 0; i < padded.length; i += 3, o += 4) {
    const n = (padded[i] << 16) | ((padded[i + 1] ?? 0) << 8) | (padded[i + 2] ?? 0);
    out[o] = ALPHABET[(n >> 18) & 63]; out[o + 1] = ALPHABET[(n >> 12) & 63]; out[o + 2] = ALPHABET[(n >> 6) & 63]; out[o + 3] = ALPHABET[n & 63];
  }
  return out.subarray(shift === 0 ? 0 : Math.ceil((shift * 8) / 6), Math.floor(((shift + bytes.length) * 8) / 6));
}

/** Every byte as `%xx`, with the digits from `digits`. */
function percentBytes(bytes, digits) {
  const out = Buffer.alloc(bytes.length * 3);
  bytes.forEach((b, i) => { out[i * 3] = PERCENT; out[i * 3 + 1] = digits[b >> 4]; out[i * 3 + 2] = digits[b & 15]; });
  return out;
}

/** What `encodeURIComponent` makes of the key, built from bytes (letters, digits and `-_.!~*'()` stay; every other byte is `%XX`). */
function addressForm(bytes) {
  const keep = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || "-_.!~*'()".includes(String.fromCharCode(b));
  return Buffer.concat([...bytes].map((b) => (keep(b) && b < 0x80 ? Buffer.of(b) : percentBytes(Buffer.of(b), HEX.upper))));
}

/**
 * The forms in which a platform may repeat the whole key (spec FR-074), longest first, as bytes: the derived forms are built
 * without making text out of them, so that no encoded copy of the key stays among the strings of this process. Short keys get the plain forms only.
 */
function keyForms(apiKey) {
  const bytes = Buffer.from(apiKey, 'utf8');
  const forms = [bytes, Buffer.from(JSON.stringify(apiKey).slice(1, -1), 'utf8')];
  if (apiKey.length >= 8) {
    forms.push(addressForm(bytes), percentBytes(bytes, HEX.lower), percentBytes(bytes, HEX.upper));
    for (const shift of [0, 1, 2]) forms.push(base64Core(bytes, shift));
  }
  return forms.filter((form, i) => form.length >= 4 && forms.findIndex((other) => other.equals(form)) === i).sort((x, y) => y.length - x.length);
}

/** The answer without the key, in case the platform repeats it (plain, escaped for JSON or an address, or as base64): the key goes back to the page nowhere. */
export function withoutKey(body, apiKey) {
  const marker = Buffer.from('[key removed]');
  let current = body;
  for (const form of keyForms(apiKey)) {
    if (current.indexOf(form) < 0) continue;
    const parts = [];
    let from = 0;
    for (let at = current.indexOf(form, from); at >= 0; at = current.indexOf(form, from)) {
      parts.push(current.subarray(from, at), marker);
      from = at + form.length;
    }
    parts.push(current.subarray(from));
    current = Buffer.concat(parts);
  }
  return current;
}

/** The upstream answer as a Buffer, or null when it is larger than `limit` (read as a stream, so it is never held whole). */
async function readCapped(upstream, limit) {
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { await upstream.body?.cancel?.(); return null; }
  if (!upstream.body?.getReader) {
    const whole = Buffer.from(await upstream.arrayBuffer());
    return whole.length > limit ? null : whole;
  }
  const reader = upstream.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createChatHandler({ token, timeoutMs, bodyLimit, answerLimit = MAX_ANSWER_BYTES, hostOk, originOk, relayFetch }) {
  return async function handleChat(req, res) {
    if (req.headers['x-relay-token'] !== token || !hostOk(req.headers.host)
      || (req.headers.origin !== undefined && !originOk(req.headers.origin))) {
      req.resume();
      return fail(res, 403, 'forbidden', 'The request was not accepted by the local relay.');
    }
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
      req.resume();
      return fail(res, 415, 'bad_content_type', 'The request must be JSON.');
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > bodyLimit) {
      req.resume();
      return fail(res, 413, 'too_large', 'The request is larger than the relay accepts.');
    }
    const text = await readBody(req, bodyLimit);
    if (text === null) return fail(res, 413, 'too_large', 'The request is larger than the relay accepts.');

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const url = checkedEndpoint(parsed?.endpoint);
    const apiKey = parsed?.apiKey;
    const payload = parsed?.payload;
    if (!url || typeof apiKey !== 'string' || apiKey === '' || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return fail(res, 400, 'bad_request', 'The request needs an http(s) endpoint, an API key, and a payload object.');
    }

    // Stop (the page closes the connection) aborts the upstream call; so does the timeout.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });

    try {
      const upstream = await relayFetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (upstream.type === 'opaqueredirect' || (upstream.status >= 300 && upstream.status < 400)) {
        return fail(res, 502, 'upstream_redirect', 'The platform answered with a redirect, which the relay does not follow.');
      }
      const body = await readCapped(upstream, answerLimit);
      if (body === null) {
        controller.abort();
        return fail(res, 502, 'upstream_too_large', 'The platform answered with more than 8 MB, which the relay does not accept.');
      }
      res.writeHead(upstream.status, { ...passedHeaders(upstream), ...SECURITY_HEADERS, 'X-Relay-Upstream': '1' });
      return res.end(withoutKey(body, apiKey));
    } catch {
      if (res.writableEnded || res.destroyed) return undefined; // the page went away
      if (timedOut) return fail(res, 504, 'upstream_timeout', `The platform did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      return fail(res, 502, 'upstream_unreachable', 'The platform could not be reached (network, DNS, or TLS problem).');
    } finally {
      clearTimeout(timer);
    }
  };
}
