import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completeSlash, parseSlashCommand, routePlainInput, shellHelp, slashCommands } from "../src/interactive/commands.js";
import { readShellHistory, shellHistoryFile, writeShellHistory } from "../src/interactive/history.js";

describe("interactive local-agent shell", () => {
  it("recognizes every documented slash command and rejects unknown commands locally", () => {
    for (const name of slashCommands) expect(parseSlashCommand(`/${name}${["ask", "fix", "run"].includes(name) ? " example" : ""}`)).toMatchObject({ name }); expect(() => parseSlashCommand("/deploy now")).toThrow(/unknown slash command/); expect(shellHelp).not.toMatch(/^\s*\/doc\s/m); expect(shellHelp).toContain("/apply");
  });
  it("parses ask/fix/run prompts without shell interpretation", () => { expect(parseSlashCommand('/report "run-id"')).toEqual({ name: "report", args: ["run-id"] }); expect(parseSlashCommand('/apply "fix-1"')).toEqual({ name: "apply", args: ["fix-1"] }); expect(parseSlashCommand('/ask --web leia https://example.com')).toEqual({ name: "ask", args: ["leia https://example.com"], web: true }); expect(parseSlashCommand('/fix corrija @"a b.md"')).toEqual({ name: "fix", args: ['corrija @"a b.md"'] }); expect(parseSlashCommand('/run implemente @"a b.md"')).toEqual({ name: "run", args: ['implemente @"a b.md"'] }); expect(parseSlashCommand("normal prompt")).toBeUndefined(); expect(() => parseSlashCommand("/doc resuma plano.md")).toThrow(/unknown slash command/); expect(() => parseSlashCommand("/exit now")).toThrow(/does not accept/); });
  it("routes questions read-only, clear Markdown actions to doc, and ambiguity to run", () => { expect(routePlainInput("vc consegue acessar links ?")).toBe("ask"); expect(routePlainInput("como funciona @README.md")).toBe("ask"); expect(routePlainInput("leia @plano.md e crie tasks/README.md")).toBe("doc"); expect(routePlainInput("gere um índice em Markdown")).toBe("doc"); expect(routePlainInput("implemente a API")).toBe("run"); expect(routePlainInput("melhore o projeto")).toBe("run"); });
  it("completes slash commands", () => { expect(completeSlash("/ha")[0]).toEqual(["/handoff"]); expect(completeSlash("plain")[0]).toEqual([]); });
  it("persists bounded private history", async () => { const root = await mkdtemp(path.join(tmpdir(), "agent-history-")); await writeShellHistory(root, ["one", "two\nlines", "three"], 2); expect(await readShellHistory(root)).toEqual(["two lines", "three"]); expect((await readFile(shellHistoryFile(root), "utf8"))).toBe("two lines\nthree\n"); });
});
