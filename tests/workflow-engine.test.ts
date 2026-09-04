import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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
  constructor(private readonly outputs: Record<string, unknown[]>, private readonly contextTokens?: number) {}
  async invoke<T>(invocation: RoleInvocation, schema: z.ZodType<T>): Promise<RoleResult<T>> {
    this.invocations.push(invocation); const index = this.counts.get(invocation.role) ?? 0; this.counts.set(invocation.role, index + 1);
    const value = schema.parse(this.outputs[invocation.role]?.[index]); return { value, sessionID: `${invocation.role}-${index}`, raw: JSON.stringify(value), ...(this.contextTokens ? { context: { latestPromptTokens: this.contextTokens, contextWindow: 65536, provenance: "exact" as const, source: "opencode_message_metadata" as const } } : {}) };
  }
}
async function setup(outputs: Record<string, unknown[]>, gateRounds = [[passedGate()]], contextTokens?: number) {
  const directory = await mkdtemp(path.join(tmpdir(), "workflow-")); const store = new StateStore(directory); const now = new Date().toISOString();
  const state: RunState = { schemaVersion: 1, runId: "run-test", repositoryPath: directory, artifactPath: directory, stage: "CREATED", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], checkpoints: [], mutatingActionsBlocked: false, manualHandoffRequested: false }; await store.initialize(state);
  let gateIndex = 0; const checkpoints: string[] = [];
  const dependencies: WorkflowDependencies = { async preflight() {}, async baseline() { return { commit: "a".repeat(40), treeHash: "b".repeat(40), gates: [passedGate()], artifactPath: path.join(directory, "baseline.json") }; }, async gates() { return gateRounds[Math.min(gateIndex++, gateRounds.length - 1)] ?? []; }, async checkpoint(kind) { checkpoints.push(kind); return { commit: "c".repeat(40), treeHash: "d".repeat(40), changedFiles: ["src/x.ts"] }; } };
  dependencies.regressionProof = async (findings, _triage, defective, repaired) => findings.map((finding) => ({ findingId: finding.id, testPath: "tests/regression.ts", defectiveCheckpoint: defective.commit, repairedCheckpoint: `${repaired.commit}-repaired`, failBefore: { exitCode: 1, expectedReasonMatched: true, evidence: "focused test failed" }, passAfter: { exitCode: 0, evidence: "focused test passed" } }));
  let handoffs = 0; dependencies.continuity = async (event) => ({ path: path.join(directory, `handoff-${++handoffs}.md`), newSessionId: `continued-${event.previousSessionId}` });
  const roles = new FakeRoles(outputs, contextTokens); return { engine: new WorkflowEngine(config(), store, roles, dependencies), roles, checkpoints, store, dependencies };
}
const baseOutputs = (): Record<string, unknown[]> => ({
  planner: [
    { criteria: [{ id: "AC-X", requirement: "works", status: "pending", evidence: [] }], assumptions: [], ambiguities: [] },
    { steps: [{ id: "P1", description: "implement", acceptanceCriteria: ["AC-X"], files: ["src/x.ts"], risks: [] }], allowedPaths: ["src"], prohibitedActions: [] }
  ],
  testArchitect: [{ tests: [{ id: "OT-1", acceptanceCriteria: ["AC-X"], behaviorPartition: "valid", edgeCases: [], description: "proves behavior" }], implementationDiffInspected: false }],
  implementer: [{ summary: "implemented", filesChanged: ["src/x.ts"], testsAdded: ["tests/x.ts"], commandsRun: [], blockers: [] }],
  repositoryReviewer: [{ findings: [] }], requirementsReviewer: [{ findings: [] }], validator: [{ findings: [] }],
  adversarialVerifier: [{ scenarios: [{ id: "ADV-1", acceptanceCriteria: ["AC-X"], category: "boundary", description: "boundary challenge", expectedBehavior: "remains correct" }] }],
  auditor: [{ acceptanceCriteria: [{ id: "AC-X", status: "proven", evidence: ["test"] }], findings: [], decision: "pass" }]
});

