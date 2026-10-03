# Open WebUI Interactive Configuration and Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to configure the Open WebUI URL and API token through Pi’s `/login` interface while preserving environment-variable setup and providing actionable, secret-safe connection errors.

**Architecture:** Keep Pi’s built-in `openai-completions` implementation for chat requests. Add an Open WebUI OAuth-compatible login adapter that collects the URL and token through Pi UI, stores the token in Pi credentials, and carries the configured URL as provider credential metadata; environment variables remain a CI-compatible fallback. Make URL validation and HTTP/network error classification explicit at the extension/client boundary, while model discovery returns model-level API endpoints so dynamically configured URLs also work for chat.

**Tech Stack:** TypeScript, Pi Extension API (`registerProvider`, OAuth login callbacks, `ctx.ui`/`/login`), Vitest, native `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-30-open-webui-provider-design.md`, extended by the interactive configuration and diagnostics requirements agreed in this conversation.

## Global Constraints

- Support one Open WebUI instance per Pi process.
- Discovery uses `GET <base>/api/models`, `Authorization: Bearer <token>`, `Accept: application/json`, and the supplied `AbortSignal`.
- Chat requests continue to delegate to Pi’s `openai-completions` implementation at `<base>/api`; no custom streaming parser is introduced.
- The interactive flow is available through Pi’s `/login` provider UI; environment variables remain supported for non-interactive and CI usage.
- Tokens, authorization headers, and complete provider responses must never appear in thrown errors, notifications, or logs.
- No new runtime dependency is added.
- Failed model refreshes must remain errors and must not publish an empty catalog.

## Review Focus

- URL with whitespace, trailing slashes, a reverse-proxy path, or a trailing `/api` must normalize deterministically without producing `/api/api`; tests belong to Task 1.
- Unsupported schemes, malformed URLs, blank input, and embedded URL credentials must produce a correction-oriented validation error; tests belong to Task 1.
- A missing interactive credential or partially configured environment must explain exactly how to configure Open WebUI; tests belong to Task 1.
- DNS, connection, TLS, and other fetch failures must be distinguishable from aborts, while abort errors preserve identity; tests belong to Task 2.
- HTTP 401/403/404/429/5xx responses must identify the likely cause without leaking the bearer token; tests belong to Task 2.

---

### Task 1: Add interactive Open WebUI authentication and dynamic endpoint wiring

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/model-mapper.ts` only if a type-safe shared model-endpoint helper is needed; prefer keeping mapping pure and adding the endpoint in `src/extension.ts`
- Test: `test/extension.test.ts`
- Test: `test/model-mapper.test.ts` only if the endpoint helper is placed there

**Interfaces:**
- Consumes: existing `createOpenWebUIClient({ baseUrl, apiKey, fetchImpl })`, `mapOpenWebUIModels(records)`, and Pi’s `ProviderConfig`/OAuth callback types.
- Produces: `createOpenWebUIProviderConfig(env, fetchImpl)` continues to return a `ProviderConfig`; its provider exposes `oauth.name === "Open WebUI"`, an OAuth `login`, `refreshToken`, and `getApiKey`; `refreshModels(context)` accepts either the stored Open WebUI credential or the environment fallback and returns chat model configs whose `baseUrl` is `<normalized-base>/api`.

- [ ] **Step 1: Write failing tests for URL validation and normalization**

  Extend `test/extension.test.ts` to cover:
  - trimming `"  https://open-webui.example/root///  "` to `https://open-webui.example/root`;
  - rejecting a blank value with `Open WebUI base URL is required.`;
  - rejecting malformed URLs and non-`http`/`https` schemes with `Open WebUI base URL must be a valid http:// or https:// URL.`;
  - rejecting a URL whose path already ends in `/api` with `Open WebUI base URL must not end with /api; provide the Open WebUI server URL.`;
  - rejecting embedded username/password credentials with `Open WebUI base URL must not contain username or password.`;
  - accepting a reverse-proxy path such as `https://host/open-webui`.

- [ ] **Step 2: Run the focused extension tests to verify they fail**

  Run: `npm test -- --run test/extension.test.ts`

  Expected: FAIL because the current implementation only trims trailing slashes and has no interactive credential flow or URL validation.

