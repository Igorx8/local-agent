import { z } from "zod";
export { challengePlanSchema } from "../verification/types.js";

export const acceptanceCriterionSchema = z.object({ id: z.string().regex(/^AC-[A-Z0-9-]+$/), requirement: z.string().min(1), status: z.enum(["pending", "proven", "failed", "blocked"]).default("pending"), evidence: z.array(z.string()).default([]) });
export const acceptanceMatrixSchema = z.object({ criteria: z.array(acceptanceCriterionSchema).min(1), assumptions: z.array(z.string()).default([]), ambiguities: z.array(z.string()).default([]) });
export type AcceptanceMatrix = z.infer<typeof acceptanceMatrixSchema>;

export const oracleTestsSchema = z.object({ tests: z.array(z.object({ id: z.string().min(1), acceptanceCriteria: z.array(z.string()).min(1), behaviorPartition: z.string().min(1), edgeCases: z.array(z.string()).default([]), description: z.string().min(1), artifactPath: z.string().optional() })), implementationDiffInspected: z.literal(false) });
export type OracleTests = z.infer<typeof oracleTestsSchema>;

export const planSchema = z.object({ steps: z.array(z.object({ id: z.string().min(1), description: z.string().min(1), acceptanceCriteria: z.array(z.string()), files: z.array(z.string()).default([]), risks: z.array(z.string()).default([]) })).min(1), allowedPaths: z.array(z.string()).default([]), prohibitedActions: z.array(z.string()).default([]) });
export type ImplementationPlan = z.infer<typeof planSchema>;

export const workResultSchema = z.object({ summary: z.string().min(1), filesChanged: z.array(z.string()).default([]), testsAdded: z.array(z.string()).default([]), commandsRun: z.array(z.string()).default([]), blockers: z.array(z.string()).default([]) });
export type WorkResult = z.infer<typeof workResultSchema>;

export const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export const findingSchema = z.object({ id: z.string().min(1), severity: severitySchema, acceptanceCriterion: z.string().optional(), file: z.string().optional(), lineStart: z.number().int().positive().optional(), lineEnd: z.number().int().positive().optional(), problem: z.string().min(1), evidence: z.string().min(1), reproduction: z.string().min(1), expectedBehavior: z.string().min(1), actualBehavior: z.string().min(1), suggestedFix: z.string().min(1), confidence: z.enum(["high", "medium", "low"]) });
export const reviewSchema = z.object({ findings: z.array(findingSchema) });
export type Finding = z.infer<typeof findingSchema>;
export type Review = z.infer<typeof reviewSchema>;

export const findingClassificationSchema = z.enum(["confirmed", "invalid", "style_preference", "out_of_scope", "requires_human_decision"]);
export const triageFindingSchema = z.object({
  findingId: z.string(),
  classification: findingClassificationSchema,
  evidence: z.string().min(1),
  rootCause: z.string().min(1),
  testable: z.boolean(),
  regressionTestExemption: z.string().optional().describe("Required and non-empty when classification is confirmed and testable is false; explain why no regression test can be added."),
}).superRefine((finding, context) => {
  if (finding.classification === "confirmed" && finding.testable === false && !finding.regressionTestExemption?.trim()) {
    context.addIssue({ code: "custom", path: ["regressionTestExemption"], message: "confirmed non-testable findings require a regression-test exemption" });
  }
});
export const triageSchema = z.object({ findings: z.array(triageFindingSchema) });
export type Triage = z.infer<typeof triageSchema>;

export const auditSchema = z.object({ acceptanceCriteria: z.array(z.object({ id: z.string(), status: z.enum(["proven", "failed", "blocked"]), evidence: z.array(z.string()) })), findings: z.array(findingSchema), decision: z.enum(["pass", "fail", "requires_human_decision"]) });
export type Audit = z.infer<typeof auditSchema>;

export const roleOutputSchemas = { acceptance: acceptanceMatrixSchema, oracle: oracleTestsSchema, plan: planSchema, work: workResultSchema, review: reviewSchema, triage: triageSchema, audit: auditSchema } as const;
