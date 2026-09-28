import { executeConfigured } from "../tools/executor.js";
import type { RepositoryIdentity } from "./workspace.js";
import { currentIdentity } from "./workspace.js";
import { assertChangedPathsAllowed } from "../tools/scope.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface Checkpoint { stage: string; iteration: number; commit: string; treeHash: string; createdAt: string; changedFiles: string[]; }

async function checkedGit(cwd: string, args: string[]): Promise<string> {
  const result = await executeConfigured({ command: "git", args, required: true, timeoutMs: 30_000 }, { cwd });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

export async function createCheckpoint(repository: string, stage: string, iteration: number, pathPolicy?: { allowed: string[]; denied: string[] }): Promise<Checkpoint> {
  if (pathPolicy) assertChangedPathsAllowed(await import("./workspace.js").then(({ changedFiles }) => changedFiles(repository)), pathPolicy.allowed, pathPolicy.denied);
  await checkedGit(repository, ["add", "--all"]);
  const staged = await checkedGit(repository, ["diff", "--cached", "--name-only"]);
  if (!staged) throw new Error("checkpoint has no changes");
  await checkedGit(repository, ["commit", "-m", `harness: ${stage} iteration ${iteration}`]);
  const identity: RepositoryIdentity = await currentIdentity(repository);
  return { stage, iteration, commit: identity.commit, treeHash: identity.treeHash, createdAt: new Date().toISOString(), changedFiles: staged.split("\n") };
}

export async function createDetachedCheckpoint(repository: string, parent: string, stage: string, iteration: number, allowEmpty = false): Promise<Checkpoint> {
  const temporary = await mkdtemp(path.join(tmpdir(), "harness-index-")); const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, "index") };
  const run = async (args: string[]) => { const result = await executeConfigured({ command: "git", args, required: true, timeoutMs: 30_000 }, { cwd: repository, env }); if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout); return result.stdout.trim(); };
  try {
    await run(["read-tree", parent]); await run(["add", "--all"]); const treeHash = await run(["write-tree"]); const parentTree = await checkedGit(repository, ["rev-parse", `${parent}^{tree}`]); if (!allowEmpty && treeHash === parentTree) throw new Error("checkpoint has no changes");
    const commit = await run(["-c", "user.name=Local Agent", "-c", "user.email=local-agent@localhost", "commit-tree", treeHash, "-p", parent, "-m", `harness: ${stage} iteration ${iteration}`]); const changed = await checkedGit(repository, ["diff", "--name-only", parent, commit]); return { stage, iteration, commit, treeHash, createdAt: new Date().toISOString(), changedFiles: changed ? changed.split("\n") : [] };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
