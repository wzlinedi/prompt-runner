# Prompt Runner: instructions for AI assistants

Prompt Runner is a local tool for one user. It needs Node.js 22 or newer and nothing else: no `npm install`, no build step, no Chrome. Tests are **not** required to use it.

## If the user asks you to install, set up, or start it

Guide the user to a running page. The user's only work is to give the data, edit the prompts, and type the endpoint and the API key into the page. Do the rest yourself, and tell the user in a few words what you are doing.

1. **Check Node.js.** Run `node -v`. If it is missing or older than 22, tell the user and offer to install Node.js 22 (for example with `nvm install 22`, or the system package manager). Install only after the user agrees.
2. **Start the app** from the repository root: `node app/server.mjs` (or `npm start`), in the background. It prints the address, by default `http://127.0.0.1:8787`; if the port is taken it prints another one. Read the address from its output, never guess it.
3. **Open the page.** Open the printed address in the user's browser (`xdg-open <address>` on Linux, `open` on macOS), or give the user the address if you cannot open it.
4. **Walk the user through the page.** Tell them to press **New Session**, then fill steps 1–5 from top to bottom (see the README): the dataset (**Insert sample** loads five example rows), the main prompt, the two judge prompts, the configuration (endpoint, API key, and the JSON with the model), and finally **Run** and **Confirm and send**. Explain what each step is for when asked; the page itself says what still blocks a run.
5. **Stop the server** when the user is done.

### Tests before starting?

Not needed. `npm test` (about 12 seconds, no key, no Chrome) is an optional check. Run it only if the user asks, or if the app does not start or behaves strangely. `npm run test:e2e`, `npm run accept`, and `npm run audit:key` need Chrome or Chromium and are for development, not for using the tool.

## The API key (hard rule)

The user types the key **into the page**, and only there. Never ask the user to paste a key into the chat, never read it from an environment variable or a file to fill it in for them, and never write it to any file, command line, log, or message. If the user pastes a key into the chat anyway, do not repeat it and tell them to type it into the page instead.

## Rules of the project when you change code

- The specification in `specs/001-simple-prompt-runner/` is the source of truth; a change of behavior starts there.
- The tool is local and single-user: the relay listens on `127.0.0.1` only. Do not add hosting, accounts, or a public interface.
- No dependencies and no build step. Plain ES modules.
- Keys live in memory only: never in a file, browser storage, log, URL, or export.
- Run `npm test` after a change. The page language is English.
