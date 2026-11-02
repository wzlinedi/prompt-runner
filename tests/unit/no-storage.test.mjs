import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appFiles, read, relative } from '../helpers/app-files.mjs';

/** Source without comments, so that a comment may name what the code must not do. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const FORBIDDEN_EVERYWHERE = [
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  [/document\s*\.\s*cookie/, 'document.cookie'],
  [/\bcaches\s*\.\s*open\b/, 'the Cache API'],
  [/\bopenDatabase\b/, 'openDatabase'],
];
const FILE_WRITES = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|writeSync|mkdir|mkdirSync|rename|unlink|rm|rmSync)\b/;
const OUTPUT = /\bconsole\s*\.|process\s*\.\s*(stdout|stderr)\b|\bprocess\s*\.\s*emitWarning\b/;

test('no browser storage anywhere in app/ (spec FR-029, constitution Principle I)', async () => {
  const files = await appFiles();
  assert.ok(files.length > 15, 'the scan found the files');
  for (const file of files) {
    const text = code(await read(file));
    for (const [pattern, name] of FORBIDDEN_EVERYWHERE) assert.ok(!pattern.test(text), `${relative(file)} uses ${name}`);
  }
});

test('the server side writes no files', async () => {
  for (const file of await appFiles()) {
    if (relative(file).startsWith('public/')) continue;
    assert.ok(!FILE_WRITES.test(code(await read(file))), `${relative(file)} writes to the file system`);
  }
});

test('only output.mjs writes to the terminal: the access log and one startup message', async () => {
  const offenders = [];
  for (const file of await appFiles()) {
    if (OUTPUT.test(code(await read(file)))) offenders.push(relative(file));
  }
  assert.deepEqual(offenders, ['output.mjs']);
  const output = code(await read((await appFiles()).find((f) => relative(f) === 'output.mjs')));
  const functions = [...output.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(functions, ['writeAccessLog', 'announce']);
  assert.equal((output.match(/process\s*\.\s*stdout\s*\.\s*write/g) ?? []).length, 2);
});

test('the page code prints nothing to the console', async () => {
  for (const file of await appFiles()) {
    if (!relative(file).startsWith('public/')) continue;
    assert.ok(!/\bconsole\s*\./.test(code(await read(file))), `${relative(file)} writes to the console`);
  }
});

test('the access log line has no place for anything but time, method, path, status, and duration', async () => {
  const server = code(await read((await appFiles()).find((f) => relative(f) === 'server.mjs')));
  const calls = [...server.matchAll(/\blog\(([^;]*)\);/g)].map((m) => m[1]);
  assert.equal(calls.length, 1);
  assert.ok(!/headers|body|apiKey|payload|query|search|url/i.test(calls[0].replace(/req\.url/g, '')), calls[0]);
});
