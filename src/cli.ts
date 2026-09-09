#!/usr/bin/env node
import { Command } from "commander";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { readRun, requestManualHandoff, requestPause, resumeRun } from "./workflow/run.js";
import { loadModelRegistry, requireAlias } from "./models/registry.js";
import { mergeOpenCodeLocal, prepareLocalModels } from "./models/local-config.js";
import { readModelRuntime, runtimeAliases, smokeModel, startLocalModel, stopLocalModel } from "./models/control.js";
import { buildDashboardSnapshot } from "./telemetry/snapshot.js";
import { eventFile, readEvents } from "./telemetry/events.js";
import { watch } from "node:fs";
import { generateRunReport } from "./report/run-report.js";
import { discoverHarnessConfig, resolveWorkspace } from "./workspace.js";
import { continueConversation, readConversation } from "./conversation/service.js";
import { runGitRegressionAdapter } from "./verification/git-regression-adapter.js";
import { initializeProjectConfig, projectProfiles, type ProjectProfile } from "./project-profile.js";

async function resolveRunId(repository: string, requested?: string): Promise<string> {
  if (requested) return requested; const directory = path.join(path.resolve(repository), ".agent-harness", "runs"); const runs = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const latest = runs.at(-1); if (!latest) throw new Error(`no runs found in ${directory}`); return latest;
}

const program = new Command().name("harness").description("Local multi-agent engineering harness").version("0.1.0");
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
async function workspace(value = "."): Promise<string> { return resolveWorkspace(value); }
async function configuration(repository: string, requested?: string): Promise<string> { return discoverHarnessConfig(repository, requested, moduleDirectory); }
async function registryFile(requested?: string): Promise<string> { if (requested) return path.resolve(requested); const repository = await workspace(); return (await loadConfig(await configuration(repository))).modelRegistry; }
async function conversationalTurn(repository: string, prompt: string, config: Awaited<ReturnType<typeof loadConfig>>, conversationId?: string, newConversation = false, definitionOfDone?: string) {
  let activeRunId: string | undefined; let interrupts = 0; const controller = new AbortController(); const signal = () => { if (!activeRunId) return; interrupts++; if (interrupts === 1) { void requestPause(repository, activeRunId).then((file) => { process.stderr.write(`Graceful pause requested: ${file}\n`); controller.abort(new Error("cooperative pause requested")); }).catch((error) => process.stderr.write(`Pause request failed: ${error instanceof Error ? error.message : String(error)}\n`)); return; } process.stderr.write("Second interrupt received; exiting immediately with persisted state preserved.\n"); process.exit(130); }; process.on("SIGINT", signal);
  return continueConversation({ workspace: repository, prompt, config, conversationId, newConversation, definitionOfDone, signal: controller.signal, onRunCreated(runId) { activeRunId = runId; } }).finally(() => process.off("SIGINT", signal));
}

program.command("regression-proof").description("Run a configured test against repaired and defective checkpoints").argument("<command>").argument("[args...]").action(async (command, args) => { process.stdout.write(`${JSON.stringify(await runGitRegressionAdapter(process.cwd(), command, args))}\n`); });

program.command("doctor").description("Validate local runtime compatibility").option("-c, --config <file>", "configuration file").option("--json", "emit JSON").action(async (options) => {
  const repository = await workspace(); const report = await runDoctor(await loadConfig(await configuration(repository, options.config)));
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else for (const check of report.checks) process.stdout.write(`${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.detail}\n`);
  process.exitCode = report.ok ? 0 : report.checks.some((check) => ["opencode", "llama.cpp", "OpenCode health/API", "llama.cpp health"].includes(check.name) && check.status !== "pass") ? 4 : 3;
});

program.command("init").description("Create a safe project-local harness configuration").argument("[directory]", "target directory", ".").option("--profile <profile>", `project profile: ${projectProfiles.join("|")}`, "auto").action(async (directory, options) => {
  if (!projectProfiles.includes(options.profile as ProjectProfile)) throw new Error(`invalid project profile: ${options.profile}`);
  const root = path.resolve(directory); const target = path.join(root, "config");
  await mkdir(target, { recursive: true });
  const candidates = [path.resolve(moduleDirectory, "../config/harness.example.yaml"), path.resolve(moduleDirectory, "../../config/harness.example.yaml")];
  const source = await candidates.reduce<Promise<string>>(async (found, candidate) => {
    const prior = await found;
    if (prior) return prior;
    try { await access(candidate); return candidate; } catch { return ""; }
  }, Promise.resolve(""));
  if (!source) throw new Error("Packaged config/harness.example.yaml was not found");
  const { destination, detected } = await initializeProjectConfig(root, source, options.profile as ProjectProfile);
  process.stdout.write(`Created ${destination}\nProfile: ${detected.profile} (${detected.evidence.join(", ")})\nConfigured gates: ${Object.entries(detected.quality).filter(([, value]) => value).map(([name]) => name).join(", ") || "none; configure explicitly before implementation"}\n`);
});

