// Validation and derived values of the configuration block (spec FR-014, FR-015, FR-030).
// Pure functions: the keys are only read here, never stored or echoed.

const FORBIDDEN_KEYS = ['messages', 'stream'];

/** Parses the parameters text: `{ value }` for a valid object, `{ error }` with the English problem otherwise. */
export function parseParams(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { error: `the parameters are not valid JSON (${error.message.replace(/\s+/g, ' ')})` };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { error: 'the parameters must be a JSON object' };
  if (typeof value.model !== 'string' || value.model.trim() === '') return { error: 'the parameters must contain a non-empty text under "model"' };
  for (const key of FORBIDDEN_KEYS) {
    if (key in value) return { error: `the parameters must not contain "${key}" (the app sets it)` };
  }
  return { value };
}

function wellFormed(address) {
  try {
    const url = new URL(address);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Problems of one block as items `{ text, block, field }` (field: `endpoint`, `apiKey`, or `params`). */
function validateBlockDetailed(label, block, which) {
  const items = [];
  const add = (field, text) => items.push({ text: `${label}: ${text}`, block: which, field });
  const endpoint = block.endpoint.trim();
  if (!endpoint) add('endpoint', 'the endpoint is empty.');
  else if (!wellFormed(endpoint)) add('endpoint', 'the endpoint is not a well-formed http or https address.');
  if (!block.apiKey.trim()) add('apiKey', 'the API key is empty.');
  const parsed = parseParams(block.params);
  if (parsed.error) add('params', `${parsed.error}.`);
  return items;
}

/** All problems that block a run as items, main block first; judge fields count only while they are shown (spec FR-052). */
export function validateConfigDetailed(config) {
  const items = validateBlockDetailed('Main prompt', config.main, 'main');
  if (!config.judge.sameAsMain) items.push(...validateBlockDetailed('LLM as Judge', config.judge, 'judge'));
  return items;
}

/** All problems that block a run, main block first; judge fields count only while they are shown. */
export function validateConfig(config) {
  return validateConfigDetailed(config).map((item) => item.text);
}

/** Problems of the fields the judges use (for a judge re-run, which does not need the main block of a separate judge setup). */
export function validateJudgeConfig(config) {
  const source = effectiveJudgeConfig(config);
  return validateBlockDetailed('LLM as Judge', source, 'judge').map((item) => item.text);
}

/** What the judges actually use. */
export function effectiveJudgeConfig(config) {
  const source = config.judge.sameAsMain ? config.main : config.judge;
  return { endpoint: source.endpoint, apiKey: source.apiKey, params: source.params, sameAsMain: config.judge.sameAsMain };
}

/** The parameters as a `name=value` list: without `model`, `chat_template_kwargs` flattened. */
export function displayParams(text) {
  const parsed = parseParams(text);
  if (parsed.error) return '';
  const show = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
  const parts = [];
  for (const [name, value] of Object.entries(parsed.value)) {
    if (name === 'model') continue;
    if (name === 'chat_template_kwargs' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value)) parts.push(`${inner}=${show(innerValue)}`);
    } else {
      parts.push(`${name}=${show(value)}`);
    }
  }
  return parts.join(', ');
}

/** A hint (never a block) for a key that does not look like a platform key; the key is never echoed. */
export function keyHint(key) {
  if (!key || key.startsWith('nvapi-')) return '';
  return 'A key from the NVIDIA platform usually starts with "nvapi-". Check that you copied the whole key.';
}

/** True for an address on this computer: `localhost` (and its subdomains), `127.0.0.0/8`, or `::1` (spec FR-044). */
export function isThisComputer(endpoint) {
  try {
    const host = new URL(String(endpoint).trim()).hostname.toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host) || host === '[::1]';
  } catch {
    return false;
  }
}

/** True when the endpoint uses plain `http` and is not on this computer: key and data would travel unencrypted (spec FR-044). */
export function sendsUnencrypted(endpoint) {
  try {
    return new URL(String(endpoint).trim()).protocol === 'http:' && !isThisComputer(endpoint);
  } catch {
    return false;
  }
}

/** What the badge next to a parameters field says: `{ ok: true, model }` or `{ ok: false, problem }` (spec FR-053). */
export function describeParams(text) {
  const parsed = parseParams(text);
  return parsed.error ? { ok: false, problem: parsed.error } : { ok: true, model: parsed.value.model };
}