- [ ] **Step 3: Implement the Open WebUI credential and endpoint interfaces in `src/extension.ts`**

  Add a private credential shape extending Pi’s OAuth credential with `baseUrl: string`, plus these behaviors:
  - `oauth.login(callbacks)` prompts for `Open WebUI base URL` and `Open WebUI API token`, validates both, and returns the access token plus normalized URL metadata and a non-expiring/static refresh marker accepted by Pi’s OAuth credential schema; use the exact validation messages from Step 1;
  - `oauth.refreshToken(credentials, signal)` preserves the static token credential and honors `signal.throwIfAborted()`;
  - `oauth.getApiKey(credentials)` returns only the stored access token;
  - `refreshModels(context)` prefers a valid OAuth credential, otherwise uses `OPEN_WEBUI_BASE_URL` and `OPEN_WEBUI_API_KEY`; if neither source is complete, throws `Open WebUI is not configured. Run /login open-webui or set OPEN_WEBUI_BASE_URL and OPEN_WEBUI_API_KEY.` when no source exists and retains `Missing required environment variable: <NAME>` for a partial environment configuration;
  - returned model configs receive `baseUrl: "<normalized-base>/api"`, allowing chat requests to use a URL collected after startup;
  - preserve `api: "openai-completions"`, `authHeader: true`, the supplied fetch implementation, and `context.signal`.

  Keep the existing environment fallback so `createOpenWebUIProviderConfig(env, fetchImpl)` remains injectable in tests and usable in CI.

- [ ] **Step 4: Add failing tests for interactive login, credential precedence, and dynamic chat endpoint**

  In `test/extension.test.ts`, test that:
  - `oauth.login` prompts for URL and token and returns normalized URL metadata without changing the token;
  - an OAuth credential is used instead of environment values during `refreshModels`;
  - environment values still work when no OAuth credential is present;
  - a refreshed model has `baseUrl: "https://open-webui.example/api"`;
  - missing configuration throws `Open WebUI is not configured. Run /login open-webui or set OPEN_WEBUI_BASE_URL and OPEN_WEBUI_API_KEY.`;
  - the token is not included in a missing-config or validation error.

- [ ] **Step 5: Run the focused tests to verify the new assertions fail**

  Run: `npm test -- --run test/extension.test.ts`

  Expected: FAIL on the new OAuth, credential-selection, and model-endpoint assertions.

- [ ] **Step 6: Implement the minimal provider registration changes**

  Update `createOpenWebUIProviderConfig` to register the OAuth adapter alongside the environment fallback, use `context.credential` for stored credentials, and attach the resolved API endpoint to every refreshed model. Keep the existing public factory signature and do not add file-system credential handling in the extension.

- [ ] **Step 7: Run the focused tests to verify the task passes**

  Run: `npm test -- --run test/extension.test.ts`

  Expected: PASS, including existing registration, refresh, missing-environment, and empty-catalog tests.

- [ ] **Step 8: Commit the authentication and dynamic endpoint changes**

  ```bash
  git add src/extension.ts test/extension.test.ts
  git commit -m "feat: configure Open WebUI through Pi login"
  ```

### Task 2: Make connection and HTTP errors actionable and secret-safe

**Files:**
- Modify: `src/open-webui-client.ts`
- Test: `test/open-webui-client.test.ts`

**Interfaces:**
- Consumes: normalized `baseUrl`, API token, and the existing injectable `fetchImpl`/`AbortSignal` boundary.
- Produces: `createOpenWebUIClient(options).fetchModels(signal)` with stable, user-facing error categories for URL/network/HTTP/JSON/shape failures while preserving abort errors and redacting the token.

- [ ] **Step 1: Write failing tests for network and HTTP diagnostics**

  Extend `test/open-webui-client.test.ts` with tests that assert:
  - a `TypeError`/connection failure throws `Could not connect to Open WebUI at https://open-webui.example. Check the URL, server availability, and HTTPS configuration.` without the token;
  - an `AbortError` from `fetch` is rethrown as the same object;
  - status `401`/`403` says `Open WebUI rejected the API token` without including the token;
  - status `404` says `Open WebUI endpoint was not found` and mentions `/api`;
  - status `429` identifies rate limiting;
  - status `500` (and other `5xx`) identifies an Open WebUI server failure;
  - response excerpts remain bounded, remove control characters, and never contain the token.

- [ ] **Step 2: Run the focused client tests to verify they fail**

  Run: `npm test -- --run test/open-webui-client.test.ts`

  Expected: FAIL because the current implementation emits only `HTTP <status>` and does not classify fetch failures or common HTTP statuses.

