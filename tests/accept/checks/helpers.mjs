// Small helpers shared by the checks: what a person does on the page, with real input (spec FR-060).
export const SAMPLE_IDS = ['PL', 'CZ', 'SK', 'HU', 'DE'];

export const text = (d, selector) => d.evaluate((s) => document.querySelector(s)?.textContent ?? '', selector);
export const value = (d, selector) => d.evaluate((s) => document.querySelector(s)?.value ?? '', selector);
export const visible = (d, selector) => d.evaluate((s) => { const e = document.querySelector(s); return Boolean(e) && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0; }, selector);
export const disabled = (d, selector) => d.evaluate((s) => Boolean(document.querySelector(s)?.disabled), selector);
export const count = (d, selector) => d.evaluate((s) => document.querySelectorAll(s).length, selector);

/** Clears the selection and ticks the given rows with the pointer. */
export async function selectOnly(d, ids) {
  await d.click('#selNone');
  for (const id of ids) await d.click(`input[data-select="${id}"]`);
}

/** Opens the page, presses New Session, and (optionally) loads the sample, selects rows, and types the endpoint and the key. */
export async function startSession(ctx, { sample = true, rows = null, key = true, endpoint = true } = {}) {
  const { d } = ctx;
  await d.open(ctx.appUrl);
  await d.click('#newSession');
  if (sample) await d.click('#dsSample');
  if (sample && rows) await selectOnly(d, rows);
  if (endpoint && ctx.fake) await d.fill('#mainEp', ctx.fake.endpoint);
  if (key) await d.fill('#mainKey', ctx.key);
}

export const waitForReport = (d, timeoutMs = 90_000) => d.waitFor(() => !document.getElementById('reportView').hidden && document.querySelectorAll('#report .case').length > 0, { timeoutMs, what: 'the report' });

/** Run, confirm, and wait until the report opens by itself. */
export async function runAndWait(d, timeoutMs) {
  await d.click('#run');
  await d.click('#confirmYes');
  await waitForReport(d, timeoutMs);
}

/** The state after one finished run of the first row: the page is on the report. Done once per page (`mem`). */
export async function ensureReport(ctx, { rows = ['PL'], fakeOptions = {} } = {}) {
  if (ctx.mem.reportDone) return; // the page is on the report or, after "Back to the form", on the form with its results
  await ctx.useFake(fakeOptions);
  await startSession(ctx, { rows });
  await runAndWait(ctx.d);
  ctx.mem.reportDone = true;
}

export const RERUN_BOX = (inReport = false) => (inReport ? '#rvRerunBox' : '#rerunBox');

/** What the page shows for one re-run choice: whether it is there, unavailable, and the line beside it. */
export const rerunChoice = (d, id, inReport = false) => d.evaluate((box, choice) => {
  const button = document.querySelector(`${box} [data-rerun="${choice}"]`);
  return { exists: Boolean(button), disabled: Boolean(button?.disabled), note: button?.closest('li')?.querySelector('.why')?.textContent ?? '' };
}, RERUN_BOX(inReport), id);

/** Opens the re-run control with the pointer (when it is closed) and presses one choice, as a person does. */
export async function chooseRerun(d, id, { inReport = false } = {}) {
  const box = RERUN_BOX(inReport);
  if (!await d.evaluate((b) => document.querySelector(`${b} details`).open, box)) await d.click(`${box} summary`);
  await d.click(`${box} [data-rerun="${id}"]`);
}
