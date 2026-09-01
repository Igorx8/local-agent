import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createWorktree, inspectRepository, preflight } from "../src/git/workspace.js";
import { createCheckpoint } from "../src/git/checkpoints.js";

const run = promisify(execFile);
async function repository(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "harness-git-"));
  await run("git", ["init", "-b", "main"], { cwd: directory });
  await run("git", ["config", "user.email", "test@example.invalid"], { cwd: directory });
  await run("git", ["config", "user.name", "Harness Test"], { cwd: directory });
  await writeFile(path.join(directory, "README.md"), "fixture\n");
  await run("git", ["add", "README.md"], { cwd: directory }); await run("git", ["commit", "-m", "fixture"], { cwd: directory });
  return directory;
}

describe("Git workspace", () => {
  it("rejects dirty repositories by default", async () => {
    const repo = await repository(); await writeFile(path.join(repo, "dirty.txt"), "x");
    await expect(preflight({ repository: repo, workspaceRoot: path.dirname(repo), worktreePath: `${repo}-worktree`, targetBranch: "agent/run-task", allowDirtyWorktree: false, protectedBranches: ["main"] })).rejects.toThrow(/dirty/);
  });
  it("creates an isolated agent branch worktree", async () => {
    const repo = await repository(); const worktree = `${repo}-worktree`;
    await preflight({ repository: repo, workspaceRoot: path.dirname(repo), worktreePath: worktree, targetBranch: "agent/run-task", allowDirtyWorktree: false, protectedBranches: ["main"] });
    await createWorktree(repo, path.dirname(repo), worktree, "agent/run-task");
    expect((await inspectRepository(worktree)).branch).toBe("agent/run-task");
    await writeFile(path.join(worktree, "implementation.txt"), "change\n");
    const checkpoint = await createCheckpoint(worktree, "implementation", 0);
    expect(checkpoint.changedFiles).toEqual(["implementation.txt"]);
    expect(checkpoint.commit).toHaveLength(40);
  });
});
