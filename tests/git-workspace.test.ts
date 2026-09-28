import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createWorktree, ensureHarnessIgnored, ensureRepositoryBaseline, inspectRepository, preflight, publishCheckpoint, synchronizePublishedCheckpoint } from "../src/git/workspace.js";
import { createCheckpoint, createDetachedCheckpoint } from "../src/git/checkpoints.js";

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
  it("captures dirty root files without moving HEAD or staging user work", async () => {
    const repo = await repository(); const head = (await inspectRepository(repo)).commit; await writeFile(path.join(repo, "direct.txt"), "agent output\n"); const checkpoint = await createDetachedCheckpoint(repo, head, "focused-fix", 0); expect(checkpoint.changedFiles).toEqual(["direct.txt"]); expect((await inspectRepository(repo)).commit).toBe(head); expect((await run("git", ["diff", "--cached", "--name-only"], { cwd: repo })).stdout.trim()).toBe(""); expect((await run("git", ["show", `${checkpoint.commit}:direct.txt`], { cwd: repo })).stdout).toBe("agent output\n");
  });
  it("publishes an approved checkpoint as uncommitted changes in the current working tree", async () => {
    const repo = await repository(); await ensureHarnessIgnored(repo); const baseline = (await inspectRepository(repo)).commit; const worktree = `${repo}-publish-worktree`;
    await createWorktree(repo, path.dirname(repo), worktree, "agent/publish-test"); await writeFile(path.join(worktree, "generated.md"), "approved\n"); const checkpoint = await createCheckpoint(worktree, "implementation", 0);
    const result = await publishCheckpoint(repo, baseline, checkpoint.commit, path.join(repo, ".agent-harness", "runs", "publish", "workspace.patch"));
    expect(result.files).toEqual(["generated.md"]); expect((await readFile(path.join(repo, "generated.md"), "utf8"))).toBe("approved\n"); expect((await inspectRepository(repo)).commit).toBe(baseline); expect((await inspectRepository(repo)).dirty).toBe(true);
  });
  it("synchronizes a repair after automatic implementation publication", async () => {
    const repo = await repository(); await ensureHarnessIgnored(repo); const baseline = (await inspectRepository(repo)).commit; const worktree = `${repo}-sync-worktree`; await createWorktree(repo, path.dirname(repo), worktree, "agent/sync-test"); await writeFile(path.join(worktree, "generated.md"), "initial\n"); const initial = await createCheckpoint(worktree, "implementation", 0); await publishCheckpoint(repo, baseline, initial.commit, path.join(repo, ".agent-harness", "initial.patch")); await writeFile(path.join(worktree, "generated.md"), "repaired\n"); const repaired = await createCheckpoint(worktree, "repair", 1);
    const result = await synchronizePublishedCheckpoint(repo, baseline, initial.commit, repaired.commit, initial.changedFiles, path.join(repo, ".agent-harness", "repair.patch")); expect(result.commit).toBe(repaired.commit); expect(await readFile(path.join(repo, "generated.md"), "utf8")).toBe("repaired\n"); expect((await inspectRepository(repo)).commit).toBe(baseline);
  });
  it("refuses publication when the current working tree changed during the run", async () => {
    const repo = await repository(); await ensureHarnessIgnored(repo); const baseline = (await inspectRepository(repo)).commit; const worktree = `${repo}-blocked-publish-worktree`;
    await createWorktree(repo, path.dirname(repo), worktree, "agent/blocked-publish-test"); await writeFile(path.join(worktree, "generated.md"), "approved\n"); const checkpoint = await createCheckpoint(worktree, "implementation", 0); await writeFile(path.join(repo, "user-work.txt"), "preserve\n");
    await expect(publishCheckpoint(repo, baseline, checkpoint.commit, path.join(repo, ".agent-harness", "runs", "blocked", "workspace.patch"))).rejects.toThrow(/working tree changed/); await expect(readFile(path.join(repo, "generated.md"), "utf8")).rejects.toThrow(); expect(await readFile(path.join(repo, "user-work.txt"), "utf8")).toBe("preserve\n");
  });
  it("validates focused checkpoint paths before creating a commit", async () => { const repo = await repository(); await writeFile(path.join(repo, "secret.txt"), "deny\n"); const before = (await inspectRepository(repo)).commit; await expect(createCheckpoint(repo, "focused-fix", 0, { allowed: [], denied: ["secret.txt"] })).rejects.toThrow(/denied/); expect((await inspectRepository(repo)).commit).toBe(before); expect((await run("git", ["status", "--porcelain"], { cwd: repo })).stdout).toContain("secret.txt"); });
  it("creates only an empty baseline commit for a truly empty unborn repository", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "harness-unborn-")); await run("git", ["init", "-b", "main"], { cwd: repo }); await ensureHarnessIgnored(repo); const result = await ensureRepositoryBaseline(repo); expect(result.created).toBe(true); expect(result.commit).toHaveLength(40); expect((await inspectRepository(repo))).toMatchObject({ branch: "main", dirty: false }); expect((await run("git", ["show", "--pretty=format:", "--name-only", "HEAD"], { cwd: repo })).stdout.trim()).toBe(""); expect((await ensureRepositoryBaseline(repo)).created).toBe(false);
  });
  it("refuses to capture uncommitted files into an unborn baseline", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "harness-unborn-dirty-")); await run("git", ["init", "-b", "main"], { cwd: repo }); await writeFile(path.join(repo, "user-file.txt"), "preserve me\n"); await expect(ensureRepositoryBaseline(repo)).rejects.toThrow(/create the initial commit explicitly/); await expect(run("git", ["rev-parse", "--verify", "HEAD"], { cwd: repo })).rejects.toThrow(); expect((await run("git", ["status", "--porcelain"], { cwd: repo })).stdout).toContain("user-file.txt");
  });
  it("creates the first commit with existing files only after explicit consent", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "harness-unborn-consent-")); await run("git", ["init", "-b", "main"], { cwd: repo }); await writeFile(path.join(repo, "README.md"), "new project\n"); const result = await ensureRepositoryBaseline(repo, true); expect(result.created).toBe(true); expect((await run("git", ["show", "--pretty=format:", "--name-only", "HEAD"], { cwd: repo })).stdout.trim()).toBe("README.md"); expect((await inspectRepository(repo)).dirty).toBe(false);
  });
});
