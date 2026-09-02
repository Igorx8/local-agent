import { z } from "zod";
import path from "node:path";
import type { HarnessConfig } from "../config.js";
import type { Finding, Triage } from "../workflow/contracts.js";
import { executeConfigured } from "../tools/executor.js";

export const regressionProofSchema = z.object({ findingId: z.string().min(1), testPath: z.string().min(1).optional(), defectiveCheckpoint: z.string().min(1).optional(), repairedCheckpoint: z.string().min(1).optional(), failBefore: z.object({ exitCode: z.number().int(), expectedReasonMatched: z.literal(true), evidence: z.string().min(1) }).optional(), passAfter: z.object({ exitCode: z.literal(0), evidence: z.string().min(1) }).optional(), exemption: z.object({ category: z.enum(["documentation_only", "non_testable_infrastructure", "externally_constrained"]), justification: z.string().min(1) }).optional() }).superRefine((proof, context) => {
  if (proof.exemption) { if (proof.failBefore || proof.passAfter) context.addIssue({ code: "custom", message: "exemption cannot be combined with execution proof" }); return; }
  if (!proof.testPath || !proof.defectiveCheckpoint || !proof.repairedCheckpoint || !proof.failBefore || !proof.passAfter) context.addIssue({ code: "custom", message: "testable regression requires fail-before and pass-after checkpoint evidence" });
  if (proof.failBefore?.exitCode === 0) context.addIssue({ code: "custom", message: "fail-before must have a non-zero exit code" });
  if (proof.defectiveCheckpoint && proof.defectiveCheckpoint === proof.repairedCheckpoint) context.addIssue({ code: "custom", message: "defective and repaired checkpoints must differ" });
});
export type RegressionProof = z.infer<typeof regressionProofSchema>;
export function validateRegressionProofs(expectedFindingIds: string[], proofs: unknown[]): RegressionProof[] { const parsed = proofs.map((proof) => regressionProofSchema.parse(proof)); const expected = new Set(expectedFindingIds); const actual = new Set(parsed.map((proof) => proof.findingId)); if (parsed.length !== expected.size || actual.size !== expected.size || [...expected].some((id) => !actual.has(id))) throw new Error("regression proof must cover every confirmed finding exactly once"); return parsed; }

export async function runRegressionProofAdapter(config: HarnessConfig, repository: string, artifactDirectory: string, findings: Finding[], triage: Triage, defectiveCheckpoint: string, repairedCheckpoint: string): Promise<RegressionProof[]> {
  const spec = config.verification.commands.regression; if (!spec) throw new Error("testable finding requires verification.commands.regression; no project test runner was assumed");
  const context = { findings, triage, defectiveCheckpoint, repairedCheckpoint }; const execution = await executeConfigured(spec, { cwd: repository, logPath: path.join(artifactDirectory, "regression-proof-command.json"), outputLimitBytes: 4 * 1024 * 1024, env: { ...process.env, HARNESS_REGRESSION_CONTEXT: JSON.stringify(context) } });
  if (execution.exitCode !== 0 || execution.timedOut) throw new Error(execution.timedOut ? "regression-proof adapter timed out" : `regression-proof adapter exited ${execution.exitCode}`);
  const body = z.object({ proofs: z.array(regressionProofSchema) }).parse(JSON.parse(execution.stdout)); const proofs = validateRegressionProofs(findings.map((finding) => finding.id), body.proofs);
  for (const proof of proofs) if (!proof.exemption && (proof.defectiveCheckpoint !== defectiveCheckpoint || proof.repairedCheckpoint !== repairedCheckpoint)) throw new Error(`regression proof checkpoint mismatch for ${proof.findingId}`);
  return proofs;
}
