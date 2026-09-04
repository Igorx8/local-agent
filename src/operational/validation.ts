import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeAtomic } from "../models/registry.js";
import { collectMachineMetrics, type MachineMetrics } from "../telemetry/machine.js";
import { readEvents } from "../telemetry/events.js";

export const operationalScenarioIds = ["multi_turn", "repair", "handoff", "pause_resume", "cold_start", "forced_interrupt", "endurance"] as const;
export const operationalScenarioIdSchema = z.enum(operationalScenarioIds);
const commandSchema = z.object({ id: operationalScenarioIdSchema, command: z.string().min(1), args: z.array(z.string()).default([]), cwd: z.string().min(1), timeoutMs: z.number().int().positive().default(3_600_000), expectedExitCodes: z.array(z.number().int()).min(1).default([0]), blockedExitCodes: z.array(z.number().int()).default([77]), maximumModelProcesses: z.number().int().positive().default(1), maximumSwapGrowthMiB: z.number().nonnegative().default(512) });
export const operationalManifestSchema = z.object({ schemaVersion: z.literal(1), output: z.string().min(1), sampleIntervalMs: z.number().int().min(500).default(2000), scenarios: z.array(commandSchema).min(1) });
export type OperationalManifest = z.infer<typeof operationalManifestSchema>;
export interface OperationalSample extends MachineMetrics { at: string; }
export interface OperationalScenarioResult { id: z.infer<typeof operationalScenarioIdSchema>; status: "passed" | "failed" | "blocked"; command: string; args: string[]; cwd: string; startedAt: string; completedAt: string; durationMs: number; exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; maximumModelProcesses: number; swapGrowthMiB: number; stageDurationsMs?: Record<string, number>; samples: OperationalSample[]; stdout: string; stderr: string; reason?: string; }
export interface OperationalReport { schemaVersion: 1; generatedAt: string; hostBootId?: string; scenarios: OperationalScenarioResult[]; summary: { passed: number; failed: number; blocked: number; }; }

async function bootId(): Promise<string | undefined> { try { return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(); } catch { return undefined; } }
function bounded(chunks: Buffer[]): string { const value = Buffer.concat(chunks); return value.subarray(Math.max(0, value.length - 1024 * 1024)).toString("utf8"); }
export function stageDurations(events: Array<{ timestamp: string; type: string; data?: Record<string, unknown> }>): Record<string, number> { const changes = events.filter((event) => event.type === "workflow.stage" && typeof event.data?.stage === "string"); const result: Record<string, number> = {}; for (let index = 0; index < changes.length - 1; index++) { const current = changes[index]!; const next = changes[index + 1]!; const elapsed = Date.parse(next.timestamp) - Date.parse(current.timestamp); if (Number.isFinite(elapsed) && elapsed >= 0) result[String(current.data!.stage)] = (result[String(current.data!.stage)] ?? 0) + elapsed; } return result; }
export function classifyOperationalScenario(input: { exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; maximumModelProcesses: number; swapGrowthMiB: number }, spec: Pick<z.infer<typeof commandSchema>, "expectedExitCodes" | "blockedExitCodes" | "maximumModelProcesses" | "maximumSwapGrowthMiB">): { status: OperationalScenarioResult["status"]; reason?: string } {
  if (input.exitCode !== null && spec.blockedExitCodes.includes(input.exitCode)) return { status: "blocked", reason: "scenario reported an unavailable runtime prerequisite" };
  if (input.timedOut) return { status: "failed", reason: "scenario timeout" };
  if (input.maximumModelProcesses > spec.maximumModelProcesses) return { status: "failed", reason: `observed ${input.maximumModelProcesses} simultaneous model processes` };
  if (input.swapGrowthMiB > spec.maximumSwapGrowthMiB) return { status: "failed", reason: `swap grew by ${input.swapGrowthMiB.toFixed(1)} MiB` };
  if (input.exitCode === null || !spec.expectedExitCodes.includes(input.exitCode)) return { status: "failed", reason: `unexpected exit code ${input.exitCode ?? input.signal ?? "unknown"}` };
  return { status: "passed" };
}

export async function executeOperationalScenario(spec: z.infer<typeof commandSchema>, sampleIntervalMs: number): Promise<OperationalScenarioResult> {
  const started = Date.now(); const samples: OperationalSample[] = []; const stdout: Buffer[] = []; const stderr: Buffer[] = []; let timedOut = false;
  const child = spawn(spec.command, spec.args, { cwd: path.resolve(spec.cwd), env: process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] }); child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk)); child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  const sample = async () => samples.push({ at: new Date().toISOString(), ...await collectMachineMetrics() }); await sample(); const interval = setInterval(() => void sample(), sampleIntervalMs); const timeout = setTimeout(() => { timedOut = true; child.kill("SIGINT"); }, spec.timeoutMs);
  const completion = await exited.finally(() => { clearInterval(interval); clearTimeout(timeout); }); await sample();
  const firstSwap = samples[0]?.swap.usedMiB ?? 0; const lastSwap = samples.at(-1)?.swap.usedMiB ?? firstSwap; const maximumModelProcesses = Math.max(0, ...samples.map((entry) => entry.modelProcessCount ?? 0)); const swapGrowthMiB = lastSwap - firstSwap; const classification = classifyOperationalScenario({ exitCode: completion.code, signal: completion.signal, timedOut, maximumModelProcesses, swapGrowthMiB }, spec);
  const stdoutText = bounded(stdout); const artifactPath = stdoutText.match(/"artifactPath"\s*:\s*"([^"]+)"/)?.[1]; const stageEvidence = artifactPath ? stageDurations(await readEvents(artifactPath, Number.MAX_SAFE_INTEGER)) : undefined;
  return { id: spec.id, status: classification.status, command: spec.command, args: spec.args, cwd: path.resolve(spec.cwd), startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - started, exitCode: completion.code, signal: completion.signal, timedOut, maximumModelProcesses, swapGrowthMiB, ...(stageEvidence ? { stageDurationsMs: stageEvidence } : {}), samples, stdout: stdoutText, stderr: bounded(stderr), ...(classification.reason ? { reason: classification.reason } : {}) };
}

export async function runOperationalManifest(input: unknown): Promise<OperationalReport> {
  const manifest = operationalManifestSchema.parse(input); const scenarios: OperationalScenarioResult[] = [];
  for (const scenario of manifest.scenarios) scenarios.push(await executeOperationalScenario(scenario, manifest.sampleIntervalMs));
  const report: OperationalReport = { schemaVersion: 1, generatedAt: new Date().toISOString(), hostBootId: await bootId(), scenarios, summary: { passed: scenarios.filter((item) => item.status === "passed").length, failed: scenarios.filter((item) => item.status === "failed").length, blocked: scenarios.filter((item) => item.status === "blocked").length } };
  await mkdir(path.dirname(path.resolve(manifest.output)), { recursive: true }); await writeAtomic(path.resolve(manifest.output), `${JSON.stringify(report, null, 2)}\n`); return report;
}
