import { describe, expect, it } from "vitest";
import { benchmarkFingerprint, compareDocumentBenchmarks, parseDocumentBenchmarkSnapshot, type DocumentBenchmarkSnapshot } from "../src/evaluation/document-benchmark.js";

const quality = (specificity: "pass" | "fail" = "pass") => [
  { dimension: "completeness" as const, status: "pass" as const, evidence: [] },
  { dimension: "specificity" as const, status: specificity, evidence: [] },
  { dimension: "traceability" as const, status: "pass" as const, evidence: [] },
  { dimension: "verification" as const, status: "pass" as const, evidence: [] },
  { dimension: "unsupported-invention" as const, status: "review" as const, evidence: [] },
];

const snapshot = (outputTokens: number, overrides: Partial<DocumentBenchmarkSnapshot> = {}): DocumentBenchmarkSnapshot => ({
  fixtureSha256: "fixture", promptSha256: "prompt", initialTreeHash: "tree", runtimeFingerprint: "runtime", modelFingerprint: "models", quality: quality(),
  metrics: { totalDurationMs: 1000, inputTokens: 100, outputTokens, toolCalls: 4, modelSwitches: 1, retries: 0, repairs: 0 }, ...overrides,
});

describe("controlled document benchmark", () => {
  it("passes only a comparable run with mandatory quality and material token reduction", () => {
    expect(compareDocumentBenchmarks(snapshot(1000), snapshot(700))).toMatchObject({ status: "passed", comparable: true, outputTokenReduction: 0.3, reasons: [] });
  });

  it("blocks comparisons across different fixtures or runtime/model fingerprints", () => {
    const verdict = compareDocumentBenchmarks(snapshot(1000), snapshot(700, { fixtureSha256: "other", runtimeFingerprint: "other-runtime" }));
    expect(verdict).toMatchObject({ status: "blocked", comparable: false });
    expect(verdict.reasons).toEqual(["fixtureSha256 differs", "runtimeFingerprint differs"]);
  });

  it("fails closed when quality regresses or token reduction is immaterial", () => {
    const verdict = compareDocumentBenchmarks(snapshot(1000), snapshot(900, { quality: quality("fail") }));
    expect(verdict.status).toBe("failed");
    expect(verdict.reasons).toContain("specificity is fail, not pass");
    expect(verdict.reasons.some((reason) => reason.includes("below 20.00%"))).toBe(true);
  });

  it("creates stable content fingerprints", () => {
    expect(benchmarkFingerprint("same")).toBe(benchmarkFingerprint(Buffer.from("same")));
    expect(benchmarkFingerprint("same")).not.toBe(benchmarkFingerprint("different"));
  });

  it("rejects incomplete or untyped snapshot evidence", () => {
    expect(() => parseDocumentBenchmarkSnapshot({ fixtureSha256: "fixture" })).toThrow();
    expect(() => parseDocumentBenchmarkSnapshot({ ...snapshot(100), metrics: { ...snapshot(100).metrics, outputTokens: -1 } })).toThrow();
    expect(() => parseDocumentBenchmarkSnapshot({ ...snapshot(100), quality: [...quality(), quality()[0]!] })).toThrow(/exactly once/);
    expect(parseDocumentBenchmarkSnapshot(snapshot(100))).toEqual(snapshot(100));
  });
});
