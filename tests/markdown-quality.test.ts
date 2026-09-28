import { describe, expect, it } from "vitest";
import { assertMarkdownOutputPaths, assertMarkdownQuality, validateMarkdownQuality } from "../src/tools/markdown-quality.js";

describe("contextual Markdown quality", () => {
  it("rejects duplicate declarations while allowing references and ordinary repeated code words", () => {
    const report = validateMarkdownQuality("- TASK-120: first\nDepends on TASK-120.\n- TASK-120: second\n`status status`\n");
    expect(report.findings).toEqual([{ rule: "duplicate-structured-identifier", identifier: "TASK-120", lines: [1, 3] }]);
    expect(() => assertMarkdownQuality("tasks/README.md", report)).toThrow(/TASK-120.*lines 1, 3/);
  });

  it("accepts unique structured declarations and does not interpret source code", () => {
    const report = validateMarkdownQuality("- TASK-001: one\n- TASK-002: two\n```ts\nconst id = id;\n```\n");
    expect(report.passed).toBe(true);
  });

  it("restricts document mode to a non-empty Markdown change set", () => {
    expect(() => assertMarkdownOutputPaths([])).toThrow(/at least one/);
    expect(() => assertMarkdownOutputPaths(["tasks/README.md", "src/app.ts"])).toThrow(/src\/app.ts/);
    expect(() => assertMarkdownOutputPaths(["README.md", "docs/guide.MD"])).not.toThrow();
  });
});
