import path from "node:path";
import type { HarnessConfig } from "../config.js";
import { executeConfigured } from "../tools/executor.js";
import { testEvidenceSchema, type MutationResult, type VerificationResult } from "./types.js";
import { z } from "zod";

const normalizedSchema = z.object({ tests: z.array(testEvidenceSchema) });
const mutationOutputSchema = z.object({ killed: z.number().int().nonnegative(), survived: z.number().int().nonnegative(), timedOut: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), survivors: z.array(z.object({ mutant: z.string(), file: z.string(), acceptanceCriteria: z.array(z.string()).default([]) })).default([]) });
function skipped(kind: "adversarial" | "property", detail: string): VerificationResult { return { kind, status: "skipped", required: false, tests: [], detail, durationMs: 0 }; }

export async function runVerificationAdapter(kind: "adversarial" | "property", config: HarnessConfig, cwd: string, artifactDirectory: string): Promise<VerificationResult> {
  const spec = config.verification.commands[kind];
  if (!spec) return skipped(kind, `${kind} adapter command is not configured; no project tool was assumed`);
  const execution = await executeConfigured(spec, { cwd, logPath: path.join(artifactDirectory, `${kind}-command.json`), outputLimitBytes: 4 * 1024 * 1024 });
  if (execution.exitCode !== 0 || execution.timedOut) return { kind, status: "failed", required: spec.required, tests: [], detail: execution.timedOut ? "adapter timed out" : `adapter exited ${execution.exitCode}`, durationMs: execution.durationMs };
  try { const output = normalizedSchema.parse(JSON.parse(execution.stdout)); const wrong = output.tests.filter((test) => test.provenance !== (kind === "property" ? "property_based" : "adversarial") || !test.acceptanceCriteria.length || !test.behaviorPartitions.length); if (wrong.length) throw new Error(`adapter returned invalid provenance or behavioral mapping for ${wrong.map((test) => test.id).join(", ")}`); return { kind, status: output.tests.every((test) => test.passed) ? "passed" : "failed", required: spec.required, tests: output.tests, detail: `${output.tests.length} mapped behavioral test(s)`, durationMs: execution.durationMs }; }
  catch (error) { return { kind, status: "failed", required: spec.required, tests: [], detail: `invalid normalized adapter output: ${error instanceof Error ? error.message : String(error)}`, durationMs: execution.durationMs }; }
}

export async function runMutationAdapter(config: HarnessConfig, cwd: string, changedFiles: string[], artifactDirectory: string): Promise<MutationResult> {
  const spec = config.verification.commands.mutation;
  if (!spec) return { kind: "mutation", status: "skipped", required: false, changedFiles, killed: 0, survived: 0, timedOut: 0, skipped: 0, relevantSurvivors: [], score: null, detail: "mutation adapter command is not configured; no project tool was assumed", durationMs: 0 };
  const execution = await executeConfigured(spec, { cwd, logPath: path.join(artifactDirectory, "mutation-command.json"), outputLimitBytes: 4 * 1024 * 1024, env: { ...process.env, HARNESS_CHANGED_FILES: JSON.stringify(changedFiles) } });
  const base = { kind: "mutation" as const, required: spec.required, changedFiles, durationMs: execution.durationMs };
  if (execution.exitCode !== 0 || execution.timedOut) return { ...base, status: "failed", killed: 0, survived: 0, timedOut: execution.timedOut ? 1 : 0, skipped: 0, relevantSurvivors: [], score: null, detail: execution.timedOut ? "mutation adapter timed out" : `mutation adapter exited ${execution.exitCode}` };
  try { const output = mutationOutputSchema.parse(JSON.parse(execution.stdout)); const outOfScope = output.survivors.filter((item) => !changedFiles.includes(item.file)); if (outOfScope.length) throw new Error(`mutation adapter returned out-of-scope survivor files: ${outOfScope.map((item) => item.file).join(", ")}`); const denominator = output.killed + output.survived; const relevantSurvivors = output.survivors.filter((item) => item.acceptanceCriteria.length > 0); const failed = relevantSurvivors.length > 0 || output.timedOut > 0; return { ...base, status: failed ? "failed" : "passed", killed: output.killed, survived: output.survived, timedOut: output.timedOut, skipped: output.skipped, relevantSurvivors, score: denominator ? output.killed / denominator : null, detail: relevantSurvivors.length ? `${relevantSurvivors.length} acceptance-relevant mutant(s) survived` : output.timedOut ? `${output.timedOut} mutant(s) timed out` : "no acceptance-relevant mutants survived" }; }
  catch (error) { return { ...base, status: "failed", killed: 0, survived: 0, timedOut: 0, skipped: 0, relevantSurvivors: [], score: null, detail: `invalid normalized mutation output: ${error instanceof Error ? error.message : String(error)}` }; }
}
