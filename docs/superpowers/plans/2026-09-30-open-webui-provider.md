# Open WebUI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Git-installable Pi extension that discovers all usable models from one Open WebUI instance and routes chat through Pi's built-in OpenAI-compatible implementation.

**Architecture:** `src/extension.ts` registers provider `open-webui` with `api: "openai-completions"`, an env-interpolated API key, and a live `refreshModels` callback. `src/open-webui-client.ts` owns fetch, URL/header construction, safe response validation, and abort behavior; `src/model-mapper.ts` is a pure normalizer from unknown Open WebUI records to Pi chat model configs. No catalog is persisted and no custom chat streaming code is added.

**Tech Stack:** TypeScript, native `fetch`, Vitest, Pi extension API, Git-installed Pi package with conventional `pi.extensions` discovery.

**Spec:** `docs/superpowers/specs/2026-09-30-open-webui-provider-design.md`

## Global Constraints

- The first version supports only `OPEN_WEBUI_BASE_URL` and `OPEN_WEBUI_API_KEY` for one Open WebUI instance.
- Discovery requests use `GET <base>/api/models`, `Authorization: Bearer <key>`, `Accept: application/json`, and the supplied `AbortSignal`.
- Chat requests delegate to Pi's `openai-completions` implementation with base URL `<base>/api`; no custom streaming parser is implemented.
- Missing required environment variables, invalid JSON, invalid response shape, empty usable catalogs, and non-2xx responses have the exact actionable error categories from the spec.
- Error excerpts contain no API key, remove control characters, and are limited to 500 characters.
- Model records without a non-empty string `id` are ignored; duplicate IDs keep the first usable record.
- All models are chat models with zero costs, `input: ["text"]` unless vision is explicitly supported, a default context window of `32_000`, and default max tokens of `4_096`.
- Optional numeric metadata is accepted only when finite, positive, safe integers; invalid values use defaults.
- No model catalog or credentials are written to `auth.json`, `models.json`, project settings, or another persistent store.
- Tests use injected fetch implementations or mocked ExtensionAPI objects and never require a live server or real credentials.

## Review Focus

- A non-2xx body containing the configured API key must still produce a bounded error without leaking that key; pinned by Task 2's safe-error test.
- Abort errors from fetch or response-body reading must preserve the original cancellation error rather than becoming JSON/catalog errors; pinned by Task 2's abort tests.
- A base URL with a path and trailing slashes must produce only the configured `/api/models` and `/api` descendants, without double slashes or an unrelated origin; pinned by Tasks 2 and 3 URL assertions.
- Records with malformed optional `info`/`meta` values mixed with valid records must remain usable and receive metadata defaults; pinned by Task 1's malformed-metadata test.
- A refresh that fails must reject rather than return `[]`, leaving lifecycle snapshot decisions to Pi; pinned by Tasks 1 and 3 empty/error refresh tests.

---

### Task 1: Package scaffold and pure model mapper

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/model-mapper.ts`
- Test: `test/model-mapper.test.ts`

`package.json` must define `name: "pi-open-webui-provider"`, `type: "module"`, `pi.extensions: ["./src/extension.ts"]`, scripts `test: "vitest --run"` and `typecheck: "tsc --noEmit"`, `@earendil-works/pi-coding-agent` as a wildcard peer dependency, and matching dev dependencies for that host, TypeScript, Node types, and Vitest. It must not include npm publication metadata such as `keywords` or `files`, and the repository must not include `package-lock.json`.

**Interfaces:**
- Produces `mapOpenWebUIModels(records: unknown[]): ProviderModelConfig[]` exported from `src/model-mapper.ts`.
- The mapper accepts arbitrary decoded JSON records, ignores entries without a non-empty string `id`, keeps the first occurrence of each ID, and throws when no usable entries remain.
- Each result is a Pi chat model config with `api: "openai-completions"` omitted at mapper level (provider-level registration supplies it), `name`, `input`, `reasoning`, zero cost, `contextWindow`, and `maxTokens`.
- Later tasks consume `ProviderModelConfig` output and package scripts/configuration.

- [ ] **Step 1: Write failing mapper tests**

  Add focused Vitest cases for: normal name and defaults; ID fallback when `name` is empty/non-string; vision capability; reasoning and thinking capability; each context/max-token metadata fallback path; invalid metadata values; ignored missing IDs; deterministic first-record duplicate handling; malformed optional metadata; and the no-usable-record error.

- [ ] **Step 2: Run the mapper tests and verify RED**

  Run: `npm test -- test/model-mapper.test.ts`

  Expected: FAIL because `src/model-mapper.ts` and `mapOpenWebUIModels` do not exist yet.

- [ ] **Step 3: Implement `mapOpenWebUIModels(records: unknown[]): ProviderModelConfig[]`**

  In `src/model-mapper.ts`, narrow records defensively, read `info.meta` first with top-level `meta` fallback, accept only explicit `true` capability flags, select the first valid positive safe integer from the specified metadata paths, and preserve input order while deduplicating IDs.

- [ ] **Step 4: Run mapper tests and the full suite**

  Run: `npm test -- test/model-mapper.test.ts && npm test`

  Expected: all mapper tests and the complete current suite PASS with no failures.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json tsconfig.json vitest.config.ts src/model-mapper.ts test/model-mapper.test.ts
  git commit -m "feat: add Open WebUI model mapper"
  ```

### Task 2: Open WebUI discovery client

