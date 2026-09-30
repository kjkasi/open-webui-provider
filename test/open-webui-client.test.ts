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

  test("rejects non-2xx responses with a bounded sanitized excerpt that redacts the key", async () => {
    const apiKey = "secret-key";
    const body = `${"x".repeat(600)}${apiKey}\u0001tail`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(502, body));
    const client = createOpenWebUIClient({ baseUrl: "https://open-webui.example", apiKey, fetchImpl });

    const result = client.fetchModels(new AbortController().signal);

    await expect(result).rejects.toThrow("Open WebUI model request failed with HTTP 502");
    await expect(result).rejects.not.toThrow(apiKey);
    await expect(result).rejects.not.toThrow("\u0001");
    await expect(result).rejects.toThrow(/x{500}/);
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
