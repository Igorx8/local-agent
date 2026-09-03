import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { RunState } from "../state/types.js";
import { inspectRepository } from "../git/workspace.js";
import { writeArtifact, writeTextArtifact } from "../workflow/artifacts.js";
import { readEvents } from "../telemetry/events.js";

async function digest(file: string): Promise<string> { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function files(root: string, directory = root): Promise<string[]> { const result: string[] = []; for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) result.push(...await files(root, absolute)); else if (!entry.name.endsWith(".tmp")) result.push(path.relative(root, absolute)); } return result.sort(); }
export interface RunReport { schemaVersion: 1; runId: string; status: string; stage: string; repository: Awaited<ReturnType<typeof inspectRepository>>; baseline?: RunState["baseline"]; counters: RunState["counters"]; checkpoints: RunState["checkpoints"]; artifacts: Array<{ path: string; sha256: string }>; reconstruction: { configSnapshot: string; modelRegistrySnapshot: string; requirements: string; modelManifest?: string; state: string; commands: string[] }; eventCount: number; generatedAt: string; }

export async function generateRunReport(state: RunState): Promise<RunReport> {
  const names = (await files(state.artifactPath)).filter((name) => !["report.json", "report.md"].includes(name)); const artifacts = await Promise.all(names.map(async (name) => ({ path: name, sha256: await digest(path.join(state.artifactPath, name)) })));
  const report: RunReport = { schemaVersion: 1, runId: state.runId, status: state.status, stage: state.stage, repository: await inspectRepository(state.repositoryPath), baseline: state.baseline, counters: state.counters, checkpoints: state.checkpoints, artifacts, reconstruction: { configSnapshot: path.join(state.artifactPath, "config.snapshot.json"), modelRegistrySnapshot: path.join(state.artifactPath, "model-registry.snapshot.json"), requirements: path.join(state.artifactPath, "requirements.json"), modelManifest: state.modelManifest, state: path.join(state.artifactPath, "state.json"), commands: [`harness status ${state.runId} --json`, `harness logs ${state.runId}`, `harness report ${state.runId}`] }, eventCount: (await readEvents(state.artifactPath, Number.MAX_SAFE_INTEGER)).length, generatedAt: new Date().toISOString() };
  await writeArtifact(state.artifactPath, "report.json", report); await writeTextArtifact(state.artifactPath, "report.md", `# Run ${state.runId}\n\nStatus: **${state.status}** at **${state.stage}**\n\nBranch: \`${report.repository.branch}\`  \nCommit: \`${report.repository.commit}\`  \nDirty: ${report.repository.dirty}\n\nArtifacts: ${report.artifacts.length} (SHA-256 indexed in report.json)\n\nRecovery material and the isolated worktree are preserved at \`${state.artifactPath}\` and \`${state.repositoryPath}\`.\n`); return report;
}
