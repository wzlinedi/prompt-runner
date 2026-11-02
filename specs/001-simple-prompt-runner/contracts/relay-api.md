# Contract: Local relay API

**Spec**: FR-016, FR-017, FR-074, Assumptions "Reaching the platform" | **Research**: R1, R3 | **Used by**: `app/server.mjs`, `chat.mjs`

The relay is a local Node.js program started by the user (`node app/server.mjs`). It serves the page and forwards chat requests. It exists only because the platform does not allow browser calls from other origins (research R1).

## Process

- Listens on `127.0.0.1:<port>` only (default `8787`, otherwise a free port; the address is printed). Never on a public interface.
- Holds nothing between requests (no cache, no session, no files).
- Logs only `time method path status duration`. Never request/response bodies, headers, endpoint URLs, keys, or answers.

## `GET /`

Returns `index.html` with a per-start random token inserted as `<meta name="relay-token" content="…">`. Other static files under `public/` are served read-only (`GET /styles.css`, `GET /src/*.mjs`). Anything else: `404`.

Every response of the server carries these headers (spec FR-046, research R21): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, together with the existing `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

## `POST /api/chat`

Forwards one chat request.

### Required request headers

| Header | Rule |
|--------|------|
| `X-Relay-Token` | Must equal the token of this process. Missing or wrong: `403`. |
| `Host` | Must be `127.0.0.1:<port>` or `localhost:<port>`. Otherwise `403`. |
| `Origin` | If present, must equal the relay's own origin. Otherwise `403`. |
| `Content-Type` | `application/json`. Otherwise `415`. |

### Request body (JSON)

```json
{
  "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
  "apiKey": "…",
  "payload": { "model": "…", "messages": [ … ], "stream": false, "temperature": 1 }
}
```

| Field | Rule |
|-------|------|
| `endpoint` | `http:` or `https:` URL, no user-info part. Otherwise `400`. |
| `apiKey` | Non-empty text; sent upstream as `Authorization: Bearer <apiKey>`. |
| `payload` | A JSON object, forwarded as the upstream body without change. |
| (size) | Body limit 64 MB; larger: `413`. |

### Upstream call

`POST <endpoint>` with `Authorization: Bearer <apiKey>`, `Content-Type: application/json`, `Accept: application/json`, body = `payload`. Redirects are **not** followed. Timeout 180 s. When the page closes the connection (Stop), the upstream request is aborted.

### Responses

The relay returns the upstream answer unchanged **when the upstream answered**: the same status code and the same JSON body, plus the header `X-Relay-Upstream: 1`. Only `Content-Type` and a harmless `Retry-After` are passed on; other header values (which could expose the key) are never echoed.

When the relay itself cannot get an answer, it returns a JSON error with header `X-Relay-Upstream: 0`:

| Status | `error.code` | Meaning |
|--------|--------------|---------|
| `400` | `bad_request` | Invalid body or endpoint. |
| `403` | `forbidden` | Token, Host, or Origin check failed. |
| `413` | `too_large` | Body over the limit. |
| `415` | `bad_content_type` | Not JSON. |
| `502` | `upstream_unreachable` | DNS, connection, or TLS failure (message without the URL's query or credentials). |
| `502` | `upstream_redirect` | The upstream answered with a redirect. |
| `502` | `upstream_too_large` | The upstream answer is larger than 8 MB; it is read as a stream, the upstream request is aborted at the limit, and nothing of it is forwarded. |
| `504` | `upstream_timeout` | No answer within 180 s. |

```json
{ "error": { "code": "upstream_timeout", "message": "The platform did not answer within 180 seconds." } }
```

The page tells the two kinds apart with `X-Relay-Upstream`.

## Contract tests (required)

1. A request without or with a wrong token, a foreign `Host`, or a foreign `Origin` gets `403` and no upstream call is made.
2. A valid request reaches a fake upstream with the exact `Authorization` header and body, and the fake's status and body come back unchanged.
3. The captured log output of a run that used the key `SECRET-TEST-KEY` does not contain that string, nor any prompt text.
4. Closing the client connection aborts the upstream request.
5. Redirect, timeout, and refused-connection upstreams give the `502`/`504` codes above.
6. Non-`http(s)` endpoint, endpoint with user-info, or non-JSON body are rejected.
7. Every response (page, script, style, API, error) carries the headers of "`GET /`" above; a fake upstream that answers with more than 8 MB gets `502 upstream_too_large`, and the relay's memory is not used for the whole body.

## The answer never carries the key (FR-074)

Before the answer is sent on, the relay removes the whole key from its body, in plain text, JSON-escaped, escaped for an address (`encodeURIComponent` and `%xx` bytes), and as base64 in three alignments; each occurrence becomes `[key removed]`. The status and the other headers are unchanged. A body without the key is passed on as it is. The forms are built and searched as bytes, so that no encoded copy of the key becomes text in the process.
