import { describe, expect, it } from "vitest";
import { z } from "zod";
import { structuredPrompt } from "../src/workflow/role-runner.js";
import { triageSchema } from "../src/workflow/contracts.js";

describe("structured role prompt", () => {
  it("includes the exact response property names and required fields", () => {
    const prompt = structuredPrompt("Return the criteria.", z.object({ criteria: z.array(z.object({ id: z.string() })) }));
    expect(prompt).toContain('"criteria"'); expect(prompt).toContain('"required"'); expect(prompt).not.toContain('"acceptanceCriteria"');
  });

  it("tells the validator when a regression-test exemption is mandatory", () => {
    const prompt = structuredPrompt("Validate findings.", triageSchema);
    expect(prompt).toContain("Required and non-empty when classification is confirmed and testable is false");
  });
});
