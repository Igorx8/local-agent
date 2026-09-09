import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { detectProjectProfile, initializeProjectConfig } from "../src/project-profile.js";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "harness-profile-"));
  for (const [name, contents] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), contents); }
  return root;
}

describe("language-agnostic project profiles", () => {
  it("derives only declared Node scripts and honors the lockfile package manager", async () => {
    const root = await fixture({ "package.json": JSON.stringify({ scripts: { test: "vitest", lint: "eslint .", check: "tsc" } }), "pnpm-lock.yaml": "" });
    const result = await detectProjectProfile(root);
    expect(result.profile).toBe("node");
    expect(result.quality.test).toMatchObject({ command: "pnpm", args: ["run", "test"] });
    expect(result.quality.typecheck).toMatchObject({ command: "pnpm", args: ["run", "check"] });
    expect(result.quality.build).toBeNull();
  });

  it.each([
    ["python", { "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n" }, "python3", ["-m", "pytest"]],
    ["rust", { "Cargo.toml": "[package]\nname='demo'\n" }, "cargo", ["test"]],
    ["go", { "go.mod": "module example.test/demo\n" }, "go", ["test", "./..."]]
  ] as const)("detects %s without introducing Node commands", async (profile, files, executable, args) => {
    const result = await detectProjectProfile(await fixture(files));
    expect(result.profile).toBe(profile);
    expect(result.quality.test).toMatchObject({ command: executable, args });
    expect(JSON.stringify(result)).not.toContain("npm");
  });

  it("uses a safe no-gates profile for documentation-only repositories", async () => {
    const result = await detectProjectProfile(await fixture({ "README.md": "docs" }));
    expect(result.profile).toBe("none");
    expect(Object.values(result.quality).every((gate) => gate === null)).toBe(true);
    expect(result.regression).toBeUndefined();
  });

  it("does not assume pytest from pyproject.toml alone", async () => {
    const result = await detectProjectProfile(await fixture({ "pyproject.toml": "[project]\nname='demo'\n" }));
    expect(result.quality.test).toBeNull();
    expect(result.regression).toBeUndefined();
  });

  it("fails closed for ambiguous multi-ecosystem roots", async () => {
    const root = await fixture({ "package.json": "{}", "go.mod": "module example.test/demo\n" });
    await expect(detectProjectProfile(root)).rejects.toThrow(/ambiguous project profile.*package\.json, go\.mod/);
    expect((await detectProjectProfile(root, "go")).profile).toBe("go");
  });

  it("writes portable model paths and the detected gates into initialized config", async () => {
    const root = await fixture({ "README.md": "docs" }); const packaged = await fixture({
      "harness.example.yaml": "version: 1\nmodelRegistry: ./config/models.local.yaml\nrouterPreset: ./config/models.local.ini\nverification:\n  commands:\n    regression: { command: harness, args: [regression-proof, npm, test] }\nquality:\n  test: { command: npm, args: [test] }\n"
    });
    const source = path.join(packaged, "harness.example.yaml");
    const initialized = await initializeProjectConfig(root, source);
    const config = YAML.parse(await readFile(initialized.destination, "utf8"));
    expect(config.modelRegistry).toBe(path.join(packaged, "models.local.yaml"));
    expect(config.quality.test).toBeNull();
    expect(config.verification.commands.regression).toBeUndefined();
  });
});
