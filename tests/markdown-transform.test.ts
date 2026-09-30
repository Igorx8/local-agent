import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyWorkspaceMarkdownTransforms } from "../src/tools/markdown-transform.js";

const contract = { identifierPrefix: "TASK" as const, requiredSections: [{ key: "phase-0", label: "Fase 0" }, { key: "phase-1", label: "Fase 1" }] };
const document = "### Fase 0\n**Tarefas principais:**\n- TASK-001: base\n\n### Fase 1\n**Tarefas principais:**\n- criar API\n\n**Critério de conclusão:** intacto\n";

describe("workspace Markdown transformations", () => {
  it("writes an eligible transformation atomically and records bounded evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "markdown-transform-")); await mkdir(path.join(root, "tasks"));
    const target = path.join(root, "tasks", "README.md"); await writeFile(target, document);
    const evidence = await applyWorkspaceMarkdownTransforms(root, ["tasks/README.md"], contract);
    expect(evidence).toMatchObject([{ file: "tasks/README.md", applied: true, changedLines: [7], reason: expect.any(String) }]);
    expect(evidence[0]?.originalSha256).not.toBe(evidence[0]?.resultSha256);
    expect(await readFile(target, "utf8")).toContain("- TASK-002: criar API");
  });

  it("does not write ambiguous, absent, or symlink targets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "markdown-transform-")); await mkdir(path.join(root, "tasks"));
    const ambiguous = path.join(root, "tasks", "README.md"); const original = document.replace("- criar API", "- criar API\ntexto ambíguo"); await writeFile(ambiguous, original);
    const outside = path.join(await mkdtemp(path.join(os.tmpdir(), "markdown-outside-")), "outside.md"); await writeFile(outside, document);
    await symlink(outside, path.join(root, "tasks", "linked.md"));
    const evidence = await applyWorkspaceMarkdownTransforms(root, ["tasks/README.md", "tasks/missing.md", "tasks/linked.md"], contract);
    expect(evidence.map((item) => item.applied)).toEqual([false, false, false]);
    expect(await readFile(ambiguous, "utf8")).toBe(original);
    expect(await readFile(outside, "utf8")).toBe(document);
  });
});
