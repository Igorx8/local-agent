import { describe, expect, it } from "vitest";
import { harnessConfigSchema } from "../src/config.js";

const models = Object.fromEntries(["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"].map((role) => [role, `llama.cpp/${role}`]));
const valid = { version: 1, runtime: { opencodeUrl: "http://127.0.0.1:4096", llamaUrl: "http://localhost:8080", localOnly: true }, models, workflow: { autoMerge: false }, context: {} };

describe("harnessConfigSchema", () => {
  it("applies safe defaults", () => {
    const parsed = harnessConfigSchema.parse(valid);
    expect(parsed.workflow.maxReviewIterations).toBe(3);
    expect(parsed.workflow.inferenceTimeoutMs).toBe(900000);
    expect(parsed.workflow.autoMerge).toBe(false);
    expect(parsed.runtime).toMatchObject({ modelStartupTimeoutMs: 600000, modelShutdownTimeoutMs: 60000, modelUnloadVramThresholdMiB: 2048 });
    expect(parsed.context.handoffThreshold).toBe(0.85);
    expect(parsed.verification.flakyRepetitions).toBe(3);
    expect(parsed.verification.mutationTesting).toBe("changed-files");
    expect(parsed.conversation).toEqual({ maxRecentTurns: 8, maxMemoryBytes: 32768 });
  });

  it("rejects non-loopback services", () => {
    expect(() => harnessConfigSchema.parse({ ...valid, runtime: { ...valid.runtime, opencodeUrl: "http://192.168.1.2:4096" } })).toThrow(/localOnly/);
  });

  it("rejects automatic merge and unordered context thresholds", () => {
    expect(() => harnessConfigSchema.parse({ ...valid, workflow: { autoMerge: true } })).toThrow();
    expect(() => harnessConfigSchema.parse({ ...valid, context: { warningThreshold: 0.9, prepareHandoffThreshold: 0.78 } })).toThrow(/strictly increasing/);
  });
  it("rejects invalid secret-redaction expressions", () => {
    expect(() => harnessConfigSchema.parse({ ...valid, security: { redactPatterns: ["["] } })).toThrow(/invalid redaction regex/);
  });
});
