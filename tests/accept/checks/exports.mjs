// The exports as real downloads in the browser, under the page's security policy (spec FR-061, research R32).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkExport } from '../checkers.mjs';
import { startSession, runAndWait } from './helpers.mjs';

const isJudge = (content) => content.includes('SCORE: <number>');

async function saveBoth(ctx, t) {
  const { d } = ctx;
  const dir = path.join(ctx.folder, 'downloads');
  const html = await d.download(dir, () => d.click('#rvHtml'));
  const csv = await d.download(dir, () => d.click('#rvCsv'));
  const read = { html: await readFile(html.path, 'utf8'), csv: await readFile(csv.path, 'utf8') };
  t.evidence(path.join('downloads', html.name), Buffer.byteLength(read.html));
  t.evidence(path.join('downloads', csv.name), Buffer.byteLength(read.csv));
  return { html: { ...html, text: read.html }, csv: { ...csv, text: read.csv } };
}

export const exportChecks = [
  {
    id: 'exports.real-downloads', group: 'exports', timeoutMs: 120_000, row: 'Exports', title: 'Export HTML and Export CSV download real files that open without the app and hold no key or address',
    async run(t, ctx) {
      const fake = await ctx.useFake();
      await startSession(ctx, { rows: ['PL'] });
      await runAndWait(ctx.d);
      const files = await saveBoth(ctx, t);
      const secrets = [ctx.key, fake.endpoint, '127.0.0.1', new URL(ctx.appUrl).host];
      t.expect(/\.html$/.test(files.html.name) && /\.csv$/.test(files.csv.name), `the files are named ${files.html.name} and ${files.csv.name}`);
      for (const [kind, file] of [['html', files.html], ['csv', files.csv]]) {
        const result = checkExport({ kind, text: file.text, secrets });
        t.problems(result.problems.map((p) => `${file.name}: ${p}`));
      }
      t.expect(files.html.text.length > 5000 && /Report – Prompt Runner/.test(files.html.text), 'the HTML export is too small or has no title');
      t.expect(files.csv.text.split('\r\n').filter(Boolean).length === 2, 'the CSV does not have a header and one line per row');
    },
  },
  {
    id: 'exports.csv-formulas', group: 'exports', timeoutMs: 90_000, row: 'CSV formulas', title: 'A text that starts with = is written with a leading quote in the CSV',
    async run(t, ctx) {
      await ctx.useFake({ rules: [{ match: (b, c) => !isJudge(c), respond: { content: '=SUM(1,1)' } }] });
      await startSession(ctx, { rows: ['PL'] });
      await runAndWait(ctx.d);
      const files = await saveBoth(ctx, t);
      t.expect(files.csv.text.includes('"\'=SUM(1,1)"'), 'the cell does not start with a quote in front of =SUM(1,1)');
      t.problems(checkExport({ kind: 'csv', text: files.csv.text, secrets: [ctx.key] }).problems);
    },
  },
];
