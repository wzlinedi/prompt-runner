// The privacy check of the quickstart (section 5), run on what this walk-through really produced (spec FR-061, SC-035).
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { checkLog, checkFolder } from '../checkers.mjs';
import { startSession, runAndWait } from './helpers.mjs';

export const privacyChecks = [
  {
    id: 'privacy.relay-log', group: 'privacy', row: null, title: 'The log of the application\'s own process holds no key and no prompt text',
    async run(t, ctx) {
      const log = await readFile(ctx.relayLog, 'utf8');
      t.expect(/POST \/api\/chat 200/.test(log), 'the log shows no request: the check would prove nothing');
      t.problems(checkLog(log, [ctx.key, 'Selected indicators', 'Summarize below data', 'EDITED WHILE RUNNING']).problems);
      t.evidence('relay.log');
    },
  },
  {
    id: 'privacy.exports', group: 'privacy', row: null, title: 'The downloaded exports hold no key and no address',
    async run(t, ctx) {
      const dir = path.join(ctx.folder, 'downloads');
      const names = await readdir(dir);
      t.expect(names.length >= 2, `only ${names.length} downloaded files to check`);
      const files = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(path.join(dir, n), 'utf8')])));
      t.problems(checkFolder(files, [ctx.key, '127.0.0.1', 'http://localhost']).problems);
    },
  },
  {
    id: 'privacy.storage', group: 'privacy', timeoutMs: 90_000, row: null, title: 'Nothing is kept in the browser after a run: no storage, no cookie, no database, no cache',
    async run(t, ctx) {
      const { d } = ctx;
      await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      await runAndWait(d);
      const seen = await d.evaluate(async () => ({
        local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
        databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length,
        keyFields: [document.getElementById('mainKey').value, document.getElementById('judgeKey').value],
      }));
      t.expect(seen.local === 0 && seen.session === 0 && seen.cookie === '' && seen.databases === 0 && seen.caches === 0, `the browser holds ${JSON.stringify(seen)}`);
      t.expect(seen.keyFields.every((v) => v === ''), 'a key field still holds a key after the run');
    },
  },
];
