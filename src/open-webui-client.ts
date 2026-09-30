type JsonRecord = Record<string, unknown>;

export interface OpenWebUIClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface OpenWebUIClient {
  fetchModels(signal: AbortSignal): Promise<unknown[]>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeExcerpt(body: string, apiKey: string): string {
  const withoutControls = body.replace(/[\u0000-\u001F\u007F]/g, "");
  const redacted = apiKey === "" ? withoutControls : withoutControls.split(apiKey).join("[redacted]");
  return redacted.slice(0, 500);
}

export function createOpenWebUIClient(options: OpenWebUIClientOptions): OpenWebUIClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async fetchModels(signal: AbortSignal): Promise<unknown[]> {
      const response = await fetchImpl(`${baseUrl}/api/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: "application/json",
        },
        signal,
      });
      const body = await response.text();

      if (!response.ok) {
        const excerpt = sanitizeExcerpt(body, options.apiKey);
        throw new Error(
          `Open WebUI model request failed with HTTP ${response.status}${excerpt ? `: ${excerpt}` : ""}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error("Open WebUI /api/models did not return valid JSON");
      }

      if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
        throw new Error("Open WebUI /api/models response data must be an array");
      }

      return parsed.data;
    },
  };
}
