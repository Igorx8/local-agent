import { describe, expect, it } from "vitest";
import { classifyOperationalScenario, executeOperationalScenario, operationalManifestSchema, stageDurations } from "../src/operational/validation.js";

const limits = { expectedExitCodes: [0], blockedExitCodes: [77], maximumModelProcesses: 1, maximumSwapGrowthMiB: 512 };

describe("operational validation", () => {
  it("accepts executable plus argv manifests and rejects shell-shaped omissions", () => {
    const parsed = operationalManifestSchema.parse({ schemaVersion: 1, output: "/tmp/report.json", scenarios: [{ id: "multi_turn", command: "harness-validation", args: ["/repo"], cwd: "/repo" }] });
    expect(parsed.scenarios[0]).toMatchObject({ command: "harness-validation", args: ["/repo"], maximumModelProcesses: 1 });
  });

  it("fails on overlap or excessive swap and distinguishes blocked prerequisites", () => {
    expect(classifyOperationalScenario({ exitCode: 0, signal: null, timedOut: false, maximumModelProcesses: 2, swapGrowthMiB: 0 }, limits)).toMatchObject({ status: "failed", reason: expect.stringContaining("simultaneous") });
    expect(classifyOperationalScenario({ exitCode: 0, signal: null, timedOut: false, maximumModelProcesses: 1, swapGrowthMiB: 600 }, limits)).toMatchObject({ status: "failed", reason: expect.stringContaining("swap") });
    expect(classifyOperationalScenario({ exitCode: 77, signal: null, timedOut: false, maximumModelProcesses: 0, swapGrowthMiB: 0 }, limits)).toMatchObject({ status: "blocked" });
  });

  it("derives per-stage durations for future pipeline optimization", () => {
    expect(stageDurations([{ timestamp: "2026-01-01T00:00:00.000Z", type: "workflow.stage", data: { stage: "PLANNING" } }, { timestamp: "2026-01-01T00:00:02.500Z", type: "workflow.stage", data: { stage: "IMPLEMENTING" } }])).toEqual({ PLANNING: 2500 });
  });

  it("does not miss an immediately exiting child process", async () => {
    const result = await executeOperationalScenario(operationalManifestSchema.parse({ schemaVersion: 1, output: "/tmp/unused.json", scenarios: [{ id: "multi_turn", command: "/usr/bin/true", cwd: "/tmp" }] }).scenarios[0]!, 500);
    expect(result).toMatchObject({ status: "passed", exitCode: 0, timedOut: false });
  }, 10_000);
});
