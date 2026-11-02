// Placeholders in prompts: `{name}` with letters, digits, and underscores; `{{` and `}}` are literal braces.
// Pure module: no DOM access (spec FR-008, FR-010; data-model: PromptSet).

/** The three prompts and the places each may use. */
export const PROMPT_KINDS = {
  main: { label: 'Main prompt', allowed: ['prompt_input'], required: ['prompt_input'] },
  accuracy: { label: 'Judge Accuracy', allowed: ['prompt_input', 'output'], required: ['prompt_input', 'output'] },
  completeness: { label: 'Judge Completeness', allowed: ['prompt_input', 'output'], required: ['prompt_input', 'output'] },
};

const PLACEHOLDER = /^\{([A-Za-z0-9_]+)\}/;

/**
 * Splits a prompt into tokens: { raw, out } for text (out is what is sent: `{{` gives `{`)
 * and { raw, name } for placeholders. Anything in braces that is not a valid name is ordinary text.
 */
export function tokenize(text) {
  const source = String(text ?? '');
  const tokens = [];
  let i = 0;
  const pushText = (raw, out) => {
    const last = tokens[tokens.length - 1];
    if (last && last.name === undefined) { last.raw += raw; last.out += out; } else tokens.push({ raw, out });
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '{' && source[i + 1] === '{') { pushText('{{', '{'); i += 2; continue; }
    if (ch === '}' && source[i + 1] === '}') { pushText('}}', '}'); i += 2; continue; }
    if (ch === '{') {
      const m = PLACEHOLDER.exec(source.slice(i));
      if (m) { tokens.push({ raw: m[0], name: m[1] }); i += m[0].length; continue; }
    }
    pushText(ch, ch);
    i += 1;
  }
  return tokens;
}

/** The placeholders of a prompt, in order, with repeats. */
export function findPlaceholders(text) {
  return tokenize(text).filter((t) => t.name !== undefined).map((t) => t.name);
}

/**
 * Replaces placeholders by their values in one pass: a value that itself contains `{output}` or `{{`
 * is inserted literally and never processed again. A placeholder without a value stays as written.
 */
export function fill(text, values) {
  return tokenize(text).map((t) => {
    if (t.name === undefined) return t.out;
    return Object.hasOwn(values, t.name) ? String(values[t.name]) : t.raw;
  }).join('');
}

/** For the editor overlay: the source text split into plain / known / unknown parts, characters unchanged. */
export function sourceSegments(text, allowed) {
  return tokenize(text).map((t) => (t.name === undefined
    ? { text: t.raw, type: 'plain' }
    : { text: t.raw, type: allowed.includes(t.name) ? 'known' : 'unknown' }));
}

/** For the example and previews: the text that is sent, split into plain / value / unknown parts. */
export function outputSegments(text, values) {
  return tokenize(text).map((t) => {
    if (t.name === undefined) return { text: t.out, type: 'plain' };
    return Object.hasOwn(values, t.name) ? { text: String(values[t.name]), type: 'value' } : { text: t.raw, type: 'unknown' };
  });
}

/** Problems that block a run, in plain English, each naming the prompt. Empty when the prompt is fine. */
export function checkPrompt(kind, text) {
  const spec = PROMPT_KINDS[kind];
  if (!spec) throw new Error(`Unknown prompt kind: ${kind}`);
  const names = findPlaceholders(text);
  const problems = [];
  for (const required of spec.required) {
    if (!names.includes(required)) problems.push(`${spec.label}: {${required}} is missing.`);
  }
  const allowedList = spec.allowed.map((n) => `{${n}}`).join(', ');
  for (const name of [...new Set(names.filter((n) => !spec.allowed.includes(n)))]) {
    problems.push(`${spec.label}: unknown placeholder {${name}} (allowed: ${allowedList}).`);
  }
  return problems;
}
