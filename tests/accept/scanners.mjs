// What is examined in each place of the key audit, as pure functions over plain records (spec FR-067, FR-070, FR-073,
// research R37, R39, R42). Every scanner returns `{ examined, skipped, hits, empty }`: what was looked at (counts), what was
// left out, the hits (place, where, form, masked excerpt), and whether the place could hold nothing at all.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { findKey, excerpt, mask } from './leak.mjs';

const MB = 1024 * 1024;
// Only plain forms show a (masked) excerpt; an encoded form is reported by its name and place alone, so that the report never holds a key in any form.
const PLAIN = new Set(['key/utf-8', 'part/utf-8', 'key/json', 'part/json', 'key/percent', 'part/percent']);
const hitsIn = (place, where, data, forms) => findKey(data, forms).map((h) => ({ place, where: mask(where), form: h.form, excerpt: PLAIN.has(h.form) ? excerpt(data, h.offset) : '(not shown)' }));
const result = (examined, hits, extra = {}) => ({ examined, skipped: [], hits, empty: false, ...extra });

/** Every file under `dir` changed after `since` (ms), as bytes; a file above `maxBytes` is skipped and listed. */
export async function scanDirectory(dir, forms, { since = 0, maxBytes = 50 * MB, skip = () => false, place = 'files' } = {}) {
  const out = result({ files: 0, bytes: 0 }, []);
  async function walk(current) {
    let names;
    try { names = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of names) {
      const full = path.join(current, entry.name);
      if (skip(full)) continue;
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile()) continue;
      let info;
      try { info = await stat(full); } catch { continue; }
      if (info.mtimeMs < since && info.ctimeMs < since) continue;
      if (info.size > maxBytes) { out.skipped.push({ path: full, bytes: info.size }); continue; }
      let data;
      try { data = await readFile(full); } catch { continue; }
      out.examined.files += 1;
      out.examined.bytes += data.length;
      out.hits.push(...hitsIn(place, full, data, forms));
    }
  }
  await walk(dir);
  return out;
}

const SKIPPED_NAMES = new Set(['node_modules', '.git']);

/** Several roots, not `node_modules` and `.git`; a root that does not exist counts as nothing. */
export async function scanFiles(roots, forms, options = {}) {
  const out = result({ files: 0, bytes: 0 }, []);
  const userSkip = options.skip ?? (() => false);
  for (const root of roots) {
    const one = await scanDirectory(root, forms, { ...options, skip: (p) => SKIPPED_NAMES.has(path.basename(p)) || userSkip(p) });
    out.examined.files += one.examined.files;
    out.examined.bytes += one.examined.bytes;
    out.skipped.push(...one.skipped);
    out.hits.push(...one.hits);
  }
  return out;
}

/** Texts such as the log, the console messages, the page text, or the history; `texts` is a list of strings or `{ where, text }`. */
export function scanText(place, texts, forms) {
  const hits = [];
  let characters = 0;
  texts.forEach((item, i) => {
    const text = typeof item === 'string' ? item : item.text;
    characters += text.length;
    hits.push(...hitsIn(place, typeof item === 'string' ? `${place} ${i + 1}` : item.where, text, forms));
  });
  return result({ entries: texts.length, characters }, hits);
}

/** The strings of a heap snapshot. */
export function scanSnapshot(place, strings, forms) {
  const hits = [];
  for (const [i, s] of strings.entries()) if (typeof s === 'string' && s.length >= 8) hits.push(...hitsIn(place, `string ${i}`, s, forms));
  return result({ snapshots: 1, strings: strings.length }, hits);
}

/** Entries of storage (`{ kind, name, value }`); "none can exist" when there are no entries. */
export function scanStorage(entries, forms) {
  const hits = [];
  for (const e of entries) hits.push(...hitsIn('storage', `${e.kind} ${e.name}`, `${e.name}\n${e.value ?? ''}`, forms));
  return result({ entries: entries.length }, hits, { empty: false, nothingCanExist: entries.length === 0 });
}

/** Cookies (`{ name, value, domain }`). */
export function scanCookies(cookies, forms) {
  const hits = [];
  for (const c of cookies) hits.push(...hitsIn('cookies', `cookie ${c.name}`, `${c.name}=${c.value ?? ''}; ${c.domain ?? ''}`, forms));
  return result({ cookies: cookies.length }, hits, { nothingCanExist: cookies.length === 0 });
}

const headerText = (headers = {}) => Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');

/**
 * The traffic of the page and the fake platform. The key may be (1) in the body of a request from the page to the relay's
 * `/api/chat` and (2) in the `Authorization: Bearer` header of a request that reached the fake. Anywhere else it is a hit.
 * With `needUses`, a way that sent requests must show both uses, or the examination is empty.
 */
export function scanNetwork({ requests = [], responses = [], fakeRequests = [] }, forms, { needUses = true } = {}) {
  const hits = [];
  const wholeKey = forms.filter((f) => f.name.startsWith('key/')); // an answer is expected to be free of the whole key only (FR-074)
  let pageToRelay = 0;
  let relayToPlatform = 0;
  for (const r of requests) {
    const toRelay = r.method === 'POST' && /\/api\/chat(\?|$)/.test(r.url);
    hits.push(...hitsIn('network', `request address ${r.method} ${r.url}`, r.url, forms));
    hits.push(...hitsIn('network', `request headers ${r.url}`, headerText(r.headers), forms));
    if (toRelay) { if (findKey(r.body ?? '', forms).length) pageToRelay += 1; } else hits.push(...hitsIn('network', `request body ${r.method} ${r.url}`, r.body ?? '', forms));
  }
  for (const r of responses) {
    hits.push(...hitsIn('network', `response headers ${r.url}`, headerText(r.headers), wholeKey));
    hits.push(...hitsIn('network', `response body ${r.url}`, r.body ?? '', wholeKey));
  }
  for (const f of fakeRequests) {
    hits.push(...hitsIn('network', `platform request address ${f.path}`, f.path, forms));
    hits.push(...hitsIn('network', 'platform request body', f.bodyText ?? '', forms));
    const auth = f.authorization ?? '';
    if (findKey(auth, forms).length) {
      if (/^Bearer \S+$/.test(auth)) relayToPlatform += 1;
      else hits.push(...hitsIn('network', 'platform request, an Authorization that is not a plain Bearer', auth, forms));
    }
  }
  const sent = requests.some((r) => /\/api\/chat(\?|$)/.test(r.url)) || fakeRequests.length > 0;
  const empty = needUses && sent && (pageToRelay === 0 || relayToPlatform === 0);
  return result({ requests: requests.length, responses: responses.length, fakeRequests: fakeRequests.length, pageToRelay, relayToPlatform }, hits, { empty });
}
