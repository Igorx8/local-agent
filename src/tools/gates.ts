import path from "node:path";
import type { HarnessConfig } from "../config.js";
import { executeConfigured, type ExecutionResult } from "./executor.js";

export const gateOrder = ["install", "test", "lint", "typecheck", "coverage", "build"] as const;
export type GateStatus = "passed" | "failed" | "skipped" | "timed_out";
export interface GateResult extends ExecutionResult { name: string; required: boolean; status: GateStatus; provenance: "pre_existing"; }

export async function runGates(config: HarnessConfig, cwd: string, artifactsDirectory: string): Promise<GateResult[]> {
  const names = [...gateOrder, ...Object.keys(config.quality).filter((name) => !gateOrder.includes(name as typeof gateOrder[number])).sort()];
  const results: GateResult[] = [];
  for (const name of names) {
    const gate = config.quality[name];
    if (!gate) continue;
    const execution = await executeConfigured(gate, { cwd, logPath: path.join(artifactsDirectory, `${name}.json`) });
    results.push({ ...execution, name, required: gate.required, status: execution.timedOut ? "timed_out" : execution.exitCode === 0 ? "passed" : "failed", provenance: "pre_existing" });
  }
  return results;
}

export function requiredGatesPassed(results: GateResult[]): boolean {
  return results.every((result) => !result.required || result.status === "passed");
}
