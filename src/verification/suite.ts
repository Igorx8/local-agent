import type { HarnessConfig } from "../config.js";
import { runMutationAdapter, runVerificationAdapter } from "./adapters.js";
import type { AdvancedVerificationResult, ChallengePlan } from "./types.js";
import { repeatIsolated } from "./flaky.js";

export async function runAdvancedVerification(config: HarnessConfig, repository: string, artifacts: string, changedFiles: string[], challenge: ChallengePlan): Promise<AdvancedVerificationResult> {
  if (!challenge.scenarios.length) throw new Error("adversarial challenge plan cannot be empty");
  const adversarial = await runVerificationAdapter("adversarial", config, repository, artifacts);
  const property = config.verification.propertyTesting === "off" ? { kind: "property" as const, status: "skipped" as const, required: false, tests: [], detail: "property testing is disabled", durationMs: 0 } : await runVerificationAdapter("property", config, repository, artifacts);
  const mutation = config.verification.mutationTesting === "off" ? { kind: "mutation" as const, status: "skipped" as const, required: false, changedFiles, killed: 0, survived: 0, timedOut: 0, skipped: 0, relevantSurvivors: [], score: null, detail: "mutation testing is disabled", durationMs: 0 } : await runMutationAdapter(config, repository, changedFiles, artifacts);
  const flaky = config.verification.commands.flaky ? [await repeatIsolated(config.verification.commands.flaky, config.verification.flakyRepetitions, { cwd: repository })] : [];
  return { adversarial, property, mutation, flaky };
}

export function advancedVerificationPassed(result: AdvancedVerificationResult): boolean {
  const checks = [result.adversarial, result.property, result.mutation];
  return checks.every((check) => !(check.required && check.status !== "passed") && !(check.kind === "mutation" && check.relevantSurvivors.length > 0)) && result.flaky.every((item) => item.classification !== "potentially_flaky");
}
