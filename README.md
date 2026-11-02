# Prompt Runner

A small local tool for trying a prompt on a dataset and checking the answers. You load a dataset, edit a main prompt, review two ready-made QA judge prompts (Accuracy and Completeness), run everything against a model endpoint, and read an HTML report that you can export as HTML or CSV.

It runs on your own computer, for one user. There is nothing to install: Node.js 22 or newer is all it needs (no dependencies, no build step).

## Start

```bash
node app/server.mjs        # or: npm start
```

Open the address it prints (default `http://127.0.0.1:8787`). If the port is taken, a free one is used and printed.

The server serves the page and passes your chat requests on to the endpoint you configure (the hosted platform does not accept calls straight from a web page). It listens on the loopback address only.

## The five steps

Press **New Session**, then fill the page from top to bottom:

1. **Dataset** – paste text or choose a file with the columns `id`, `name`, `prompt_input`, `expected_result` (tab, semicolon, or comma separated, detected automatically). "Insert sample" loads five countries in the Eurostat format. Tick the rows to run: at most 20 per run (the first 20 are selected by default).
2. **Main prompt** – text with `{prompt_input}`; below it you see the complete prompt for a row of your choice.
3. **LLM as Judge** – two prompts (Accuracy, Completeness) using `{prompt_input}` and `{output}`. Each judge returns a percentage and a rationale; the answer format is added by the app and shown in the preview.
4. **Configuration** – endpoint, API key, and one JSON with the model and its parameters. The judges use the same model by default; switch that off to give them their own endpoint, key, and JSON.
5. **Run** – the app tells you how many requests it will send, to which endpoint and model, and which data they contain; nothing is sent until you confirm. While that confirmation is open, steps 1–4 are locked (only **Confirm and send** and **Cancel** act), so what you confirmed is exactly what is sent; a started run keeps its own copy, and edits made while it runs apply to the next run. An `http://` endpoint outside your computer gets a warning in the confirmation, because the key and the data would travel unencrypted. Progress, **Stop**, and the confirmation are in step 5.

The page has the look of the report: a **header band** with chips (rows loaded, rows selected out of 20, model, judges, whether a report exists – never a key or an address), a **step indicator** that shows each step as not available, current, done (with a short fact such as "5 rows, 3 selected"), or needing attention, and the **run panel** beside the steps (below them on narrower windows). The panel lists **live** everything that still blocks a run, grouped by step; an item moves you to its field, and **Run** stays unavailable until the list is empty ("Ready to run.", with the number of requests and the models). Below 1100 px a **bar at the bottom** of the window shows the state and the one main action (Run, Stop, or Open report). The JSON fields show a badge ("valid · model" or what is wrong), the editors count characters, and a dataset file can be dropped on the dataset card. Motion is subtle (at most 250 ms) and switched off when your system asks for reduced motion; the whole flow works with the keyboard alone, from 500 to 1920 px wide, in the light and in the dark setting of your system.

Running again is one control, **Re-run**, with four choices, in the run panel and in the toolbar of the report: **Re-run all** (main prompts and judges on the rows of the last run), **Re-run failing main prompts and all related judges**, **Re-run all judges**, and **Re-run only the failing judges**. Each shows how many requests it would send, and one that cannot be used says why (a run is in progress, nothing failed, no row has an output). If one judge request of ten rows fails, "Re-run only the failing judges" sends exactly that one. A choice made in the report leads back to the form for the key. **New Session** is one button in the header band, also in the report; after a confirmation it removes the report and the session.

When the run ends, the page switches by itself to the **report**, which uses the full width of the window: a header band, cards with the averages, a summary table, the prompts and models used, the collapsed archive of the prompts, and one card per test case. Each card shows the prompt input, the expected result, the actual output, the similarity, and the differences (words only in the expected result struck through, words only in the actual output underlined) side by side, with the grade and the rationale of each judge below. Long texts are shown in full in boxes that scroll inside themselves. The report follows the light or dark setting of your system, and stacks on narrow windows. **Back to the form** returns to the unchanged steps; step 5 then offers **Open report**, **Export HTML**, **Export CSV**, and the **Re-run** control (see above; **Re-run all judges** is the one to use after editing a judge prompt). In the CSV, a text that begins with `=`, `+`, `-`, `@`, a tab, or a carriage return starts with a single quote (`'`), so that a spreadsheet shows it as text instead of evaluating it as a formula; numbers and dates are unchanged.

The default endpoint and parameters are those of the NVIDIA-hosted models (`https://integrate.api.nvidia.com/v1/chat/completions`); any chat endpoint that accepts the same request shape works.

## Privacy

API keys are kept in memory only, masked on screen, and cleared when a run or any re-run ends, fails, or is stopped. They are never written to a file, browser storage, a log, a URL, or an export. The local server keeps no state, and logs only time, method, path, status, and duration of each request – never keys, prompts, or answers. Its pages carry a strict content-security policy (they load only their own files and cannot be shown inside another site), the exported HTML report cannot load anything when opened from disk, and an answer from the platform larger than 8 MB is refused. Results exist only in the open page: **export them before you close or reload it** (the page warns you).

## Tests

```bash
npm test                   # unit and contract tests, including the relay tests and a self-test of the live check
npm run test:e2e           # end-to-end scenarios in headless Chrome against a fake platform (Chrome or Chromium required)
```

```bash
npm run accept             # the acceptance walk-through: a real Chrome, real clicks and key presses, real downloads, light and dark, 500–1920 px (about 3 minutes)
npm run audit:key          # the key audit: proves a typed API key is stored nowhere (about 2 minutes)
```

`npm run accept` replaces the hand walk-through of the [quickstart](specs/001-simple-prompt-runner/quickstart.md): it starts the application and the fake platform, goes through every row of the quickstart table, presses Tab through the whole flow, downloads the exports, checks the log for any key, and writes `test-results/acceptance-<date>-<time>/` with `report.html` (verdicts, evidence, a gallery of screenshots next to the reference page), the downloaded files, and `relay.log`. It needs Chrome or Chromium and no key. Exit status 0 means every check passed; 1 a check failed; 2 it could not run. The look of the page, a usability check with a first-time user, and the live check with your own key are not decided by it (the report lists them).

None of these calls the real platform. To check your own key and the platform's behavior once, run the live check, which prints only non-secret facts and never your key:

```bash
read -rs NVIDIA_API_KEY && export NVIDIA_API_KEY && node tests/live/check.mjs
```

## More

- [Specification](specs/001-simple-prompt-runner/spec.md) – what the tool does and why
- [Quickstart](specs/001-simple-prompt-runner/quickstart.md) – how to validate it by hand
- [Plan](specs/001-simple-prompt-runner/plan.md) and [tasks](specs/001-simple-prompt-runner/tasks.md)

`npm run audit:key` types a fake key and ends a run in seven ways (normal with both exports, the platform repeating the key in an error, Stop, judges re-run, failed-requests re-run, New Session during a run, a key typed and never used), then searches for the key, in several encodings, in the files changed meanwhile, the browser's profile on disk, the application's log, the memory of the page and of the application, the console, the network traffic, history, cookies, storage, the exports, and the page text. It first plants copies of the key in every place to prove that it would see them. The key may only be in the request from the page to the relay and in the `Authorization` header to the platform. It does not look at your terminal, the clipboard, swap files, your everyday browser, or the platform's side. The report shows places against ways in a table. Needs Chrome or Chromium; no real key.

## License

MIT, see [LICENSE](LICENSE).
