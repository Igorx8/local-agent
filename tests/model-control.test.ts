import { afterEach, describe, expect, it, vi } from "vitest";
import { smokeModel } from "../src/models/control.js";
import type { ModelRegistry } from "../src/models/registry.js";

const registry: ModelRegistry = {
  version: 1, providerId: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1/", apiKeyEnv: "LLAMA_API_KEY",
  models: { main: { hfRef: "local/main:Q4", quantization: "Q4", approximateArtifactGiB: 1, contextSize: 4096, parallel: 1, reasoning: "off", roles: ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"] } },
  commonServerArgs: { host: "127.0.0.1", port: 8080, noMmproj: true, jinja: true, flashAttention: "auto", cacheTypeK: "q8_0", cacheTypeV: "q8_0", fit: "on", fitTargetMiB: 1024, loadMode: "none" },
};

describe("model smoke telemetry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts compatible exact token accounting across completion and tool calls", async () => {
    const responses = [
      { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } },
      { choices: [{ message: { tool_calls: [{}] } }], usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })));
    await expect(smokeModel(registry, "main")).resolves.toEqual({ completion: true, toolCall: true, tokenUsage: true });
  });

  it("does not assume token visibility when totals are absent or inconsistent", async () => {
    const responses = [
      { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 7 } },
      { choices: [{ message: { tool_calls: [{}] } }] },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })));
    await expect(smokeModel(registry, "main")).resolves.toEqual({ completion: true, toolCall: true, tokenUsage: false });
  });
});
