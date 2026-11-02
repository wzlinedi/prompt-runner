import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appFiles, read, relative } from '../helpers/app-files.mjs';

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

test('every text of the page and the server is English: no Polish letters in app/ (spec FR-036)', async () => {
  for (const file of await appFiles()) {
    const lines = (await read(file)).split('\n');
    lines.forEach((line, i) => assert.ok(!POLISH.test(line), `${relative(file)}:${i + 1} contains a Polish letter: ${line.trim().slice(0, 80)}`));
  }
});

test('the page declares English and the start button is "New Session"', async () => {
  const html = await read((await appFiles()).find((f) => relative(f) === 'public/index.html'));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<button class="primary" id="newSession" type="button">New Session<\/button>/);
});
