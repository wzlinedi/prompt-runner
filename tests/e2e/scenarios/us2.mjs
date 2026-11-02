// User Story 2: the main prompt with a live example (spec US2 scenarios 1-6).
export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');

  // 1-2. The default prompt is shown with {prompt_input} highlighted (braces stay visible); the example shows the first row.
  t.assert(t.value('mainText').includes('{prompt_input}'), 'the default main prompt has {prompt_input}');
  const known = document.querySelector('#mainBack mark.ph');
  t.assert(known && known.textContent === '{prompt_input}', 'the placeholder is highlighted inside the text with its braces visible');
  const firstValue = document.querySelector('#mainExample mark.val');
  t.assert(firstValue && firstValue.textContent.startsWith('Selected indicators\tPoland\tSource dataset'), 'the example shows the first row value in place of {prompt_input}');
  t.assert(t.text('mainExample').startsWith('Summarize below data.'), 'the example keeps the wording around the placeholder');
  t.equal(t.text('mainMsg'), '', 'no message for a valid prompt');

  // The user can choose another row.
  const select = t.byId('exRow');
  t.equal(select.options.length, 5, 'the row selector lists the 5 rows');
  t.equal(select.options[0].textContent, 'PL – Poland', 'rows are listed as id – name');
  select.value = '1';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  t.assert(t.text('mainExample').includes('Selected indicators\tCzechia'), 'switching the row changes the example');
  t.assert(!t.text('mainExample').includes('Selected indicators\tPoland'), 'the previous row is gone from the example');

  // 3. Typing updates the example at once.
  t.type('mainText', 'Short: {prompt_input}!');
  t.assert(t.text('mainExample').startsWith('Short: Selected indicators\tCzechia') && t.text('mainExample').endsWith('!'), 'typing updates the example immediately');

  // 6. The same placeholder several times gets the same value.
  t.type('mainText', 'A {prompt_input} | B {prompt_input}');
  const values = [...document.querySelectorAll('#mainExample mark.val')].map((m) => m.textContent);
  t.equal(values.length, 2, 'two occurrences are both replaced');
  t.assert(values[0] === values[1], 'both occurrences get the same value');

  // 4-5. A prompt without {prompt_input}, and another word in braces, are flagged and block the run.
  t.type('mainText', 'No place here, only {history}');
  t.match(t.text('mainMsg'), /^Run blocked: /, 'the message says the run is blocked');
  t.match(t.text('mainMsg'), /\{prompt_input\} is missing/, 'the missing place is named');
  t.match(t.text('mainMsg'), /unknown placeholder \{history\}/, 'the unknown word is named');
  const unknown = document.querySelector('#mainBack mark.bad');
  t.assert(unknown && unknown.textContent === '{history}', 'the unknown placeholder is highlighted differently, braces visible');

  // A literal brace is written doubled.
  t.type('mainText', 'JSON {{"a": 1}} then {prompt_input}');
  t.equal(t.text('mainMsg'), '', '{{ and }} do not count as placeholders');
  t.assert(t.text('mainExample').startsWith('JSON {"a": 1} then Selected indicators'), '{{ and }} are sent as single literal braces');
}
