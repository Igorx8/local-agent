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
import { parseProgressMode, ProgressReporter, type ProgressMode } from "./telemetry/progress.js";
import { ensureOpencodeService } from "./opencode/service.js";
import { completeSlash, parseSlashCommand, shellHelp } from "./interactive/commands.js";
import { readShellHistory, writeShellHistory } from "./interactive/history.js";
import { redact } from "./telemetry/redact.js";
import { inspectRepository } from "./git/workspace.js";

async function resolveRunId(repository: string, requested?: string): Promise<string> {
  if (requested) return requested; const directory = path.join(path.resolve(repository), ".agent-harness", "runs"); const runs = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const latest = runs.at(-1); if (!latest) throw new Error(`no runs found in ${directory}`); return latest;
}

const program = new Command().name("harness").description("Local multi-agent engineering harness").version("0.1.0");
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
async function workspace(value = "."): Promise<string> { return resolveWorkspace(value); }
async function configuration(repository: string, requested?: string): Promise<string> { return discoverHarnessConfig(repository, requested, moduleDirectory); }
async function registryFile(requested?: string): Promise<string> { if (requested) return path.resolve(requested); const repository = await workspace(); return (await loadConfig(await configuration(repository))).modelRegistry; }
async function conversationalTurn(repository: string, prompt: string, config: Awaited<ReturnType<typeof loadConfig>>, conversationId?: string, newConversation = false, definitionOfDone?: string, progressMode: ProgressMode = "human") {
  let activeRunId: string | undefined; let interrupts = 0; const controller = new AbortController(); const signal = () => { if (!activeRunId) return; interrupts++; if (interrupts === 1) { void requestPause(repository, activeRunId).then((file) => { process.stderr.write(`Graceful pause requested: ${file}\n`); controller.abort(new Error("cooperative pause requested")); }).catch((error) => process.stderr.write(`Pause request failed: ${error instanceof Error ? error.message : String(error)}\n`)); return; } process.stderr.write("Second interrupt received; exiting immediately with persisted state preserved.\n"); process.exit(130); }; process.on("SIGINT", signal);
  let reporter: ProgressReporter | undefined;
  try { return await continueConversation({ workspace: repository, prompt, config, conversationId, newConversation, definitionOfDone, signal: controller.signal, onRunCreated(runId, repositoryPath, artifactPath) { activeRunId = runId; reporter = new ProgressReporter({ runId, repositoryPath, artifactPath }, progressMode, progressMode === "jsonl" ? process.stdout : process.stderr); reporter.start(); } }); }
  finally { await reporter?.stop(); process.off("SIGINT", signal); }
}

function writeTurnResult(result: Awaited<ReturnType<typeof conversationalTurn>>, mode: ProgressMode): void { const value = { conversationId: result.conversation.id, turn: result.conversation.turns.length, run: result.run }; process.stdout.write(`${JSON.stringify(mode === "jsonl" ? { type: "run.result", ...value } : value, null, mode === "jsonl" ? undefined : 2)}\n`); }

