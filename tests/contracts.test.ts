import { describe, expect, it } from "vitest";
import { triageSchema } from "../src/workflow/contracts.js";

const base = { findingId: "FIND-001", evidence: "observed", rootCause: "documentation gap" };

describe("triage contract", () => {
  it("rejects a confirmed non-testable finding without a regression-test exemption", () => {
    expect(() => triageSchema.parse({ findings: [{ ...base, classification: "confirmed", testable: false, regressionTestExemption: "" }] })).toThrow(/regression-test exemption/);
  });

  it("accepts a documented exemption for a confirmed non-testable finding", () => {
    expect(triageSchema.parse({ findings: [{ ...base, classification: "confirmed", testable: false, regressionTestExemption: "Documentation-only change; verified by review." }] })).toBeTruthy();
  });
});
