import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

type JsonRecord = Record<string, unknown>;

const DEFAULT_CONTEXT_WINDOW = 32_000;
const DEFAULT_MAX_TOKENS = 4_096;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function firstPositiveSafeInteger(values: unknown[], fallback: number): number {
  return values.find(isPositiveSafeInteger) ?? fallback;
}

function getMetadata(record: JsonRecord): JsonRecord {
  const info = isRecord(record.info) ? record.info : undefined;
  return isRecord(info?.meta) ? info.meta : isRecord(record.meta) ? record.meta : {};
}

function getInfoParams(record: JsonRecord): JsonRecord {
  return isRecord(record.info) && isRecord(record.info.params) ? record.info.params : {};
}

function getCapabilities(metadata: JsonRecord): JsonRecord {
  return isRecord(metadata.capabilities) ? metadata.capabilities : {};
}

export function mapOpenWebUIModels(records: unknown[]): ProviderModelConfig[] {
  const models: ProviderModelConfig[] = [];
  const seenIds = new Set<string>();

  for (const record of records) {
    if (!isRecord(record) || typeof record.id !== "string" || record.id.trim() === "") {
      continue;
    }

    const id = record.id;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const metadata = getMetadata(record);
    const params = getInfoParams(record);
    const capabilities = getCapabilities(metadata);
    const name = typeof record.name === "string" && record.name.trim() !== "" ? record.name : id;

    models.push({
      id,
      name,
      input: capabilities.vision === true ? ["text", "image"] : ["text"],
      reasoning: capabilities.reasoning === true || capabilities.thinking === true,
      cost: { ...ZERO_COST },
      contextWindow: firstPositiveSafeInteger(
        [params.context_length, params.num_ctx, metadata.context_length, metadata.num_ctx],
        DEFAULT_CONTEXT_WINDOW,
      ),
      maxTokens: firstPositiveSafeInteger(
        [params.max_tokens, metadata.max_tokens],
        DEFAULT_MAX_TOKENS,
      ),
    });
  }

  if (models.length === 0) {
    throw new Error("No entries with a non-empty string id were returned");
  }

  return models;
}
