#!/usr/bin/env node
import { Command } from "commander";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";

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

program.parseAsync().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
