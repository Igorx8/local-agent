import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completeSlash, parseSlashCommand, shellHelp, slashCommands } from "../src/interactive/commands.js";
import { readShellHistory, shellHistoryFile, writeShellHistory } from "../src/interactive/history.js";

describe("interactive local-agent shell", () => {
  it("recognizes every documented slash command and rejects unknown commands locally", () => {
    for (const name of slashCommands) expect(parseSlashCommand(`/${name}`)).toMatchObject({ name, args: [] }); expect(() => parseSlashCommand("/deploy now")).toThrow(/unknown slash command/); expect(shellHelp).toContain("/handoff");
  });
  it("parses an optional quoted run ID as argv without shell interpretation", () => { expect(parseSlashCommand('/report "run-id"')).toEqual({ name: "report", args: ["run-id"] }); expect(parseSlashCommand("normal prompt")).toBeUndefined(); expect(() => parseSlashCommand("/exit now")).toThrow(/does not accept/); expect(() => parseSlashCommand('/report "unterminated')).toThrow(/unterminated/); });
  it("completes slash commands", () => { expect(completeSlash("/ha")[0]).toEqual(["/handoff"]); expect(completeSlash("plain")[0]).toEqual([]); });
  it("persists bounded private history", async () => { const root = await mkdtemp(path.join(tmpdir(), "agent-history-")); await writeShellHistory(root, ["one", "two\nlines", "three"], 2); expect(await readShellHistory(root)).toEqual(["two lines", "three"]); expect((await readFile(shellHistoryFile(root), "utf8"))).toBe("two lines\nthree\n"); });
});
