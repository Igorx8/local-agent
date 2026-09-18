import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completeSlash, parseSlashCommand, routePlainInput, shellHelp, slashCommands } from "../src/interactive/commands.js";
import { readShellHistory, shellHistoryFile, writeShellHistory } from "../src/interactive/history.js";

describe("interactive local-agent shell", () => {
  it("recognizes every documented slash command and rejects unknown commands locally", () => {
    for (const name of slashCommands) expect(parseSlashCommand(`/${name}${name === "ask" || name === "fix" || name === "run" ? " example" : ""}`)).toMatchObject({ name }); expect(() => parseSlashCommand("/deploy now")).toThrow(/unknown slash command/); expect(shellHelp).toContain("/fix"); expect(shellHelp).toContain("/apply");
  });
  it("parses ask/fix/run prompts without shell interpretation", () => { expect(parseSlashCommand('/report "run-id"')).toEqual({ name: "report", args: ["run-id"] }); expect(parseSlashCommand('/apply "fix-1"')).toEqual({ name: "apply", args: ["fix-1"] }); expect(parseSlashCommand('/ask --web leia https://example.com')).toEqual({ name: "ask", args: ["leia https://example.com"], web: true }); expect(parseSlashCommand('/fix corrija @"a b.md"')).toEqual({ name: "fix", args: ['corrija @"a b.md"'] }); expect(parseSlashCommand('/run implemente @"a b.md"')).toEqual({ name: "run", args: ['implemente @"a b.md"'] }); expect(parseSlashCommand("normal prompt")).toBeUndefined(); expect(() => parseSlashCommand("/exit now")).toThrow(/does not accept/); });
  it("routes questions read-only and ambiguous actions conservatively to run", () => { expect(routePlainInput("vc consegue acessar links ?")).toBe("ask"); expect(routePlainInput("como funciona isso")).toBe("ask"); expect(routePlainInput("implemente a API")).toBe("run"); });
  it("completes slash commands", () => { expect(completeSlash("/ha")[0]).toEqual(["/handoff"]); expect(completeSlash("plain")[0]).toEqual([]); });
  it("persists bounded private history", async () => { const root = await mkdtemp(path.join(tmpdir(), "agent-history-")); await writeShellHistory(root, ["one", "two\nlines", "three"], 2); expect(await readShellHistory(root)).toEqual(["two lines", "three"]); expect((await readFile(shellHistoryFile(root), "utf8"))).toBe("two lines\nthree\n"); });
});