**Files:**
- Create: `src/open-webui-client.ts`
- Test: `test/open-webui-client.test.ts`

**Interfaces:**
- Produces `createOpenWebUIClient(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }): { fetchModels(signal: AbortSignal): Promise<unknown[]> }`.
- `fetchModels` normalizes only trailing slashes, requests `${baseUrl}/api/models`, sends `Authorization` and `Accept`, and returns the validated `data` array.
- Non-2xx, malformed JSON, and invalid response shape errors are thrown by the client; abort errors from either fetch or body reading are rethrown unchanged.
- The client never logs or includes request headers and redacts the configured key from response excerpts.

- [ ] **Step 1: Write failing client tests**

  Add injected-fetch tests for URL construction with trailing slashes/path, Bearer and Accept headers, signal identity, successful `data` extraction, non-2xx status plus sanitized/truncated/redacted body excerpt, malformed JSON, non-array `data`, and abort propagation.

- [ ] **Step 2: Run the client tests and verify RED**

  Run: `npm test -- test/open-webui-client.test.ts`

  Expected: FAIL because `src/open-webui-client.ts` and `createOpenWebUIClient` do not exist yet.

- [ ] **Step 3: Implement the injectable client**

  Use native fetch (or the supplied replacement), build the endpoint from the normalized configured base URL, read the body once, parse JSON explicitly, validate an object with an array `data`, and use a helper that removes control characters, replaces occurrences of the API key, then truncates to 500 characters. Catch only parse failures so `AbortError` and other transport/body failures retain their original error.

- [ ] **Step 4: Run client tests and the full suite**

  Run: `npm test -- test/open-webui-client.test.ts && npm test`

  Expected: all client tests and the complete suite PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/open-webui-client.ts test/open-webui-client.test.ts
  git commit -m "feat: add Open WebUI model discovery client"
  ```

### Task 3: Pi provider registration and live refresh

**Files:**
- Create: `src/extension.ts`
- Test: `test/extension.test.ts`

**Interfaces:**
- Produces the default extension factory `default function (api: ExtensionAPI): void` in `src/extension.ts`.
- The factory registers exactly provider ID `open-webui` with `api: "openai-completions"`, `baseUrl` equal to the normalized `<OPEN_WEBUI_BASE_URL>/api` endpoint when configured, `apiKey: "$OPEN_WEBUI_API_KEY"`, `authHeader: true`, and an async `refreshModels`.
- `refreshModels(context: RefreshModelsContext)` validates both env variables before constructing the client, passes `context.signal`, maps the live records with `mapOpenWebUIModels`, and does not call persistence APIs.
- Tests may call an exported `createOpenWebUIProviderConfig(env, fetchImpl)` helper if needed to inject fetch; the default factory must use `process.env` and global fetch.

- [ ] **Step 1: Write failing extension tests**

  Add a minimal mocked `ExtensionAPI` test for provider ID/config wiring, normalized `/api` base URL, env API-key interpolation, and `openai-completions`. Add refresh tests for successful mapped output, exact missing-variable errors, signal/fetch wiring, and rejection of an empty catalog without fabricating `[]`.

- [ ] **Step 2: Run the extension tests and verify RED**

  Run: `npm test -- test/extension.test.ts`

  Expected: FAIL because `src/extension.ts` and its provider factory do not exist yet.

- [ ] **Step 3: Implement provider registration**

  Keep environment validation in the refresh path, inject the client factory only for tests, use `api.registerProvider("open-webui", config)`, and leave model persistence unset. Ensure the provider's base URL points to `/api` for built-in OpenAI chat requests while discovery uses the client’s `/api/models` endpoint.

- [ ] **Step 4: Run extension tests and the full suite**

  Run: `npm test -- test/extension.test.ts && npm test && npm run typecheck`

  Expected: all tests PASS and TypeScript exits successfully with no diagnostics.

- [ ] **Step 5: Commit**

  ```bash
  git add src/extension.ts test/extension.test.ts
  git commit -m "feat: register dynamic Open WebUI provider"
  ```

### Task 4: Git package README and verification

**Files:**
- Modify: `README.md`
- Create: `test/package.test.ts`

**Interfaces:**
- Consumes the completed extension entry point and package manifest from Tasks 1–3.
- Produces a Git-installable Pi package named `pi-open-webui-provider` with conventional `pi.extensions` discovery and user-facing setup documentation.

- [ ] **Step 1: Write a failing documentation/package check**

  Create `test/package.test.ts` that reads the root manifest and README, asserting the exact package name, `pi.extensions`, `test` and `typecheck` scripts, `pi install git:github.com/kjkasi/open-webui-provider`, absence of npm publication metadata and `package-lock.json`, both environment variables, startup-time setup, `/model`, `/reload`, and security/no-persistence notes.

- [ ] **Step 2: Run the package check and verify RED**

  Run: `npm test -- test/package.test.ts`

  Expected: FAIL because the README does not yet contain the required setup and safety documentation.

- [ ] **Step 3: Complete README documentation**

  Document `pi install git:github.com/kjkasi/open-webui-provider`, startup-time env configuration, `/model` refresh behavior, `/reload`, supported scope, zero-cost metadata behavior, and that credentials/catalogs are not persisted or logged.

- [ ] **Step 4: Run final verification**

  Run: `npm test && npm run typecheck`

  Expected: complete test suite PASS and typecheck PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add README.md test/package.test.ts
  git commit -m "docs: package Open WebUI provider"
  ```
