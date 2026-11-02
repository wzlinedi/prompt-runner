// The contrast of the text as it is rendered (spec FR-062, SC-027, research R33). The pure functions are tested with
// fixtures; `MEASURE` is the same functions plus a walker, as one expression that the driver runs inside the page.

/** `rgb(…)`, `rgba(…)`, or `transparent` (what the browser reports) as [r, g, b, a]; null when it is something else. */
export function parseColor(text) {
  if (!text) return null;
  if (text === 'transparent') return [0, 0, 0, 0];
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text.trim());
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
  return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

/** `top` ([r, g, b, a]) painted over `bottom` ([r, g, b]); the result is [r, g, b]. */
export function blend(top, bottom) {
  const a = top[3] === undefined ? 1 : top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
}

export function luminance(color) {
  const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}

/** The contrast ratio of two [r, g, b] colours (1 to 21). */
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The worst contrast of a text colour over several possible backgrounds (the colour stops of a gradient). */
export function worstRatio(foreground, backgrounds) {
  return Math.min(...backgrounds.map((bg) => ratio(blend(foreground, bg), bg)));
}

/** Runs in the page: every visible text with a ratio below the limit. Receives the functions above. */
function walk(parseColor, blend, ratio, limit) {
  const failures = [];
  let measured = 0;
  let exempt = 0;
  const describe = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 3; e = e.parentElement) {
      parts.unshift(e.id ? `#${e.id}` : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/)[0]}` : ''));
      if (e.id) break;
    }
    return parts.join(' > ');
  };
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
    if (el.closest('[hidden], [aria-hidden="true"]')) continue; // hidden from people (such as the layer under the prompt editors)
    // What lies inside a closed disclosure (except its summary) is not shown, so it is not measured.
    const closed = el.closest('details:not([open])');
    if (closed && !el.closest('summary') && closed.contains(el)) continue;
    // Text of a control that cannot be used right now (disabled, locked while a confirmation is open) is exempt: the standard
    // does not ask for contrast of inactive components.
    if (el.closest('[inert], [aria-disabled="true"], :disabled')) { exempt += 1; continue; }
    // Where the text lies: every ancestor's background, painted from the outermost; a gradient is one background per colour stop.
    let backgrounds = [[255, 255, 255]];
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let opacity = 1;
    for (const e of chain) {
      const s = getComputedStyle(e);
      opacity *= Number(s.opacity);
      if (/gradient/.test(s.backgroundImage)) {
        const stops = [...s.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map((m) => parseColor(m[0])).filter(Boolean);
        if (stops.length) backgrounds = stops.flatMap((stop) => backgrounds.map((bg) => blend(stop, bg)));
      } else {
        const c = parseColor(s.backgroundColor);
        if (c && c[3] > 0) backgrounds = backgrounds.map((bg) => blend(c, bg));
      }
      // A disc or a panel drawn by ::before over the element's own background (the centre of a gauge is one): text above it lies on it.
      const before = getComputedStyle(e, '::before');
      if (before.content !== 'none' && before.position === 'absolute') {
        const c = parseColor(before.backgroundColor);
        if (c && c[3] > 0 && e !== el) backgrounds = backgrounds.map((bg) => blend(c, bg));
      }
    }
    const fg = parseColor(style.color);
    if (!fg) continue;
    fg[3] = (fg[3] ?? 1) * opacity;
    measured += 1;
    const worst = Math.min(...backgrounds.map((bg) => ratio(blend(fg, bg), bg)));
    if (worst < limit) failures.push({ selector: describe(el), text: own.slice(0, 40), color: style.color, ratio: Math.round(worst * 100) / 100 });
  }
  return { measured, exempt, failures };
}

/** The expression to evaluate in the page (the functions are the very ones above). */
export const MEASURE = `(() => {
${[parseColor, blend, luminance, ratio].map(String).join('\n')}
return (${walk.toString()})(parseColor, blend, ratio, 4.5);
})()`;
