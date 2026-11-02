// The only two places where the server side writes to the terminal.
// Everything else stays silent, so no key, prompt, header, or answer can ever reach a log
// (spec FR-016; the static check in tests/unit/no-storage.test.mjs enforces it).

/** Access log: one line per request with time, method, path, status, duration. Nothing else. */
export function writeAccessLog(line) {
  process.stdout.write(`${line}\n`);
}

/** Startup message: the listening address and nothing else. */
export function announce(url) {
  process.stdout.write(`Prompt Runner is running at ${url}\n`);
}
