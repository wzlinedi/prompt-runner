// A tab driven the way a person drives it: pointer clicks at the position of a control, typed text, key presses (spec FR-060,
// research R31), plus what the walk-through needs from the browser itself: screenshots, real downloads, the dark and the
// reduced-motion settings, widths, and the dialogs of the page (research R32).
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
};
const SHIFT = 8;
const CTRL = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDriver({ cdp, page }) {
  const { session, browserContextId } = page;
  const dialogs = [];
  let media = { scheme: 'light', motion: 'no-preference' };
  let dialogAnswer = false; // a beforeunload dialog is refused by default: the walk-through stays on the page

  session.on('Page.javascriptDialogOpening', (params) => {
    dialogs.push({ type: params.type, message: params.message });
    session.send('Page.handleJavaScriptDialog', { accept: dialogAnswer }).catch(() => {});
  });

  /** Runs `fn(...args)` in the page and returns its value (a promise is awaited). */
  async function evaluate(fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`In the page: ${String(detail).split('\n')[0]}`);
    }
    return result.result.value;
  }

  const driver = {
    session,
    dialogs,
    evaluate,
    sleep,

    /** Loads a page. Leaving a page with unexported results raises the browser's confirmation, which the walk-through accepts here. */
    async open(url) {
      const before = dialogAnswer;
      dialogAnswer = true;
      try {
        const loaded = session.waitFor('Page.loadEventFired', () => true, { timeoutMs: 20_000 });
        await session.send('Page.navigate', { url });
        await loaded;
      } finally {
        dialogAnswer = before;
      }
    },

    /** Resolves when `fn(...args)` returns something true in the page (polled), or throws after the time limit. */
    async waitFor(fn, { timeoutMs = 20_000, what = 'a condition', args = [] } = {}) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        if (await evaluate(fn, ...args)) return;
        if (Date.now() > end) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
        await sleep(100);
      }
    },

    /** Evaluates a ready expression (such as the contrast measurement of contrast.mjs) in the page. */
    async evaluateExpression(expression) {
      const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`In the page: ${String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).split('\n')[0]}`);
      return result.result.value;
    },

    async viewport(width, height) {
      await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    },

    /** The system's colour scheme (`light` or `dark`) and motion setting (`no-preference` or `reduce`). */
    async setMedia(next = {}) {
      media = { ...media, ...next };
      await session.send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: media.scheme },
        { name: 'prefers-reduced-motion', value: media.motion },
      ] });
    },

    /** Where a pointer click on `selector` would land: its centre, and whether the control itself is what is there. */
    async locate(selector) {
      return evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: 'not found' };
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return { error: 'has no size (hidden?)' };
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        const hit = Boolean(top) && (top === el || el.contains(top));
        const describe = (e) => (e ? `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${e.className && typeof e.className === 'string' ? `.${e.className.trim().split(/\s+/)[0]}` : ''}` : 'nothing');
        return { x, y, hit, coveredBy: hit ? null : describe(top), disabled: Boolean(el.disabled) };
      }, selector);
    },

    /** A pointer click on the centre of the control. Fails when the control is missing, disabled, or covered, as a person could not use it. */
    async click(selector, { force = false } = {}) {
      const spot = await driver.locate(selector);
      if (spot.error) throw new Error(`click ${selector}: ${spot.error}`);
      if (!force && spot.disabled) throw new Error(`click ${selector}: the control is disabled`);
      if (!force && !spot.hit) throw new Error(`click ${selector}: covered by ${spot.coveredBy}`);
      const point = { x: spot.x, y: spot.y, button: 'left', clickCount: 1 };
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y });
      await session.send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed' });
      await session.send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased' });
      return spot;
    },

    /** Types text key by key into what has the focus (a line break is the Enter key). */
    async type(text) {
      for (const ch of text) {
        if (ch === '\n') { await driver.press('Enter'); continue; }
        await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
        await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
    },

    /** What a paste does: the whole text at once into what has the focus. */
    async paste(text) {
      await session.send('Input.insertText', { text });
    },

    /** One key, or `Shift+Tab`, with the key-down and the key-up of a real key press. */
    async press(name) {
      const shift = name.startsWith('Shift+');
      const def = KEYS[shift ? name.slice(6) : name];
      if (!def) throw new Error(`press: unknown key ${name}`);
      const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, modifiers: shift ? SHIFT : 0 };
      await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(def.text ? { text: def.text, unmodifiedText: def.text } : {}) });
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },

    /** Selects everything in what has the focus and deletes it. */
    async clearFocused() {
      await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: CTRL, commands: ['selectAll'] });
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: CTRL });
      await driver.press('Backspace');
    },

    /** Click the field, replace its content with typed text (`paste: true`: as a paste). */
    async fill(selector, text, { paste = false } = {}) {
      await driver.click(selector);
      await driver.clearFocused();
      if (paste) await driver.paste(text); else await driver.type(text);
    },

    /** Describes what has the focus now: who it is, whether a focus ring shows. */
    focused() {
      return evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { id: null, tag: 'body', visible: false };
        const s = getComputedStyle(el);
        const wrapper = el.closest('.editor');
        const ring = wrapper ? getComputedStyle(wrapper) : s;
        const label = el.getAttribute('aria-label') || (el.labels && el.labels[0]?.textContent) || el.textContent || el.getAttribute('value') || '';
        return {
          id: el.id || null, tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), role: el.getAttribute('role'),
          name: label.trim().replace(/\s+/g, ' ').slice(0, 60),
          outlineWidth: parseFloat(ring.outlineWidth) || 0, outlineStyle: ring.outlineStyle, boxShadow: s.boxShadow,
          visible: (parseFloat(ring.outlineWidth) > 0 && ring.outlineStyle !== 'none') || s.boxShadow !== 'none',
          href: el.getAttribute('href'), field: el.dataset?.field ?? null, inEditor: Boolean(wrapper),
        };
      });
    },

    async screenshot(file, { full = false } = {}) {
      await mkdir(path.dirname(file), { recursive: true });
      const params = { format: 'png' };
      if (full) {
        const size = await evaluate(() => ({ w: Math.ceil(document.documentElement.scrollWidth), h: Math.min(Math.ceil(document.documentElement.scrollHeight), 6000) }));
        Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 } });
      }
      const { data } = await session.send('Page.captureScreenshot', params);
      await writeFile(file, Buffer.from(data, 'base64'));
      return file;
    },

    /** Runs `trigger` (a click on an export button), waits until the browser has saved the file into `dir`, and returns its path. */
    async download(dir, trigger) {
      await mkdir(dir, { recursive: true });
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, browserContextId, eventsEnabled: true });
      const begun = cdp.waitFor('Browser.downloadWillBegin', () => true, { timeoutMs: 15_000 });
      begun.catch(() => {}); // a failing trigger must not leave an unhandled rejection behind
      const finished = new Map(); // listened to from before the click: a small file can be complete before the next line runs
      const stop = cdp.on('Browser.downloadProgress', (p) => { if (p.state === 'completed') finished.set(p.guid, true); });
      try {
        await trigger();
        const { guid, suggestedFilename } = await begun;
        const end = Date.now() + 15_000;
        while (!finished.has(guid)) {
          if (Date.now() > end) throw new Error('Waited 15000 ms for Browser.downloadProgress.');
          await sleep(25);
        }
        return { name: suggestedFilename, path: path.join(dir, suggestedFilename) };
      } finally {
        stop();
      }
    },

    /** What a dialog of the page is answered with (false: stay on the page). */
    answerDialogs(accept) { dialogAnswer = accept; },
  };
  return driver;
}
