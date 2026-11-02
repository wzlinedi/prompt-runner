// User Story 1: New Session and dataset loading (spec US1 scenarios 1-8).
export default async function run(t) {
  // 1. The start screen offers only New Session and states that a session lives in memory only.
  t.assert(t.visible('startScreen'), 'start screen is visible');
  t.assert(!t.visible('app'), 'the app is hidden before New Session');
  t.equal(document.querySelectorAll('#startScreen button').length, 1, 'the start screen has exactly one action');
  t.equal(t.text('newSession'), 'New Session', 'the start button reads "New Session"');
  t.match(t.text('startScreen'), /memory only/, 'start screen states that a session lives in memory only');
  t.click('newSession');
  t.assert(t.visible('app') && !t.visible('startScreen'), 'New Session reveals the app');
  for (const id of ['secMain', 'secJudge', 'secCfg']) t.assert(!t.visible(id), `${id} stays hidden until a dataset is valid`);
  // The run panel is part of the page from the start: it lists what is missing, and Run waits (spec FR-052).
  t.assert(t.visible('secRes'), 'the run panel is shown from the start of a session');
  t.match(t.text('ready'), /Dataset: load a dataset first\./, 'the panel says that a dataset is missing');
  t.assert(t.byId('run').disabled, 'Run is not available without a dataset');

  // 3. A dataset without a required column names it, and later steps stay unavailable.
  t.type('dsText', 'id,name,prompt_input\nx,y,z');
  t.click('dsLoad');
  t.match(t.text('dsMsg'), /missing: expected_result/, 'missing column is named');
  for (const id of ['secMain', 'secJudge', 'secCfg']) t.assert(!t.visible(id), `${id} hidden after an invalid dataset`);

  // 4. Duplicate IDs and empty names are reported and nothing is loaded.
  t.type('dsText', 'id,name,prompt_input,expected_result\nA,One,in,out\nA,,in2,out2');
  t.click('dsLoad');
  t.match(t.text('dsMsg'), /row 2: duplicate id "A"; row 2: empty name/, 'row problems are listed');
  t.equal(document.querySelectorAll('#dsPrev tbody tr').length, 0, 'nothing is previewed after an error');

  // 6b. An unquoted comma breaks the column count: the record is named, nothing is loaded.
  t.type('dsText', 'id,name,prompt_input,expected_result\nA,One,x, y,z');
  t.click('dsLoad');
  t.match(t.text('dsMsg'), /Record 1 has 5 columns instead of 4/, 'record with the wrong column count is named');
  t.assert(!t.visible('secMain'), 'main prompt step still locked');

  // 6a. A quoted value with a comma arrives intact.
  t.type('dsText', 'id,name,prompt_input,expected_result\nA,One,"x, y",z');
  t.click('dsLoad');
  t.match(t.text('dsMsg'), /Loaded 1 rows\./, 'a valid dataset loads');
  t.assert(document.querySelector('#dsPrev tbody').textContent.includes('x, y'), 'the comma inside the quoted value is intact');
  t.assert(t.visible('secMain') && t.visible('secJudge') && t.visible('secCfg'), 'steps 2-4 unlock after a valid dataset');

  // 2, 5. The sample loads five rows; the row without an expected result is flagged in the note.
  t.click('dsSample');
  t.match(t.text('dsMsg'), /Loaded 5 rows\. Note: 1 without expected_result/, 'sample loads 5 rows with a note');
  t.equal(document.querySelectorAll('#dsPrev tbody tr').length, 5, 'five rows are previewed');
  t.assert(document.querySelector('#dsPrev tbody tr:last-child .tag') !== null, 'the row without expected result is marked');
  // 7. A long value is shortened with its length and expandable.
  const summary = document.querySelector('#dsPrev tbody tr details summary');
  t.assert(summary && /characters\)$/.test(summary.textContent), 'a long value is shortened with its length');

  // 8. A second New Session asks for confirmation; Cancel keeps the data, confirming starts empty.
  t.click('newSession2');
  t.assert(t.visible('resetConfirm'), 'confirmation appears when data exists');
  t.match(t.text('resetConfirm'), /Unexported results will be lost/, 'confirmation warns about unexported results');
  t.click('resetNo');
  t.assert(!t.visible('resetConfirm') && t.visible('secMain'), 'Cancel keeps the session');
  t.click('newSession2');
  t.click('resetYes');
  t.equal(t.value('dsText'), '', 'a new session starts with an empty dataset field');
  t.equal(document.querySelectorAll('#dsPrev tbody tr').length, 0, 'a new session has no preview');
  t.assert(!t.visible('secMain') && t.visible('app'), 'a new session locks the later steps again');
  t.click('newSession2'); // nothing to lose now: no confirmation
  t.assert(!t.visible('resetConfirm'), 'no confirmation for an empty session');
}