- [ ] **Step 3: Implement stable error formatting in `src/open-webui-client.ts`**

  Add private helpers with explicit behavior:
  - `isAbortError(error: unknown): boolean` detects cancellation without converting it;
  - `formatHttpFailure(status: number, excerpt: string): string` maps statuses to these prefixes: `401/403: Open WebUI rejected the API token (HTTP <status>). Check the token and its permissions.`; `404: Open WebUI endpoint was not found (HTTP 404). Check the base URL and ensure it does not already include /api.`; `429: Open WebUI rate limit reached (HTTP 429). Try again later.`; `5xx: Open WebUI server error (HTTP <status>). Check the Open WebUI server logs.`; other statuses use `Open WebUI model request failed with HTTP <status>`; append the existing sanitized bounded excerpt;
  - `formatNetworkFailure(error: unknown, baseUrl: string): Error` reports `Could not connect to Open WebUI at <safe-base-url>. Check the URL, server availability, and HTTPS configuration.`, preserves the original error as `cause`, and excludes authorization data.

  Wrap only the fetch/response-read transport failures; leave JSON and response-shape errors specific to `/api/models`. Preserve the existing 500-character excerpt limit and API-token redaction.

- [ ] **Step 4: Run the focused client tests to verify they pass**

  Run: `npm test -- --run test/open-webui-client.test.ts`

  Expected: PASS, including existing request, malformed JSON, invalid shape, and abort tests.

- [ ] **Step 5: Commit the diagnostics changes**

  ```bash
  git add src/open-webui-client.ts test/open-webui-client.test.ts
  git commit -m "feat: clarify Open WebUI connection errors"
  ```

### Task 3: Document interactive setup and preserve environment setup

**Files:**
- Modify: `README.md`
- Modify: `.env.example` if its wording needs to explain the fallback relationship
- Test: `test/package.test.ts` if package documentation assertions require updated commands or `/login` text

**Interfaces:**
- Consumes: the `/login open-webui` flow, environment fallback, and exact error behavior produced by Tasks 1–2.
- Produces: documentation that gives users a supported interactive setup path, a supported CI path, URL formatting rules, and troubleshooting guidance without printing example secrets.

- [ ] **Step 1: Write or update documentation assertions**

  Update `test/package.test.ts` only where existing README/package checks encode the old setup as the sole supported path. Assert that the package documentation mentions `/login open-webui`, `OPEN_WEBUI_BASE_URL`, `OPEN_WEBUI_API_KEY`, and that the URL is the Open WebUI base address without a trailing `/api`.

- [ ] **Step 2: Run the documentation-focused test to verify the expected assertions fail**

  Run: `npm test -- --run test/package.test.ts`

  Expected: FAIL if the new interactive setup text is not yet present.

- [ ] **Step 3: Update `README.md`**

  Document:
  - interactive setup: start Pi, run `/login open-webui`, enter the base URL and API token;
  - environment setup for CI/non-interactive use;
  - accepted URL examples and the rule not to append `/api`;
  - `/model` refresh behavior;
  - interpretation of 401/403, 404, connection, rate-limit, and server errors;
  - that credentials are handled by Pi and tokens are not included in package errors.

- [ ] **Step 4: Run the documentation-focused test to verify it passes**

  Run: `npm test -- --run test/package.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the documentation changes**

  ```bash
  git add README.md .env.example test/package.test.ts
  git commit -m "docs: explain interactive Open WebUI setup"
  ```

### Task 4: Verify the complete provider

**Files:**
- Test: `test/extension.test.ts`
- Test: `test/open-webui-client.test.ts`
- Test: `test/model-mapper.test.ts`
- Test: `test/package.test.ts`

**Interfaces:**
- Consumes: all implementation and documentation changes from Tasks 1–3.
- Produces: verified TypeScript and Vitest results for the complete package.

- [ ] **Step 1: Run the complete test suite**

  Run: `npm test`

  Expected: all Vitest tests pass.

- [ ] **Step 2: Run the TypeScript checker**

  Run: `npm run typecheck`

  Expected: `tsc --noEmit` exits successfully with no diagnostics.

- [ ] **Step 3: Review the final diff for credential leakage and endpoint mistakes**

  Run: `git diff HEAD~3..HEAD -- src README.md test`

  Confirm that no token literal, authorization header, `/api/api` construction, or misleading generic-only error remains.

- [ ] **Step 4: Commit any verification-only corrections**

  ```bash
  git status --short
  git add <corrected-files>
  git commit -m "test: verify Open WebUI interactive configuration"
  ```

  Skip this commit when verification produces no corrections.
