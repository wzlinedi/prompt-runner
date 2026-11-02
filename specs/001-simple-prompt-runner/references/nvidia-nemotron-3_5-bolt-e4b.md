# Reference: NVIDIA Nemotron 3.5 Bolt E4B (API access)

**Source**: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-bolt-e4b (read 2026-11-01)
**Purpose**: input for `/speckit-plan` (research and contracts). This file is a reference, not a requirement; the spec stays provider-neutral.

## Confirmed from the page

- Model name on the page: `nvidia / nemotron-3.5-bolt-e4b` (not labeled as the API model identifier). Hugging Face repo: `nvidia/Nemotron-3.5-Bolt-E4B-BF16`.
- Request/response: text in, text out, "OpenAI-compatible chat format". Optional reasoning trace and tool calls (`message.tool_calls`, one tool call per assistant turn).
- Only request parameter named on the page: `conversational_mode` (flag for concise, low-formatting output).
- Maximum context length of the endpoint: up to 64K tokens.
- Recommended sampling (both thinking on and off): temperature 1.0, top_p 0.95. The spec exposes no parameters, so provider defaults apply.
- Preview API runs on vLLM with NVIDIA Dynamo, NVIDIA L40S.
- Use of the API is governed by the NVIDIA API Trial Terms of Service.

## Resolved by the user's Shell sample (see `nvidia-hosted-models-api.md`)

URL `https://integrate.api.nvidia.com/v1/chat/completions`, `Authorization: Bearer` header, model identifier `nvidia/nemotron-3.5-bolt-e4b`, request body fields. The list below is what the model page itself did not state.

## NOT found on the page

- Base URL and path of the request, HTTP method.
- Authentication header format.
- The exact model identifier string to send in the request body.
- Rate limits, streaming option, a request example.

The page text available to the fetch had no code samples. Likely (from general knowledge of NVIDIA's hosted API catalog, NOT verified for this model): an OpenAI-style `chat/completions` request on `integrate.api.nvidia.com` with a Bearer API key. Confirm on the model's "Try API / Get API key" view before relying on it.

## Consequences for the spec

- The generated answer is read from an OpenAI-style chat response (first choice's message text); a reasoning trace, if present, is not part of the output.
- Input-too-long errors are likely at about 64K tokens; the spec already shows a readable per-row error for that case.
- The spec's endpoint block has only an address and a key. Chat-style APIs also need a model identifier in the request; see the open decision in the spec notes.
