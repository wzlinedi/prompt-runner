// One chat request through the local relay, and the reading of the answer (contracts/upstream-chat.md).
// Every text that comes from the platform is redacted (key, nvapi-… tokens, endpoint) and cut before it can
// become part of a row error, the report, or an export (spec FR-016). Nothing is retried (spec FR-019).

const MAX_PLATFORM_TEXT = 300;
const LENGTH_NOTE = 'no answer text returned: the length limit was reached before the answer';

/** The user's parameters as written, plus the messages and `stream: false` that the app sets itself. */
export function buildPayload(params, prompt) {
  return { ...params, messages: [{ role: 'user', content: prompt }], stream: false };
}

/** Anything shaped like a platform key replaced by `[key]` (no cutting): for texts the user wrote, such as the parameters (spec FR-045). */
export function hideKeys(text) {
  return String(text ?? '').replace(/nvapi-[A-Za-z0-9_-]+/g, '[key]');
}

/** The forms in which a key may be echoed: as entered, trimmed, and without a pasted `Bearer ` prefix or quotes. */
function keyForms(secret) {
  if (typeof secret !== 'string') return [];
  const trimmed = secret.trim().replace(/^["']|["']$/g, '').trim();
  const bare = trimmed.replace(/^bearer\s+/i, '').trim();
  return [secret, trimmed, bare];
}

/** The endpoint address and its host name: either may appear in a platform message. */
function endpointForms(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return [];
  const forms = [endpoint, endpoint.trim()];
  try { forms.push(new URL(endpoint.trim()).host); } catch { /* not a URL: the text itself is still removed */ }
  return forms;
}

/**
 * Longest first, so that an address is removed whole before its host. What was entered is removed as it is; the forms
 * derived from it (trimmed, without `Bearer `, the host name) only when they have at least 4 characters, because a
 * shorter piece would shred every message.
 */
const removable = (exact, derived) => [...new Set([...exact.filter((form) => typeof form === 'string' && form !== ''), ...derived.filter((form) => form.length >= 4)])]
  .sort((a, b) => b.length - a.length);

/**
 * Replaces the given keys (also trimmed, without `Bearer `) and anything shaped like a platform key by `[key]`, the given
 * endpoints (and their host names) by `[endpoint]`, and cuts the text (spec FR-016, FR-045).
 */
export function redact(text, secrets = [], endpoints = []) {
  let result = String(text ?? '');
  for (const form of removable(endpoints, endpoints.flatMap(endpointForms))) result = result.split(form).join('[endpoint]');
  for (const form of removable(secrets, secrets.flatMap(keyForms))) result = result.split(form).join('[key]');
  result = hideKeys(result);
  return result.length > MAX_PLATFORM_TEXT ? `${result.slice(0, MAX_PLATFORM_TEXT)}…` : result;
}

/** The platform's own message in a failed answer. */
function platformMessage({ json, text }) {
  const pick = json?.detail ?? json?.error?.message ?? json?.message ?? json?.title ?? json?.error;
  if (pick !== undefined && pick !== null) return typeof pick === 'string' ? pick : JSON.stringify(pick);
  return text ?? '';
}

function relayError(response) {
  const code = response.json?.error?.code;
  const unreachable = 'Platform or network problem: ';
  switch (code) {
    case 'upstream_unreachable': return `${unreachable}the platform could not be reached. Check the endpoint and your network.`;
    case 'upstream_timeout': return `${unreachable}the platform did not answer in time. Try again later.`;
    case 'upstream_redirect': return `${unreachable}the platform answered with a redirect. Check the endpoint address.`;
    case 'upstream_too_large': return "The platform's answer is too large (more than 8 MB).";
    case 'forbidden': return 'The local relay refused the request. Reload the page and start again.';
    case 'too_large': return 'The input is too long for the local relay.';
    default: return 'The local relay did not accept the request.';
  }
}

/**
 * Reads one answer. `response` is `{ status, viaUpstream, json, text, retryAfter }`.
 * Result: `{ output, cutOff, note? }` or `{ error }`.
 */
export function mapAnswer(response, secrets = [], endpoints = []) {
  const { status, viaUpstream, json } = response;
  if (!viaUpstream) return { error: relayError(response) };

  if (status === 200) {
    const choice = json?.choices?.[0];
    if (!choice || typeof choice !== 'object' || typeof choice.message !== 'object' || choice.message === null) {
      return { error: 'The platform answered in an unexpected format.' };
    }
    const cutOff = choice.finish_reason === 'length';
    const content = choice.message.content;
    if (typeof content === 'string' && content !== '') return { output: content, cutOff };
    return cutOff ? { output: '', cutOff, note: LENGTH_NOTE } : { output: '', cutOff };
  }

  const message = platformMessage(response);
  const detail = redact(message, secrets, endpoints);
  const http = `(HTTP ${status})`;
  if (status === 413 || /context (length|window)|maximum context|too many tokens/i.test(message)) {
    return { error: 'The input is too long for this model. Shorten the prompt input or choose a model with a longer context.' };
  }
  if (status === 400 || status === 422) {
    return { error: `The platform rejected the request ${http}. The parameters or the model are the likely cause. Platform message: ${detail}` };
  }
  if (status === 401 && /jwt/i.test(message)) {
    return { error: 'The platform did not recognise the key. A key from the NVIDIA platform starts with "nvapi-".' };
  }
  if (status === 401 || status === 403) {
    return { error: `The key was refused, or the model is not permitted for this key ${http}. Platform message: ${detail}` };
  }
  if (status === 404) {
    const said = detail ? ` Platform message: ${detail}` : '';
    return { error: `Unknown address or model ${http}. Check the endpoint and the model name; the platform also answers this way when a hosted model is briefly unavailable, so the same request may work later.${said}` };
  }
  if (status === 429) {
    const wait = response.retryAfter ? ` The platform asks to wait ${redact(response.retryAfter, secrets, endpoints)}.` : '';
    return { error: `Rate limit exceeded ${http}.${wait}` };
  }
  return { error: `Platform or network problem ${http}. ${detail}`.trim() };
}

/**
 * Sends one request through the relay. Result: the mapped answer, or `{ aborted: true }` when Stop cancelled it.
 * The key travels only in the body of this one request.
 */
export async function callChat({ endpoint, apiKey, payload, signal, relayToken = '', fetchImpl = globalThis.fetch.bind(globalThis) }) {
  let reply;
  try {
    reply = await fetchImpl('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Token': relayToken },
      body: JSON.stringify({ endpoint, apiKey, payload }),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) return { aborted: true };
    return { error: 'The local relay could not be reached. Is it still running? Start it again with "node app/server.mjs" and reload the page.' };
  }
  let text = '';
  try { text = await reply.text(); } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) return { aborted: true };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return mapAnswer({
    status: reply.status,
    viaUpstream: reply.headers.get('x-relay-upstream') === '1',
    json,
    text,
    retryAfter: reply.headers.get('retry-after'),
  }, [apiKey], [endpoint]);
}
