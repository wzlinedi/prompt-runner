// User Story 4: configuration (spec US4 scenarios 1-8).


export default async function run(t) {
  t.click('newSession');
  t.click('dsSample');

  // Defaults are pre-filled; the key is empty and masked.
  t.equal(t.value('mainEp'), 'https://integrate.api.nvidia.com/v1/chat/completions', 'the endpoint is pre-filled');
  t.match(t.value('main_json'), /"model": "nvidia\/nemotron-3.5-bolt-e4b"/, 'the main JSON is pre-filled with the default model');
  t.equal(t.value('mainKey'), '', 'the key starts empty');
  t.equal(t.byId('mainKey').type, 'password', 'the key input is masked');
  t.equal(t.byId('judgeKey').type, 'password', 'the judge key input is masked');

  // "Same model" is on; judge fields are hidden. Switching off shows them with the second model, on hides them again.
  t.assert(t.byId('sameModel').checked, 'Same model as the main prompt is on by default');
  t.assert(!t.visible('judgeFields'), 'judge fields are hidden while the option is on');
  t.click('sameModel');
  t.assert(t.visible('judgeFields'), 'judge fields appear when the option is switched off');
  t.match(t.value('judge_json'), /"model": "nvidia\/nemotron-3.5-lightning-30b-a3b"/, 'the judge JSON is pre-filled with the second model');
  t.click('sameModel');
  t.assert(!t.visible('judgeFields'), 'judge fields disappear when the option is switched on again');

  // The hint for a key that does not look like a platform key; the key is not echoed.
  t.type('mainKey', 'sk-secret-123');
  t.match(t.text('keyHint'), /usually starts with "nvapi-"/, 'the hint appears for a foreign-looking key');
  t.assert(!t.text('keyHint').includes('sk-secret-123'), 'the hint does not echo the key');
  t.type('mainKey', 'nvapi-abc');
  t.equal(t.text('keyHint'), '', 'no hint for a platform-looking key');

  // The state-level validation sees what was typed (the Run button is wired in the next phase).
  const { validateConfig } = await import('/src/config.mjs');
  const { state } = await import('/src/main.mjs');
  t.assert(validateConfig(state.get().config).length === 0, 'valid defaults plus a key pass validation');
  t.type('main_json', '{"model": "m", "stream": true}');
  t.match(validateConfig(state.get().config)[0], /must not contain "stream"/, 'a forbidden key is reported');
  t.type('mainKey', '');
  t.equal(validateConfig(state.get().config).length, 2, 'an empty key is reported too');

  // No browser storage is used.
  t.assert(t.storageEmpty(), 'localStorage, sessionStorage, and cookies are empty');
}
