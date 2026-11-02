// Lists the source files of the app for the static scans.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

export async function appFiles(dir = APP_DIR) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await appFiles(full));
    else if (/\.(mjs|js|html|css)$/.test(entry.name)) files.push(full);
  }
  return files;
}

export async function read(file) {
  return readFile(file, 'utf8');
}

export const relative = (file) => path.relative(APP_DIR, file).split(path.sep).join('/');
