import { z } from "zod";

export const testProvenanceSchema = z.enum(["pre_existing", "implementer_generated", "oracle_independent", "review_regression", "adversarial", "property_based", "mutation_generated"]);
export type TestProvenance = z.infer<typeof testProvenanceSchema>;
export const testEvidenceSchema = z.object({ id: z.string().min(1), provenance: testProvenanceSchema, acceptanceCriteria: z.array(z.string()).default([]), behaviorPartitions: z.array(z.string()).default([]), edgeCases: z.array(z.string()).default([]), changedCodePaths: z.array(z.string()).default([]), passed: z.boolean(), evidence: z.array(z.string()).min(1) });
export type TestEvidence = z.infer<typeof testEvidenceSchema>;

export const challengePlanSchema = z.object({ scenarios: z.array(z.object({ id: z.string().min(1), acceptanceCriteria: z.array(z.string()).min(1), category: z.enum(["invalid_input", "boundary", "state_transition", "partial_failure", "concurrency", "idempotency"]), description: z.string().min(1), expectedBehavior: z.string().min(1) })).min(1) });
export type ChallengePlan = z.infer<typeof challengePlanSchema>;

export interface VerificationResult { kind: "adversarial" | "property"; status: "passed" | "failed" | "skipped" | "blocked"; required: boolean; tests: TestEvidence[]; detail: string; durationMs: number; }
export interface MutationResult { kind: "mutation"; status: "passed" | "failed" | "skipped" | "blocked"; required: boolean; changedFiles: string[]; killed: number; survived: number; timedOut: number; skipped: number; relevantSurvivors: Array<{ mutant: string; file: string; acceptanceCriteria: string[] }>; score: number | null; detail: string; durationMs: number; }
export interface FlakyResult { kind: "flaky"; classification: "stable_pass" | "stable_failure" | "potentially_flaky"; repetitions: number; outcomes: Array<{ passed: boolean; exitCode: number | null; durationMs: number }>; soleSuccessEvidenceAllowed: false; }
export interface AdvancedVerificationResult { adversarial: VerificationResult; property: VerificationResult; mutation: MutationResult; flaky: FlakyResult[]; }
