import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { harnessConfigSchema } from "../src/config.js";
import { requiredGatesPassed, runGates } from "../src/tools/gates.js";

const roles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"];

describe("quality gates", () => {
  it("runs configured gates deterministically and blocks required failures", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gates-"));
    const config = harnessConfigSchema.parse({ version: 1, runtime: {}, models: Object.fromEntries(roles.map((role) => [role, role])), workflow: { autoMerge: false }, context: {}, quality: {
      lint: { command: "git", args: ["--version"], required: false, timeoutMs: 1000 },
      test: { command: "git", args: ["not-a-command"], required: true, timeoutMs: 1000 }
    } });
    const results = await runGates(config, directory, path.join(directory, "logs"));
    expect(results.map((result) => result.name)).toEqual(["test", "lint"]);
    expect(requiredGatesPassed(results)).toBe(false);
    expect(results[0]?.stderr.length).toBeGreaterThan(0);
  });
});
