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

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function redactSecret(value: string, apiKey: string): string {
  if (apiKey === "") {
    return value;
  }

  const encodedApiKey = encodeURIComponent(apiKey);
  return value
    .split(apiKey)
    .join("[redacted]")
    .split(encodedApiKey)
    .join("[redacted]");
}

function safeBaseUrl(baseUrl: string, apiKey: string): string {
  let safeUrl: string;
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    safeUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    safeUrl = baseUrl.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\/+$/, "");
  }
  return redactSecret(safeUrl, apiKey);
}

function containsSecret(value: unknown, apiKey: string): boolean {
  if (apiKey === "" || value === null || value === undefined) {
    return false;
  }

  const seen = new Set<object>();
  let inspected = 0;
  const inspect = (candidate: unknown): boolean => {
    if (typeof candidate === "string") {
      return candidate.includes(apiKey) || candidate.includes(encodeURIComponent(apiKey));
    }
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate)) {
      return false;
    }
    if (inspected++ >= 1_000) {
      return false;
    }
    seen.add(candidate);

    for (const key of Reflect.ownKeys(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor && "value" in descriptor && inspect(descriptor.value)) {
        return true;
      }
    }
    return false;
  };

  return inspect(value);
}

function safeCause(error: unknown, apiKey: string): unknown {
  return containsSecret(error, apiKey) ? new Error("Open WebUI transport failure") : error;
}

function formatNetworkFailure(error: unknown, baseUrl: string, apiKey: string): Error {
  return new Error(
    `Could not connect to Open WebUI at ${safeBaseUrl(baseUrl, apiKey)}. Check the URL, server availability, and HTTPS configuration.`,
    { cause: safeCause(error, apiKey) },
  );
}

function formatHttpFailure(status: number, excerpt: string): string {
  let message: string;
  if (status === 401 || status === 403) {
    message =
      `Open WebUI rejected the API token (HTTP ${status}). Check the token and its permissions.`;
  } else if (status === 404) {
    message =
      "Open WebUI endpoint was not found (HTTP 404). Check the base URL and ensure it does not already include /api.";
  } else if (status === 429) {
    message = "Open WebUI rate limit reached (HTTP 429). Try again later.";
  } else if (status >= 500 && status <= 599) {
    message = `Open WebUI server error (HTTP ${status}). Check the Open WebUI server logs.`;
  } else {
    message = `Open WebUI model request failed with HTTP ${status}`;
  }

  return excerpt ? `${message}: ${excerpt}` : message;
}

export function createOpenWebUIClient(options: OpenWebUIClientOptions): OpenWebUIClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async fetchModels(signal: AbortSignal): Promise<unknown[]> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/api/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            Accept: "application/json",
          },
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        throw formatNetworkFailure(error, baseUrl, options.apiKey);
      }

      let body: string;
      try {
        body = await response.text();
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        throw formatNetworkFailure(error, baseUrl, options.apiKey);
      }

      if (!response.ok) {
        const excerpt = sanitizeExcerpt(body, options.apiKey);
        throw new Error(formatHttpFailure(response.status, excerpt));
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
