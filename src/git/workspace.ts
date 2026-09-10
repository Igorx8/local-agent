import { access, appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { executeConfigured } from "../tools/executor.js";
import { assertPathWithin } from "../tools/policy.js";

export interface PreflightOptions { repository: string; workspaceRoot: string; worktreePath: string; targetBranch: string; allowDirtyWorktree: boolean; protectedBranches: string[]; }
export interface RepositoryIdentity { repository: string; branch: string; commit: string; treeHash: string; dirty: boolean; }
export class UnbornRepositoryDirtyError extends Error { constructor(readonly files: string[]) { super("Git repository has no initial commit and contains uncommitted files; create the initial commit explicitly before running local-agent"); this.name = "UnbornRepositoryDirtyError"; } }

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await executeConfigured({ command: "git", args, required: true, timeoutMs: 30_000 }, { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export async function ensureRepositoryBaseline(repository: string, includeUncommitted = false): Promise<{ created: boolean; commit: string }> {
  const canonical = await realpath(repository); await git(canonical, ["rev-parse", "--is-inside-work-tree"]);
  const head = await executeConfigured({ command: "git", args: ["rev-parse", "--verify", "HEAD"], required: true, timeoutMs: 30_000 }, { cwd: canonical });
  if (head.exitCode === 0 && head.stdout.trim()) return { created: false, commit: head.stdout.trim() };
  const status = await git(canonical, ["status", "--porcelain"]); const files = status ? status.split("\n").map((line) => line.slice(3).split(" -> ").at(-1) ?? "").filter(Boolean) : [];
  if (files.length && !includeUncommitted) throw new UnbornRepositoryDirtyError(files); if (files.length) await git(canonical, ["add", "--all"]);
  await git(canonical, ["-c", "user.name=Local Agent", "-c", "user.email=local-agent@localhost", "commit", "--allow-empty", "-m", "chore: initialize local-agent baseline"]);
  return { created: true, commit: await git(canonical, ["rev-parse", "HEAD"]) };
}

export async function inspectRepository(repository: string): Promise<RepositoryIdentity> {
  await access(repository);
  const canonical = await realpath(repository);
  await git(canonical, ["rev-parse", "--is-inside-work-tree"]);
  const branch = await git(canonical, ["branch", "--show-current"]);
  const commit = await git(canonical, ["rev-parse", "HEAD"]);
  const treeHash = await git(canonical, ["rev-parse", "HEAD^{tree}"]);
  const dirty = (await git(canonical, ["status", "--porcelain"])).length > 0;
  return { repository: canonical, branch, commit, treeHash, dirty };
}
export async function ensureHarnessIgnored(repository: string): Promise<void> { const configured = await git(repository, ["rev-parse", "--git-path", "info/exclude"]); const file = path.isAbsolute(configured) ? configured : path.resolve(repository, configured); await mkdir(path.dirname(file), { recursive: true }); const current = await readFile(file, "utf8").catch(() => ""); if (!current.split(/\r?\n/).includes("/.agent-harness/")) await appendFile(file, `${current && !current.endsWith("\n") ? "\n" : ""}/.agent-harness/\n`); }

export async function preflight(options: PreflightOptions): Promise<RepositoryIdentity> {
  const identity = await inspectRepository(options.repository);
  assertPathWithin(options.workspaceRoot, options.worktreePath);
  if (identity.dirty && !options.allowDirtyWorktree) throw new Error("working tree is dirty");
  if (options.protectedBranches.includes(options.targetBranch)) throw new Error(`target branch is protected: ${options.targetBranch}`);
  return identity;
}

export async function createWorktree(repository: string, workspaceRoot: string, worktreePath: string, branch: string, startPoint?: string): Promise<void> {
  const target = assertPathWithin(workspaceRoot, worktreePath);
  if (!branch.startsWith("agent/")) throw new Error("worktree branch must use agent/ prefix");
  await git(repository, ["worktree", "add", "-b", branch, target, ...(startPoint ? [startPoint] : [])]);
}

export async function currentIdentity(repository: string): Promise<RepositoryIdentity> { return inspectRepository(repository); }
export async function changedFiles(repository: string): Promise<string[]> {
  const status = await git(repository, ["status", "--porcelain"]);
  return status ? status.split("\n").map((line) => line.slice(3).split(" -> ").at(-1) ?? "").filter(Boolean) : [];
}
