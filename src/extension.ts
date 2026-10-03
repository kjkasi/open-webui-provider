import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { mapOpenWebUIModels } from "./model-mapper.ts";
import { createOpenWebUIClient } from "./open-webui-client.ts";

const PROVIDER_ID = "open-webui";
const BASE_URL_ENV = "OPEN_WEBUI_BASE_URL";
const API_KEY_ENV = "OPEN_WEBUI_API_KEY";
const NOT_CONFIGURED_MESSAGE =
  "Open WebUI is not configured. Run /login open-webui or set OPEN_WEBUI_BASE_URL and OPEN_WEBUI_API_KEY.";
const STATIC_CREDENTIAL_EXPIRY = Number.MAX_SAFE_INTEGER;

type Environment = Record<string, string | undefined>;
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
    candidate.access.trim() === "" ||
    typeof candidate.baseUrl !== "string" ||
    candidate.baseUrl.trim() === ""
  ) {
    return undefined;
  }

  try {
    return {
      type: "oauth",
      refresh: typeof candidate.refresh === "string" ? candidate.refresh : "",
      access: candidate.access,
      expires:
        typeof candidate.expires === "number" ? candidate.expires : STATIC_CREDENTIAL_EXPIRY,
      baseUrl: normalizeBaseUrl(candidate.baseUrl),
    };
  } catch {
    return undefined;
  }
}

export function createOpenWebUIProviderConfig(fetchImpl?: typeof fetch): ProviderConfig;
export function createOpenWebUIProviderConfig(
  env?: Environment,
  fetchImpl?: typeof fetch,
): ProviderConfig;
export function createOpenWebUIProviderConfig(
  envOrFetch: Environment | typeof fetch = process.env,
  configuredFetch: typeof fetch = fetch,
): ProviderConfig {
  const env = typeof envOrFetch === "function" ? process.env : envOrFetch;
  const fetchImpl = typeof envOrFetch === "function" ? envOrFetch : configuredFetch;

  return {
    api: "openai-completions",
    baseUrl: undefined,
    apiKey: `$${API_KEY_ENV}`,
    authHeader: true,
    refreshModels: async (context) => {
      const storedCredentials = getStoredCredentials(context.credential);
      let baseUrl: string;
      let apiKey: string;

      if (storedCredentials) {
        baseUrl = storedCredentials.baseUrl;
        apiKey = storedCredentials.access;
      } else {
        const configuredBaseUrl = env[BASE_URL_ENV];
        const configuredApiKey = env[API_KEY_ENV];
        const hasBaseUrl = typeof configuredBaseUrl === "string" && configuredBaseUrl.trim() !== "";
        const hasApiKey = typeof configuredApiKey === "string" && configuredApiKey.trim() !== "";

        if (!hasBaseUrl && !hasApiKey) {
          throw new Error(NOT_CONFIGURED_MESSAGE);
        }
        if (!hasBaseUrl) {
          throw new Error(`Missing required environment variable: ${BASE_URL_ENV}`);
        }
        if (!hasApiKey) {
          throw new Error(`Missing required environment variable: ${API_KEY_ENV}`);
        }

        baseUrl = normalizeBaseUrl(configuredBaseUrl as string);
        apiKey = configuredApiKey as string;
      }

      const client = createOpenWebUIClient({ baseUrl, apiKey, fetchImpl });
      const models = mapOpenWebUIModels(await client.fetchModels(context.signal));
      return models.map((model) => ({
        ...model,
        baseUrl: `${baseUrl}/api`,
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