async function optionalRun(repository: string, requested?: string) { try { return await readRun(repository, await resolveRunId(repository, requested)); } catch { return undefined; } }
async function interactiveShell(repository: string, config: Awaited<ReturnType<typeof loadConfig>>, requestedConversation?: string, forceNew = false): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("local-agent requires a TTY; use harness continue for scripts");
  const history = await readShellHistory(repository); const service = await ensureOpencodeService({ baseUrl: config.runtime.opencodeUrl }); const terminal = createInterface({ input: process.stdin, output: process.stdout, completer: completeSlash, history: [...history].reverse(), historySize: 100 }); let selected = requestedConversation; let createNew = forceNew;
  const remember = async (value: string) => { const safe = redact(value, [process.env[config.apiKeyEnv] ?? ""], config.security.redactPatterns); history.push(String(safe)); await writeShellHistory(repository, history); };
  process.stdout.write(`Local Agent — ${repository}\nOpenCode: ${service.owned ? "started for this shell" : "reusing healthy service"} (${service.url})\nType /help for commands. Plain text starts a workflow turn.\n`);
  try {
    while (true) {
      const input = (await terminal.question("you> ")).trim(); if (!input) continue; await remember(input); let command;
      try { command = parseSlashCommand(input); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); continue; }
      if (!command) { try { const result = await conversationalTurn(repository, input, config, selected, createNew); selected = result.conversation.id; createNew = false; process.stdout.write(`agent> turn=${result.conversation.turns.length} status=${result.run.status} conversation=${selected} run=${result.run.runId} commit=${result.run.checkpoints.at(-1)?.commit ?? "none"}\n`); } catch (error) { process.stderr.write(`turn failed: ${error instanceof Error ? error.message : String(error)}\n`); } continue; }
      try {
        if (command.name === "help") process.stdout.write(`${shellHelp}\n`);
        else if (command.name === "clear") process.stdout.write("\u001Bc");
        else if (command.name === "new") { selected = undefined; createNew = true; process.stdout.write("A new conversation will be created by the next prompt.\n"); }
        else if (command.name === "status") { const conversation = await readConversation(repository, selected).catch(() => undefined); const run = await optionalRun(repository, conversation?.state.activeRunId); process.stdout.write(`${JSON.stringify({ conversation: conversation ? { id: conversation.state.id, status: conversation.state.status, turns: conversation.state.turns.length, activeRunId: conversation.state.activeRunId } : null, run: run ? { runId: run.runId, stage: run.stage, status: run.status, model: run.activeModel, counters: run.counters } : null }, null, 2)}\n`); }
        else if (command.name === "memory") { const current = await readConversation(repository, selected); selected = current.state.id; process.stdout.write(`${JSON.stringify({ conversationId: selected, compactedTurns: current.memory.compacted.length, recent: current.memory.recent.map(({ sequence, runId, status, baseCommit, finalCommit, summary, artifacts, references }) => ({ sequence, runId, status, baseCommit, finalCommit, summary, artifacts, references })) }, null, 2)}\n`); }
        else if (command.name === "files") { const current = await readConversation(repository, selected); selected = current.state.id; process.stdout.write(`${JSON.stringify(current.memory.recent.map((turn) => ({ sequence: turn.sequence, runId: turn.runId, references: turn.references })), null, 2)}\n`); }
        else if (command.name === "worktree") { const run = await optionalRun(repository); if (!run) throw new Error("no run found"); const identity = await inspectRepository(run.repositoryPath); process.stdout.write(`${JSON.stringify({ runId: run.runId, worktree: run.repositoryPath, branch: identity.branch, commit: identity.commit, dirty: identity.dirty }, null, 2)}\n`); }
        else if (command.name === "model") { const registry = await loadModelRegistry(config.modelRegistry); process.stdout.write(`${JSON.stringify({ process: await readModelRuntime(repository), aliases: await runtimeAliases(registry).catch(() => []) }, null, 2)}\n`); }
        else if (command.name === "doctor") { const report = await runDoctor(config); for (const check of report.checks) process.stdout.write(`${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.detail}\n`); }
        else if (command.name === "report") { const run = await optionalRun(repository, command.args[0]); if (!run) throw new Error("no run found"); const report = await generateRunReport(run); process.stdout.write(`Report written for ${report.runId}: ${report.status} at ${report.stage}; artifacts=${report.artifacts.length}\n`); }
        else if (command.name === "pause") { const run = await optionalRun(repository, command.args[0]); if (!run) throw new Error("no run found"); process.stdout.write(`Graceful pause requested: ${await requestPause(repository, run.runId)}\n`); }
        else if (command.name === "handoff") { const run = await optionalRun(repository, command.args[0]); if (!run) throw new Error("no run found"); process.stdout.write(`Handoff requested: ${await requestManualHandoff(repository, run.runId)}\n`); }
        else if (command.name === "resume") { const run = await optionalRun(repository, command.args[0]); if (!run) throw new Error("no run found"); const reporter = new ProgressReporter({ runId: run.runId, repositoryPath: run.repositoryPath, artifactPath: run.artifactPath }, "human", process.stderr); reporter.start(); try { const result = await resumeRun(repository, run.runId); process.stdout.write(`Resume ${result.state.status}: run=${result.state.runId} stage=${result.state.stage}\n`); } finally { await reporter.stop(); } }
        else if (command.name === "exit") { const current = await readConversation(repository, selected).catch(() => undefined); if (current?.state.activeRunId) { const run = await optionalRun(repository, current.state.activeRunId); if (run?.status === "active") { process.stderr.write(`Run ${run.runId} is active; use /pause and wait for cleanup before /exit.\n`); continue; } } break; }
      } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); }
    }
  } finally { terminal.close(); await stopLocalModel(repository, config.runtime).catch((error) => process.stderr.write(`Model cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`)); await service.close(); }
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

