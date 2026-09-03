import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeOpenCodeLocal } from "../src/models/local-config.js";

describe("OpenCode local configuration", () => {
  it("installs every harness agent while preserving unrelated user agents", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-config-")); const required = path.join(directory, "required.json"); const destination = path.join(directory, "opencode.json");
    await writeFile(required, JSON.stringify({ provider: { local: {} }, agent: { planner: { mode: "all" }, implementer: { tools: { edit: true } } } })); await writeFile(destination, JSON.stringify({ agent: { personal: { description: "keep" } } }));
    await mergeOpenCodeLocal(required, destination); const result = JSON.parse(await readFile(destination, "utf8"));
    expect(result.agent.personal.description).toBe("keep"); expect(result.agent.planner.mode).toBe("all"); expect(result.agent.implementer.tools.edit).toBe(true);
  });

  it("preserves explicit agent step and doom-loop limits", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-limits-")); const required = path.join(directory, "required.json"); const destination = path.join(directory, "opencode.json");
    await writeFile(required, JSON.stringify({ agent: { auditor: { maxSteps: 24, tools: { todowrite: false, webfetch: false, skill: false }, permission: { doom_loop: "deny" } } } }));
    await mergeOpenCodeLocal(required, destination); const result = JSON.parse(await readFile(destination, "utf8"));
    expect(result.agent.auditor.maxSteps).toBe(24); expect(result.agent.auditor.permission.doom_loop).toBe("deny"); expect(result.agent.auditor.tools).toMatchObject({ todowrite: false, webfetch: false, skill: false });
  });
});
