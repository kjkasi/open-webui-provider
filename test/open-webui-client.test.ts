import { describe, expect, test, vi } from "vitest";
import { createOpenWebUIClient } from "../src/open-webui-client.ts";

function response(status: number, body: string, text = vi.fn().mockResolvedValue(body)): Response {
  return { ok: status >= 200 && status < 300, status, text } as unknown as Response;
}

describe("createOpenWebUIClient", () => {
  test("requests the models endpoint with bearer auth, accept header, and supplied signal", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, JSON.stringify({ data: [{ id: "llama" }] })),
    );
    const signal = new AbortController().signal;
    const client = createOpenWebUIClient({
      baseUrl: "https://open-webui.example/root///",
      apiKey: "secret-key",
      fetchImpl,
    });

    await expect(client.fetchModels(signal)).resolves.toEqual([{ id: "llama" }]);
    expect(fetchImpl).toHaveBeenCalledWith("https://open-webui.example/root/api/models", {
      method: "GET",
      headers: {
        Authorization: "Bearer secret-key",
        Accept: "application/json",
      },
      signal,
    });
  });

  test("reports a server-specific HTTP failure with a bounded sanitized excerpt that redacts the key", async () => {
    const apiKey = "secret-key";
    const body = `${"x".repeat(600)}${apiKey}\u0001tail`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(502, body));
    const client = createOpenWebUIClient({ baseUrl: "https://open-webui.example", apiKey, fetchImpl });

    const result = client.fetchModels(new AbortController().signal);

    await expect(result).rejects.toThrow(
      "Open WebUI server error (HTTP 502). Check the Open WebUI server logs.",
    );
    await expect(result).rejects.not.toThrow(apiKey);
    await expect(result).rejects.not.toThrow("\u0001");
    await expect(result).rejects.toThrow(/x{500}/);
  });

  test.each([
    [401, "Open WebUI rejected the API token (HTTP 401). Check the token and its permissions."],
    [403, "Open WebUI rejected the API token (HTTP 403). Check the token and its permissions."],
    [404, "Open WebUI endpoint was not found (HTTP 404). Check the base URL and ensure it does not already include /api."],
    [429, "Open WebUI rate limit reached (HTTP 429). Try again later."],
    [500, "Open WebUI server error (HTTP 500). Check the Open WebUI server logs."],
  ])("classifies HTTP %s failures", async (status, message) => {
    const apiKey = "secret-key";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response(status, `failure for ${apiKey}`),
    );
    const client = createOpenWebUIClient({
      baseUrl: "https://open-webui.example",
      apiKey,
      fetchImpl,
    });

    await expect(client.fetchModels(new AbortController().signal)).rejects.toThrow(message);
    await expect(client.fetchModels(new AbortController().signal)).rejects.not.toThrow(apiKey);
  });

  test("keeps generic HTTP failures actionable and redacted", async () => {
    const apiKey = "secret-key";
    const body = `${"x".repeat(200)}${apiKey}${"y".repeat(600)}\u0001tail`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(400, body));
    const client = createOpenWebUIClient({
      baseUrl: "https://open-webui.example",
      apiKey,
      fetchImpl,
    });

    const result = client.fetchModels(new AbortController().signal);

    await expect(result).rejects.toThrow("Open WebUI model request failed with HTTP 400");
    await expect(result).rejects.not.toThrow(apiKey);
    await expect(result).rejects.toThrow(/x{200}/);
    await expect(result).rejects.not.toThrow("\u0001");
  });

  test("redacts the API key when it appears in the configured base URL", async () => {
    const apiKey = "secret-key";
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const client = createOpenWebUIClient({
      baseUrl: `https://open-webui.example/${apiKey}`,
      apiKey,
      fetchImpl,
    });

    const error = await client.fetchModels(new AbortController().signal).catch((value) => value);

    expect(error.message).not.toContain(apiKey);
    expect(error.message).toContain("https://open-webui.example/[redacted]");
  });

  test("does not preserve nested or aggregate transport causes containing the API key", async () => {
    const apiKey = "secret-key";
    const aggregate = new AggregateError([new Error(`request failed with ${apiKey}`)], "aggregate");
    const networkError = new Error("fetch failed", { cause: aggregate });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(networkError);
    const client = createOpenWebUIClient({
      baseUrl: "https://open-webui.example",
      apiKey,
      fetchImpl,
    });

    const error = await client.fetchModels(new AbortController().signal).catch((value) => value);

    expect(error.message).not.toContain(apiKey);
    expect(error.cause).not.toBe(networkError);
    expect(JSON.stringify(error.cause)).not.toContain(apiKey);
  });

  test("classifies fetch failures separately and preserves the cause", async () => {
    const networkError = new TypeError("fetch failed");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(networkError);
    const client = createOpenWebUIClient({
      baseUrl: "https://open-webui.example/root",
      apiKey: "secret-key",
      fetchImpl,
    });

    const error = await client.fetchModels(new AbortController().signal).catch((value) => value);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      "Could not connect to Open WebUI at https://open-webui.example/root. Check the URL, server availability, and HTTPS configuration.",
    );
    expect(error.cause).toBe(networkError);
    expect(error.message).not.toContain("secret-key");
  });

  test("does not expose a bearer token from a transport error cause", async () => {
    const apiKey = "secret-key";
    const networkError = new Error(`request failed with Bearer ${apiKey}`);
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(networkError);
    const client = createOpenWebUIClient({
      baseUrl: "https://open-webui.example",
      apiKey,
      fetchImpl,
    });

    const error = await client.fetchModels(new AbortController().signal).catch((value) => value);

    expect(error.message).not.toContain(apiKey);
    expect(error.cause).not.toBe(networkError);
    expect(error.cause?.message).not.toContain(apiKey);
  });

  test("classifies response body read failures as connection failures", async () => {
    const networkError = new TypeError("connection closed");
    const text = vi.fn().mockRejectedValue(networkError);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, "", text),
    );
    const client = createOpenWebUIClient({
      baseUrl: "https://open-webui.example",
      apiKey: "secret-key",
      fetchImpl,
    });

    const error = await client.fetchModels(new AbortController().signal).catch((value) => value);

    expect(error.message).toContain("Could not connect to Open WebUI at https://open-webui.example.");
    expect(error.cause).toBe(networkError);
  });

  test("rejects malformed JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, "not-json"));
    const client = createOpenWebUIClient({ baseUrl: "https://open-webui.example", apiKey: "secret", fetchImpl });

    await expect(client.fetchModels(new AbortController().signal)).rejects.toThrow(
      "/api/models did not return valid JSON",
    );
  });

  test("rejects a response whose data field is not an array", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, JSON.stringify({ data: { id: "llama" } })),
    );
    const client = createOpenWebUIClient({ baseUrl: "https://open-webui.example", apiKey: "secret", fetchImpl });

    await expect(client.fetchModels(new AbortController().signal)).rejects.toThrow(
      "/api/models response data must be an array",
    );
  });

  test("preserves an abort error from fetch", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(abortError);
    const client = createOpenWebUIClient({ baseUrl: "https://open-webui.example", apiKey: "secret", fetchImpl });

    await expect(client.fetchModels(new AbortController().signal)).rejects.toBe(abortError);
  });

  test("preserves an abort error from reading the response body", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const text = vi.fn().mockRejectedValue(abortError);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, "", text));
    const client = createOpenWebUIClient({ baseUrl: "https://open-webui.example", apiKey: "secret", fetchImpl });

    await expect(client.fetchModels(new AbortController().signal)).rejects.toBe(abortError);
  });
});