program.command("run", { isDefault: true }).description("Execute in the current Git workspace").argument("[task]", "inline task description").option("--repo <path>", "target Git workspace", ".").option("--requirements <file>", "requirements Markdown file").option("-c, --config <file>", "configuration file").option("--new", "start a new workspace conversation").option("--definition-of-done <text>", "explicit definition of done").option("--follow", "emit live progress (enabled by default)").option("--progress <mode>", "human, jsonl, or off", "human").action(async (task, options) => {
  const repository = await workspace(options.repo); if (task && options.requirements) throw new Error("use either an inline task or --requirements, not both"); if (!task && !options.requirements) throw new Error("provide a task, for example: harness \"add validation and tests\""); const configFile = await configuration(repository, options.config);
  const mode = parseProgressMode(options.follow ? "human" : options.progress); const prompt = task ?? await readFile(path.resolve(options.requirements), "utf8"); const result = await conversationalTurn(repository, prompt, await loadConfig(configFile), undefined, options.new, options.definitionOfDone, mode); writeTurnResult(result, mode); process.exitCode = result.run.status === "succeeded" ? 0 : result.run.status === "escalated" ? 6 : 5;
});

program.command("continue").description("Execute one prompt in a persistent workspace conversation").argument("[words...]", "optional conversation ID followed by the prompt").option("--conversation <id>", "conversation ID").option("--repo <path>", "target Git workspace", ".").option("-c, --config <file>", "configuration file").option("--new", "start a new conversation").option("--follow", "emit live progress (enabled by default)").option("--progress <mode>", "human, jsonl, or off", "human").action(async (words: string[], options) => {
  const repository = await workspace(options.repo); const values = [...words]; let conversationId = options.conversation as string | undefined; if (!conversationId && values[0]?.startsWith("conv-") && values.length > 1) conversationId = values.shift(); const prompt = values.join(" ").trim(); if (!prompt) throw new Error("provide a prompt to continue the conversation"); const mode = parseProgressMode(options.follow ? "human" : options.progress); const result = await conversationalTurn(repository, prompt, await loadConfig(await configuration(repository, options.config)), conversationId, options.new, undefined, mode); writeTurnResult(result, mode); process.exitCode = result.run.status === "succeeded" ? 0 : result.run.status === "escalated" ? 6 : 5;
});

program.command("shell").description("Open the Claude-like interactive local-agent shell").argument("[conversation-id]").option("--repo <path>", "target Git workspace", ".").option("-c, --config <file>", "configuration file").option("--new", "start a new conversation on the first prompt").action(async (conversationId, options) => { const repository = await workspace(options.repo); await interactiveShell(repository, await loadConfig(await configuration(repository, options.config)), conversationId, options.new); });

program.command("chat").description("Open an interactive persistent workspace conversation").argument("[conversation-id]").option("--repo <path>", "target Git workspace", ".").option("-c, --config <file>", "configuration file").option("--new", "start a new conversation").action(async (conversationId, options) => {
  const repository = await workspace(options.repo); await interactiveShell(repository, await loadConfig(await configuration(repository, options.config)), conversationId, options.new);
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

program.command("resume").description("Reconcile an interrupted run without discarding work").argument("<run-id>").option("--repo <path>", "target repository", ".").option("--follow", "emit live progress (enabled by default)").option("--progress <mode>", "human, jsonl, or off", "human").action(async (runId, options) => {
  const repository = await workspace(options.repo); const existing = await readRun(repository, runId); const mode = parseProgressMode(options.follow ? "human" : options.progress); const reporter = new ProgressReporter({ runId, repositoryPath: existing.repositoryPath, artifactPath: existing.artifactPath }, mode, mode === "jsonl" ? process.stdout : process.stderr); reporter.start(); const controller = new AbortController(); let interrupts = 0; const interrupt = () => { interrupts++; if (interrupts === 1) { void requestPause(repository, runId).then((file) => { process.stderr.write(`Graceful pause requested: ${file}\n`); controller.abort(new Error("cooperative pause requested")); }).catch((error) => process.stderr.write(`Pause request failed: ${error instanceof Error ? error.message : String(error)}\n`)); return; } process.stderr.write("Second interrupt received; exiting immediately with persisted state preserved.\n"); process.exit(130); }; process.on("SIGINT", interrupt);
  try { const result = await resumeRun(repository, runId, controller.signal); const value = { recovery: result.plan, state: result.state }; process.stdout.write(`${JSON.stringify(mode === "jsonl" ? { type: "run.result", ...value } : value, null, mode === "jsonl" ? undefined : 2)}\n`); if (result.plan.disposition === "manual_reconciliation") process.exitCode = 7; else if (result.state.status !== "succeeded" && result.state.status !== "active") process.exitCode = result.state.status === "escalated" ? 6 : 5; } finally { await reporter.stop(); process.off("SIGINT", interrupt); }
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
