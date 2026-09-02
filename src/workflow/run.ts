import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessConfig } from "../config.js";
import { connectOpencode } from "../opencode/client.js";
import { OpencodeSessions } from "../opencode/sessions.js";
import { createModelManager } from "../models/manager.js";
import { loadModelRegistry } from "../models/registry.js";
import { changedFiles, createWorktree, inspectRepository, preflight } from "../git/workspace.js";
import { createCheckpoint } from "../git/checkpoints.js";
import { captureBaseline } from "../tools/baseline.js";
import { runGates } from "../tools/gates.js";
import { StateStore } from "../state/store.js";
import type { RunState } from "../state/types.js";
import { OpenCodeRoleRunner } from "./role-runner.js";
import { WorkflowEngine, type WorkflowDependencies, type WorkflowInput } from "./engine.js";
import { writeArtifact } from "./artifacts.js";
import { assertChangedPathsAllowed } from "../tools/scope.js";

export interface StartRunOptions { repository: string; requirementsFile: string; config: HarnessConfig; definitionOfDone?: string; }
function runIdentifier(): string { return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`; }
function slug(value: string): string { return path.basename(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "task"; }

export async function startRun(options: StartRunOptions): Promise<RunState> {
  const repository = path.resolve(options.repository); await inspectRepository(repository); const runId = runIdentifier();
  const harnessRoot = path.join(repository, ".agent-harness"); const worktree = path.join(harnessRoot, "worktrees", runId); const branch = `${options.config.git.branchPrefix}${runId}-${slug(options.requirementsFile)}`;
  await preflight({ repository, workspaceRoot: harnessRoot, worktreePath: worktree, targetBranch: branch, allowDirtyWorktree: !options.config.git.requireCleanWorktree, protectedBranches: ["main", "master"] });
  await mkdir(harnessRoot, { recursive: true }); await createWorktree(repository, harnessRoot, worktree, branch);
  const artifacts = path.join(harnessRoot, "runs", runId); const store = new StateStore(artifacts); const now = new Date().toISOString();
  const initial: RunState = { schemaVersion: 1, runId, repositoryPath: worktree, artifactPath: artifacts, stage: "CREATED", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 } };
  await store.initialize(initial); const release = await store.acquireLock();
  try {
    await writeArtifact(artifacts, "config.snapshot.json", options.config);
    const requirements = await readFile(path.resolve(options.requirementsFile), "utf8"); await writeArtifact(artifacts, "requirements.json", { source: path.resolve(options.requirementsFile), content: requirements });
    const client = connectOpencode({ baseUrl: options.config.runtime.opencodeUrl, directory: worktree }); const sessions = new OpencodeSessions(client, worktree);
    const manager = createModelManager(options.config, { registry: await loadModelRegistry(options.config.modelRegistry), router: {}, process: {} });
    const roleRunner = new OpenCodeRoleRunner(sessions, manager, options.config, async (role, sessionID) => { await writeArtifact(artifacts, `sessions/${Date.now()}-${role}-${sessionID}.json`, { role, sessionID, createdAt: new Date().toISOString() }); });
    const dependencies: WorkflowDependencies = {
      async preflight() { const current = await inspectRepository(worktree); if (current.dirty) throw new Error("isolated worktree became dirty before baseline"); },
      async baseline() { const evidence = await captureBaseline(options.config, worktree, artifacts); return { commit: evidence.commit, treeHash: evidence.treeHash, gates: evidence.gates, artifactPath: path.join(artifacts, "baseline.json") }; },
      async gates(iteration) { return runGates(options.config, worktree, path.join(artifacts, "gates", `iteration-${iteration}`)); },
      async checkpoint(kind, iteration) { const files = await changedFiles(worktree); assertChangedPathsAllowed(files, options.config.scope.allowedPaths, [...options.config.scope.deniedPaths, ...options.config.security.deniedPathPatterns]); return createCheckpoint(worktree, kind, iteration); }
    };
    const input: WorkflowInput = { requirements, definitionOfDone: options.definitionOfDone ?? "All required gates pass and every acceptance criterion is proven." };
    return await new WorkflowEngine(options.config, store, roleRunner, dependencies).run(input);
  } finally { await release(); }
}

export async function readRun(repository: string, runId: string): Promise<RunState> { return new StateStore(path.join(path.resolve(repository), ".agent-harness", "runs", runId)).read(); }
