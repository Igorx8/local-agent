import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { harnessConfigSchema } from "../src/config.js";
import { classifyFlaky, repeatIsolated } from "../src/verification/flaky.js";
import { runRegressionProofAdapter, validateRegressionProofs } from "../src/verification/regression.js";
import { advancedVerificationPassed, runAdvancedVerification } from "../src/verification/suite.js";
import { appendHistoricalMetric } from "../src/verification/historical.js";

const roles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"];
const jsonTest = (provenance: string) => JSON.stringify({ tests: [{ id: "T-1", provenance, acceptanceCriteria: ["AC-X"], behaviorPartitions: ["boundary"], edgeCases: ["zero"], changedCodePaths: ["src/x.ts"], passed: true, evidence: ["exit 0"] }] });
function config(commands: object) { return harnessConfigSchema.parse({ version: 1, runtime: {}, models: Object.fromEntries(roles.map((role) => [role, role])), workflow: { autoMerge: false }, verification: { commands }, context: {} }); }
const command = (stdout: string, required = true) => ({ command: "printf", args: [stdout], required, timeoutMs: 5000 });

describe("advanced verification", () => {
  it("executes configured adapters and blocks acceptance-relevant surviving mutants", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "advanced-"));
    const mutation = JSON.stringify({ killed: 4, survived: 1, timedOut: 0, skipped: 0, survivors: [{ mutant: "negate condition", file: "src/x.ts", acceptanceCriteria: ["AC-X"] }] });
    const result = await runAdvancedVerification(config({ adversarial: command(jsonTest("adversarial")), property: command(jsonTest("property_based")), mutation: command(mutation) }), directory, directory, ["src/x.ts"], { scenarios: [{ id: "ADV", acceptanceCriteria: ["AC-X"], category: "boundary", description: "zero", expectedBehavior: "valid" }] });
    expect(result.adversarial.status).toBe("passed"); expect(result.property.tests[0]?.provenance).toBe("property_based"); expect(result.mutation.score).toBe(0.8); expect(result.mutation.relevantSurvivors).toHaveLength(1); expect(advancedVerificationPassed(result)).toBe(false);
  });

  it("classifies repeated isolated outcomes and never permits flaky sole evidence", async () => {
    expect(classifyFlaky([{ passed: true, exitCode: 0, durationMs: 1 }, { passed: false, exitCode: 1, durationMs: 1 }])).toBe("potentially_flaky");
    const directory = await mkdtemp(path.join(tmpdir(), "flaky-")); const result = await repeatIsolated(command("ok"), 3, { cwd: directory }); expect(result.classification).toBe("stable_pass"); expect(result.outcomes).toHaveLength(3); expect(result.soleSuccessEvidenceAllowed).toBe(false);
  });

  it("requires fail-before/pass-after proof for every testable finding", () => {
    const proof = { findingId: "REV-1", testPath: "tests/regression.ts", defectiveCheckpoint: "before", repairedCheckpoint: "after", failBefore: { exitCode: 1, expectedReasonMatched: true, evidence: "assertion failed" }, passAfter: { exitCode: 0, evidence: "test passed" } };
    expect(validateRegressionProofs(["REV-1"], [proof])).toHaveLength(1); expect(() => validateRegressionProofs(["REV-1"], [{ ...proof, failBefore: { ...proof.failBefore, exitCode: 0 } }])).toThrow(/fail-before/); expect(() => validateRegressionProofs(["REV-1", "REV-2"], [proof])).toThrow(/every confirmed/);
  });

  it("accepts only configured regression-adapter evidence bound to both checkpoints", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "regression-")); const finding = { id: "REV-1", severity: "high" as const, problem: "broken", evidence: "observed", reproduction: "focused test", expectedBehavior: "pass", actualBehavior: "fail", suggestedFix: "fix", confidence: "high" as const };
    const proof = { findingId: "REV-1", testPath: "tests/regression.ts", defectiveCheckpoint: "before", repairedCheckpoint: "after", failBefore: { exitCode: 1, expectedReasonMatched: true, evidence: "assertion failed" }, passAfter: { exitCode: 0, evidence: "test passed" } }; const configured = config({ regression: command(JSON.stringify({ proofs: [proof] })) });
    expect(await runRegressionProofAdapter(configured, directory, directory, [finding], { findings: [{ findingId: "REV-1", classification: "confirmed", evidence: "reproduced", rootCause: "predicate", testable: true }] }, "before", "after")).toHaveLength(1);
    await expect(runRegressionProofAdapter(configured, directory, directory, [finding], { findings: [{ findingId: "REV-1", classification: "confirmed", evidence: "reproduced", rootCause: "predicate", testable: true }] }, "other", "after")).rejects.toThrow(/checkpoint mismatch/);
  });

  it("appends historical metrics as JSONL", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "history-")); const file = path.join(directory, "history.jsonl"); const metric = { schemaVersion: 1 as const, recordedAt: new Date().toISOString(), runId: "run", repository: directory, success: true, firstPassGateSuccess: true, repairIterations: 0, confirmedFindings: 0, invalidFindings: 0, regressions: 0, testProvenance: { property_based: 1 }, mutationScore: 1, flakyIncidents: 0, durationMs: 10, gateResults: { test: "passed" }, diffChurn: 1, handoffs: 0, humanInterventions: 0 };
    await appendHistoricalMetric(file, metric); await appendHistoricalMetric(file, metric); expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);
  });
});
