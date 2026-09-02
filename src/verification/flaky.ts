import type { CommandSpec } from "../tools/policy.js";
import { executeConfigured, type ExecuteOptions } from "../tools/executor.js";
import type { FlakyResult } from "./types.js";

export function classifyFlaky(outcomes: FlakyResult["outcomes"]): FlakyResult["classification"] { const passes = outcomes.filter((item) => item.passed).length; return passes === outcomes.length ? "stable_pass" : passes === 0 ? "stable_failure" : "potentially_flaky"; }
export async function repeatIsolated(spec: CommandSpec, repetitions: number, options: ExecuteOptions): Promise<FlakyResult> {
  const outcomes: FlakyResult["outcomes"] = [];
  for (let index = 0; index < repetitions; index++) { const result = await executeConfigured(spec, options); outcomes.push({ passed: result.exitCode === 0 && !result.timedOut, exitCode: result.exitCode, durationMs: result.durationMs }); }
  return { kind: "flaky", classification: classifyFlaky(outcomes), repetitions, outcomes, soleSuccessEvidenceAllowed: false };
}
