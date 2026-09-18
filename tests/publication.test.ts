import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createCheckpoint } from "../src/git/checkpoints.js";
import { createWorktree, ensureHarnessIgnored, inspectRepository } from "../src/git/workspace.js";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";
import { applyPreservedCheckpoint, findMatchingPublishedCheckpoint } from "../src/workflow/publication.js";

const run = promisify(execFile);

describe("preserved checkpoint publication", () => {
  it("explicitly applies a failed run checkpoint without moving HEAD", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "harness-publication-")); await run("git", ["init", "-b", "main"], { cwd: repository }); await run("git", ["config", "user.name", "Harness"], { cwd: repository }); await run("git", ["config", "user.email", "harness@example.invalid"], { cwd: repository }); await writeFile(path.join(repository, "README.md"), "base\n"); await run("git", ["add", "README.md"], { cwd: repository }); await run("git", ["commit", "-m", "base"], { cwd: repository }); await ensureHarnessIgnored(repository);
    const baseline = (await inspectRepository(repository)).commit; const runId = "fix-preserved"; const harnessRoot = path.join(repository, ".agent-harness"); const worktree = path.join(harnessRoot, "worktrees", runId); await mkdir(harnessRoot, { recursive: true }); await createWorktree(repository, harnessRoot, worktree, `agent/${runId}`); await writeFile(path.join(worktree, "generated.md"), "recovered\n"); const checkpoint = await createCheckpoint(worktree, "focused-fix", 0); const artifacts = path.join(harnessRoot, "runs", runId); const now = new Date().toISOString(); const state: RunState = { schemaVersion: 1, runId, repositoryPath: worktree, artifactPath: artifacts, stage: "FAILED", status: "failed", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, baseline: { commit: baseline, treeHash: (await inspectRepository(repository)).treeHash }, handoffs: [], checkpoints: [{ kind: "implementation", iteration: 0, commit: checkpoint.commit, treeHash: checkpoint.treeHash, changedFiles: checkpoint.changedFiles, createdAt: checkpoint.createdAt }], mutatingActionsBlocked: true, manualHandoffRequested: false }; await new StateStore(artifacts).initialize(state);
    const result = await applyPreservedCheckpoint(repository, runId); expect(result).toMatchObject({ runId, runStatus: "failed", checkpoint: checkpoint.commit, files: ["generated.md"], automaticApprovalBypassed: true }); expect(await readFile(path.join(repository, "generated.md"), "utf8")).toBe("recovered\n"); expect((await inspectRepository(repository)).commit).toBe(baseline); await expect(findMatchingPublishedCheckpoint(repository)).resolves.toEqual({ commit: checkpoint.commit, files: ["generated.md"], runId });
  });
});
