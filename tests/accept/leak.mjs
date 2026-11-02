// The fake key of the audit, its forms, and the search for it in bytes (spec FR-069, research R40).
import { randomBytes } from 'node:crypto';

const PREFIX = 'nvapi-FAKE-AUDIT-';

/** A fresh key: the whole text and its distinctive part (the 12 random characters). */
export function makeKey() {
  const distinctive = randomBytes(6).toString('hex');
  return { text: `${PREFIX}${distinctive}`, distinctive };
}

const utf16 = (s, bigEndian) => {
  const buffer = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) { if (bigEndian) buffer.writeUInt16BE(s.charCodeAt(i), i * 2); else buffer.writeUInt16LE(s.charCodeAt(i), i * 2); }
  return buffer;
};

/** The base64 of `bytes` as it appears inside a larger base64 text at the alignment `shift` (0..2), without the characters that depend on neighbours. */
function base64Core(bytes, shift) {
  const padded = Buffer.concat([Buffer.alloc(shift), bytes]);
  const text = padded.toString('base64').replace(/=+$/, '');
  const start = shift === 0 ? 0 : Math.ceil((shift * 8) / 6);
  const end = Math.floor(((shift + bytes.length) * 8) / 6);
  return text.slice(shift === 0 ? 0 : start, end);
}

/** Every form that is searched: `{ name, bytes }`, for the whole key and for its distinctive part. */
export function keyForms(key) {
  const forms = [];
  const seen = new Set();
  const add = (name, bytes) => {
    const buffer = Buffer.from(bytes);
    const id = buffer.toString('hex');
    if (buffer.length < 8 || seen.has(id)) return;
    seen.add(id);
    forms.push({ name, bytes: buffer });
  };
  for (const [label, text] of [['key', key.text], ['part', key.distinctive]]) {
    const raw = Buffer.from(text, 'utf8');
    add(`${label}/utf-8`, raw);
    add(`${label}/json`, Buffer.from(JSON.stringify(text).slice(1, -1), 'utf8'));
    add(`${label}/percent`, Buffer.from(encodeURIComponent(text), 'utf8'));
    add(`${label}/percent-all`, Buffer.from([...raw].map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''), 'utf8'));
    for (const shift of [0, 1, 2]) add(`${label}/base64+${shift}`, Buffer.from(base64Core(raw, shift), 'utf8'));
    add(`${label}/utf-16le`, utf16(text, false));
    add(`${label}/utf-16be`, utf16(text, true));
  }
  return forms;
}

/** Every hit of any form in a buffer (or text): `{ form, offset }`. */
export function findKey(data, forms) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const hits = [];
  for (const form of forms) {
    let from = 0;
    for (;;) {
      const offset = buffer.indexOf(form.bytes, from);
      if (offset < 0) break;
      hits.push({ form: form.name, offset });
      from = offset + 1;
      if (hits.length > 50) return hits;
    }
  }
  return hits;
}

/** A short piece of text around a hit, with every key-shaped run cut to its first 8 characters. */
export function excerpt(data, offset, length = 40) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const region = buffer.subarray(Math.max(0, offset - 10), offset + length).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
  return mask(region).replace(/[0-9a-f]{6,}/g, (m) => `${m.slice(0, 4)}…`); // a piece of a key cut by the window is masked too
}

/** Only the first 8 characters of a key-shaped text are kept (`nvapi-FAKE-AUDIT-abc…` → `nvapi-FA…`); the report never holds a whole key. */
export function mask(text) {
  return String(text).replace(/nvapi-FAKE-AUDIT-[0-9a-f]*/g, (m) => `${m.slice(0, 8)}…`).replace(/[0-9a-f]{12}/g, (m) => `${m.slice(0, 4)}…`);
}
