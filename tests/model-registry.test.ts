import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { explicitProcessProfile, unsupportedFlags } from "../src/models/profiles.js";
import { modelRegistrySchema, renderRouterPreset, requireAlias, resolveCachedArtifact, resolveRoleAlias } from "../src/models/registry.js";

const raw = YAML.parse(`
version: 1
providerId: llama.cpp
baseUrl: http://127.0.0.1:8080/v1
apiKeyEnv: LLAMA_API_KEY
models:
  main: { hfRef: owner/main-GGUF:UD-IQ3_S, quantization: UD-IQ3_S, approximateArtifactGiB: 1, contextSize: 65536, parallel: 1, reasoning: auto, reasoningBudget: 8192, reasoningPreserve: true, roles: [supervisor, planner, testArchitect, requirementsReviewer, validator, auditor] }
  coder: { hfRef: owner/coder-GGUF:UD-Q4_K_XL, quantization: UD-Q4_K_XL, approximateArtifactGiB: 1, contextSize: 65536, parallel: 1, reasoning: off, roles: [implementer, repair] }
  review: { hfRef: owner/review-GGUF:Q4_K_S, quantization: Q4_K_S, approximateArtifactGiB: 1, contextSize: 65536, parallel: 1, reasoning: off, roles: [repositoryReviewer, adversarialVerifier] }
commonServerArgs: { host: 127.0.0.1, port: 8080, noMmproj: true, jinja: true, flashAttention: auto, cacheTypeK: q8_0, cacheTypeV: q8_0, fit: on, fitTargetMiB: 2048 }
`);
const registry = modelRegistrySchema.parse(raw);

describe("model registry", () => {
  it("resolves roles to stable aliases and fails closed", () => {
    expect(resolveRoleAlias(registry, "implementer")).toBe("coder");
    expect(() => requireAlias(registry, "implementer")).toThrow(/unknown model alias/);
    expect(() => modelRegistrySchema.parse({ ...raw, models: { ...raw.models, coder: { ...raw.models.coder, hfRef: "owner/coder-GGUF:Q4_K_M" } } })).toThrow(/quantization/);
  });
  it("builds exact argv without shell interpolation", () => {
    const profile = explicitProcessProfile(registry, "main", { command: "llama", prefix: ["serve"] }, "secret");
    expect(profile.args.slice(0, 5)).toEqual(["serve", "-hf", "owner/main-GGUF:UD-IQ3_S", "--alias", "main"]); expect(profile.args).toContain("--reasoning-preserve"); expect(profile.args.join(" ")).not.toContain("$"); expect(unsupportedFlags("--hf-repo\n" + profile.args.join("\n"))).toContain("--models-preset");
  });
  it("resolves exact cache quantization and renders the preset", async () => {
    const root = path.join(process.env.TMPDIR ?? "/tmp", `registry-${process.pid}-${Date.now()}`); const snapshot = path.join(root, "models--owner--main-GGUF", "snapshots", "revision"); const blobs = path.join(root, "models--owner--main-GGUF", "blobs");
    await mkdir(snapshot, { recursive: true }); await mkdir(blobs, { recursive: true }); await writeFile(path.join(blobs, "blob"), "gguf"); await symlink("../../blobs/blob", path.join(snapshot, "main-UD-IQ3_S.gguf"));
    const artifact = await resolveCachedArtifact("main", registry.models.main!, root, true); expect(artifact.bytes).toEqual([4]); expect(artifact.sha256?.[0]).toHaveLength(64);
    const all = Object.fromEntries(Object.keys(registry.models).map((alias) => [alias, { ...artifact, alias, paths: [`/models/${alias}.gguf`] }])); const preset = renderRouterPreset(registry, all); expect(preset).toContain("[main]\nmodel = /models/main.gguf"); expect(preset).toContain("reasoning-budget = 8192");
  });
});
