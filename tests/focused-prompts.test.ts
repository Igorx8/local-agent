import { describe, expect, it } from "vitest";
import { assertFocusedRepairChanged, focusedBlockingFindings, focusedRepairPrompt, focusedReviewPrompt, reusedFocusedCheckpoint } from "../src/workflow/fix.js";

describe("focused workflow prompts", () => {
  it("limits review findings to explicit requirements and introduced defects", () => {
    const prompt = focusedReviewPrompt("create an index", ["tasks/README.md"], [{ name: "git-status", status: "passed" }]);
    expect(prompt).toContain("explicit task");
    expect(prompt).toContain("demonstrably introduced");
    expect(prompt).toContain("Do not invent additional acceptance criteria");
    expect(prompt).toContain("scan the complete affected file");
  });

  it("requires surgical edits during the single repair opportunity", () => {
    const prompt = focusedRepairPrompt("create an index", [{ file: "tasks/README.md", lineStart: 10 }]);
    expect(prompt).toContain("smallest possible replacement");
    expect(prompt).toContain("never regenerate or rewrite the whole file");
    expect(prompt).toContain("Preserve all unaffected content byte-for-byte");
    expect(prompt).toContain("do not create new paths");
    expect(prompt).toContain("Never apply a suggested identifier or numbering range blindly");
    expect(prompt).toContain("file-wide invariant");
  });

  it("repairs only validated high-severity findings", () => {
    const finding = (id: string, severity: "high" | "low") => ({ id, severity, problem: id, evidence: id, reproduction: id, expectedBehavior: id, actualBehavior: id, suggestedFix: id, confidence: "high" as const });
    const findings = [finding("invented", "high"), finding("style", "low"), finding("real", "high")];
    const triage = { findings: [{ findingId: "invented", classification: "invalid" as const, evidence: "not required", rootCause: "invented", testable: false }, { findingId: "style", classification: "confirmed" as const, evidence: "wording", rootCause: "style", testable: false, regressionTestExemption: "style only" }, { findingId: "real", classification: "confirmed" as const, evidence: "reproduced", rootCause: "defect", testable: true }] };
    expect(focusedBlockingFindings(findings, triage).map((item) => item.id)).toEqual(["real"]);
  });

  it("reports a no-op repair blocker before checkpoint creation", () => {
    expect(() => assertFocusedRepairChanged([], ["Maximum steps reached"])).toThrow("focused repair produced no file changes: Maximum steps reached");
    expect(() => assertFocusedRepairChanged(["tasks/README.md"], [])).not.toThrow();
  });

  it("reuses an inherited checkpoint when implementation is already identical", () => {
    expect(reusedFocusedCheckpoint({ commit: "abc", files: ["tasks/README.md"] }, { commit: "abc", treeHash: "tree" }, "2026-09-28T00:00:00.000Z")).toEqual({ stage: "focused-fix", iteration: 0, commit: "abc", treeHash: "tree", changedFiles: ["tasks/README.md"], createdAt: "2026-09-28T00:00:00.000Z" });
    expect(() => reusedFocusedCheckpoint({ commit: "abc", files: [] }, { commit: "other", treeHash: "tree" })).toThrow("identity changed");
  });
});
