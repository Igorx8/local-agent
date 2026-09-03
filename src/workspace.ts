import { access } from "node:fs/promises";
import path from "node:path";
import { executeConfigured } from "./tools/executor.js";

export async function resolveWorkspace(start = "."): Promise<string> {
  const cwd = path.resolve(start); const result = await executeConfigured({ command: "git", args: ["rev-parse", "--show-toplevel"], required: true, timeoutMs: 10_000 }, { cwd });
  if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error(`${cwd} is not inside a Git workspace`); return path.resolve(result.stdout.trim());
}

export async function discoverHarnessConfig(workspace: string, requested: string | undefined, moduleDirectory: string, environment = process.env): Promise<string> {
  const candidates = [requested, environment.HARNESS_CONFIG, path.join(workspace, ".agent-harness", "harness.yaml"), path.join(workspace, "config", "harness.yaml"), path.resolve(moduleDirectory, "../config/harness.example.yaml"), path.resolve(moduleDirectory, "../../config/harness.example.yaml")].filter((value): value is string => Boolean(value)).map((value) => path.resolve(value));
  for (const candidate of [...new Set(candidates)]) try { await access(candidate); return candidate; } catch { /* try the next explicit discovery location */ }
  throw new Error(`no harness configuration found; run harness init or set HARNESS_CONFIG (checked ${candidates.join(", ")})`);
}
