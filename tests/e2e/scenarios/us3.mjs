// User Story 3: the two judge prompts (spec US3 scenarios 1-9).
export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');

  // 1. Both prompts are pre-filled, editable, and highlighted with both places.
  for (const [id, back, name] of [['accText', 'accBack', 'Accuracy'], ['compText', 'compBack', 'Completeness']]) {
    const text = t.value(id);
    t.assert(text.startsWith('You are a meticulous QA reviewer.'), `${name} is pre-filled with the ready-made prompt`);
    t.assert(text.includes('{prompt_input}') && text.includes('{output}'), `${name} uses both places`);
    const marks = [...document.querySelectorAll(`#${back} mark.ph`)].map((m) => m.textContent);
    t.assert(marks.includes('{prompt_input}') && marks.includes('{output}'), `${name}: both places are highlighted with their braces visible`);
  }
  t.assert(t.value('accText').includes('ACCURACY') && t.value('compText').includes('COMPLETENESS'), 'the two prompts are different');
  t.equal(t.text('accMsg') + t.text('compMsg'), '', 'no message while both prompts are valid');

  // The cost statement is visible.
  t.match(t.text('secJudge'), /two judges add two extra requests per row, which may cost extra/, 'the cost statement is visible');

  // 2. The preview shows the complete judge input with the stand-in for the output and the labelled format block.
  const accPrev = t.byId('accPrev');
  t.assert(accPrev.textContent.includes('Selected indicators\tPoland'), 'the preview contains the input of the first row');
  t.assert(accPrev.textContent.includes('[the main prompt answer goes here]'), 'the output is a clearly marked stand-in');
  t.equal([...accPrev.querySelectorAll('mark.val')].length, 2, 'both inserted values are highlighted');
  t.match(t.text('formatPrev'), /^Finish your answer with one final line in exactly this form/, 'the instruction added by the app is shown');
  t.assert(t.text('judgePreview').includes('Added by the app to every judge prompt'), 'the instruction block is labelled "added by the app"');
  // The preview follows the chosen row.
  const select = t.byId('exRow');
  select.value = '2';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  t.assert(t.text('compPrev').includes('Selected indicators\tSlovakia'), 'the preview follows the chosen row');

  // 3. A judge prompt without {output}: the run is blocked, naming the judge and the missing place.
  t.type('accText', 'Check {prompt_input} only');
  t.match(t.text('accMsg'), /^Run blocked: Judge Accuracy: \{output\} is missing\./, 'the missing place is named with the judge');
  t.equal(t.text('compMsg'), '', 'the other judge is not affected');

  // An unknown placeholder is flagged and named; a literal brace is written doubled.
  t.type('compText', '{prompt_input} vs {output} and {zzz}');
  t.match(t.text('compMsg'), /Judge Completeness: unknown placeholder \{zzz\} \(allowed: \{prompt_input\}, \{output\}\)/, 'the unknown word is named, with the allowed ones');
  const bad = document.querySelector('#compBack mark.bad');
  t.assert(bad && bad.textContent === '{zzz}', 'the unknown placeholder is highlighted differently, braces visible');
  t.type('compText', '{prompt_input} vs {output} and {{literal}}');
  t.equal(t.text('compMsg'), '', 'doubled braces are literal');
  t.assert(t.text('compPrev').includes('{literal}'), 'doubled braces are sent as single braces');
}
