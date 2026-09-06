import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runGitRegressionAdapter } from "../src/verification/git-regression-adapter.js";

const execute = promisify(execFile);
async function git(repository: string, ...args: string[]): Promise<string> { return (await execute("git", args, { cwd: repository, env: { ...process.env, GIT_AUTHOR_NAME: "Harness Test", GIT_AUTHOR_EMAIL: "test@local", GIT_COMMITTER_NAME: "Harness Test", GIT_COMMITTER_EMAIL: "test@local" } })).stdout.trim(); }

describe("Git regression proof adapter", () => {
  it("overlays repaired tests and proves fail-before/pass-after", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "git-regression-fixture-")); await git(repository, "init"); await mkdir(path.join(repository, "src")); await writeFile(path.join(repository, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test" } })); await writeFile(path.join(repository, "src/value.js"), "export const value = () => 1;\n"); await git(repository, "add", "."); await git(repository, "commit", "-m", "defect"); const defective = await git(repository, "rev-parse", "HEAD");
    await mkdir(path.join(repository, "test")); await writeFile(path.join(repository, "src/value.js"), "export const value = () => 2;\n"); await writeFile(path.join(repository, "test/value.test.js"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value', () => assert.equal(value(), 2));\n"); await git(repository, "add", "."); await git(repository, "commit", "-m", "repair"); const repaired = await git(repository, "rev-parse", "HEAD");
    const result = await runGitRegressionAdapter(repository, "npm", ["test"], JSON.stringify({ findings: [{ id: "F-1" }], triage: {}, defectiveCheckpoint: defective, repairedCheckpoint: repaired })) as { proofs: Array<Record<string, unknown>> };
    expect(result.proofs).toHaveLength(1); expect(result.proofs[0]).toMatchObject({ findingId: "F-1", defectiveCheckpoint: defective, repairedCheckpoint: repaired, failBefore: { expectedReasonMatched: true }, passAfter: { exitCode: 0 } });
  });

  it("refuses a repair whose new test also passes before the fix", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "git-regression-noop-")); await git(repository, "init"); await writeFile(path.join(repository, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test" } })); await writeFile(path.join(repository, "value.js"), "export const value = 2;\n"); await git(repository, "add", "."); await git(repository, "commit", "-m", "before"); const defective = await git(repository, "rev-parse", "HEAD"); await mkdir(path.join(repository, "test")); await writeFile(path.join(repository, "test/value.test.js"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../value.js'; test('value', () => assert.equal(value, 2));\n"); await git(repository, "add", "."); await git(repository, "commit", "-m", "test only"); const repaired = await git(repository, "rev-parse", "HEAD");
    await expect(runGitRegressionAdapter(repository, "npm", ["test"], JSON.stringify({ findings: [{ id: "F-1" }], defectiveCheckpoint: defective, repairedCheckpoint: repaired }))).rejects.toThrow(/did not fail/);
  });

  it("proves a test-only repair without overlaying away the defective test", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "git-regression-test-repair-")); await git(repository, "init"); await mkdir(path.join(repository, "test")); await writeFile(path.join(repository, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test" } })); await writeFile(path.join(repository, "test/value.test.js"), "import test from 'node:test'; import assert from 'node:assert/strict'; test('broken assertion', () => assert.equal(1));\n"); await git(repository, "add", "."); await git(repository, "commit", "-m", "defective test"); const defective = await git(repository, "rev-parse", "HEAD");
    await writeFile(path.join(repository, "test/value.test.js"), "import test from 'node:test'; import assert from 'node:assert/strict'; test('fixed assertion', () => assert.equal(1, 1));\n"); await git(repository, "add", "."); await git(repository, "commit", "-m", "repair test"); const repaired = await git(repository, "rev-parse", "HEAD");
    const result = await runGitRegressionAdapter(repository, "npm", ["test"], JSON.stringify({ findings: [{ id: "F-1" }], defectiveCheckpoint: defective, repairedCheckpoint: repaired })) as { proofs: Array<Record<string, unknown>> };
    expect(result.proofs[0]).toMatchObject({ findingId: "F-1", failBefore: { exitCode: 1 }, passAfter: { exitCode: 0 } });
  });
});
