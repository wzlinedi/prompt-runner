// The design tokens of the report and of the application page, defined once (spec FR-048).
// Each token has a light and a dark value; `tokensCss(selector, extra)` writes them as custom properties for a selector
// (the dark values under `prefers-color-scheme: dark`). The report uses it for `.rpt`, the server for `:root` (`GET /styles.css`).
// Pure module: no DOM access, no external fonts, images, or scripts.

/** Shared by the page and the report: [name, light, dark]. */
export const SHARED_TOKENS = [
  ['bg', '#f4f6fb', '#0d111c'],
  ['surface', '#fff', '#151b2b'],
  ['surface2', '#f8f9fd', '#1a2133'],
  ['text', '#141a2a', '#e8ecf6'],
  ['muted', '#5a6479', '#a1abc2'],
  ['line', '#e2e6f0', '#2a3350'],
  ['accent', '#4f46e5', '#9aa5ff'],
  ['accent-soft', '#eceafd', '#232a52'],
  ['on-accent', '#fff', '#10131a'],
  ['good', '#0d7a4a', '#6fdca0'],
  ['goodbg', '#dff5e9', '#143525'],
  ['mid', '#8a5300', '#f3c46c'],
  ['midbg', '#fff0d1', '#3a2d10'],
  ['ring-mid', '#b36b00', '#f3c46c'],
  ['low', '#b42318', '#ff9d93'],
  ['lowbg', '#fde4e1', '#3d1c1a'],
  ['shadow', '0 1px 2px rgba(20,26,42,.06),0 8px 24px rgba(20,26,42,.06)', '0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)'],
  ['hero1', '#312e81', '#1e1b4b'],
  ['hero2', '#4f46e5', '#312e81'],
  ['hero3', '#7c3aed', '#4c1d95'],
  ['herotext', '#fff', '#fff'],
];

/** Only the report needs these (the marks of the word differences). */
export const REPORT_TOKENS = [
  ['insbg', '#d4f3df', '#14402a'],
  ['delbg', '#fbdad6', '#4a1f1b'],
  ['delfg', '#8a1c12', '#ffb4ab'],
];

/** Only the page needs these (highlighted places and inserted values in the prompt editors). */
export const PAGE_TOKENS = [
  ['ph', '#e0defb', '#2e3566'],
  ['val', '#fff0b8', '#4a4015'],
];

const declarations = (tokens, index) => tokens.map((token) => `--${token[0]}:${token[index]}`).join(';');

/** The tokens as CSS for `selector`: the light values, then the dark ones under the system's dark setting. */
export function tokensCss(selector, extra = []) {
  const tokens = [...SHARED_TOKENS, ...extra];
  return `${selector}{${declarations(tokens, 1)}}\n@media (prefers-color-scheme:dark){${selector}{${declarations(tokens, 2)}}}`;
}
