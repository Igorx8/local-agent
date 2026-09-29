import { describe, expect, it } from "vitest";
import { assertFocusedRepairChanged, deterministicDocumentFindings, focusedBlockingFindings, focusedDocumentPrompt, focusedPerformanceReport, focusedRepairPrompt, focusedReviewPrompt, reusedFocusedCheckpoint } from "../src/workflow/fix.js";

describe("focused workflow prompts", () => {
  it("prevents redundant source reads and whole-document rewrites in document mode", () => {
    const prompt = focusedDocumentPrompt("update @plan.md");
    expect(prompt).toContain("do not read those source paths again");
    expect(prompt).toContain("Read each existing output target at most once");
    expect(prompt).toContain("prefer small edits");
  });

  it("summarizes content-free performance evidence", () => {
    const report = focusedPerformanceReport(1200, [{ stage: "IMPLEMENTING", durationMs: 900 }], [{ role: "implementer", alias: "coder", durationMs: 800, inputTokens: 100, outputTokens: 20, reasoningTokens: 0, toolCalls: 2 }, { role: "repositoryReviewer", alias: "main", durationMs: 200, inputTokens: 30, outputTokens: 5, reasoningTokens: 0, toolCalls: 1 }], { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 });
    expect(report).toMatchObject({ totalDurationMs: 1200, totals: { inputTokens: 130, outputTokens: 25, reasoningTokens: 0, toolCalls: 3 } });
    expect(JSON.stringify(report)).not.toContain("prompt");
  });
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
    expect(focusedBlockingFindings(findings, triage, [finding("gate", "high")]).map((item) => item.id)).toEqual(["gate", "real"]);
  });

  it("reports a no-op repair blocker before checkpoint creation", () => {
    expect(() => assertFocusedRepairChanged([], ["Maximum steps reached"])).toThrow("focused repair produced no file changes: Maximum steps reached");
    expect(() => assertFocusedRepairChanged(["tasks/README.md"], [])).not.toThrow();
  });

  it("turns deterministic document failures into authoritative high-severity findings", () => {
    const findings = deterministicDocumentFindings("tasks/README.md", { declarations: [], passed: false, findings: [{ rule: "missing-structured-identifier", identifier: "TASK-NNN", section: "Fase 5", lines: [42] }] });
    expect(findings[0]).toMatchObject({ id: "DOC-GATE-1", severity: "high", file: "tasks/README.md", lineStart: 42, confidence: "high" });
    expect(findings[0]?.evidence).toContain("Fase 5");
  });

  it("reuses an inherited checkpoint when implementation is already identical", () => {
    expect(reusedFocusedCheckpoint({ commit: "abc", files: ["tasks/README.md"] }, { commit: "abc", treeHash: "tree" }, "2026-09-28T00:00:00.000Z")).toEqual({ stage: "focused-fix", iteration: 0, commit: "abc", treeHash: "tree", changedFiles: ["tasks/README.md"], createdAt: "2026-09-28T00:00:00.000Z" });
    expect(() => reusedFocusedCheckpoint({ commit: "abc", files: [] }, { commit: "other", treeHash: "tree" })).toThrow("identity changed");
  });
});
