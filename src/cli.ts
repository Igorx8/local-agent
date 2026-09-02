#!/usr/bin/env node
import { Command } from "commander";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { readRun, requestManualHandoff, startRun } from "./workflow/run.js";
import { loadModelRegistry, requireAlias } from "./models/registry.js";
import { mergeOpenCodeLocal, prepareLocalModels } from "./models/local-config.js";
import { readModelRuntime, runtimeAliases, smokeModel, startLocalModel, stopLocalModel } from "./models/control.js";

const program = new Command().name("harness").description("Local multi-agent engineering harness").version("0.1.0");

program.command("doctor").description("Validate local runtime compatibility").option("-c, --config <file>", "configuration file", "config/harness.yaml").option("--json", "emit JSON").action(async (options) => {
  const report = await runDoctor(await loadConfig(options.config));
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else for (const check of report.checks) process.stdout.write(`${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.detail}\n`);
  process.exitCode = report.ok ? 0 : report.checks.some((check) => ["opencode", "llama.cpp", "OpenCode health/API", "llama.cpp health"].includes(check.name) && check.status !== "pass") ? 4 : 3;
});

program.command("init").description("Create a safe project-local harness configuration").argument("[directory]", "target directory", ".").action(async (directory) => {
  const target = path.resolve(directory, "config");
  await mkdir(target, { recursive: true });
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
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

program.command("run").description("Execute the deterministic local engineering workflow").requiredOption("--repo <path>", "target Git repository").requiredOption("--requirements <file>", "requirements Markdown file").option("-c, --config <file>", "configuration file", "config/harness.yaml").option("--definition-of-done <text>", "explicit definition of done").action(async (options) => {
  const state = await startRun({ repository: options.repo, requirementsFile: options.requirements, config: await loadConfig(options.config), definitionOfDone: options.definitionOfDone });
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exitCode = state.status === "succeeded" ? 0 : state.status === "escalated" ? 6 : 5;
});

program.command("status").description("Read persisted run status").argument("<run-id>").option("--repo <path>", "target repository", ".").option("--json", "emit JSON").action(async (runId, options) => {
  const state = await readRun(options.repo, runId);
  if (options.json) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`); else process.stdout.write(`${state.runId} ${state.status} ${state.stage} repairs=${state.counters.repairIterations}\n`);
});

program.command("resume").description("Inspect a persisted run before recovery support is enabled").argument("<run-id>").option("--repo <path>", "target repository", ".").action(async (runId, options) => {
  const state = await readRun(options.repo, runId);
  if (state.status === "succeeded" || state.status === "failed" || state.status === "escalated") { process.stdout.write(`${JSON.stringify(state, null, 2)}\n`); return; }
  throw new Error(`run ${runId} stopped at ${state.stage}; editing-stage reconciliation is scheduled for Milestone 8 and automatic resume is refused safely`);
});

program.command("handoff").description("Request a safe handoff at the next model-action boundary").argument("<run-id>").option("--repo <path>", "target repository", ".").action(async (runId, options) => {
  const request = await requestManualHandoff(options.repo, runId); process.stdout.write(`Handoff requested: ${request}\n`);
});

const model = program.command("model").description("Inspect and control registered local models");
model.command("prepare").description("Generate ignored local model configuration").option("--no-fingerprint", "skip SHA-256 calculation").action(async (options) => {
  const cacheRoot = process.env.HF_HOME ? path.join(process.env.HF_HOME, "hub") : path.join(process.env.HOME ?? "", ".cache", "huggingface", "hub");
  await prepareLocalModels({ exampleFile: "config/models.example.yaml", registryFile: "config/models.local.yaml", presetFile: "config/models.local.ini", cacheRoot, fingerprint: options.fingerprint });
  await mergeOpenCodeLocal("config/opencode.example.json", "config/opencode.local.json"); process.stdout.write("Generated local model registry, router preset, and OpenCode mapping.\n");
});
model.command("list").description("List exact registry aliases").option("-r, --registry <file>", "registry", "config/models.local.yaml").action(async (options) => {
  const registry = await loadModelRegistry(options.registry); for (const [alias, entry] of Object.entries(registry.models)) process.stdout.write(`${alias}\t${entry.hfRef}\t${entry.roles.join(",")}\n`);
});
model.command("status").description("Show managed process and advertised aliases").option("-r, --registry <file>", "registry", "config/models.local.yaml").action(async (options) => {
  const registry = await loadModelRegistry(options.registry); process.stdout.write(`${JSON.stringify({ process: await readModelRuntime(process.cwd()), aliases: await runtimeAliases(registry).catch(() => []) }, null, 2)}\n`);
});
for (const operation of ["start", "switch"] as const) model.command(operation).argument("<alias>").option("-r, --registry <file>", "registry", "config/models.local.yaml").action(async (alias, options) => {
  const registry = await loadModelRegistry(options.registry); requireAlias(registry, alias); process.stdout.write(`${JSON.stringify(await startLocalModel(process.cwd(), registry, alias), null, 2)}\n`);
});
model.command("smoke").argument("<alias>").option("-r, --registry <file>", "registry", "config/models.local.yaml").action(async (alias, options) => {
  const registry = await loadModelRegistry(options.registry); const result = await smokeModel(registry, alias); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.completion || !result.toolCall) process.exitCode = 5;
});
model.command("stop").action(async () => { await stopLocalModel(process.cwd()); process.stdout.write("Model stopped.\n"); });

program.parseAsync().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
