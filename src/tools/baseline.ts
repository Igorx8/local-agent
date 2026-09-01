import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GateResult } from "./gates.js";
import type { HarnessConfig } from "../config.js";
import { inspectRepository } from "../git/workspace.js";
import { runGates } from "./gates.js";

export interface BaselineEvidence { schemaVersion: 1; capturedAt: string; commit: string; treeHash: string; environment: { node: string; platform: string; arch: string }; gates: GateResult[]; }
export type GateAttribution = "unchanged_pass" | "unchanged_failure" | "fixed_pre_existing" | "introduced_failure";

export function compareGateResults(baseline: GateResult[], current: GateResult[]): Record<string, GateAttribution> {
  const before = new Map(baseline.map((gate) => [gate.name, gate.status]));
  return Object.fromEntries(current.map((gate) => {
    const priorPassed = before.get(gate.name) === "passed";
    const nowPassed = gate.status === "passed";
    return [gate.name, priorPassed ? nowPassed ? "unchanged_pass" : "introduced_failure" : nowPassed ? "fixed_pre_existing" : "unchanged_failure"];
  }));
}

export async function persistBaseline(file: string, evidence: BaselineEvidence): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await import("node:fs/promises").then(({ rename }) => rename(temporary, file));
}

export async function captureBaseline(config: HarnessConfig, repository: string, runArtifacts: string): Promise<BaselineEvidence> {
  const identity = await inspectRepository(repository);
  const gates = await runGates(config, repository, path.join(runArtifacts, "gates", "baseline"));
  const evidence: BaselineEvidence = { schemaVersion: 1, capturedAt: new Date().toISOString(), commit: identity.commit, treeHash: identity.treeHash, environment: { node: process.version, platform: process.platform, arch: process.arch }, gates };
  await persistBaseline(path.join(runArtifacts, "baseline.json"), evidence);
  return evidence;
}
