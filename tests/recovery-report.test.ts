import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { reconcileRun, persistRecoveryPlan } from "../src/recovery/reconcile.js";
import { generateRunReport } from "../src/report/run-report.js";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";

const execute = promisify(execFile);
async function fixture(stage: RunState["stage"]): Promise<{ root: string; artifacts: string; state: RunState }> {
  const base = await mkdtemp(path.join(tmpdir(), "harness-recovery-")); const root = path.join(base, "worktree"); await execute("git", ["init", "-b", "agent/recovery", root]); await writeFile(path.join(root, "app.txt"), "stable\n"); await execute("git", ["-C", root, "add", "app.txt"]); await execute("git", ["-C", root, "-c", "user.name=Harness", "-c", "user.email=harness@example.invalid", "commit", "-m", "checkpoint"]); const { stdout } = await execute("git", ["-C", root, "rev-parse", "HEAD"]); const { stdout: tree } = await execute("git", ["-C", root, "rev-parse", "HEAD^{tree}"]);
  const artifacts = path.join(base, "artifacts"); const now = new Date().toISOString(); const state: RunState = { schemaVersion: 1, runId: "run-recovery", repositoryPath: root, artifactPath: artifacts, stage, status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], checkpoints: [{ kind: "implementation", iteration: 0, commit: stdout.trim(), treeHash: tree.trim(), changedFiles: ["app.txt"], createdAt: now }], mutatingActionsBlocked: false, manualHandoffRequested: false };
  const store = new StateStore(artifacts); await store.initialize(state); await writeFile(path.join(artifacts, "config.snapshot.json"), "{}\n"); await writeFile(path.join(artifacts, "requirements.json"), JSON.stringify({ content: "keep stable" })); return { root, artifacts, state };
}

describe("Milestone 8 recovery and reports", () => {
  it("retries a clean pre-edit stage and reconciles a clean checkpoint", async () => {
    const before = await fixture("PLANNING"); expect((await reconcileRun(before.state)).disposition).toBe("restart_pre_edit");
    const after = await fixture("GATES_RUNNING"); expect((await reconcileRun(after.state)).disposition).toBe("resume_checkpoint");
  });

  it("preserves dirty editing work and writes deterministic recovery instructions", async () => {
    const value = await fixture("IMPLEMENTING"); await writeFile(path.join(value.root, "app.txt"), "unfinished\n"); const plan = await reconcileRun(value.state); expect(plan.disposition).toBe("manual_reconciliation"); expect(plan.reasons.join(" ")).toMatch(/uncommitted edits/); const file = await persistRecoveryPlan(value.state, plan); expect(await readFile(file, "utf8")).toContain("automatic cleanup is forbidden"); expect(await readFile(path.join(value.artifacts, "recovery/README.md"), "utf8")).toContain("Preserved material");
  });

  it("indexes preserved artifacts by hash in a reconstructable report", async () => {
    const value = await fixture("FAILED"); value.state.status = "failed"; await new StateStore(value.artifacts).write(value.state); const report = await generateRunReport(value.state); expect(report.reconstruction.configSnapshot).toContain("config.snapshot.json"); expect(report.artifacts.find((item) => item.path === "requirements.json")?.sha256).toMatch(/^[a-f0-9]{64}$/); expect(await readFile(path.join(value.artifacts, "report.md"), "utf8")).toContain("worktree are preserved");
  });
});
