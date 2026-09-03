import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { harnessConfigSchema } from "../src/config.js";
import { modelRegistrySchema } from "../src/models/registry.js";
import { createReproducibilityManifest } from "../src/reproducibility/manifest.js";

const roles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"] as const;
const models = Object.fromEntries(roles.map((role) => [role, `llama.cpp/${role === "implementer" || role === "repair" ? "coder" : role === "repositoryReviewer" || role === "adversarialVerifier" ? "review" : "main"}`]));
const entries = {
  main: { hfRef: "owner/main:Q4", quantization: "Q4", approximateArtifactGiB: 1, contextSize: 100, parallel: 1 as const, reasoning: "auto" as const, reasoningBudget: 10, roles: ["supervisor", "planner", "testArchitect", "requirementsReviewer", "validator", "auditor"] },
  coder: { hfRef: "owner/coder:Q4", quantization: "Q4", approximateArtifactGiB: 1, contextSize: 100, parallel: 1 as const, reasoning: "off" as const, roles: ["implementer", "repair"] },
  review: { hfRef: "owner/review:Q4", quantization: "Q4", approximateArtifactGiB: 1, contextSize: 100, parallel: 1 as const, reasoning: "off" as const, roles: ["repositoryReviewer", "adversarialVerifier"] }
};
const commonServerArgs = { host: "127.0.0.1" as const, port: 8080, noMmproj: true as const, jinja: true as const, flashAttention: "auto" as const, cacheTypeK: "q8_0" as const, cacheTypeV: "q8_0" as const, fit: "on" as const, fitTargetMiB: 100 };

describe("reproducibility manifest", () => {
  it("fails closed without immutable GGUF identity", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "manifest-missing-")); const config = harnessConfigSchema.parse({ version: 1, runtime: {}, models, workflow: { autoMerge: false }, context: {} }); const registry = modelRegistrySchema.parse({ version: 1, providerId: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", apiKeyEnv: "LLAMA_API_KEY", models: entries, commonServerArgs }); await expect(createReproducibilityManifest(directory, config, registry)).rejects.toThrow(/immutable artifact identity/);
  });

  it("records aliases, hashes, runtime evidence, sampling status and gate argv", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "manifest-")); const config = harnessConfigSchema.parse({ version: 1, runtime: {}, models, workflow: { autoMerge: false }, context: {}, quality: { test: { command: "npm", args: ["test"], required: true, timeoutMs: 1000 } } }); const hash = "a".repeat(64); const artifacts = Object.fromEntries(Object.keys(entries).map((alias) => [alias, { paths: [`/models/${alias}.gguf`], bytes: [42], sha256: [hash] }])); const registry = modelRegistrySchema.parse({ version: 1, providerId: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", apiKeyEnv: "LLAMA_API_KEY", models: entries, artifacts, commonServerArgs }); const file = await createReproducibilityManifest(directory, config, registry); const manifest = JSON.parse(await readFile(file, "utf8")); expect(manifest.models.coder).toMatchObject({ alias: "coder", bytes: [42], sha256: [hash], quantization: "Q4" }); expect(manifest.qualityCommands.test).toEqual({ command: "npm", args: ["test"], required: true }); expect(manifest.runtimes.node).toBe(process.version); expect(manifest.sampling.seed).toContain("blocked");
  });
});
