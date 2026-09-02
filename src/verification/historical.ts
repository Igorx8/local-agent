import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AdvancedVerificationResult } from "./types.js";

export interface HistoricalMetric { schemaVersion: 1; recordedAt: string; runId: string; repository: string; success: boolean; firstPassGateSuccess: boolean; repairIterations: number; confirmedFindings: number; invalidFindings: number; regressions: number; testProvenance: Record<string, number>; mutationScore: number | null; flakyIncidents: number; durationMs: number; }
export async function appendHistoricalMetric(file: string, metric: HistoricalMetric): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await appendFile(file, `${JSON.stringify(metric)}\n`, { mode: 0o600 }); }
export function verificationProvenance(result: AdvancedVerificationResult): Record<string, number> { const values = [...result.adversarial.tests, ...result.property.tests]; return values.reduce<Record<string, number>>((counts, test) => { counts[test.provenance] = (counts[test.provenance] ?? 0) + 1; return counts; }, {}); }
