import { describe, expect, it } from "vitest";
import { z } from "zod";
import { structuredPrompt } from "../src/workflow/role-runner.js";
import { OpenCodeRoleRunner } from "../src/workflow/role-runner.js";
import { triageSchema } from "../src/workflow/contracts.js";
import { harnessConfigSchema } from "../src/config.js";
import type { OpencodeSessions } from "../src/opencode/sessions.js";
import type { ModelLifecycle } from "../src/models/types.js";

describe("structured role prompt", () => {
  it("includes the exact response property names and required fields", () => {
    const prompt = structuredPrompt("Return the criteria.", z.object({ criteria: z.array(z.object({ id: z.string() })) }));
    expect(prompt).toContain('"criteria"'); expect(prompt).toContain('"required"'); expect(prompt).not.toContain('"acceptanceCriteria"');
  });

  it("tells the validator when a regression-test exemption is mandatory", () => {
    const prompt = structuredPrompt("Validate findings.", triageSchema);
    expect(prompt).toContain("Required and non-empty when classification is confirmed and testable is false");
  });

  it("aborts the accepted OpenCode session when cooperative shutdown interrupts a prompt", async () => {
    const roles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"];
    const config = harnessConfigSchema.parse({ version: 1, runtime: {}, models: Object.fromEntries(roles.map((role) => [role, `llama.cpp/${role === "planner" ? "qwen" : role}`])), workflow: { autoMerge: false }, context: {}, quality: {} });
    const controller = new AbortController(); const aborted: string[] = [];
    const sessions = { create: async () => ({ id: "ses-active" }), prompt: async () => { controller.abort(); throw new Error("aborted"); }, abort: async (id: string) => { aborted.push(id); return true; } } as unknown as OpencodeSessions;
    const model = { ensureModel: async () => ({ state: "healthy" }), beginRequest() {}, endRequest() {}, status: () => ({ state: "healthy" }), stop: async () => ({ state: "stopped" }) } as ModelLifecycle;
    const runner = new OpenCodeRoleRunner(sessions, model, config, undefined, {}, controller.signal);
    await expect(runner.invoke({ role: "planner", prompt: "plan", iteration: 0, artifactReferences: [], freshSession: true }, z.object({ ok: z.boolean() }))).rejects.toThrow("aborted");
    expect(aborted).toEqual(["ses-active"]);
  });
});
