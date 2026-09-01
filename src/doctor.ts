import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { HarnessConfig } from "./config.js";
import { validateCommand } from "./tools/policy.js";

export type CheckStatus = "pass" | "warn" | "fail" | "blocked";
export interface DoctorCheck { name: string; status: CheckStatus; detail: string; }
export interface DoctorReport { ok: boolean; generatedAt: string; checks: DoctorCheck[]; }

async function command(name: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(name, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    child.on("error", (error) => resolve({ code: null, output: error.message }));
    child.on("close", (code) => resolve({ code, output: output.trim() }));
  });
}

async function endpoint(name: string, url: string): Promise<DoctorCheck> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { name, status: response.ok ? "pass" : "fail", detail: `${url} returned HTTP ${response.status}` };
  } catch (error) { return { name, status: "blocked", detail: `${url}: ${error instanceof Error ? error.message : String(error)}` }; }
}

async function fingerprint(alias: string, file: string): Promise<DoctorCheck> {
  try {
    await access(file);
    const info = await stat(file);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return { name: `model:${alias}`, status: "pass", detail: `${file}; ${info.size} bytes; sha256:${hash.digest("hex")}` };
  } catch (error) { return { name: `model:${alias}`, status: "fail", detail: `${file}: ${error instanceof Error ? error.message : String(error)}` }; }
}

export async function runDoctor(config: HarnessConfig): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  for (const [name, executable, args] of [["node", process.execPath, ["--version"]], ["git", "git", ["--version"]], ["opencode", "opencode", ["--version"]], ["llama.cpp", "llama-server", ["--version"]], ["nvidia", "nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"]]] as const) {
    const result = await command(executable, [...args]);
    const absentRuntime = name === "opencode" || name === "llama.cpp" || name === "nvidia";
    checks.push({ name, status: result.code === 0 ? "pass" : absentRuntime ? "blocked" : "fail", detail: result.output || `exit ${result.code}` });
  }
  checks.push(await endpoint("OpenCode health/API", config.runtime.opencodeUrl));
  checks.push(await endpoint("llama.cpp health", new URL("/health", config.runtime.llamaUrl).toString()));
  checks.push(...await Promise.all(Object.entries(config.modelFiles).map(([alias, file]) => fingerprint(alias, file))));
  try {
    for (const gate of Object.values(config.quality)) if (gate) validateCommand(gate);
    checks.push({ name: "repository command policy", status: "pass", detail: `${Object.values(config.quality).filter(Boolean).length} configured command(s) validated as executable + argv` });
  } catch (error) {
    checks.push({ name: "repository command policy", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
  checks.push({ name: "token usage visibility", status: "blocked", detail: "requires a compatible running OpenCode/llama.cpp request; no undocumented field assumed" });
  checks.push({ name: "router unload behavior", status: "blocked", detail: "requires configured models and a running llama.cpp router; no model was started by doctor" });
  return { ok: checks.every((check) => check.status === "pass" || check.status === "warn"), generatedAt: new Date().toISOString(), checks };
}