program.command("run", { isDefault: true }).description("Execute in the current Git workspace").argument("[task]", "inline task description").option("--repo <path>", "target Git workspace", ".").option("--requirements <file>", "requirements Markdown file").option("-c, --config <file>", "configuration file").option("--new", "start a new workspace conversation").option("--definition-of-done <text>", "explicit definition of done").action(async (task, options) => {
  const repository = await workspace(options.repo); if (task && options.requirements) throw new Error("use either an inline task or --requirements, not both"); if (!task && !options.requirements) throw new Error("provide a task, for example: harness \"add validation and tests\""); const configFile = await configuration(repository, options.config);
  const prompt = task ?? await readFile(path.resolve(options.requirements), "utf8"); const result = await conversationalTurn(repository, prompt, await loadConfig(configFile), undefined, options.new, options.definitionOfDone); process.stdout.write(`${JSON.stringify({ conversationId: result.conversation.id, turn: result.conversation.turns.length, run: result.run }, null, 2)}\n`); process.exitCode = result.run.status === "succeeded" ? 0 : result.run.status === "escalated" ? 6 : 5;
});

program.command("continue").description("Execute one prompt in a persistent workspace conversation").argument("[words...]", "optional conversation ID followed by the prompt").option("--conversation <id>", "conversation ID").option("--repo <path>", "target Git workspace", ".").option("-c, --config <file>", "configuration file").option("--new", "start a new conversation").action(async (words: string[], options) => {
  const repository = await workspace(options.repo); const values = [...words]; let conversationId = options.conversation as string | undefined; if (!conversationId && values[0]?.startsWith("conv-") && values.length > 1) conversationId = values.shift(); const prompt = values.join(" ").trim(); if (!prompt) throw new Error("provide a prompt to continue the conversation"); const result = await conversationalTurn(repository, prompt, await loadConfig(await configuration(repository, options.config)), conversationId, options.new); process.stdout.write(`${JSON.stringify({ conversationId: result.conversation.id, turn: result.conversation.turns.length, run: result.run }, null, 2)}\n`); process.exitCode = result.run.status === "succeeded" ? 0 : result.run.status === "escalated" ? 6 : 5;
});

program.command("chat").description("Open an interactive persistent workspace conversation").argument("[conversation-id]").option("--repo <path>", "target Git workspace", ".").option("-c, --config <file>", "configuration file").option("--new", "start a new conversation").action(async (conversationId, options) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("harness chat requires a TTY; use harness continue for scripts"); const repository = await workspace(options.repo); const config = await loadConfig(await configuration(repository, options.config)); const terminal = createInterface({ input: process.stdin, output: process.stdout }); let selected = conversationId as string | undefined; let createNew = Boolean(options.new); process.stdout.write("Local Agent chat. Commands: /status, /memory, /exit\n");
  try { while (true) { const prompt = (await terminal.question("you> ")).trim(); if (!prompt) continue; if (prompt === "/exit") break; if (prompt === "/status" || prompt === "/memory") { const current = await readConversation(repository, selected); selected = current.state.id; process.stdout.write(`${JSON.stringify(prompt === "/status" ? current.state : current.memory, null, 2)}\n`); continue; } const result = await conversationalTurn(repository, prompt, config, selected, createNew); selected = result.conversation.id; createNew = false; process.stdout.write(`agent> turn ${result.conversation.turns.length} ${result.run.status}; conversation=${selected}; run=${result.run.runId}; worktree=${result.run.repositoryPath}\n`); } } finally { terminal.close(); }
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
  const repository = await workspace(options.repo); const controller = new AbortController(); let interrupts = 0; const interrupt = () => { interrupts++; if (interrupts === 1) { void requestPause(repository, runId).then((file) => { process.stderr.write(`Graceful pause requested: ${file}\n`); controller.abort(new Error("cooperative pause requested")); }).catch((error) => process.stderr.write(`Pause request failed: ${error instanceof Error ? error.message : String(error)}\n`)); return; } process.stderr.write("Second interrupt received; exiting immediately with persisted state preserved.\n"); process.exit(130); }; process.on("SIGINT", interrupt);
  try { const result = await resumeRun(repository, runId, controller.signal); process.stdout.write(`${JSON.stringify({ recovery: result.plan, state: result.state }, null, 2)}\n`); if (result.plan.disposition === "manual_reconciliation") process.exitCode = 7; else if (result.state.status !== "succeeded" && result.state.status !== "active") process.exitCode = result.state.status === "escalated" ? 6 : 5; } finally { process.off("SIGINT", interrupt); }
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
  const repository = await workspace(); const config = await loadConfig(await configuration(repository)); const registry = await loadModelRegistry(await registryFile(options.registry)); requireAlias(registry, alias); process.stdout.write(`${JSON.stringify(await startLocalModel(repository, registry, alias, undefined, config.runtime), null, 2)}\n`);
});
model.command("smoke").argument("<alias>").option("-r, --registry <file>", "registry").action(async (alias, options) => {
  const registry = await loadModelRegistry(await registryFile(options.registry)); const result = await smokeModel(registry, alias); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.completion || !result.toolCall) process.exitCode = 5;
});
model.command("stop").action(async () => { const repository = await workspace(); const config = await loadConfig(await configuration(repository)); await stopLocalModel(repository, config.runtime); process.stdout.write("Model stopped.\n"); });

program.parseAsync().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
