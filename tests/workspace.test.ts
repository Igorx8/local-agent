import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { discoverHarnessConfig, resolveWorkspace } from "../src/workspace.js";

const execute = promisify(execFile);
describe("workspace convenience", () => {
  it("resolves the containing Git root from a nested IDE folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "harness-workspace-")); await execute("git", ["init", root]); const nested = path.join(root, "packages", "app"); await mkdir(nested, { recursive: true }); expect(await resolveWorkspace(nested)).toBe(root);
  });

  it("prefers explicit, environment, workspace and packaged configuration in order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "harness-config-discovery-")); const moduleDirectory = path.join(root, "dist", "src"); const local = path.join(root, ".agent-harness", "harness.yaml"); const personal = path.join(root, "personal.yaml"); await mkdir(path.dirname(local), { recursive: true }); await writeFile(local, "version: 1\n"); await writeFile(personal, "version: 1\n"); expect(await discoverHarnessConfig(root, undefined, moduleDirectory, { HARNESS_CONFIG: personal })).toBe(personal); expect(await discoverHarnessConfig(root, local, moduleDirectory, {})).toBe(local);
  });
});
