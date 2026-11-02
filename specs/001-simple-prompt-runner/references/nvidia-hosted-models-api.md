# Reference: Accessing NVIDIA-hosted models through the API

**Researched**: 2026-11-01. Input for `/speckit-plan` (research, contracts). A reference, not a requirement: the spec stays provider-neutral.
**Reliability legend**: [official] = NVIDIA documentation read directly; [third-party] = blog, forum, or library documentation; [unverified] = reported only, confirm before relying on it.

## Confirmed request contract (from the user's own "Shell" sample on the model page, 2026-11-01)

[official, supplied by the user] This is the authoritative example; it supersedes the third-party rows in the table below where they differ.

```
POST https://integrate.api.nvidia.com/v1/chat/completions
Authorization: Bearer $NVIDIA_API_KEY
Content-Type: application/json
Accept: application/json            (or text/event-stream when stream=true)
```

Body (fields used by the sample):

| Field | Sample value | Meaning for the app |
|-------|--------------|---------------------|
| `model` | `nvidia/nemotron-3.5-bolt-e4b` | **Model identifier confirmed.** Comes from the "Model" field of the configuration. |
| `messages` | `[{"role":"user","content":"<prompt text>"}]` | One user message holding the resolved prompt (no system message). Line breaks and tabs are sent as JSON escapes (`\n`, `\t`). |
| `temperature` / `top_p` | `1` / `0.95` | Recommended sampling. The app exposes no parameters; fixed values are chosen at planning. |
| `max_tokens` | `1024` | Length limit of the answer. Long summaries can be cut off; the app must show that (see spec). |
| `seed` | `42` | Optional, for repeatability. Planning decides whether to send it. |
| `stream` | `true` in the sample | The app needs the complete answer, so it does not need streaming (`Accept: application/json`). |
| `tools`, `tool_choice`, `parallel_tool_calls` | sample tools (Harry Potter, colors) | Demonstration only. The app sends no tools. |
| `chat_template_kwargs.enable_thinking` | `true` | Reasoning mode of the model. Whether the app switches it on or off is decided at planning; a reasoning trace is never part of the output. |
| `skip_special_tokens` | `false` | Sample setting; not needed by the app. |

Response: OpenAI chat format; the answer text is `choices[0].message.content` (non-streaming). The reason the generation stopped (`finish_reason`, e.g. `length` when cut off) is in the same choice. The field that carries a reasoning trace is not shown in the sample.

Observation about the data: the sample prompt is a Eurostat-style indicator table with tabs and many line breaks. This is exactly the kind of `prompt_input` the dataset must carry, so values with tabs and line breaks must survive loading (quoted values, see spec FR-003).

## Second model (default Completeness judge): nvidia/nemotron-3.5-lightning-30b-a3b

[official, supplied by the user] Same address and bearer key as the first model; only `model` and a few settings differ. One personal API key works for every model hosted on the platform.

```
POST https://integrate.api.nvidia.com/v1/chat/completions
Authorization: Bearer $NVIDIA_API_KEY
Content-Type: application/json
Accept: application/json
```

| Field | Sample value | Note |
|-------|--------------|------|
| `model` | `nvidia/nemotron-3.5-lightning-30b-a3b` | Model page: https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b |
| `messages` | `[{"role":"user","content":"..."}]` | Same shape as the first model |
| `temperature` / `top_p` | `1` / `0.95` | Same recommended sampling |
| `max_tokens` | `16384` | Much larger than the first sample (1024); room for reasoning plus the answer |
| `reasoning_budget` | `16384` | Extra setting not seen in the first sample; limits the reasoning part |
| `chat_template_kwargs.enable_thinking` | `true` | Reasoning mode |
| `stream` | `true` in the sample | The app does not need streaming |

Not read: the model's reference page on `docs.api.nvidia.com` returned 404 under the guessed address, so context length and the field carrying the reasoning trace are unconfirmed for this model.

Implication for judges: with reasoning on, the visible answer (percentage and rationale) comes after a reasoning part. A small answer limit could be used up by reasoning and leave no answer; planning must choose `max_tokens` and reasoning settings per model so that judge answers are not cut off, and the spec's "cut off at the length limit" note covers the failure case.

## Verified live (2026-11-01, by the user's own run of `tests/live/check.mjs`)

- Chat answers contain `choices[0].message` with `content`, `role`, and `reasoning_content` (the reasoning trace is separate; `content` is the final answer only); `finish_reason: stop`; a `usage` object.
- Both models accepted their default parameters as written (including `reasoning_budget`).
- Measured latency: about 0.3 s for a trivial request, about 10 s (first model) and about 27 s (second model) for a judge-style request.
- A key is `nvapi-` plus 64 characters. The platform recognises a key only by the lowercase prefix `nvapi-`; any other text without dots gets `401 Invalid JWT serialization`; a `nvapi-` text that is not valid gets `403 Authorization failed`.
- `GET /v1/models` is public (no key needed) and lists 85 models, including both models used here; it cannot be used to test a key.
- No rate-limit headers are returned.

