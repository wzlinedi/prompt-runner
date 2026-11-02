// Runs INSIDE the page (served by the e2e harness): small helpers for the scenarios.
// Assertions are soft (recorded, the scenario goes on); `require` stops the scenario.

export function createDriver(config) {
  const failures = [];
  const notes = {};
  const downloads = [];
  const blobs = new Map();

  // Downloads: capture the blob instead of saving a file.
  URL.createObjectURL = (blob) => { const url = `blob:e2e/${blobs.size}`; blobs.set(url, blob); return url; };
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    if (this.download && blobs.has(this.getAttribute('href'))) { downloads.push({ name: this.download, blob: blobs.get(this.getAttribute('href')) }); return; }
    return originalClick.call(this);
  };

  const byId = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const t = {
    config,
    byId,
    sleep,
    visible: (id) => { const el = byId(id); return Boolean(el) && !el.hidden && !el.closest('[hidden]'); },
    text: (id) => (byId(id)?.textContent ?? ''),
    value: (id) => byId(id)?.value ?? '',
    click(idOrEl) {
      const el = typeof idOrEl === 'string' ? byId(idOrEl) : idOrEl;
      if (!el) throw new Error(`click: no element ${idOrEl}`);
      if (el.disabled) throw new Error(`click: ${idOrEl} is disabled`);
      el.click();
    },
    /** The re-run choice `id` (all, failedMain, judges, failedJudges) in the run panel or, with `inReport`, in the report's toolbar. */
    rerunButton(id, inReport = false) {
      const button = document.querySelector(`#${inReport ? 'rvRerunBox' : 'rerunBox'} [data-rerun="${id}"]`);
      if (!button) throw new Error(`no re-run choice ${id}`);
      return button;
    },
    chooseRerun(id, inReport = false) { t.click(t.rerunButton(id, inReport)); },
    type(id, text) {
      const el = byId(id);
      if (!el) throw new Error(`type: no element ${id}`);
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    check(id, on = true) {
      const el = byId(id);
      if (el.checked !== on) { el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }
    },
    async waitFor(predicate, what = 'condition', { timeout = 120_000, step = 50 } = {}) {
      const start = performance.now();
      while (!predicate()) {
        if (performance.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
        await sleep(step);
      }
    },
    /** Soft assertion: recorded, the scenario continues. */
    assert(condition, message) { if (!condition) failures.push(message); return Boolean(condition); },
    equal(actual, expected, message) {
      const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
      if (!ok) failures.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      return ok;
    },
    match(text, regex, message) { if (!regex.test(String(text))) failures.push(`${message}: ${JSON.stringify(String(text).slice(0, 200))} does not match ${regex}`); },
    /** Hard assertion: stops the scenario. */
    require(condition, message) { if (!condition) throw new Error(`required: ${message}`); },
    note(key, value) { notes[key] = value; },
    downloads,
    async lastDownload(name) {
      const found = [...downloads].reverse().find((d) => d.name === name);
      return found ? found.blob.text() : null;
    },
    storageEmpty() {
      let local = 0; let session = 0;
      try { local = localStorage.length; session = sessionStorage.length; } catch { /* blocked storage counts as empty */ }
      return local === 0 && session === 0 && document.cookie === '';
    },
    crash(error) { failures.push(`crashed: ${error?.stack ?? error}`); },
    finish() {
      const pre = document.createElement('pre');
      pre.id = '__e2e_result';
      pre.textContent = JSON.stringify({ failures, notes, downloads: downloads.map((d) => d.name) });
      document.body.appendChild(pre);
    },
  };
  return t;
}
