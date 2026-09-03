import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { RunState } from "../state/types.js";
import type { GateResult } from "../tools/gates.js";
import type { Finding, Triage } from "../workflow/contracts.js";
import type { FlakyResult, MutationResult } from "../verification/types.js";
import { inspectRepository } from "../git/workspace.js";
import { readModelRuntime } from "../models/control.js";
import { collectMachineMetrics, type MachineMetrics } from "./machine.js";
import { readEvents, type HarnessEvent } from "./events.js";

export interface DashboardSnapshot { generatedAt: string; run: { id: string; repository: string; branch: string; elapsedMs: number; stage: string; reviewIteration: number; status: string }; model?: RunState["activeModel"]; context?: RunState["context"] & { level: "green" | "yellow" | "orange" | "red" | "critical" }; gates: Array<GateResult & { baseline?: string }>; review: { total: number; severity: Record<string, number>; confirmed: number; rejected: number; unresolved: number; repairIteration: number; progress?: { decision?: string; improvements?: string[]; regressions?: string[] }; groups: { repository: number; requirements: number } }; verification: { mutation?: Pick<MutationResult, "status" | "score">; flaky?: Record<string, number> }; machine: MachineMetrics; events: HarnessEvent[]; }

async function json<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return undefined; } }
async function latest(directory: string, suffix: string): Promise<string | undefined> { try { const order = (name: string) => Number(name.match(/\d+/)?.[0] ?? -1); const names = (await readdir(directory)).filter((name) => name.endsWith(suffix)).sort((a, b) => order(a) - order(b)); return names.at(-1) ? path.join(directory, names.at(-1)!) : undefined; } catch { return undefined; } }
export function contextLevel(usage: number): "green" | "yellow" | "orange" | "red" | "critical" { return usage >= .92 ? "critical" : usage >= .85 ? "red" : usage >= .78 ? "orange" : usage >= .70 ? "yellow" : "green"; }

export async function buildDashboardSnapshot(state: RunState, root = process.cwd()): Promise<DashboardSnapshot> {
  const identity = await inspectRepository(state.repositoryPath).catch(() => ({ branch: "unknown" }));
  const gateFile = await latest(path.join(state.artifactPath, "gates"), ".json"); const gateDoc = gateFile ? await json<{ gates: GateResult[]; baselineAttribution?: Record<string, string> }>(gateFile) : undefined;
  const reviewDir = path.join(state.artifactPath, "reviews"); const mergedFile = await latest(reviewDir, "-merged.json"); const triageFile = await latest(reviewDir, "-triage.json"); const progressFile = await latest(reviewDir, "-progress.json");
  const repositoryFile = await latest(reviewDir, "-repository.json"); const requirementsFile = await latest(reviewDir, "-requirements.json");
  const merged = mergedFile ? await json<{ findings: Finding[] }>(mergedFile) : undefined; const triage = triageFile ? await json<Triage>(triageFile) : undefined;
  const repository = repositoryFile ? await json<{ findings: Finding[] }>(repositoryFile) : undefined; const requirements = requirementsFile ? await json<{ findings: Finding[] }>(requirementsFile) : undefined;
  const mutation = await json<MutationResult>(path.join(state.artifactPath, "mutation/results.json")); const flaky = await json<FlakyResult[]>(path.join(state.artifactPath, "flaky-analysis/results.json"));
  const runtime = await readModelRuntime(root); const findings = merged?.findings ?? []; const classifications = triage?.findings ?? [];
  const severity = Object.fromEntries(["critical", "high", "medium", "low", "info"].map((name) => [name, findings.filter((finding) => finding.severity === name).length]));
  return { generatedAt: new Date().toISOString(), run: { id: state.runId, repository: state.repositoryPath, branch: identity.branch, elapsedMs: Date.now() - Date.parse(state.createdAt), stage: state.stage, reviewIteration: state.counters.repairIterations, status: state.status }, model: state.activeModel, context: state.context ? { ...state.context, level: contextLevel(state.context.usage) } : undefined, gates: (gateDoc?.gates ?? []).map((gate) => ({ ...gate, baseline: gateDoc?.baselineAttribution?.[gate.name] })), review: { total: findings.length, severity, confirmed: classifications.filter((item) => item.classification === "confirmed").length, rejected: classifications.filter((item) => ["invalid", "style_preference", "out_of_scope"].includes(item.classification)).length, unresolved: classifications.filter((item) => item.classification === "requires_human_decision").length, repairIteration: state.counters.repairIterations, progress: progressFile ? await json(progressFile) : undefined, groups: { repository: repository?.findings.length ?? 0, requirements: requirements?.findings.length ?? 0 } }, verification: { mutation: mutation ? { status: mutation.status, score: mutation.score } : undefined, flaky: flaky ? Object.fromEntries(["stable_pass", "stable_failure", "potentially_flaky"].map((kind) => [kind, flaky.filter((item) => item.classification === kind).length])) : undefined }, machine: await collectMachineMetrics(runtime?.pid), events: await readEvents(state.artifactPath, 12) };
}
