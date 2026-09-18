import path from "node:path";
import { publishCheckpoint } from "../git/workspace.js";
import { StateStore } from "../state/store.js";
import { appendEvent } from "../telemetry/events.js";
import { writeArtifact } from "./artifacts.js";

export async function applyPreservedCheckpoint(repositoryInput: string, runId: string) {
  const repository = path.resolve(repositoryInput); const artifacts = path.join(repository, ".agent-harness", "runs", runId); const store = new StateStore(artifacts); const state = await store.read();
  if (state.status === "active" || state.status === "paused") throw new Error(`run ${runId} is ${state.status}; stop or finish it before applying a checkpoint`);
  const checkpoint = state.checkpoints.at(-1); if (!checkpoint) throw new Error(`run ${runId} has no preserved checkpoint`);
  const baseline = state.baseline?.commit ?? state.conversation?.baseCommit; if (!baseline) throw new Error(`run ${runId} has no persisted baseline commit`);
  const published = await publishCheckpoint(repository, baseline, checkpoint.commit, path.join(artifacts, "manual-workspace.patch"));
  const result = { runId, runStatus: state.status, checkpoint: checkpoint.commit, files: published.files, appliedAt: new Date().toISOString(), automaticApprovalBypassed: state.status !== "succeeded" };
  await writeArtifact(artifacts, "manual-publication.json", result); await appendEvent(artifacts, { type: "workspace.published", message: `Explicitly applied ${published.files.length} preserved file(s) to the current working tree`, data: { files: published.files, commit: checkpoint.commit, runStatus: state.status } }); return result;
}
