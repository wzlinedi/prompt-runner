// Makes the voice-over clips of the demo video with Piper (an offline text to speech), one WAV per line of tools/demo-narration.mjs.
// Nothing leaves this computer and no key is needed. Piper and a voice model are set up outside the repository:
//   PIPER_PYTHON   a Python that has the `piper-tts` package (default: python3)
//   PIPER_MODEL    the path of the voice model, a `.onnx` file with its `.onnx.json` beside it (required)
//   PIPER_SPEAKER  the speaker number of a multi-speaker model (default: 40 of en_US-libritts_r-medium)
//   node tools/make-voiceover.mjs            # makes the missing clips
//   node tools/make-voiceover.mjs --dry      # lists the lines and the number of characters, calls nothing
// A clip is kept by the hash of its model, speaker, and text, so an unchanged line is not made twice.
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NARRATION } from './demo-narration.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = process.env.PIPER_PYTHON || 'python3';
const MODEL = process.env.PIPER_MODEL || '';
const SPEAKER = process.env.PIPER_SPEAKER || '40';
export const CLIPS_DIR = path.join(root, 'test-results', 'voiceover');

export const clipName = (line) => `${line.id}-${createHash('sha1').update(`${path.basename(MODEL)}|${SPEAKER}|${line.say}`).digest('hex').slice(0, 10)}.wav`;
export const clipPath = (line) => path.join(CLIPS_DIR, clipName(line));

/** The length in seconds of a PCM WAV file, read from its header (the `data` chunk size over the byte rate). */
export function wavSeconds(file) {
  const buffer = readFileSync(file);
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') return byteRate ? Math.min(size, buffer.length - offset - 8) / byteRate : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dry = process.argv.includes('--dry');
  const chars = NARRATION.reduce((sum, line) => sum + line.say.length, 0);
  console.log(`${NARRATION.length} lines, ${chars} characters; model ${MODEL ? path.basename(MODEL) : '(PIPER_MODEL not set)'}, speaker ${SPEAKER}`);
  if (dry) {
    for (const line of NARRATION) console.log(`${line.id.padEnd(14)} ${line.say}`);
    process.exit(0);
  }
  if (!MODEL || !existsSync(MODEL)) { console.error('Set PIPER_MODEL to the path of a Piper voice model (.onnx).'); process.exit(2); }
  await mkdir(CLIPS_DIR, { recursive: true });
  let made = 0;
  let kept = 0;
  for (const line of NARRATION) {
    const file = clipPath(line);
    if (existsSync(file)) { kept += 1; continue; }
    const result = spawnSync(PYTHON, ['-m', 'piper', '-m', MODEL, '-s', SPEAKER, '-f', file], { input: line.say, encoding: 'utf8' });
    if (result.status !== 0 || !existsSync(file)) {
      console.error(`Piper failed for "${line.id}": ${String(result.stderr ?? '').trim().split('\n').slice(-3).join(' ')}`);
      process.exit(1);
    }
    made += 1;
    console.log(`made ${line.id} (${wavSeconds(file).toFixed(1)} s)`);
  }
  const total = NARRATION.reduce((sum, line) => sum + wavSeconds(clipPath(line)), 0);
  console.log(`Done: ${made} made, ${kept} kept; ${total.toFixed(0)} s of speech. Clips are in ${CLIPS_DIR}`);
}
