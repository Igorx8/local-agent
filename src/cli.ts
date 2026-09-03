#!/usr/bin/env node
import { Command } from "commander";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { readRun, requestManualHandoff, requestPause, resumeRun, startRun } from "./workflow/run.js";
import { loadModelRegistry, requireAlias } from "./models/registry.js";
import { mergeOpenCodeLocal, prepareLocalModels } from "./models/local-config.js";
import { readModelRuntime, runtimeAliases, smokeModel, startLocalModel, stopLocalModel } from "./models/control.js";
import { buildDashboardSnapshot } from "./telemetry/snapshot.js";
import { eventFile, readEvents } from "./telemetry/events.js";
import { watch } from "node:fs";
import { generateRunReport } from "./report/run-report.js";
import { discoverHarnessConfig, resolveWorkspace } from "./workspace.js";

async function resolveRunId(repository: string, requested?: string): Promise<string> {
  if (requested) return requested; const directory = path.join(path.resolve(repository), ".agent-harness", "runs"); const runs = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const latest = runs.at(-1); if (!latest) throw new Error(`no runs found in ${directory}`); return latest;
}

const program = new Command().name("harness").description("Local multi-agent engineering harness").version("0.1.0");
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
async function workspace(value = "."): Promise<string> { return resolveWorkspace(value); }
async function configuration(repository: string, requested?: string): Promise<string> { return discoverHarnessConfig(repository, requested, moduleDirectory); }
async function registryFile(requested?: string): Promise<string> { if (requested) return path.resolve(requested); const repository = await workspace(); return (await loadConfig(await configuration(repository))).modelRegistry; }

program.command("doctor").description("Validate local runtime compatibility").option("-c, --config <file>", "configuration file").option("--json", "emit JSON").action(async (options) => {
  const repository = await workspace(); const report = await runDoctor(await loadConfig(await configuration(repository, options.config)));
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else for (const check of report.checks) process.stdout.write(`${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.detail}\n`);
  process.exitCode = report.ok ? 0 : report.checks.some((check) => ["opencode", "llama.cpp", "OpenCode health/API", "llama.cpp health"].includes(check.name) && check.status !== "pass") ? 4 : 3;
});

program.command("init").description("Create a safe project-local harness configuration").argument("[directory]", "target directory", ".").action(async (directory) => {
  const target = path.resolve(directory, "config");
  await mkdir(target, { recursive: true });
  const candidates = [path.resolve(moduleDirectory, "../config/harness.example.yaml"), path.resolve(moduleDirectory, "../../config/harness.example.yaml")];
  const source = await candidates.reduce<Promise<string>>(async (found, candidate) => {
    const prior = await found;
    if (prior) return prior;
    try { await access(candidate); return candidate; } catch { return ""; }
  }, Promise.resolve(""));
  if (!source) throw new Error("Packaged config/harness.example.yaml was not found");
  const destination = path.join(target, "harness.yaml");
  const { readFile } = await import("node:fs/promises");
  await writeFile(destination, await readFile(source), { flag: "wx", mode: 0o600 });
  process.stdout.write(`Created ${destination}\n`);
});

program.command("run", { isDefault: true }).description("Execute in the current Git workspace").argument("[task]", "inline task description").option("--repo <path>", "target Git workspace", ".").option("--requirements <file>", "requirements Markdown file").option("-c, --config <file>", "configuration file").option("--definition-of-done <text>", "explicit definition of done").action(async (task, options) => {
  const repository = await workspace(options.repo); if (task && options.requirements) throw new Error("use either an inline task or --requirements, not both"); if (!task && !options.requirements) throw new Error("provide a task, for example: harness \"add validation and tests\""); const configFile = await configuration(repository, options.config);
  let activeRunId: string | undefined; let interrupts = 0; const signal = () => { if (!activeRunId) return; interrupts++; if (interrupts === 1) { void requestPause(repository, activeRunId).then((file) => process.stderr.write(`Graceful pause requested: ${file}\n`)).catch((error) => process.stderr.write(`Pause request failed: ${error instanceof Error ? error.message : String(error)}\n`)); return; } process.stderr.write("Second interrupt received; exiting immediately with persisted state preserved.\n"); process.exit(130); }; process.on("SIGINT", signal);
  const state = await startRun({ repository, requirementsFile: options.requirements, requirements: task, config: await loadConfig(configFile), definitionOfDone: options.definitionOfDone, onCreated(runId) { activeRunId = runId; } }).finally(() => process.off("SIGINT", signal));
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exitCode = state.status === "succeeded" ? 0 : state.status === "escalated" ? 6 : 5;
});

