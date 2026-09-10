import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { harnessConfigSchema } from "../src/config.js";
import { resolveFileReferences } from "../src/input/file-references.js";

const roles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"];
function config(overrides: Record<string, number> = {}) { return harnessConfigSchema.parse({ version: 1, runtime: {}, models: Object.fromEntries(roles.map((role) => [role, `llama.cpp/${role}`])), workflow: { autoMerge: false }, context: {}, fileReferences: overrides }); }
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), "harness-references-")); await mkdir(path.join(root, "docs")); await writeFile(path.join(root, "README.md"), "hello\n"); await writeFile(path.join(root, "docs", "with space.md"), "spaced\n"); return root; }

describe("explicit file references", () => {
  it("resolves multiple and quoted references with exact deterministic boundaries", async () => {
    const root = await fixture(); const result = await resolveFileReferences(root, 'compare @README.md and @"docs/with space.md"', config());
    expect(result.references.map((item) => item.path)).toEqual(["README.md", "docs/with space.md"]); expect(result.references[0]).toMatchObject({ bytes: 6, estimatedTokens: 2 }); expect(result.references[0]!.sha256).toMatch(/^[a-f0-9]{64}$/); expect(result.prompt).toContain("--- BEGIN REFERENCED FILE: README.md | bytes=6 | sha256="); expect(result.prompt).toContain("hello\n--- END REFERENCED FILE: README.md ---");
  });

  it("supports literal @ escaping and does not interpret email addresses", async () => {
    const root = await fixture(); const result = await resolveFileReferences(root, "send @@README.md to a@b.test", config()); expect(result.references).toEqual([]); expect(result.prompt).toBe("send @README.md to a@b.test");
  });

  it("fails closed and reports every invalid target without allowed contents", async () => {
    const root = await fixture(); await writeFile(path.join(root, ".env"), "TOP_SECRET=value\n");
    await expect(resolveFileReferences(root, "read @missing.md @.env @docs", config())).rejects.toThrow(/missing\.md:[\s\S]*\.env:[\s\S]*docs:/);
    await expect(resolveFileReferences(root, "read @missing.md @.env", config())).rejects.not.toThrow(/TOP_SECRET/);
  });

  it("rejects symlink escape, binary data, and deterministic size budgets", async () => {
    const root = await fixture(); const outside = path.join(await mkdtemp(path.join(tmpdir(), "outside-")), "secret.txt"); await writeFile(outside, "secret"); await symlink(outside, path.join(root, "escape")); await writeFile(path.join(root, "binary"), Buffer.from([0, 1, 2])); await writeFile(path.join(root, "large"), "x".repeat(17));
    await expect(resolveFileReferences(root, "@escape @binary @large", config({ maxFileBytes: 16, maxTotalBytes: 32, maxEstimatedTokens: 8 }))).rejects.toThrow(/outside[\s\S]*binary[\s\S]*per-file limit/);
  });

  it("rejects aggregate byte and estimated-token overflow without truncation", async () => {
    const root = await fixture(); await writeFile(path.join(root, "a.txt"), "a".repeat(12)); await writeFile(path.join(root, "b.txt"), "b".repeat(12));
    await expect(resolveFileReferences(root, "@a.txt @b.txt", config({ maxFileBytes: 20, maxTotalBytes: 20, maxEstimatedTokens: 4 }))).rejects.toThrow(/aggregate references: 24 bytes[\s\S]*approximately 6 tokens/);
  });
});
