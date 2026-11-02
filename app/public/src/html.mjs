// Small HTML helpers shared by the page and the report renderer. No DOM access at import time.

/** Escapes text for use inside HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Shows a long value shortened with its length and expandable (spec FR-006). */
export function shortHtml(text, max = 110) {
  const value = String(text ?? '');
  if (value.length <= max) return esc(value);
  const head = value.slice(0, max).replace(/\s+/g, ' ');
  return `<details><summary>${esc(head)}… (${value.length} characters)</summary>${esc(value)}</details>`;
}
