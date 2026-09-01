import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HarnessConfig } from "../src/config.js";
import { harnessConfigSchema } from "../src/config.js";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";
import type { GateResult } from "../src/tools/gates.js";
import { WorkflowEngine, type WorkflowDependencies } from "../src/workflow/engine.js";
import type { RoleInvocation, RoleResult, RoleRunner } from "../src/workflow/role-runner.js";
import type { z } from "zod";

const roleNames = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"];
function config(): HarnessConfig { return harnessConfigSchema.parse({ version: 1, runtime: {}, models: Object.fromEntries(roleNames.map((role) => [role, `llama.cpp/${role}`])), workflow: { autoMerge: false, maxReviewIterations: 2, adaptiveReviewMaximum: 3 }, context: {}, quality: {} }); }
function passedGate(): GateResult { return { name: "test", required: true, status: "passed", provenance: "pre_existing", command: "npm", args: ["test"], exitCode: 0, signal: null, timedOut: false, durationMs: 1, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false }; }

class FakeRoles implements RoleRunner {
  invocations: RoleInvocation[] = []; private counts = new Map<string, number>();
  constructor(private readonly outputs: Record<string, unknown[]>) {}
  async invoke<T>(invocation: RoleInvocation, schema: z.ZodType<T>): Promise<RoleResult<T>> {
    this.invocations.push(invocation); const index = this.counts.get(invocation.role) ?? 0; this.counts.set(invocation.role, index + 1);
    const value = schema.parse(this.outputs[invocation.role]?.[index]); return { value, sessionID: `${invocation.role}-${index}`, raw: JSON.stringify(value) };
  }
}
async function setup(outputs: Record<string, unknown[]>, gateRounds = [[passedGate()]]) {
  const directory = await mkdtemp(path.join(tmpdir(), "workflow-")); const store = new StateStore(directory); const now = new Date().toISOString();
  const state: RunState = { schemaVersion: 1, runId: "run-test", repositoryPath: directory, artifactPath: directory, stage: "CREATED", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 } }; await store.initialize(state);
  let gateIndex = 0; const checkpoints: string[] = [];
  const dependencies: WorkflowDependencies = { async preflight() {}, async baseline() { return { commit: "a".repeat(40), treeHash: "b".repeat(40), gates: [passedGate()], artifactPath: path.join(directory, "baseline.json") }; }, async gates() { return gateRounds[Math.min(gateIndex++, gateRounds.length - 1)] ?? []; }, async checkpoint(kind) { checkpoints.push(kind); return { commit: "c".repeat(40), treeHash: "d".repeat(40), changedFiles: ["src/x.ts"] }; } };
  const roles = new FakeRoles(outputs); return { engine: new WorkflowEngine(config(), store, roles, dependencies), roles, checkpoints, store };
}
const baseOutputs = (): Record<string, unknown[]> => ({
  planner: [
    { criteria: [{ id: "AC-X", requirement: "works", status: "pending", evidence: [] }], assumptions: [], ambiguities: [] },
    { steps: [{ id: "P1", description: "implement", acceptanceCriteria: ["AC-X"], files: ["src/x.ts"], risks: [] }], allowedPaths: ["src"], prohibitedActions: [] }
  ],
  testArchitect: [{ tests: [{ id: "OT-1", acceptanceCriteria: ["AC-X"], behaviorPartition: "valid", edgeCases: [], description: "proves behavior" }], implementationDiffInspected: false }],
  implementer: [{ summary: "implemented", filesChanged: ["src/x.ts"], testsAdded: ["tests/x.ts"], commandsRun: [], blockers: [] }],
  repositoryReviewer: [{ findings: [] }], requirementsReviewer: [{ findings: [] }], validator: [{ findings: [] }],
  auditor: [{ acceptanceCriteria: [{ id: "AC-X", status: "proven", evidence: ["test"] }], findings: [], decision: "pass" }]
});

describe("WorkflowEngine", () => {
  it("completes the core workflow and hides oracle from initial implementation", async () => {
    const fixture = await setup(baseOutputs()); const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" });
    expect(result.stage).toBe("SUCCEEDED"); expect(fixture.checkpoints).toEqual(["implementation"]);
    const implementation = fixture.roles.invocations.find((item) => item.role === "implementer");
    expect(implementation?.artifactReferences.some((item) => item.includes("oracle"))).toBe(false); expect(implementation?.prompt).not.toContain("OT-1");
    const reviews = fixture.roles.invocations.filter((item) => ["repositoryReviewer", "requirementsReviewer"].includes(item.role));
    expect(new Set(reviews.map((item) => item.role)).size).toBe(2); expect(reviews.every((item) => item.freshSession)).toBe(true);
  });
  it("validates a high finding, performs one focused repair, and re-reviews", async () => {
    const finding = { id: "REV-1", severity: "high", acceptanceCriterion: "AC-X", file: "src/x.ts", lineStart: 1, problem: "broken", evidence: "fixture", reproduction: "npm test", expectedBehavior: "pass", actualBehavior: "fail", suggestedFix: "minimal", confidence: "high" };
    const outputs = baseOutputs(); outputs.repositoryReviewer = [{ findings: [finding] }, { findings: [] }]; outputs.requirementsReviewer = [{ findings: [] }, { findings: [] }]; outputs.validator = [{ findings: [{ findingId: "REV-1", classification: "confirmed", evidence: "reproduced", rootCause: "predicate", testable: true }] }, { findings: [] }];
    Object.assign(outputs, { repair: [{ summary: "fixed", filesChanged: ["src/x.ts"], testsAdded: ["tests/regression.ts"], commandsRun: ["npm test"], blockers: [] }] });
    const fixture = await setup(outputs, [[passedGate()], [passedGate()]]); const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" });
    expect(result.stage).toBe("SUCCEEDED"); expect(result.counters.repairIterations).toBe(1); expect(fixture.checkpoints).toEqual(["implementation", "repair"]);
    expect(fixture.roles.invocations.filter((item) => item.role === "repositoryReviewer")).toHaveLength(2);
  });
  it("escalates when a repaired finding reappears", async () => {
    const finding = { id: "REV-1", severity: "high", acceptanceCriterion: "AC-X", problem: "broken", evidence: "fixture", reproduction: "npm test", expectedBehavior: "pass", actualBehavior: "fail", suggestedFix: "minimal", confidence: "high" };
    const outputs = baseOutputs(); outputs.repositoryReviewer = [{ findings: [finding] }, { findings: [finding] }]; outputs.requirementsReviewer = [{ findings: [] }, { findings: [] }];
    const classified = { findings: [{ findingId: "REV-1", classification: "confirmed", evidence: "reproduced", rootCause: "same predicate", testable: true }] };
    outputs.validator = [classified, classified]; outputs.repair = [{ summary: "attempted", filesChanged: ["src/x.ts"], testsAdded: ["tests/regression.ts"], commandsRun: [], blockers: [] }];
    const fixture = await setup(outputs, [[passedGate()], [passedGate()]]); const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" });
    expect(result.stage).toBe("ESCALATED"); expect(result.counters.repairIterations).toBe(1);
  });
});
