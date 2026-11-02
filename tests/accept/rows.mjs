// Which check answers which row of the quickstart (spec FR-059, research R35). A row of the tables of quickstart.md section 3
// must have an entry here (a check id, or { human: reason }); the coverage test and the run itself fail otherwise.

export const HUMAN = {
  look: 'Whether the page looks as professional as the reference page is a judgment. The gallery of screenshots is prepared; the user decided that the implementer judges it.',
  usability: 'The usability check with a first-time user (SC-011, SC-032) is waived by the user.',
  live: 'The live check with the user\'s own API key is run by the user, with real data, once the implementer has declared the system ready (tests/live/check.mjs).',
};

/** Rows of the tables of quickstart.md section 3: row name -> check id. */
export const ROWS = {
  'Start screen offers only New Session': 'flow.start',
  'Wrong dataset gives a specific message': 'flow.dataset-errors',
  'Placeholder check': 'flow.placeholder',
  'Judges share the model by default': 'flow.judges-share-model',
  'Confirmation before sending': 'flow.confirmation',
  'Report view': 'flow.report-view',
  'Test case card': 'flow.case-card',
  'Differences': 'flow.differences',
  'Back to the form': 'flow.back-to-form',
  'Re-run choices': 'flow.rerun-choices',
  'New Session everywhere': 'flow.new-session-everywhere',
  'Failed row and re-run': 'flow.failed-rerun',
  'Row selection': 'flow.row-selection',
  'Judge re-run': 'flow.judge-rerun',
  'Stop': 'flow.stop',
  'Exports': 'exports.real-downloads',
  'Closing with unexported results': 'flow.unload-guard',
  'Locked form while confirming': 'flow.locked-form',
  'Edits during a run': 'flow.edits-during-run',
  'Unclosed quote': 'flow.unclosed-quote',
  'Judge score forms': 'flow.score-forms',
  'Stop after a failed load': 'flow.stop-after-failed-load',
  'Plain `http` warning': 'flow.http-warning',
  'CSV formulas': 'exports.csv-formulas',
  'Modern page, look': 'appearance.matrix',
  'Step indicator and chips': 'flow.chips-steps',
  'Live readiness list': 'flow.readiness',
  'JSON badge': 'flow.json-badge',
  'Bottom bar': 'appearance.bottom-bar',
  'Reduced motion': 'appearance.reduced-motion',
  'Keyboard only': 'keyboard.full-flow',
  'Key is never stored': 'keyguard.audit',
};

/** Entries that answer parts of the quickstart that are not rows of the table (section 5, section 4) or that stay human. */
export const EXTRA = {
  'Privacy: relay log': 'privacy.relay-log',
  'Privacy: exports': 'privacy.exports',
  'Privacy: browser storage': 'privacy.storage',
  'Human: the look of the page': { human: HUMAN.look },
  'Human: usability with a first-time user': { human: HUMAN.usability },
  'Human: live check with a real key': { human: HUMAN.live },
};

/** The names of the rows of the tables of section 3 of the quickstart (the first column, without the header). */
export function quickstartRows(markdown) {
  const section = /^## 3\.[\s\S]*?(?=^## 4\.)/m.exec(markdown)?.[0] ?? '';
  return section.split('\n')
    .filter((line) => line.startsWith('| ') && !/^\|\s*-/.test(line) && !/^\|\s*Check\s*\|/.test(line))
    .map((line) => line.split('|')[1].trim());
}

/** The problems of the map against the quickstart and against the registered checks (an empty list: all covered). */
export function coverageProblems(markdown, registeredIds) {
  const problems = [];
  const rows = quickstartRows(markdown);
  const known = new Set(registeredIds);
  for (const row of rows) if (!(row in ROWS)) problems.push(`the quickstart row "${row}" has no check and no human entry`);
  for (const row of Object.keys(ROWS)) if (!rows.includes(row)) problems.push(`"${row}" is mapped but is not a row of the quickstart`);
  for (const [row, entry] of [...Object.entries(ROWS), ...Object.entries(EXTRA)]) {
    if (typeof entry === 'string' && !known.has(entry)) problems.push(`"${row}" names the check ${entry}, which no module registers`);
    if (typeof entry !== 'string' && !entry.human) problems.push(`"${row}" is a human entry without a reason`);
  }
  return problems;
}
