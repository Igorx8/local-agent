import { describe, expect, it } from "vitest";
import { focusedRepairPrompt, focusedReviewPrompt } from "../src/workflow/fix.js";

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
});
