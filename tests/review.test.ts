import { describe, expect, it } from "vitest";
import { mergeReviews } from "../src/review/merge.js";
import { evaluateProgress } from "../src/review/progress.js";
import type { Finding } from "../src/workflow/contracts.js";
import type { GateResult } from "../src/tools/gates.js";

const finding: Finding = { id: "REV-1", severity: "high", acceptanceCriterion: "AC-X", file: "src/x.ts", lineStart: 1, problem: "Broken contract", evidence: "returns false", reproduction: "run fixture", expectedBehavior: "true", actualBehavior: "false", suggestedFix: "fix predicate", confidence: "high" };
const gate = (status: GateResult["status"]): GateResult => ({ name: "test", status, required: true, provenance: "pre_existing", command: "npm", args: ["test"], exitCode: status === "passed" ? 0 : 1, signal: null, timedOut: false, durationMs: 1, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false });

describe("review merge and objective progress", () => {
  it("deduplicates by evidence/root contract while preserving attribution", () => {
    const duplicate = { ...finding, id: "REQ-2" };
    const result = mergeReviews({ findings: [finding] }, { findings: [duplicate] });
    expect(result).toHaveLength(1); expect(result[0]?.sources).toEqual(["repository", "requirements"]); expect(result[0]?.duplicateIds).toEqual(["REQ-2"]);
  });
  it("assigns deterministic unique ids when independent reviewers reuse an id for different findings", () => {
    const different = { ...finding, acceptanceCriterion: "AC-Y", problem: "Different defect" };
    const result = mergeReviews({ findings: [finding] }, { findings: [different] });
    expect(result.map((item) => item.id)).toEqual(["REV-1", "requirements:REV-1"]);
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
  });
  it("grants continuation only with measurable improvement", () => {
    const previous = { gates: [gate("failed")], confirmed: [finding], provenCriteria: 0, changedFiles: 3 };
    expect(evaluateProgress(previous, { gates: [gate("passed")], confirmed: [], provenCriteria: 1, changedFiles: 2 }).decision).toBe("stop_success");
    expect(evaluateProgress(previous, { ...previous }).decision).toBe("stop_stagnated");
  });
});
