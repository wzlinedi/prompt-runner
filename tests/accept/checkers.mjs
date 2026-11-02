// The pure checkers of the walk-through (spec FR-061, FR-062, SC-034): each takes what was seen and returns the problems
// (an empty list means it is fine), so that each can be tested against good and deliberately broken fixtures.
import { tokenize } from '../../app/public/src/dataset.mjs';

const ok = (problems) => ({ ok: problems.length === 0, problems });
const leaks = (text, secrets) => secrets.filter((s) => s && text.includes(s)).map((s) => `contains "${s.length > 12 ? `${s.slice(0, 8)}…` : s}"`);

export const CSV_COLUMNS = 17;
const TRIGGER = /^[=+\-@\t\r]/;

/** A downloaded CSV (kind `csv`) or HTML (kind `html`) file, read back as text. */
export function checkExport({ kind, text, secrets = [] }) {
  const problems = [...leaks(text, secrets)];
  if (kind === 'csv') {
    if (text.charCodeAt(0) !== 0xfeff) problems.push('no byte-order mark at the start');
    if (!text.endsWith('\r\n')) problems.push('does not end with CRLF');
    if (/(?<!\r)\n(?=(?:[^"]*"[^"]*")*[^"]*$)/.test(text.slice(1))) problems.push('a line break outside the quotes is not CRLF');
    const records = tokenize(text.slice(1), ',');
    if (!records.length) problems.push('no records');
    const wrong = records.findIndex((r) => r.length !== CSV_COLUMNS);
    if (wrong >= 0) problems.push(`record ${wrong} has ${records[wrong].length} columns instead of ${CSV_COLUMNS}`);
    const unsafe = records.flat().find((cell) => TRIGGER.test(cell));
    if (unsafe !== undefined) problems.push(`a cell starts with a character that a spreadsheet evaluates and has no quote in front: "${unsafe.slice(0, 20)}"`);
  } else if (kind === 'html') {
    if (/<script/i.test(text)) problems.push('contains a script');
    if (/(?:src|href|action)\s*=\s*["']?https?:/i.test(text) || /url\(\s*["']?https?:/i.test(text)) problems.push('refers to an address outside the file');
    if (!/http-equiv="Content-Security-Policy"/i.test(text)) problems.push('no content-security policy');
  } else {
    problems.push(`unknown kind ${kind}`);
  }
  return ok(problems);
}

/** The log of the application's own process: no key, no prompt text. */
export function checkLog(text, secrets = []) {
  return ok(leaks(text, secrets));
}

/**
 * The stops of a keyboard walk (what had the focus after each key) against the controls that must be reached, in order:
 * each expected id appears, in that relative order, with a visible focus ring; the focus is never lost to the page body
 * between the first and the last expected stop.
 */
export function checkTabOrder(stops, expectedIds) {
  const problems = [];
  let from = 0;
  for (const id of expectedIds) {
    const at = stops.findIndex((stop, i) => i >= from && stop.id === id);
    if (at < 0) {
      problems.push(stops.some((stop) => stop.id === id) ? `${id} is reached out of order` : `${id} is never reached`);
      continue;
    }
    if (!stops[at].visible) problems.push(`${id} has the focus but shows no focus ring`);
    from = at + 1;
  }
  const first = stops.findIndex((stop) => stop.id === expectedIds[0]);
  const last = stops.length - 1;
  const lost = stops.findIndex((stop, i) => i > first && i <= last && stop.id === null && stop.tag === 'body');
  if (first >= 0 && lost >= 0) problems.push(`the focus was lost to the page after ${stops[lost - 1]?.id ?? 'the start'}`);
  return ok(problems);
}

/** Horizontal overflow: the page must not be wider than the window (1 px of rounding is allowed). */
export function checkOverflow({ scrollWidth, innerWidth }) {
  return ok(scrollWidth - innerWidth > 1 ? [`the page is ${scrollWidth - innerWidth} px wider than the window`] : []);
}

/** Controls that something else covers: `{ selector, hit, coveredBy }` as the driver reports them. */
export function checkCovered(controls) {
  return ok(controls.filter((c) => !c.hit).map((c) => `${c.selector} is covered by ${c.coveredBy}`));
}

/** Under reduced motion: every transition lasts 0 and no animation runs. */
export function checkMotion(items) {
  const problems = [];
  for (const item of items) {
    if (!String(item.transitionDuration).split(',').every((d) => parseFloat(d) === 0)) problems.push(`${item.name} has a transition of ${item.transitionDuration}`);
    if (item.animationName && item.animationName !== 'none') problems.push(`${item.name} runs the animation ${item.animationName}`);
  }
  return ok(problems);
}

/** The result of the contrast measurement of the page (contrast.mjs). */
export function checkContrast({ measured, failures }) {
  const problems = failures.map((f) => `${f.selector} "${f.text}" has ${f.ratio}:1 (${f.color})`);
  if (!measured) problems.push('no text was measured');
  return ok(problems);
}

/** Files of the run folder (name -> text) that must not contain a key. */
export function checkFolder(files, secrets) {
  return ok(Object.entries(files).flatMap(([name, text]) => leaks(text, secrets).map((p) => `${name} ${p}`)));
}

/** Whether the browser really applied the requested appearance and motion setting: `seen` is what `matchMedia` answers. */
export function mediaAccepted(seen, wanted) {
  const problems = [];
  if (wanted.scheme && seen.dark !== (wanted.scheme === 'dark')) problems.push(`the browser did not apply the ${wanted.scheme} appearance`);
  if (wanted.motion && seen.reduce !== (wanted.motion === 'reduce')) problems.push(`the browser did not apply the motion setting "${wanted.motion}"`);
  return { ok: problems.length === 0, reason: problems.join('; ') };
}

/** The kinds of control that the page has, as they must each show a focus ring. */
export const FOCUS_KINDS = ['button', 'link', 'text-input', 'password-input', 'file-input', 'checkbox', 'select', 'editor', 'textarea', 'summary'];

/** The kind of the control that has the focus (`stop` as the driver reports it), or null for something else. */
export function focusKind(stop) {
  switch (stop.tag) {
    case 'button': return 'button';
    case 'a': return 'link';
    case 'select': return 'select';
    case 'summary': return 'summary';
    case 'textarea': return stop.inEditor ? 'editor' : 'textarea';
    case 'input': return { password: 'password-input', file: 'file-input', checkbox: 'checkbox' }[stop.type] ?? 'text-input';
    default: return null;
  }
}

/** A walk of Tab stops: every required kind of control was met, and every stop on a control shows a focus ring. */
export function checkFocusKinds(stops, required = FOCUS_KINDS) {
  const problems = [];
  const met = new Set();
  for (const stop of stops) {
    const kind = focusKind(stop);
    if (!kind) continue;
    met.add(kind);
    if (!stop.visible) problems.push(`no focus ring on the ${kind} ${stop.id ?? stop.name ?? ''}`.trim());
  }
  const missing = required.filter((kind) => !met.has(kind));
  if (missing.length) problems.push(`the walk never met: ${missing.join(', ')}`);
  return ok(problems);
}
