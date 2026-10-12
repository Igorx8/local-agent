import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { HarnessConfig } from "./config.js";
import { validateCommand } from "./tools/policy.js";
import { loadModelRegistry, resolveCachedArtifact } from "./models/registry.js";
import { requiredServerFlags, unsupportedFlags } from "./models/profiles.js";
import { createModelManager } from "./models/manager.js";
import { runtimeAliases, smokeModel } from "./models/control.js";
import type { ModelRegistry } from "./models/registry.js";

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

export async function runDoctor(config: HarnessConfig, options: { live?: boolean } = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  let registry: ModelRegistry | undefined;
  for (const [name, executable, args] of [["node", process.execPath, ["--version"]], ["git", "git", ["--version"]], ["opencode", "opencode", ["--version"]], ["llama.cpp", "llama-server", ["--version"]], ["nvidia", "nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"]]] as const) {
    const result = await command(executable, [...args]);
    const absentRuntime = name === "opencode" || name === "llama.cpp" || name === "nvidia";
    checks.push({ name, status: result.code === 0 ? "pass" : absentRuntime ? "blocked" : "fail", detail: result.output || `exit ${result.code}` });
  }
  checks.push(await endpoint("OpenCode health/API", config.runtime.opencodeUrl));
  const llamaHealth = await endpoint("llama.cpp health", new URL("/health", config.runtime.llamaUrl).toString());
  checks.push(options.live && llamaHealth.status === "blocked" ? { ...llamaHealth, status: "warn", detail: `${llamaHealth.detail}; no model was preloaded, live validation will start one` } : llamaHealth);
  checks.push(...await Promise.all(Object.entries(config.modelFiles).map(([alias, file]) => fingerprint(alias, file))));
  try {
    registry = await loadModelRegistry(config.modelRegistry);
    checks.push({ name: "model registry", status: "pass", detail: `${Object.keys(registry.models).length} exact aliases; provider ${registry.providerId}; credential ${registry.apiKeyEnv}` });
    const cacheRoot = process.env.HF_HOME ? `${process.env.HF_HOME}/hub` : `${process.env.HOME}/.cache/huggingface/hub`;
    for (const [alias, model] of Object.entries(registry.models)) {
      try {
        const artifact = await resolveCachedArtifact(alias, model, cacheRoot, false);
        checks.push({ name: `model:${alias}`, status: "pass", detail: `${model.hfRef}; ${artifact.paths.join(", ")}; ${artifact.bytes.join("+")} bytes` });
      } catch (error) { checks.push({ name: `model:${alias}`, status: "fail", detail: error instanceof Error ? error.message : String(error) }); }
    }
  } catch (error) { checks.push({ name: "model registry", status: "fail", detail: error instanceof Error ? error.message : String(error) }); }
  const llamaServeHelp = await command("llama", ["serve", "--help"]);
  const rawServerHelp = await command("llama-server", ["--help"]);
  for (const [name, result] of [["llama serve flags", llamaServeHelp], ["llama-server flags", rawServerHelp]] as const) {
    if (result.code !== 0) checks.push({ name, status: name.startsWith("llama serve") ? "fail" : "warn", detail: result.output || "entry point unavailable" });
    else { const missing = unsupportedFlags(result.output); checks.push({ name, status: missing.length ? "fail" : "pass", detail: missing.length ? `unsupported required flags: ${missing.join(", ")}` : `${requiredServerFlags.length} required flags supported` }); }
  }
  try {
    for (const gate of Object.values(config.quality)) if (gate) validateCommand(gate);
    for (const adapter of Object.values(config.verification.commands)) if (adapter) validateCommand(adapter);
    checks.push({ name: "repository command policy", status: "pass", detail: `${Object.values(config.quality).filter(Boolean).length} configured command(s) validated as executable + argv` });
  } catch (error) {
    checks.push({ name: "repository command policy", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
  for (const kind of ["adversarial", "property", "mutation", "flaky", "regression"] as const) checks.push({ name: `${kind} verification adapter`, status: config.verification.commands[kind] ? "pass" : "warn", detail: config.verification.commands[kind] ? "configured as executable + argv" : kind === "regression" ? "not configured; testable confirmed findings will fail closed" : "not configured; capability will be reported as skipped, never assumed" });
  if (!options.live) {
    checks.push({ name: "token usage visibility", status: "blocked", detail: "requires --live; normal doctor never starts a model" });
    checks.push({ name: "model unload/switch behavior", status: "blocked", detail: "requires --live; normal doctor never starts or stops a model" });
  } else if (!registry) {
    checks.push({ name: "token usage visibility", status: "fail", detail: "model registry is unavailable" });
    checks.push({ name: "model unload/switch behavior", status: "fail", detail: "model registry is unavailable" });
  } else {
    const aliases = Object.keys(registry.models); const observed: string[] = []; let tokenUsage = true; const manager = createModelManager(config, { registry, router: {}, process: {} });
    try {
      const active = await runtimeAliases(registry).catch((): string[] => []);
      if (active.length) throw new Error(`refusing live validation while endpoint already advertises: ${active.join(", ")}`);
      for (const alias of aliases) {
        await manager.ensureModel(alias); const advertised = await runtimeAliases(registry);
        if (advertised.length !== 1 || advertised[0] !== alias) throw new Error(`expected only ${alias}, observed ${advertised.join(", ") || "none"}`);
        const smoke = await smokeModel(registry, alias); if (!smoke.completion || !smoke.toolCall) throw new Error(`${alias} failed completion/tool-call smoke`);
        tokenUsage &&= smoke.tokenUsage; observed.push(alias);
      }
      await manager.stop();
      const remaining = await runtimeAliases(registry).catch((): string[] => []);
      if (remaining.length) throw new Error(`model endpoint still advertises after stop: ${remaining.join(", ")}`);
      checks.push({ name: "token usage visibility", status: tokenUsage ? "pass" : "fail", detail: tokenUsage ? `prompt, completion, and total token counts verified for ${observed.join(", ")}` : "one or more smoke responses omitted exact compatible token counts" });
      checks.push({ name: "model unload/switch behavior", status: "pass", detail: `validated strict sequence ${observed.join(" -> ")} -> stopped with release probes` });
    } catch (error) {
      await manager.stop().catch(() => undefined); const detail = error instanceof Error ? error.message : String(error);
      checks.push({ name: "token usage visibility", status: "blocked", detail });
      checks.push({ name: "model unload/switch behavior", status: "blocked", detail });
    }
  }
  return { ok: checks.every((check) => check.status === "pass" || check.status === "warn"), generatedAt: new Date().toISOString(), checks };
}
