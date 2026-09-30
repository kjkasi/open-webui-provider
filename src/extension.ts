import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { mapOpenWebUIModels } from "./model-mapper.ts";
import { createOpenWebUIClient } from "./open-webui-client.ts";

const PROVIDER_ID = "open-webui";
const API_KEY_ENV = "OPEN_WEBUI_API_KEY";
const BASE_URL_ENV = "OPEN_WEBUI_BASE_URL";

type Environment = Record<string, string | undefined>;

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function requireEnvironmentVariable(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createOpenWebUIProviderConfig(
  env: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): ProviderConfig {
  const configuredBaseUrl = env[BASE_URL_ENV];
  const normalizedBaseUrl = configuredBaseUrl ? normalizeBaseUrl(configuredBaseUrl) : undefined;

  return {
    api: "openai-completions",
    baseUrl: normalizedBaseUrl ? `${normalizedBaseUrl}/api` : undefined,
    apiKey: `$${API_KEY_ENV}`,
    authHeader: true,
    refreshModels: async (context) => {
      const baseUrl = normalizeBaseUrl(requireEnvironmentVariable(env, BASE_URL_ENV));
      const apiKey = requireEnvironmentVariable(env, API_KEY_ENV);
      const client = createOpenWebUIClient({ baseUrl, apiKey, fetchImpl });
      return mapOpenWebUIModels(await client.fetchModels(context.signal));
    },
  };
}

export default function extension(api: ExtensionAPI): void {
  api.registerProvider(PROVIDER_ID, createOpenWebUIProviderConfig());
}
