import { executeConfigured } from "../tools/executor.js";
import type { RepositoryIdentity } from "./workspace.js";
import { currentIdentity } from "./workspace.js";

export interface Checkpoint { stage: string; iteration: number; commit: string; treeHash: string; createdAt: string; changedFiles: string[]; }

async function checkedGit(cwd: string, args: string[]): Promise<string> {
  const result = await executeConfigured({ command: "git", args, required: true, timeoutMs: 30_000 }, { cwd });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

export async function createCheckpoint(repository: string, stage: string, iteration: number): Promise<Checkpoint> {
  await checkedGit(repository, ["add", "--all"]);
  const staged = await checkedGit(repository, ["diff", "--cached", "--name-only"]);
  if (!staged) throw new Error("checkpoint has no changes");
  await checkedGit(repository, ["commit", "-m", `harness: ${stage} iteration ${iteration}`]);
  const identity: RepositoryIdentity = await currentIdentity(repository);
  return { stage, iteration, commit: identity.commit, treeHash: identity.treeHash, createdAt: new Date().toISOString(), changedFiles: staged.split("\n") };
}
