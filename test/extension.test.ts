import { describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import extension, { createOpenWebUIProviderConfig } from "../src/extension.ts";

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function registeredConfig(
  env: Record<string, string | undefined> = {},
  fetchImpl = vi.fn<typeof fetch>(),
) {
  const config = createOpenWebUIProviderConfig(env, fetchImpl);
  return { config, fetchImpl };
}

type TestCredential = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  baseUrl: string;
};
type RefreshContext = Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0];

function refreshContext(credential?: TestCredential): RefreshContext {
  return {
    credential,
    publish: vi.fn().mockResolvedValue(true),
    allowNetwork: true,
    signal: new AbortController().signal,
  };
}

describe("Open WebUI extension", () => {
  test("registers an OAuth-configured open-webui provider without environment configuration", () => {
    const registerProvider = vi.fn();
    extension({ registerProvider } as unknown as ExtensionAPI);

    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(registerProvider).toHaveBeenCalledWith(
      "open-webui",
      expect.objectContaining({
        api: "openai-completions",
        baseUrl: undefined,
        apiKey: "$OPEN_WEBUI_API_KEY",
        authHeader: true,
        refreshModels: expect.any(Function),
        oauth: expect.objectContaining({ name: "Open WebUI" }),
      }),
    );
  });

  test("preserves the legacy fetch-only factory signature", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({ data: [{ id: "legacy-model" }] }),
    );
    const config = createOpenWebUIProviderConfig(fetchImpl);
    const credential: TestCredential = {
      type: "oauth",
      access: "legacy-token",
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
      baseUrl: "https://open-webui.example",
    };

    await expect(config.refreshModels?.(refreshContext(credential))).resolves.toMatchObject([
      { id: "legacy-model", baseUrl: "https://open-webui.example/api" },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://open-webui.example/api/models",
      expect.anything(),
    );
  });

  test("prompts for and normalizes the Open WebUI URL during login", async () => {
    const { config } = registeredConfig();
    const onPrompt = vi
      .fn()
      .mockResolvedValueOnce("  https://open-webui.example/root///  ")
      .mockResolvedValueOnce("secret-token");

    const credentials = await config.oauth?.login({ onPrompt } as never);

    expect(onPrompt).toHaveBeenNthCalledWith(1, { message: "Open WebUI base URL:" });
    expect(onPrompt).toHaveBeenNthCalledWith(2, { message: "Open WebUI API token:" });
    expect(credentials).toMatchObject({
      access: "secret-token",
      refresh: "",
      baseUrl: "https://open-webui.example/root",
    });
  });

  test.each([
    ["", "Open WebUI base URL is required."],
    ["ftp://open-webui.example", "Open WebUI base URL must be a valid http:// or https:// URL."],
    ["https://user:pass@open-webui.example", "Open WebUI base URL must not contain username or password."],
    ["https://open-webui.example/api", "Open WebUI base URL must not end with /api; provide the Open WebUI server URL."],
  ])("rejects an invalid base URL: %s", async (baseUrl, message) => {
    const { config } = registeredConfig();
    const onPrompt = vi.fn().mockResolvedValueOnce(baseUrl);

    await expect(config.oauth?.login({ onPrompt } as never)).rejects.toThrow(message);
    expect(onPrompt).toHaveBeenCalledTimes(1);
  });

  test("rejects an empty interactive API token", async () => {
    const { config } = registeredConfig();
    const onPrompt = vi
      .fn()
      .mockResolvedValueOnce("https://open-webui.example")
      .mockResolvedValueOnce("  ");

    await expect(config.oauth?.login({ onPrompt } as never)).rejects.toThrow(
      "Open WebUI API token is required.",
    );
  });

  test.each([
    ["", "Missing required environment variable: OPEN_WEBUI_BASE_URL"],
    ["not a URL", "Open WebUI base URL must be a valid http:// or https:// URL."],
    ["ftp://open-webui.example", "Open WebUI base URL must be a valid http:// or https:// URL."],
    [
      "https://user:pass@open-webui.example",
      "Open WebUI base URL must not contain username or password.",
    ],
  ])("validates an environment base URL: %s", async (baseUrl, message) => {
    const { config } = registeredConfig({
      OPEN_WEBUI_BASE_URL: baseUrl,
      OPEN_WEBUI_API_KEY: "environment-token",
    });

    await expect(config.refreshModels?.(refreshContext())).rejects.toThrow(message);
  });

  test("refreshes models using only the stored credential and attaches its API endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({ data: [{ id: "llama", name: "Llama" }] }),
    );
    const { config } = registeredConfig({}, fetchImpl);
    const credential: TestCredential = {
      type: "oauth",
      access: "secret-token",
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
      baseUrl: "https://open-webui.example/root",
    };

    await expect(config.refreshModels?.(refreshContext(credential))).resolves.toMatchObject([
      {
        id: "llama",
        name: "Llama",
        input: ["text"],
        baseUrl: "https://open-webui.example/root/api",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://open-webui.example/root/api/models",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer secret-token",
          Accept: "application/json",
        },
      }),
    );
  });

  test("uses the environment fallback when no credential is stored", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({ data: [{ id: "env-model" }] }),
    );
    const { config } = registeredConfig(
      {
        OPEN_WEBUI_BASE_URL: "  https://open-webui.example/root///  ",
        OPEN_WEBUI_API_KEY: "environment-token",
      },
      fetchImpl,
    );

    await expect(config.refreshModels?.(refreshContext())).resolves.toMatchObject([
      { id: "env-model", baseUrl: "https://open-webui.example/root/api" },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://open-webui.example/root/api/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer environment-token" }),
      }),
    );
  });

  test("prefers a valid OAuth credential over environment values", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({ data: [{ id: "oauth-model" }] }),
    );
    const { config } = registeredConfig(
      {
        OPEN_WEBUI_BASE_URL: "https://environment.example",
        OPEN_WEBUI_API_KEY: "environment-token",
      },
      fetchImpl,
    );
    const credential: TestCredential = {
      type: "oauth",
      access: "oauth-token",
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
      baseUrl: "https://oauth.example",
    };

    await config.refreshModels?.(refreshContext(credential));

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://oauth.example/api/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer oauth-token" }),
      }),
    );
  });

  test("reports how to configure the provider when no source is configured", async () => {
    const { config } = registeredConfig();
    const refresh = config.refreshModels?.(refreshContext());

    await expect(refresh).rejects.toThrow(
      "Open WebUI is not configured. Run /login open-webui or set OPEN_WEBUI_BASE_URL and OPEN_WEBUI_API_KEY.",
    );
    await expect(refresh).rejects.not.toThrow("secret-token");
  });

  test("does not expose an environment token in URL validation errors", async () => {
    const { config } = registeredConfig({
      OPEN_WEBUI_BASE_URL: "https://open-webui.example/api",
      OPEN_WEBUI_API_KEY: "secret-token",
    });

    const refresh = config.refreshModels?.(refreshContext());

    await expect(refresh).rejects.toThrow(
      "Open WebUI base URL must not end with /api; provide the Open WebUI server URL.",
    );
    await expect(refresh).rejects.not.toThrow("secret-token");
  });

  test.each(["OPEN_WEBUI_BASE_URL", "OPEN_WEBUI_API_KEY"])(
    "reports the exact missing environment variable for partial configuration",
    async (missingVariable) => {
      const env = {
        OPEN_WEBUI_BASE_URL: "https://open-webui.example",
        OPEN_WEBUI_API_KEY: "environment-token",
      };
      delete env[missingVariable as keyof typeof env];
      const { config } = registeredConfig(env);

      await expect(config.refreshModels?.(refreshContext())).rejects.toThrow(
        `Missing required environment variable: ${missingVariable}`,
      );
    },
  );

  test("preserves abort identity when refreshing static credentials", async () => {
    const { config } = registeredConfig();
    const credentials: TestCredential = {
      type: "oauth",
      access: "secret-token",
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
      baseUrl: "https://open-webui.example",
    };
    const controller = new AbortController();
    const reason = new DOMException("aborted", "AbortError");
    controller.abort(reason);

    await expect(config.oauth?.refreshToken(credentials, controller.signal)).rejects.toBe(reason);
  });

  test("returns static credentials from refresh without exposing the token", async () => {
    const { config } = registeredConfig();
    const credentials: TestCredential = {
      type: "oauth",
      access: "secret-token",
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
      baseUrl: "https://open-webui.example",
    };
    const signal = new AbortController().signal;

    await expect(config.oauth?.refreshToken(credentials, signal)).resolves.toEqual(credentials);
    expect(config.oauth?.getApiKey(credentials)).toBe("secret-token");
  });

  test("rejects an empty catalog instead of returning an empty model list or persisting it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [] }));
    const { config } = registeredConfig({}, fetchImpl);
    const publish = vi.fn();
    const credential: TestCredential = {
      type: "oauth",
      access: "secret-token",
      refresh: "",
      expires: Number.MAX_SAFE_INTEGER,
      baseUrl: "https://open-webui.example",
    };

    await expect(
      config.refreshModels?.({ ...refreshContext(credential), publish } as never),
    ).rejects.toThrow("No entries with a non-empty string id were returned");
    expect(publish).not.toHaveBeenCalled();
  });
});
