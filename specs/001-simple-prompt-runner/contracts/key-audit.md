# Contract: The key audit (places, ways of ending a run, forms, permitted uses, report)

**Spec**: FR-066 – FR-073, User Story 11, SC-037 – SC-040 | **Research**: R36 – R43 | **Used by**: `tests/accept/checks/keyguard.mjs`, `leak.mjs`, `scanners.mjs`, `sandbox.mjs`, `package.json` (`audit:key`)

A development tool that extends [acceptance-run.md](acceptance-run.md). It uses a fake key and the fake platform only; it never contacts the real platform and needs no key.

## Command

```bash
npm run audit:key                 # = node tests/accept/run.mjs --only keyguard (about 2 minutes)
npm run accept                    # the audit is part of the whole walk-through
```

Exit statuses, the run folder, and the report are those of the acceptance walk-through. The audit adds the group `keyguard` (checks `keyguard.self-test` and `keyguard.audit`) and, to `report.html`, the matrix of places by ways of ending a run.

## The key and its forms

The fake key of a run is `nvapi-FAKE-AUDIT-` plus 12 random hexadecimal characters (the distinctive part). Searched, as bytes, in each place: the whole key and the distinctive part, as UTF-8; JSON-escaped; percent-encoded; base64 in three alignments (edges that depend on neighbours are cut); UTF-16 little and big endian. A match is reported with the place, the way, the form, and an excerpt masked to its first 8 characters.

## Places (what is examined, what counts as "examined")

| Place | How it is examined | Evidence counts |
|-------|--------------------|-----------------|
| files | every file changed since the start of the way, under the project folder, the run's folder, the temporary folder, `~/.config` and `~/.cache` (not `node_modules`, not `.git`, not the audit's own sandbox), as bytes; files above 50 MB are skipped and listed | files, bytes, skipped |
| profile | every file of the browser's profile, after `Browser.close` and the exit of the process, before the profile is removed | files, bytes |
| app log | the whole output (standard output and error) of the application's process of the way | bytes, lines |
| app memory | a heap snapshot of the application's process (started with `--inspect=0`); the strings of the snapshot | snapshots, strings |
| page memory | a heap snapshot of the page after a garbage collection; the strings of the snapshot | snapshots, strings |
| console | every console message and exception of the page, arguments as text | messages |
| network | every request (address, headers, body) and response (headers, body of fetch and scripts) of the page; the fake platform's record of its requests | requests, responses, fake requests |
| history | the address of the page, `document.referrer`, the navigation history | entries |
| cookies | all cookies of the browser context | cookies |
| storage | local storage, session storage, the databases and their contents, the names of the caches, service workers | entries ("none can exist" when there are none) |
| exports | the downloaded HTML and CSV files | files, bytes |
| page text | the text, the values of all fields, and the attributes of the page, and the report's text | characters, fields |

## Permitted uses (the only places where the key may be)

1. The **body** of requests from the page to the local relay (`POST /api/chat`).
2. The **`Authorization: Bearer <key>` header** of the relay's request to the platform (seen at the fake). The fake's record of the address and the body of that request must not hold the key.

The audit confirms that both happened in each way that sends requests; it reports "the examination is empty" otherwise. A key typed into the field (way 7) is permitted in the value of the field and in the page's memory until the field is cleared.

## Ways of ending a run (each in its own sandbox; one row of the dataset)

| # | Way | After it |
|---|-----|----------|
| 1 | normal run, then Export HTML and Export CSV | key fields empty; no place holds the key beyond the permitted uses; both memories hold no string with the key |
| 2 | the fake rejects the key and repeats it in its error message | the page shows the row's error without the key; the exports have none; the rest as in 1 |
| 3 | Stop while the requests are held | as 1 |
| 4 | judges re-run (the key typed again) | as 1 |
| 5 | failed-requests re-run (the key typed again) | as 1 |
| 6 | New Session while a run is in progress; the held requests are then released | as 1; the new session's fields are empty |
| 7 | the key typed, never used; field cleared; garbage collected; page reloaded | with the key in the field: only the field's value and the page's memory hold it; after clearing: nowhere; after the reload: nowhere, and the fields are empty |

## Planted copies (`keyguard.self-test`)

In a sandbox of its own, before the audit: one copy of the key in a file of the run's folder, a file of the temporary folder, a file of the profile folder, local storage (found in the profile **on disk** after the browser is closed), a cookie, an IndexedDB entry, the address (`history.replaceState`), a console message, a request header, a request body, a line of the application's log, a variable of the page (found in the page's snapshot), a variable of the application's process (found through the debugger), and a downloaded file. Every copy must be reported by the function that the audit uses for that place; otherwise `keyguard.self-test` fails and `keyguard.audit` fails with "cannot be trusted".

## Report

`keyguard.audit` verdict: `pass` (no hit anywhere), `fail` (a hit, an empty examination, or an untrusted audit), or `not-run` with a reason (for example, a snapshot could not be taken). Its evidence has the matrix places × ways, and `report.html` shows it as a table. The report lists the out of scope (the user's terminal and shell history, the clipboard, swap files and crash dumps, other programs, the user's everyday browser and its password manager, the platform's side) and the limits (binary buffer contents are not part of a memory snapshot; files above 50 MB are skipped; the relay builds the forms of the key as bytes for one request and keeps none of them, and a heap snapshot does not show the contents of buffers; in the platform's answer only the whole key is searched for (FR-074), the distinctive part alone in every other place).

## Rules

- The audit writes no memory snapshot and no network record to disk; they are kept in memory and dropped.
- The browser is closed with `Browser.close` before its profile is read, and the profile is removed after.
- A check never throws out of the run; a time limit (180 s for `keyguard.audit`, 60 s for `keyguard.self-test`) is a `fail`.
- The folder of the run is searched for the key at the end; the key must not be there (SC-035).

## Tests (no browser needed)

1. `tests/unit/accept-leak.test.mjs`: every form of a key is built (UTF-8, JSON, percent, base64 in three alignments, UTF-16); each is found in a buffer that holds it at any offset, also next to other bytes; a buffer without the key and a key that differs in one character are not matched; the distinctive part alone is matched; the mask keeps only 8 characters.
2. `tests/unit/accept-scanners.test.mjs`: the file scanner finds a planted copy in a text file, a binary file, and a nested directory, honours the "since" time, skips and lists a file above the limit, and counts files and bytes; the snapshot scanner finds a string holding the key in a snapshot's `strings`; the network scanner accepts the permitted uses, reports the key in an address, a header, a cookie, or a request to another place, and reports an empty examination when the permitted uses did not happen; the console and history scanners report a planted copy.
3. `tests/unit/accept-keyguard.test.mjs`: with places removed from the audit one by one (the profile, the memory, the network, the files), `keyguard.self-test` fails each time; the functions that the audit uses report each kind of leaking fixture (a file, a log line, a storage entry, a cookie, an address, a string in a snapshot, a request to another place), and the whole audit run against a test copy of the application with a deliberate leak (`KEYGUARD_APP_ROOT=<copy> npm run audit:key`: a file, the log, a variable of the process, local storage) fails in each case and names the place (SC-040; the runs are recorded in the implementation notes of research.md).
4. `tests/contract/relay.test.mjs` (14–17): a platform that repeats the key in its answer does not get it sent back to the page (FR-074).