describe("WorkflowEngine", () => {
  it("converts an aborted active request into a recoverable cooperative pause", async () => {
    const fixture = await setup(baseOutputs()); let requested = false; fixture.dependencies.pauseRequested = async () => requested; fixture.dependencies.clearPauseRequest = async () => {};
    fixture.roles.invoke = async () => { requested = true; const persisted = await fixture.store.read(); persisted.activeSession = { role: "planner", sessionId: "ses-active" }; await fixture.store.write(persisted); throw new Error("aborted"); };
    const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" });
    expect(result).toMatchObject({ stage: "PAUSED", status: "paused", pausedFromStage: "ACCEPTANCE_CRITERIA_GENERATING", mutatingActionsBlocked: true });
    expect(result.counters.inferenceRetries).toBe(0);
    expect(result.activeSession).toEqual({ role: "planner", sessionId: "ses-active" });
  });

  it("completes the core workflow and hides oracle from initial implementation", async () => {
    const fixture = await setup(baseOutputs()); const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" });
    expect(result.stage).toBe("SUCCEEDED"); expect(fixture.checkpoints).toEqual(["implementation"]);
    const implementation = fixture.roles.invocations.find((item) => item.role === "implementer");
    expect(implementation?.artifactReferences.some((item) => item.includes("oracle"))).toBe(false); expect(implementation?.prompt).not.toContain("OT-1");
    const reviews = fixture.roles.invocations.filter((item) => ["repositoryReviewer", "requirementsReviewer"].includes(item.role));
    expect(new Set(reviews.map((item) => item.role)).size).toBe(2); expect(reviews.every((item) => item.freshSession)).toBe(true);
    expect(fixture.roles.invocations.filter((item) => item.role === "adversarialVerifier")).toHaveLength(1);
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
  it("can cross multiple validated continuity boundaries", async () => {
    const fixture = await setup(baseOutputs(), [[passedGate()]], 56_000); const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" }); expect(result.stage).toBe("SUCCEEDED"); expect(result.counters.contextHandoffs).toBeGreaterThanOrEqual(2); expect(result.handoffs.every((item) => item.previousSessionId !== item.newSessionId)).toBe(true); expect(result.mutatingActionsBlocked).toBe(false);
  });
  it("does not count handoff validation failure as inference retry", async () => {
    const fixture = await setup(baseOutputs(), [[passedGate()]], 56_000); fixture.dependencies.continuity = async () => { throw new Error("handoff validation failed twice"); }; const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" }); expect(result.stage).toBe("ESCALATED"); expect(result.counters.inferenceRetries).toBe(0); expect(result.mutatingActionsBlocked).toBe(true);
  });
  it("honors a persisted graceful pause between stages", async () => {
    const fixture = await setup(baseOutputs()); fixture.dependencies.pauseRequested = async () => true; const result = await fixture.engine.run({ requirements: "feature", definitionOfDone: "tests pass" }); expect(result.status).toBe("paused"); expect(result.stage).toBe("PAUSED"); expect(result.mutatingActionsBlocked).toBe(true); expect(fixture.roles.invocations).toHaveLength(0);
  });
  it("re-enters from a persisted clean implementation checkpoint", async () => {
    const first = await setup(baseOutputs()); expect((await first.engine.run({ requirements: "feature", definitionOfDone: "tests pass" })).status).toBe("succeeded"); const state = await first.store.read(); state.stage = "IMPLEMENTATION_CHECKPOINT"; state.status = "active"; state.activeSession = undefined; await first.store.write(state); await writeFile(path.join(state.artifactPath, "baseline.json"), JSON.stringify({ gates: [passedGate()] }));
    const recoveryOutputs = baseOutputs(); recoveryOutputs.planner = []; recoveryOutputs.testArchitect = []; recoveryOutputs.implementer = []; const roles = new FakeRoles(recoveryOutputs); const recovered = await new WorkflowEngine(config(), first.store, roles, first.dependencies).resumeFromCheckpoint({ requirements: "feature", definitionOfDone: "tests pass" }); expect(recovered.status).toBe("succeeded"); expect(roles.invocations.some((item) => item.role === "implementer")).toBe(false); expect(roles.invocations.filter((item) => item.role === "repositoryReviewer")).toHaveLength(1);
  });
  it("does not persist a configured raw API credential in prompts or responses", async () => {
    const prior = process.env.LLAMA_API_KEY; process.env.LLAMA_API_KEY = "credential-never-store"; try { const outputs = baseOutputs(); (outputs.implementer![0] as { summary: string }).summary = "credential-never-store"; const fixture = await setup(outputs); const result = await fixture.engine.run({ requirements: "use credential-never-store safely", definitionOfDone: "tests pass" }); expect(result.status).toBe("succeeded"); const names = await readdir(result.artifactPath, { recursive: true }); const contents = await Promise.all(names.filter((name) => name.endsWith(".json") || name.endsWith(".jsonl")).map((name) => readFile(path.join(result.artifactPath, name), "utf8"))); expect(contents.join("\n")).not.toContain("credential-never-store"); expect(contents.join("\n")).toContain("[REDACTED]"); } finally { if (prior === undefined) delete process.env.LLAMA_API_KEY; else process.env.LLAMA_API_KEY = prior; }
  });
});
