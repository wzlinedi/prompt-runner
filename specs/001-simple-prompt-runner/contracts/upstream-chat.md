# Contract: Chat request to the platform (via the relay)

**Spec**: Assumptions "Test platform", "What a request contains" | **Research**: R4 | **Used by**: `chat.mjs` | **References**: [nvidia-hosted-models-api.md](../references/nvidia-hosted-models-api.md)

This is the request the **page** builds for the relay's `payload`, and how the answer is read. The same function serves the main prompt and both judges.

## Building the request

Input: the validated parameters JSON object of the configuration block (spec FR-030) and the resolved prompt text.

```json
{
  "<every key of the user's parameters JSON, including model>": "…",
  "messages": [ { "role": "user", "content": "<resolved prompt>" } ],
  "stream": false
}
```

- The user's JSON is copied as written; the app adds `messages` and `stream` only. These two keys are rejected earlier if the user put them in the JSON.
- No system message, no tools, no streaming.
- For a judge, the prompt text is the judge prompt with `{prompt_input}` and `{output}` replaced, followed by the fixed answer-format instruction from [judge-answer-format.md](judge-answer-format.md).
- Replaced values are inserted literally (a value that itself contains `{output}` or `{{` is not processed again).

Example (the confirmed sample, non-streaming):

```json
{
  "model": "nvidia/nemotron-3.5-bolt-e4b",
  "temperature": 1,
  "top_p": 0.95,
  "max_tokens": 4096,
  "seed": 42,
  "chat_template_kwargs": { "enable_thinking": true },
  "messages": [ { "role": "user", "content": "Summarize below data. …" } ],
  "stream": false
}
```

## Reading the answer

| Upstream result | Mapping |
|-----------------|---------|
| `200` and `choices[0].message.content` is a string | `output = content`. If `choices[0].finish_reason === "length"`, `cutOff = true`. |
| `200` and `content` is empty, null, or missing | `output = ""`; if `finish_reason === "length"` add the note "no answer text returned: the length limit was reached before the answer". For a judge: unreadable answer. |
| `200` but the body is not the expected shape | Row error: "The platform answered in an unexpected format." |
| `400`, `422` | Row error naming the parameters and the model as the likely cause; includes the platform's message text. |
| `401` with a message about a JWT | Row error: the platform did not recognise the key; a key from the NVIDIA platform starts with `nvapi-`. |
| `401` (other), `403` | Row error: the key was refused, or the model is not permitted for this key. |
| `404` | Row error: unknown address or model. |
| `413`, or a message that mentions the context length | Row error: input too long for this model. |
| `429` | Row error: rate limit exceeded (`Retry-After` shown when sent). |
| `5xx`, relay `502`/`504` | Row error: platform or network problem (relay codes translated). |
| relay `502 upstream_too_large` | Row error: "The platform's answer is too large (more than 8 MB)." (spec FR-046) |

Rules:

- A row error never contains the key, the endpoint URL, or the request body. Redaction (spec FR-045) removes the key as entered, trimmed, and without a pasted `Bearer ` prefix, anything shaped like `nvapi-…`, the endpoint address, and its host name from every platform text; the removed part is replaced by `[key]` or `[endpoint]`.
- Nothing is retried automatically.
- The reasoning trace is returned in a separate field, `message.reasoning_content`; it is ignored. Only `message.content` is the answer, and it holds only the final answer, without `<think>` tags. **[verified live, 2026-11-01]**
- The answer also contains `usage` (prompt, completion, and total tokens); the app does not need it.

## Tests

Unit tests use a fake `fetch` that returns each row of the table above and assert the mapped result, plus a test that the built body equals the user's JSON plus `messages` and `stream: false`, with the key absent from it.