## Still to verify at planning

- Behavior on long real inputs (the summary of a full indicators table) with the default `max_tokens`.
- The real request limit of the account (reported at about 40 a minute; not readable from the answers).

## Access

| Item | Finding | Source |
|------|---------|--------|
| Base URL | `https://integrate.api.nvidia.com` | [official] LLM APIs reference lists it |
| Chat endpoint | `POST /v1/chat/completions` (OpenAI-compatible) | [official] path; [third-party] OpenAI compatibility |
| Authentication | `Authorization: Bearer <API key>` (confirmed by the Shell sample); keys look like `nvapi-...` | [official sample] header; [third-party] key prefix |
| Getting a key | Open a model page on build.nvidia.com, click "Get API Key", sign in or create an NVIDIA account (this joins the NVIDIA Developer Program), copy the key | [official] API quickstart |
| Model identifier | `vendor/model-name`, e.g. `meta/llama-3.1-8b-instruct`; Nemotron 3.5 Bolt E4B: `nvidia/nemotron-3.5-bolt-e4b` (confirmed by the Shell sample) | [official] |
| Request body | OpenAI chat format: `model`, `messages` (role/content), optional parameters | [third-party]; not stated on the pages read |
| Response | First choice's message text (`choices[0].message.content`); a model may add a reasoning trace and tool calls | [third-party] + model page |
| Streaming | Supported on NIM chat endpoints | [third-party] (self-hosted NIM docs) |

## Limits and terms

- Free tier rate limit: about 40 requests per minute, reported as shared across models; the limit shows on the user's dashboard. An increase has no official path. [third-party, forum posts] [unverified]
- Credits: sources conflict (1,000 free credits vs. credits phased out). [unverified]
- Context: up to about 64K tokens for Nemotron 3.5 Bolt E4B; other models differ. [official model page]
- Free API use is governed by the NVIDIA API Trial Terms of Service. [official model page]
- Sign-up requires email verification, and phone verification may be requested. [third-party]

## Browser access (CORS) – important for the architecture

- A report from another project (curl preflight, 2026-10-26) says the API echoes CORS headers only for NVIDIA's own origins (`build.nvidia.com`, `docs.api.nvidia.com`, `www.nvidia.com`); other origins get a response without CORS headers, so browsers block the call. A forum thread shows a developer hitting a CORS error from Chrome. No official statement or opt-in header was found. [third-party] [unverified]
- Consequence if confirmed: a page that only runs in the browser cannot call the API directly. Requests have to go through an intermediary (a thin relay) that forwards them. The relay must obey the constitution (Principle I): it uses the key only to forward the request, never stores or logs it, and the consent statement names it.
- Quick check to do at planning: send one request from a browser page on another origin, or inspect the response headers of a preflight (`OPTIONS`) request.

## Consequences for the spec (already applied)

- Configuration blocks: endpoint (pre-filled), model identifier, API key.
- Rate-limit and context-length failures are readable per-row errors; no automatic retry. Request pacing is allowed.
- Intermediary clause on keys, content, and consent.

## Sources

- https://docs.api.nvidia.com/nim/reference/llm-apis
- https://docs.api.nvidia.com/nim/docs/api-quickstart
- https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-bolt-e4b
- https://docs.litellm.ai/docs/providers/nvidia_nim
- https://apis.apievangelist.com/store/nvidia-nim-chat-api/
- https://github.com/SyberLabs/RISE/wiki/LIVE-NVIDIA
- https://forums.developer.nvidia.com/t/cors-errorn/310112
- https://forums.developer.nvidia.com/t/request-for-nvidia-nim-api-rate-limit-increase-40-200-rpm/375340

## Default JSON used by the spec (2026-11-01)

Each configuration block has one JSON field that holds the model and its parameters (`messages` and `stream` are set by the app). Defaults:

- Main prompt (`nvidia/nemotron-3.5-bolt-e4b`): `{"model":"nvidia/nemotron-3.5-bolt-e4b","temperature":1,"top_p":0.95,"max_tokens":4096,"seed":42,"chat_template_kwargs":{"enable_thinking":true}}`
- Judges, when the user sets them apart (`nvidia/nemotron-3.5-lightning-30b-a3b`): `{"model":"nvidia/nemotron-3.5-lightning-30b-a3b","temperature":1,"top_p":0.95,"max_tokens":16384,"reasoning_budget":16384,"chat_template_kwargs":{"enable_thinking":true}}`

By default the judges use the main prompt's endpoint, key, and JSON. `max_tokens` for the first model is raised above the sample value (1024) on purpose; this is an assumption to confirm with a real call at planning.
