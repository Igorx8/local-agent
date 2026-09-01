import { describe, expect, it } from "vitest";
import { harnessConfigSchema } from "../src/config.js";
import { runDoctor } from "../src/doctor.js";

describe("doctor", () => {
  it("reports prerequisites without throwing when optional runtimes are absent", async () => {
    const roles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"];
    const config = harnessConfigSchema.parse({ version: 1, runtime: {}, models: Object.fromEntries(roles.map((role) => [role, role])), workflow: { autoMerge: false }, context: {} });
    const report = await runDoctor(config);
    expect(report.checks.find((check) => check.name === "node")?.status).toBe("pass");
    expect(report.checks.some((check) => check.name === "token usage visibility")).toBe(true);
    expect(typeof report.ok).toBe("boolean");
  });
});
