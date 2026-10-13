import { createHash } from "node:crypto";
import { z } from "zod";
import type { DocumentQualityDimension } from "../tools/markdown-quality.js";

export interface DocumentBenchmarkSnapshot {
  workflowStatus: "succeeded" | "failed";
  fixtureSha256: string;
  promptSha256: string;
  initialTreeHash: string;
  runtimeFingerprint: string;
  modelFingerprint: string;
  quality: DocumentQualityDimension[];
  metrics: {
    totalDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    modelSwitches: number;
    retries: number;
    repairs: number;
  };
}

export interface DocumentBenchmarkVerdict {
  status: "passed" | "failed" | "blocked";
  comparable: boolean;
  reasons: string[];
  outputTokenReduction?: number;
  deltas?: Record<keyof DocumentBenchmarkSnapshot["metrics"], number>;
}

const mandatoryDimensions: DocumentQualityDimension["dimension"][] = ["completeness", "specificity", "traceability", "verification"];
const allDimensions: DocumentQualityDimension["dimension"][] = [...mandatoryDimensions, "unsupported-invention"];
const snapshotSchema = z.object({
  workflowStatus: z.enum(["succeeded", "failed"]),
  fixtureSha256: z.string().min(1), promptSha256: z.string().min(1), initialTreeHash: z.string().min(1), runtimeFingerprint: z.string().min(1), modelFingerprint: z.string().min(1),
  quality: z.array(z.object({ dimension: z.enum(allDimensions), status: z.enum(["pass", "fail", "review", "skipped"]), evidence: z.array(z.string()) }).strict()).superRefine((items, context) => {
    for (const dimension of allDimensions) if (items.filter((item) => item.dimension === dimension).length !== 1) context.addIssue({ code: "custom", message: `${dimension} must appear exactly once` });
  }),
  metrics: z.object({ totalDurationMs: z.number().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), modelSwitches: z.number().int().nonnegative(), retries: z.number().int().nonnegative(), repairs: z.number().int().nonnegative() }),
}).strict();

export function parseDocumentBenchmarkSnapshot(value: unknown): DocumentBenchmarkSnapshot {
  return snapshotSchema.parse(value);
}

export function benchmarkFingerprint(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function compareDocumentBenchmarks(before: DocumentBenchmarkSnapshot, after: DocumentBenchmarkSnapshot, minimumOutputTokenReduction = 0.2): DocumentBenchmarkVerdict {
  const reasons: string[] = [];
  for (const key of ["fixtureSha256", "promptSha256", "initialTreeHash", "runtimeFingerprint", "modelFingerprint"] as const) {
    if (before[key] !== after[key]) reasons.push(`${key} differs`);
  }
  if (reasons.length) return { status: "blocked", comparable: false, reasons };

  if (after.workflowStatus !== "succeeded") reasons.push(`candidate workflow is ${after.workflowStatus}, not succeeded`);

  const beforeQuality = new Map(before.quality.map((item) => [item.dimension, item.status]));
  const afterQuality = new Map(after.quality.map((item) => [item.dimension, item.status]));
  for (const dimension of mandatoryDimensions) {
    const prior = beforeQuality.get(dimension);
    const current = afterQuality.get(dimension);
    if (!prior || !current) reasons.push(`${dimension} dimension is missing`);
    else if (current !== "pass") reasons.push(`${dimension} is ${current}, not pass`);
    else if (prior === "pass" && current !== prior) reasons.push(`${dimension} regressed from ${prior} to ${current}`);
  }
  const unsupported = afterQuality.get("unsupported-invention");
  if (!unsupported) reasons.push("unsupported-invention dimension is missing");
  else if (unsupported === "fail") reasons.push("unsupported-invention failed");

  const reduction = before.metrics.outputTokens > 0 ? (before.metrics.outputTokens - after.metrics.outputTokens) / before.metrics.outputTokens : undefined;
  if (reduction === undefined) reasons.push("baseline outputTokens must be greater than zero");
  else if (reduction < minimumOutputTokenReduction) reasons.push(`output token reduction ${(reduction * 100).toFixed(2)}% is below ${(minimumOutputTokenReduction * 100).toFixed(2)}%`);

  const metricKeys = Object.keys(before.metrics) as Array<keyof DocumentBenchmarkSnapshot["metrics"]>;
  const deltas = Object.fromEntries(metricKeys.map((key) => [key, after.metrics[key] - before.metrics[key]])) as Record<keyof DocumentBenchmarkSnapshot["metrics"], number>;
  return { status: reasons.length ? "failed" : "passed", comparable: true, reasons, ...(reduction === undefined ? {} : { outputTokenReduction: reduction }), deltas };
}
