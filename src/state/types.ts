import { z } from "zod";

export const workflowStates = ["CREATED", "PREFLIGHT", "BASELINE_CREATED", "BASELINE_GATES_RUNNING", "BASELINE_CAPTURED", "ACCEPTANCE_CRITERIA_GENERATING", "ACCEPTANCE_CRITERIA_VALIDATING", "ORACLE_DESIGNING", "ORACLE_VALIDATING", "PLANNING", "PLAN_VALIDATION", "IMPLEMENTING", "IMPLEMENTATION_CHECKPOINT", "GATES_RUNNING", "REPOSITORY_REVIEWING", "REQUIREMENTS_REVIEWING", "REVIEWS_MERGING", "FINDINGS_VALIDATION", "PROGRESS_EVALUATION", "REPAIRING", "REPAIR_CHECKPOINT", "INCREMENTAL_REVIEW", "ADVERSARIAL_TESTING", "PROPERTY_TESTING", "MUTATION_TESTING", "FLAKY_ANALYSIS", "FINAL_AUDIT", "SUCCEEDED", "FAILED", "ESCALATED", "PAUSED", "HANDOFF_GENERATING", "HANDOFF_VALIDATING", "SESSION_RESTARTING"] as const;

export const runStateSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  repositoryPath: z.string().min(1),
  artifactPath: z.string().min(1),
  stage: z.enum(workflowStates),
  status: z.enum(["active", "paused", "succeeded", "failed", "escalated"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  counters: z.object({ inferenceRetries: z.number().int().nonnegative(), repairIterations: z.number().int().nonnegative(), contextHandoffs: z.number().int().nonnegative() }),
  baseline: z.object({ commit: z.string(), treeHash: z.string(), gatesArtifact: z.string().optional() }).optional(),
  modelManifest: z.string().optional(),
  acceptanceCriteriaArtifact: z.string().optional(),
  oracleTestsArtifact: z.string().optional(),
  historicalMetricsArtifact: z.string().optional(),
  context: z.object({ latestPromptTokens: z.number().int().nonnegative(), contextWindow: z.number().int().positive(), usage: z.number().min(0), provenance: z.enum(["exact", "estimated"]), source: z.string(), reason: z.string().optional(), projectedTokens: z.number().int().nonnegative().optional(), reservedTokens: z.number().int().nonnegative().optional(), effectiveHandoffThreshold: z.number().min(0).max(1).optional() }).optional(),
  handoffs: z.array(z.object({ sequence: z.number().int().positive(), role: z.string(), previousSessionId: z.string(), newSessionId: z.string(), path: z.string(), reason: z.string(), createdAt: z.string().datetime() })).default([]),
  checkpoints: z.array(z.object({ kind: z.enum(["implementation", "repair"]), iteration: z.number().int().nonnegative(), commit: z.string(), treeHash: z.string(), changedFiles: z.array(z.string()), createdAt: z.string().datetime() })).default([]),
  mutatingActionsBlocked: z.boolean().default(false),
  manualHandoffRequested: z.boolean().default(false),
  pausedFromStage: z.enum(workflowStates).optional(),
  conversation: z.object({ id: z.string().min(1), turn: z.number().int().positive(), baseCommit: z.string().min(1) }).optional(),
  activeSession: z.object({ role: z.string(), sessionId: z.string() }).optional(),
  activeModel: z.object({ role: z.string(), alias: z.string(), lifecycle: z.enum(["stopped", "loading", "healthy", "generating", "unloading", "error"]), requestDurationMs: z.number().nonnegative().optional(), tokensPerSecond: z.number().nonnegative().optional() }).optional()
});

export type RunState = z.infer<typeof runStateSchema>;
