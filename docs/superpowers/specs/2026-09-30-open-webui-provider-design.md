# Open WebUI Dynamic Provider Design

**Date:** 2026-09-30

## Goal

Create a distributable Pi npm package that discovers all models available from one Open WebUI instance and exposes them in Pi's standard `/model` picker for chat use.

## Scope

The first version supports one Open WebUI instance configured by environment variables:

- `OPEN_WEBUI_BASE_URL` — the Open WebUI origin, for example `http://localhost:3000`.
- `OPEN_WEBUI_API_KEY` — the Open WebUI Bearer API key.

The provider fetches the live model catalog from `GET <base>/api/models` and sends chat requests through `POST <base>/api/chat/completions`. It does not support multiple profiles, OAuth login, anonymous authentication, an allowlist, model persistence, or a custom streaming parser in the first version.

## Architecture

The package registers a provider named `open-webui` through Pi's extension API:

```text
Open WebUI API
  ├── GET /api/models
  │     └── open-webui-client.ts
  │             └── model-mapper.ts
  │                     └── ProviderModelConfig[]
  └── POST /api/chat/completions
        └── Pi built-in openai-completions implementation
```

`src/extension.ts` owns provider registration and reads the environment configuration. The provider uses `api: "openai-completions"`, `baseUrl: "<OPEN_WEBUI_BASE_URL>/api"`, and the API key. Pi's existing OpenAI-compatible implementation therefore handles prompt conversion, streaming, tool calls, cancellation, and usage accounting.

`src/open-webui-client.ts` owns HTTP transport and response validation. It exposes a small injectable client boundary so tests do not require a live Open WebUI instance. `src/model-mapper.ts` is a pure normalizer from Open WebUI records to Pi model definitions.

## Model discovery contract

The discovery request is:

```http
GET <OPEN_WEBUI_BASE_URL>/api/models
Authorization: Bearer <OPEN_WEBUI_API_KEY>
Accept: application/json
```

The expected response is an object with a `data` array. Each usable record must contain a non-empty string `id`; records without one are ignored. The display name uses `name` when it is a non-empty string, otherwise the model ID.

The provider's `refreshModels(context)` must:

1. Validate that both environment variables are present.
2. Normalize the base URL by removing trailing slashes.
3. Request `/api/models` with `context.signal`.
4. Reject non-2xx responses with an error containing the HTTP status and a bounded, sanitized response fragment.
5. Reject malformed JSON or a response whose `data` field is not an array.
6. Map valid records, remove duplicate IDs deterministically by keeping the first occurrence, and return the resulting list.
7. Reject a catalog with no usable records.
8. Avoid persistent model-catalog storage; the live response is the source of truth for each refresh.

An aborted request must preserve the abort semantics from the supplied `AbortSignal` and must not be converted into a misleading authentication or JSON error.

## Model mapping

All discovered models are chat models with zero monetary cost by default:

```typescript
{
  id,
  name,
  input: ["text"] or ["text", "image"],
  reasoning: boolean,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow,
  maxTokens,
}
```

The provider-level registration sets `api: "openai-completions"` for all of these models.

The mapper reads optional metadata from `info.meta`, with a fallback to a top-level `meta` object when present:

- `capabilities.vision === true` adds `"image"` to `input`.
- `capabilities.reasoning === true` or `capabilities.thinking === true` sets `reasoning: true`.
- `contextWindow` uses the first positive integer among `info.params.context_length`, `info.params.num_ctx`, `meta.context_length`, and `meta.num_ctx`; otherwise it is `32_000`.
- `maxTokens` uses the first positive integer among `info.params.max_tokens` and `meta.max_tokens`; otherwise it is `4_096`.

Metadata values are accepted only when they are finite, positive, safe integers. Zero, negative, fractional, non-numeric, and unsafe-integer values are ignored in favor of the fallback. No model is discarded solely because optional metadata is missing.

## Configuration and user experience

The package is distributed as an npm Pi package named `pi-open-webui-provider` with conventional extension discovery. Its README documents installation and runtime setup separately:

```bash
pi install npm:pi-open-webui-provider
OPEN_WEBUI_BASE_URL=http://localhost:3000 \
OPEN_WEBUI_API_KEY=... \
pi
```

The actual runtime setup must explain that the environment variables need to be present when Pi starts. Users select the resulting models through `/model`; opening `/model` refreshes the catalog, and `/reload` reloads the extension if configuration or extension code changed.

The package must not log the API key or include it in thrown errors. HTTP response text included in errors is truncated to at most 500 characters and has control characters removed. The package makes requests only to the explicitly configured base URL.

## Error behavior

Errors must be actionable and safe:

- missing `OPEN_WEBUI_BASE_URL`: report the exact variable name;
- missing `OPEN_WEBUI_API_KEY`: report the exact variable name;
- non-2xx response: include status and a bounded response excerpt, never request headers;
- invalid JSON: report that `/api/models` did not return valid JSON;
- invalid shape: report that `data` must be an array;
- no usable models: report that no entries with a non-empty string `id` were returned;
- abort: propagate cancellation without replacing it with a generic catalog error.

A failed refresh must not fabricate an empty model list. Pi remains responsible for retaining or replacing its current provider snapshot according to its provider lifecycle.

## Testing strategy

Use TypeScript and Vitest. Tests are divided by responsibility:

- `test/open-webui-client.test.ts` uses an injected fetch implementation to verify URL construction, Bearer authentication, `Accept` header, abort propagation, non-2xx handling, malformed JSON, and response-shape validation.
- `test/model-mapper.test.ts` verifies names, fallback names, vision and reasoning capabilities, each metadata fallback path, invalid metadata, duplicate handling, and ignored records without IDs.
- `test/extension.test.ts` uses a minimal mocked `ExtensionAPI` to verify registration of provider `open-webui`, `openai-completions`, the `/api` base URL, environment key wiring, and refresh output.

The package does not re-test Pi's built-in OpenAI stream implementation. A live Open WebUI integration test is intentionally excluded from the first version because it would require a configured external server and credentials.

## File responsibilities

```text
package.json                  npm package metadata, scripts, peer/dev dependencies
 tsconfig.json                TypeScript compiler settings
src/extension.ts              Pi provider registration and env wiring
src/open-webui-client.ts      GET /api/models transport and response validation
src/model-mapper.ts            Pure Open WebUI-to-Pi model normalization
test/open-webui-client.test.ts HTTP client tests
test/model-mapper.test.ts     Mapping tests
test/extension.test.ts        Provider registration tests
README.md                     Installation, env setup, usage, security notes
```

## Non-goals

- Multiple Open WebUI instances or named profiles.
- Storing credentials in `auth.json`, `models.json`, or project settings.
- Open WebUI OAuth or alternate API-key headers.
- Model allowlists or custom filtering.
- Open WebUI server-side `tool_ids` configuration.
- Custom streaming, retries, or usage accounting outside Pi's built-in API.
- Persisting a stale catalog for offline use.

## References

- Pi Extensions: `docs/extensions.md`
- Pi Custom Providers: `docs/custom-provider.md`
- Pi Packages: `docs/packages.md`
- Open WebUI API endpoints: https://docs.openwebui.com/reference/api-endpoints/
- Open WebUI API keys: https://docs.openwebui.com/features/authentication-access/api-keys/
