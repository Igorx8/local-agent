import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { agentRoles, loadModelRegistry, resolveRoleAlias } from "./models/registry.js";

const roleNames = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"] as const;
const roleModelsSchema = z.object(Object.fromEntries(roleNames.map((name) => [name, z.string().min(1)])) as Record<(typeof roleNames)[number], z.ZodString>);

const threshold = z.number().min(0).max(1);
const commandSchema = z.object({ command: z.string().min(1), args: z.array(z.string()).default([]), required: z.boolean().default(true), timeoutMs: z.number().int().positive().default(600_000) });

export const harnessConfigSchema = z.object({
  version: z.literal(1),
  runtime: z.object({
    opencodeUrl: z.string().url().default("http://127.0.0.1:4096"),
    llamaUrl: z.string().url().default("http://127.0.0.1:8080"),
    modelStrategy: z.enum(["router", "process"]).default("router"),
    localOnly: z.literal(true).default(true)
  }).refine((v) => [v.opencodeUrl, v.llamaUrl].every((url) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)), "localOnly requires loopback runtime URLs"),
  modelRegistry: z.string().min(1).default("./config/models.local.yaml"),
  routerPreset: z.string().min(1).default("./config/models.local.ini"),
  apiKeyEnv: z.literal("LLAMA_API_KEY").default("LLAMA_API_KEY"),
  models: roleModelsSchema,
  modelFiles: z.record(z.string(), z.string()).default({}),
  modelProcesses: z.record(z.string(), z.object({ command: z.string().min(1), args: z.array(z.string()).default([]) })).default({}),
  workflow: z.object({
    maxReviewIterations: z.number().int().min(1).default(3),
    adaptiveReviewMaximum: z.number().int().min(1).default(5),
    inferenceRetries: z.number().int().min(0).default(2),
    requireObjectiveProgress: z.boolean().default(true),
    stopAfterConsecutiveStagnantIterations: z.number().int().min(1).default(2),
    autoCommitCheckpoints: z.boolean().default(true),
    stopOnAmbiguousCriticalFinding: z.boolean().default(true),
    requireRegressionTestForConfirmedDefect: z.boolean().default(true),
    autoMerge: z.literal(false).default(false)
  }).refine((v) => v.adaptiveReviewMaximum >= v.maxReviewIterations, "adaptive maximum must be >= normal maximum"),
  verification: z.object({
    captureBaseline: z.literal(true).default(true), designOracleTestsBeforeImplementation: z.literal(true).default(true), hideOracleTestsUntilInitialCheckpoint: z.literal(true).default(true), dualIndependentReview: z.literal(true).default(true),
    propertyTesting: z.enum(["auto", "configured", "off"]).default("auto"), mutationTesting: z.enum(["changed-files", "configured", "off"]).default("changed-files"), flakyRepetitions: z.number().int().min(2).default(3),
    commands: z.object({ adversarial: commandSchema.optional(), property: commandSchema.optional(), mutation: commandSchema.optional(), flaky: commandSchema.optional(), regression: commandSchema.optional() }).default({})
  }).default({ captureBaseline: true, designOracleTestsBeforeImplementation: true, hideOracleTestsUntilInitialCheckpoint: true, dualIndependentReview: true, propertyTesting: "auto", mutationTesting: "changed-files", flakyRepetitions: 3, commands: {} }),
  context: z.object({
    warningThreshold: threshold.default(0.7),
    prepareHandoffThreshold: threshold.default(0.78),
    handoffThreshold: threshold.default(0.85),
    hardStopThreshold: threshold.default(0.92),
    reservedTokens: z.number().int().nonnegative().default(8192),
    maxHandoffTokens: z.number().int().positive().default(6000),
    expectedNextTurnTokens: z.record(z.string(), z.number().int().positive()).default({})
  }).refine((v) => v.warningThreshold < v.prepareHandoffThreshold && v.prepareHandoffThreshold < v.handoffThreshold && v.handoffThreshold < v.hardStopThreshold, "context thresholds must be strictly increasing"),
  quality: z.record(z.string(), commandSchema.nullable()).default({}),
  scope: z.object({
    allowedPaths: z.array(z.string()).default([]), deniedPaths: z.array(z.string()).default([]),
    maxChangedFilesBeforeReview: z.number().int().positive().default(20), maxAddedLinesBeforeReview: z.number().int().positive().default(800),
    requireDependencyChangeJustification: z.boolean().default(true), requirePublicApiChangeJustification: z.boolean().default(true), requireMigrationJustification: z.boolean().default(true)
  }).default({ allowedPaths: [], deniedPaths: [], maxChangedFilesBeforeReview: 20, maxAddedLinesBeforeReview: 800, requireDependencyChangeJustification: true, requirePublicApiChangeJustification: true, requireMigrationJustification: true }),
  security: z.object({ deniedPathPatterns: z.array(z.string()).default(["**/.env", "**/.ssh/**"]), redactPatterns: z.array(z.string()).default([]) }).default({ deniedPathPatterns: ["**/.env", "**/.ssh/**"], redactPatterns: [] }),
  telemetry: z.object({ jsonLogs: z.boolean().default(true), storePrompts: z.boolean().default(true), storeResponses: z.boolean().default(true) }).default({ jsonLogs: true, storePrompts: true, storeResponses: true }),
  git: z.object({ requireCleanWorktree: z.boolean().default(true), useIsolatedWorktree: z.boolean().default(true), branchPrefix: z.string().default("agent/"), defaultBranchProtection: z.boolean().default(true) }).default({ requireCleanWorktree: true, useIsolatedWorktree: true, branchPrefix: "agent/", defaultBranchProtection: true })
});

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

export async function loadConfig(file: string): Promise<HarnessConfig> {
  const raw = YAML.parse(await readFile(path.resolve(file), "utf8"));
  const config = harnessConfigSchema.parse(raw);
  const registry = await loadModelRegistry(config.modelRegistry);
  for (const role of agentRoles) {
    const expected = `${registry.providerId}/${resolveRoleAlias(registry, role)}`;
    if (config.models[role] !== expected) throw new Error(`models.${role} must be exactly ${expected}`);
  }
  return config;
}
