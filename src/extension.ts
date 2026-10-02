import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { mapOpenWebUIModels } from "./model-mapper.ts";
import { createOpenWebUIClient } from "./open-webui-client.ts";

const PROVIDER_ID = "open-webui";
const NOT_CONFIGURED_MESSAGE = "Open WebUI is not configured. Run /login open-webui.";
const STATIC_CREDENTIAL_EXPIRY = Number.MAX_SAFE_INTEGER;

type OAuthLoginCallbacks = Parameters<NonNullable<ProviderConfig["oauth"]>["login"]>[0];
type OpenWebUICredentials = {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  baseUrl: string;
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error("Open WebUI base URL is required.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Open WebUI base URL must be a valid http:// or https:// URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Open WebUI base URL must be a valid http:// or https:// URL.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("Open WebUI base URL must not contain username or password.");
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path.toLowerCase() === "/api") {
    throw new Error(
      "Open WebUI base URL must not end with /api; provide the Open WebUI server URL.",
    );
  }

  return `${url.origin}${path}`;
}

function getStoredCredentials(credential: unknown): OpenWebUICredentials | undefined {
  if (
    typeof credential !== "object" ||
    credential === null ||
    (credential as { type?: unknown }).type !== "oauth"
  ) {
    return undefined;
  }

  const candidate = credential as Partial<OpenWebUICredentials>;
  if (
    typeof candidate.access !== "string" ||
    typeof candidate.baseUrl !== "string" ||
    candidate.baseUrl.trim() === ""
  ) {
    return undefined;
  }

  return {
    type: "oauth",
    refresh: typeof candidate.refresh === "string" ? candidate.refresh : "",
    access: candidate.access,
    expires: typeof candidate.expires === "number" ? candidate.expires : STATIC_CREDENTIAL_EXPIRY,
    baseUrl: normalizeBaseUrl(candidate.baseUrl),
  };
}

export function createOpenWebUIProviderConfig(fetchImpl: typeof fetch = fetch): ProviderConfig {
  return {
    api: "openai-completions",
    baseUrl: undefined,
    apiKey: undefined,
    authHeader: true,
    refreshModels: async (context) => {
      const credentials = getStoredCredentials(context.credential);
      if (!credentials) {
        throw new Error(NOT_CONFIGURED_MESSAGE);
      }

      const client = createOpenWebUIClient({
        baseUrl: credentials.baseUrl,
        apiKey: credentials.access,
        fetchImpl,
      });
      const models = mapOpenWebUIModels(await client.fetchModels(context.signal));
      return models.map((model) => ({
        ...model,
        baseUrl: `${credentials.baseUrl}/api`,
      }));
    },
    oauth: {
      name: "Open WebUI",
      login: async (callbacks: OAuthLoginCallbacks): Promise<OpenWebUICredentials> => {
        const baseUrl = normalizeBaseUrl(
          await callbacks.onPrompt({ message: "Open WebUI base URL:" }),
        );
        const access = await callbacks.onPrompt({ message: "Open WebUI API token:" });
        if (access.trim() === "") {
          throw new Error("Open WebUI API token is required.");
        }

        return {
          type: "oauth",
          refresh: "",
          access,
          expires: STATIC_CREDENTIAL_EXPIRY,
          baseUrl,
        };
      },
      refreshToken: async (credentials, signal) => {
        signal.throwIfAborted();
        return credentials;
      },
      getApiKey: (credentials) => credentials.access,
    },
  };
}

export default function extension(api: ExtensionAPI): void {
  api.registerProvider(PROVIDER_ID, createOpenWebUIProviderConfig());
}