program.command("status").description("Show the persisted observational dashboard").argument("[run-id]").option("--repo <path>", "target repository", ".").option("--json", "emit JSON").option("--no-tui", "emit one structured JSON line").action(async (requestedRunId, options) => {
  const repository = await workspace(options.repo); const runId = await resolveRunId(repository, requestedRunId); const state = await readRun(repository, runId); const snapshot = await buildDashboardSnapshot(state, repository);
  if (options.json) { process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`); return; }
  if (!options.tui || !process.stdout.isTTY) { process.stdout.write(`${JSON.stringify({ type: "status.snapshot", ...snapshot })}\n`); return; }
  try { const { renderDashboard } = await import("./ui/dashboard.js"); await renderDashboard(snapshot); } catch (error) { process.stderr.write(`dashboard unavailable: ${error instanceof Error ? error.message : String(error)}\n`); process.stdout.write(`${JSON.stringify({ type: "status.snapshot", ...snapshot })}\n`); }
});

program.command("logs").description("Read the bounded run event stream").argument("<run-id>").option("--repo <path>", "target repository", ".").option("--follow", "continue streaming new events").action(async (runId, options) => {
  const state = await readRun(await workspace(options.repo), runId); let emitted = 0;
  const flush = async () => { const events = await readEvents(state.artifactPath, Number.MAX_SAFE_INTEGER); for (const event of events.slice(emitted)) process.stdout.write(`${JSON.stringify(event)}\n`); emitted = events.length; };
  await flush(); if (!options.follow) return;
  await new Promise<void>((resolve, reject) => { const observer = watch(state.artifactPath, (_event, filename) => { if (!filename || path.resolve(state.artifactPath, filename) === eventFile(state.artifactPath)) void flush().catch(reject); }); const stop = () => { observer.close(); resolve(); }; process.once("SIGINT", stop); process.once("SIGTERM", stop); observer.once("error", reject); });
});

program.command("resume").description("Reconcile an interrupted run without discarding work").argument("<run-id>").option("--repo <path>", "target repository", ".").action(async (runId, options) => {
  const result = await resumeRun(await workspace(options.repo), runId); process.stdout.write(`${JSON.stringify({ recovery: result.plan, state: result.state }, null, 2)}\n`); if (result.plan.disposition === "manual_reconciliation") process.exitCode = 7; else if (result.state.status !== "succeeded" && result.state.status !== "active") process.exitCode = result.state.status === "escalated" ? 6 : 5;
});

program.command("abort").description("Pause a run and preserve all recovery material").argument("<run-id>").option("--repo <path>", "target repository", ".").action(async (runId, options) => {
  const request = await requestPause(await workspace(options.repo), runId); process.stdout.write(`Graceful pause requested: ${request}\n`);
});

program.command("report").description("Generate a reproducible report for a run").argument("<run-id>").option("--repo <path>", "target repository", ".").option("--json", "emit report JSON").action(async (runId, options) => {
  const report = await generateRunReport(await readRun(await workspace(options.repo), runId)); if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); else process.stdout.write(`Report written for ${report.runId}: ${report.status} at ${report.stage}; artifacts=${report.artifacts.length}\n`);
});

program.command("handoff").description("Request a safe handoff at the next model-action boundary").argument("<run-id>").option("--repo <path>", "target repository", ".").action(async (runId, options) => {
  const request = await requestManualHandoff(await workspace(options.repo), runId); process.stdout.write(`Handoff requested: ${request}\n`);
});

const model = program.command("model").description("Inspect and control registered local models");
model.command("prepare").description("Generate ignored local model configuration").option("--no-fingerprint", "skip SHA-256 calculation").action(async (options) => {
  const cacheRoot = process.env.HF_HOME ? path.join(process.env.HF_HOME, "hub") : path.join(process.env.HOME ?? "", ".cache", "huggingface", "hub");
  await prepareLocalModels({ exampleFile: "config/models.example.yaml", registryFile: "config/models.local.yaml", presetFile: "config/models.local.ini", cacheRoot, fingerprint: options.fingerprint });
  await mergeOpenCodeLocal("config/opencode.example.json", "config/opencode.local.json"); process.stdout.write("Generated local model registry, router preset, and OpenCode mapping.\n");
});
model.command("list").description("List exact registry aliases").option("-r, --registry <file>", "registry").action(async (options) => {
  const registry = await loadModelRegistry(await registryFile(options.registry)); for (const [alias, entry] of Object.entries(registry.models)) process.stdout.write(`${alias}\t${entry.hfRef}\t${entry.roles.join(",")}\n`);
});
model.command("status").description("Show managed process and advertised aliases").option("-r, --registry <file>", "registry").action(async (options) => {
  const repository = await workspace(); const registry = await loadModelRegistry(await registryFile(options.registry)); process.stdout.write(`${JSON.stringify({ process: await readModelRuntime(repository), aliases: await runtimeAliases(registry).catch(() => []) }, null, 2)}\n`);
});
for (const operation of ["start", "switch"] as const) model.command(operation).argument("<alias>").option("-r, --registry <file>", "registry").action(async (alias, options) => {
  const repository = await workspace(); const registry = await loadModelRegistry(await registryFile(options.registry)); requireAlias(registry, alias); process.stdout.write(`${JSON.stringify(await startLocalModel(repository, registry, alias), null, 2)}\n`);
});
model.command("smoke").argument("<alias>").option("-r, --registry <file>", "registry").action(async (alias, options) => {
  const registry = await loadModelRegistry(await registryFile(options.registry)); const result = await smokeModel(registry, alias); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.completion || !result.toolCall) process.exitCode = 5;
});
model.command("stop").action(async () => { await stopLocalModel(await workspace()); process.stdout.write("Model stopped.\n"); });

program.parseAsync().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
