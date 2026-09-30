import { describe, expect, test } from "vitest";
import { mapOpenWebUIModels } from "../src/model-mapper.ts";

describe("mapOpenWebUIModels", () => {
  test("maps a model with its name and default metadata", () => {
    expect(mapOpenWebUIModels([{ id: "llama", name: "Llama" }])).toEqual([
      {
        id: "llama",
        name: "Llama",
        input: ["text"],
        reasoning: false,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_000,
        maxTokens: 4_096,
      },
    ]);
  });

  test("uses the id when name is empty or not a string", () => {
    expect(
      mapOpenWebUIModels([
        { id: "empty", name: "   " },
        { id: "missing" },
        { id: "non-string", name: 123 },
      ]),
    ).toMatchObject([
      { id: "empty", name: "empty" },
      { id: "missing", name: "missing" },
      { id: "non-string", name: "non-string" },
    ]);
  });

  test("maps vision capability to image input", () => {
    expect(
      mapOpenWebUIModels([{ id: "vision", info: { meta: { capabilities: { vision: true } } } }])[0],
    ).toMatchObject({ input: ["text", "image"] });
  });

  test("maps reasoning and thinking capabilities", () => {
    expect(
      mapOpenWebUIModels([
        { id: "reasoning", info: { meta: { capabilities: { reasoning: true } } } },
        { id: "thinking", info: { meta: { capabilities: { thinking: true } } } },
      ]),
    ).toMatchObject([{ reasoning: true }, { reasoning: true }]);
  });

  test("uses each supported metadata fallback path", () => {
    expect(
      mapOpenWebUIModels([
        { id: "context-length", info: { params: { context_length: 1000, num_ctx: 2000 } } },
        { id: "num-ctx", info: { params: { num_ctx: 2000 } } },
        { id: "meta-context", meta: { context_length: 3000 } },
        { id: "meta-num-ctx", meta: { num_ctx: 4000 } },
        { id: "info-max", info: { params: { max_tokens: 500 } } },
        { id: "meta-max", meta: { max_tokens: 600 } },
      ]),
    ).toMatchObject([
      { contextWindow: 1000 },
      { contextWindow: 2000 },
      { contextWindow: 3000 },
      { contextWindow: 4000 },
      { maxTokens: 500 },
      { maxTokens: 600 },
    ]);
  });

  test("ignores invalid numeric metadata and malformed optional objects", () => {
    expect(
      mapOpenWebUIModels([
        {
          id: "invalid",
          info: {
            params: {
              context_length: 0,
              num_ctx: -1,
              max_tokens: 1.5,
            },
            meta: "invalid",
          },
          meta: { context_length: Number.MAX_SAFE_INTEGER + 1, max_tokens: "bad" },
        },
        { id: "valid-after-invalid", info: { params: { context_length: 2048 } } },
      ]),
    ).toMatchObject([
      { contextWindow: 32_000, maxTokens: 4_096 },
      { contextWindow: 2048, maxTokens: 4_096 },
    ]);
  });

  test("ignores records without non-empty string ids and keeps the first duplicate", () => {
    expect(
      mapOpenWebUIModels([
        null,
        {},
        { id: "" },
        { id: "   " },
        { id: "same", name: "First" },
        { id: "same", name: "Second" },
      ]),
    ).toMatchObject([{ id: "same", name: "First" }]);
  });

  test("throws when no usable model records are returned", () => {
    expect(() => mapOpenWebUIModels([null, {}, { id: "" }])).toThrow(
      "No entries with a non-empty string id were returned",
    );
  });
});
