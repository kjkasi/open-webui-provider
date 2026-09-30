import { describe, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, { createOpenWebUIProviderConfig } from "../src/extension.ts";

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function registeredConfig(env: Record<string, string | undefined>, fetchImpl = vi.fn<typeof fetch>()) {
  const config = createOpenWebUIProviderConfig(env, fetchImpl);
  return { config, fetchImpl };
}

describe("Open WebUI extension", () => {
  test("registers the open-webui provider with OpenAI-compatible chat settings", () => {
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
      }),
    );
  });

  test("normalizes the configured base URL for chat requests", () => {
    const { config } = registeredConfig({
      OPEN_WEBUI_BASE_URL: "https://open-webui.example/root///",
      OPEN_WEBUI_API_KEY: "secret",
    });

    expect(config.baseUrl).toBe("https://open-webui.example/root/api");
    expect(config.apiKey).toBe("$OPEN_WEBUI_API_KEY");
  });

  test("refreshes and maps the live catalog using the context signal", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({ data: [{ id: "llama", name: "Llama" }] }),
    );
    const { config } = registeredConfig(
      {
        OPEN_WEBUI_BASE_URL: "https://open-webui.example",
        OPEN_WEBUI_API_KEY: "secret",
      },
      fetchImpl,
    );
    const signal = new AbortController().signal;

    await expect(config.refreshModels?.({ signal } as never)).resolves.toMatchObject([
      { id: "llama", name: "Llama", input: ["text"] },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith("https://open-webui.example/api/models", expect.objectContaining({ signal }));
  });

  test.each(["OPEN_WEBUI_BASE_URL", "OPEN_WEBUI_API_KEY"])(
    "reports the exact missing environment variable %s",
    async (missingVariable) => {
      const env: Record<string, string | undefined> = {
        OPEN_WEBUI_BASE_URL: "https://open-webui.example",
        OPEN_WEBUI_API_KEY: "secret",
      };
      env[missingVariable as keyof typeof env] = undefined;
      const { config } = registeredConfig(env);

      await expect(config.refreshModels?.({ signal: new AbortController().signal } as never)).rejects.toThrow(
        missingVariable,
      );
    },
  );

  test("rejects an empty catalog instead of returning an empty model list or persisting it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [] }));
    const { config } = registeredConfig(
      {
        OPEN_WEBUI_BASE_URL: "https://open-webui.example",
        OPEN_WEBUI_API_KEY: "secret",
      },
      fetchImpl,
    );
    const publish = vi.fn();

    await expect(
      config.refreshModels?.({ signal: new AbortController().signal, publish } as never),
    ).rejects.toThrow("No entries with a non-empty string id were returned");
    expect(publish).not.toHaveBeenCalled();
  });
});
