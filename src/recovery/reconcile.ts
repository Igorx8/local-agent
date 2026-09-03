import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RunState } from "../state/types.js";
import { inspectRepository } from "../git/workspace.js";
import { writeArtifact, writeTextArtifact } from "../workflow/artifacts.js";
import { appendEvent } from "../telemetry/events.js";

const beforeEditing = new Set<RunState["stage"]>(["CREATED", "PREFLIGHT", "BASELINE_CREATED", "BASELINE_GATES_RUNNING", "BASELINE_CAPTURED", "ACCEPTANCE_CRITERIA_GENERATING", "ACCEPTANCE_CRITERIA_VALIDATING", "ORACLE_DESIGNING", "ORACLE_VALIDATING", "PLANNING", "PLAN_VALIDATION"]);
const terminal = new Set<RunState["status"]>(["succeeded", "failed", "escalated"]);
export interface RecoveryPlan { runId: string; disposition: "terminal" | "restart_pre_edit" | "resume_checkpoint" | "manual_reconciliation"; stage: RunState["stage"]; repository: { branch: string; commit: string; treeHash: string; dirty: boolean }; reasons: string[]; preservedArtifacts: string[]; nextCommand?: string; }

export async function reconcileRun(state: RunState): Promise<RecoveryPlan> {
  const repository = await inspectRepository(state.repositoryPath); const preservedArtifacts = [path.join(state.artifactPath, "state.json"), state.repositoryPath]; const interruptedStage = state.pausedFromStage ?? state.stage;
  if (terminal.has(state.status)) return { runId: state.runId, disposition: "terminal", stage: interruptedStage, repository, reasons: [`run is already ${state.status}`, "isolated worktree and evidence remain preserved"], preservedArtifacts, nextCommand: `harness report ${state.runId}` };
  if (beforeEditing.has(interruptedStage) && !repository.dirty) return { runId: state.runId, disposition: "restart_pre_edit", stage: interruptedStage, repository, reasons: ["interrupted stage is idempotent", "worktree is clean"], preservedArtifacts, nextCommand: `harness resume ${state.runId}` };
  const checkpoint = state.checkpoints.at(-1);
  if (checkpoint && !repository.dirty && checkpoint.commit === repository.commit) return { runId: state.runId, disposition: "resume_checkpoint", stage: interruptedStage, repository, reasons: ["worktree matches the last persisted checkpoint", `checkpoint=${checkpoint.kind}:${checkpoint.iteration}`], preservedArtifacts: [...preservedArtifacts, checkpoint.commit], nextCommand: `harness resume ${state.runId}` };
  return { runId: state.runId, disposition: "manual_reconciliation", stage: interruptedStage, repository, reasons: [repository.dirty ? "uncommitted edits must be reconciled before retry" : "Git HEAD does not match the last persisted checkpoint", "automatic cleanup is forbidden"], preservedArtifacts, nextCommand: `harness report ${state.runId}` };
}

export async function persistRecoveryPlan(state: RunState, plan: RecoveryPlan): Promise<string> {
  const file = await writeArtifact(state.artifactPath, "recovery/plan.json", plan); const text = [`# Recovery instructions for ${state.runId}`, "", `Disposition: ${plan.disposition}`, `Interrupted stage: ${plan.stage}`, `Git: ${plan.repository.branch} ${plan.repository.commit} dirty=${plan.repository.dirty}`, "", "## Reasons", ...plan.reasons.map((reason) => `- ${reason}`), "", "## Preserved material", ...plan.preservedArtifacts.map((item) => `- ${item}`), "", "## Next action", plan.nextCommand ? `Run: \`${plan.nextCommand}\`` : "No action is required."].join("\n"); await writeTextArtifact(state.artifactPath, "recovery/README.md", `${text}\n`); await appendEvent(state.artifactPath, { type: "recovery.reconciled", message: plan.disposition, data: { stage: plan.stage, dirty: plan.repository.dirty } }).catch(() => undefined); return file;
}

export async function readRunInputs(state: RunState): Promise<{ requirements: string; definitionOfDone: string }> {
  const stored = JSON.parse(await readFile(path.join(state.artifactPath, "requirements.json"), "utf8")) as { content: string; definitionOfDone?: string };
  return { requirements: stored.content, definitionOfDone: stored.definitionOfDone ?? "All required gates pass and every acceptance criterion is proven." };
}
