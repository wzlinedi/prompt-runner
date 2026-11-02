import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeKey, keyForms } from '../accept/leak.mjs';
import { scanDirectory, scanFiles, scanText, scanSnapshot, scanStorage, scanCookies, scanNetwork } from '../accept/scanners.mjs';

const key = makeKey();
const forms = keyForms(key);

async function tree(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scan-test-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

test('a planted copy is found in a text file, a binary file, and a nested directory; counts are given', async () => {
  const dir = await tree({ 'a.txt': `x ${key.text}`, 'bin/b.dat': Buffer.concat([Buffer.alloc(100, 1), Buffer.from(key.text)]), 'deep/er/c.log': 'clean', 'd.txt': 'clean too' });
  try {
    const out = await scanDirectory(dir, forms);
    assert.equal(out.examined.files, 4);
    assert.ok(out.examined.bytes > 100);
    const places = out.hits.map((h) => path.basename(h.where)).sort();
    assert.deepEqual([...new Set(places)], ['a.txt', 'b.dat']);
    assert.ok(out.hits.every((h) => !h.excerpt.includes(key.distinctive)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('files not changed since the start are not examined', async () => {
  const dir = await tree({ 'old.txt': key.text, 'new.txt': key.text });
  try {
    const long = new Date(Date.now() - 3600_000);
    await utimes(path.join(dir, 'old.txt'), long, long);
    const out = await scanDirectory(dir, forms, { since: Date.now() - 60_000 });
    // ctime of the old file is fresh on Linux; the rule is "mtime or ctime after the start"
    assert.ok(out.examined.files >= 1);
    assert.ok(out.hits.some((h) => h.where.endsWith('new.txt')));
    const later = await scanDirectory(dir, forms, { since: Date.now() + 60_000 });
    assert.equal(later.examined.files, 0);
    assert.deepEqual(later.hits, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a file above the limit is skipped and listed; node_modules and .git are left out', async () => {
  const dir = await tree({ 'big.bin': Buffer.alloc(2000, 1), 'node_modules/x/leak.txt': key.text, '.git/leak.txt': key.text, 'ok.txt': 'fine' });
  try {
    const out = await scanFiles([dir, path.join(dir, 'missing')], forms, { maxBytes: 1000 });
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].bytes, 2000);
    assert.equal(out.hits.length, 0);
    assert.equal(out.examined.files, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('texts, snapshot strings, storage and cookies report a planted copy and nothing else', () => {
  assert.equal(scanText('console', ['fine', `log ${key.text}`], forms).hits.length > 0, true);
  assert.equal(scanText('console', ['fine', 'also fine'], forms).hits.length, 0);
  assert.equal(scanSnapshot('page memory', ['short', `the value is ${key.text}`], forms).hits.length > 0, true);
  assert.equal(scanSnapshot('page memory', ['no key here, just some text'], forms).examined.strings, 1);
  assert.equal(scanStorage([{ kind: 'local', name: 'k', value: key.text }], forms).hits.length > 0, true);
  const none = scanStorage([], forms);
  assert.equal(none.nothingCanExist, true);
  assert.equal(scanCookies([{ name: 'sid', value: key.text, domain: 'x' }], forms).hits.length > 0, true);
});

const chat = (body) => ({ method: 'POST', url: 'http://127.0.0.1:9000/api/chat', headers: {}, body });
const fakeWith = (authorization, rest = {}) => ({ path: '/v1/chat/completions', authorization, bodyText: '{"messages":[]}', ...rest });

test('the two permitted uses are accepted', () => {
  const out = scanNetwork({ requests: [chat(JSON.stringify({ apiKey: key.text }))], fakeRequests: [fakeWith(`Bearer ${key.text}`)] }, forms);
  assert.deepEqual(out.hits, []);
  assert.equal(out.empty, false);
  assert.equal(out.examined.pageToRelay, 1);
  assert.equal(out.examined.relayToPlatform, 1);
});

test('the key in an address, a header, a cookie, a response, or a request to another place is reported', () => {
  const cases = {
    address: { requests: [{ method: 'GET', url: `http://x/?k=${key.text}`, headers: {} }] },
    header: { requests: [{ method: 'GET', url: 'http://x/', headers: { 'x-k': key.text } }] },
    cookie: { requests: [{ method: 'GET', url: 'http://x/', headers: { cookie: `s=${key.text}` } }] },
    other: { requests: [{ method: 'POST', url: 'http://x/log', headers: {}, body: key.text }] },
    response: { responses: [{ url: 'http://x/', headers: {}, body: `echo ${key.text}` }] },
    platformBody: { fakeRequests: [fakeWith('Bearer other', { bodyText: key.text })] },
    platformAddress: { fakeRequests: [fakeWith('Bearer other', { path: `/v1/${key.text}` })] },
    platformOddAuth: { fakeRequests: [fakeWith(`Basic ${key.text} more`)] },
  };
  for (const [name, input] of Object.entries(cases)) assert.ok(scanNetwork(input, forms, { needUses: false }).hits.length > 0, `${name} not reported`);
});

test('a response is searched for the whole key only; the bare distinctive part in a response is not a hit, but is one in a request', () => {
  const piece = `id ${key.distinctive}`;
  assert.deepEqual(scanNetwork({ responses: [{ url: 'http://x/', headers: {}, body: piece }] }, forms, { needUses: false }).hits, []);
  assert.ok(scanNetwork({ requests: [{ method: 'GET', url: 'http://x/', headers: { 'x-id': piece } }] }, forms, { needUses: false }).hits.length > 0);
  assert.ok(scanNetwork({ responses: [{ url: 'http://x/', headers: {}, body: key.text }] }, forms, { needUses: false }).hits.length > 0);
});

test('an examination where the permitted uses did not happen is reported as empty', () => {
  assert.equal(scanNetwork({ requests: [chat('{}')], fakeRequests: [fakeWith('Bearer other')] }, forms).empty, true);
  assert.equal(scanNetwork({ requests: [chat(key.text)], fakeRequests: [] }, forms).empty, true);
  assert.equal(scanNetwork({ requests: [], fakeRequests: [] }, forms).empty, false); // a way that sent nothing
});
