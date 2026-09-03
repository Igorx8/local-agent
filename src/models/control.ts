import { spawn } from "node:child_process";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelRegistry } from "./registry.js";
import { requireAlias } from "./registry.js";
import { explicitProcessProfile, type ServerEntryPoint } from "./profiles.js";
import { pollUntil } from "./http.js";
import { vramReleaseProbe } from "./resources.js";

interface RuntimeState { alias: string; pid: number; startedAt: string; }
const statePath = (root: string) => path.join(root, ".agent-harness", "model-runtime.json");
function headers(registry: ModelRegistry): HeadersInit { const key = process.env[registry.apiKeyEnv]; return key ? { authorization: `Bearer ${key}`, "content-type": "application/json" } : { "content-type": "application/json" }; }
export async function readModelRuntime(root: string): Promise<RuntimeState | undefined> { try { return JSON.parse(await readFile(statePath(root), "utf8")) as RuntimeState; } catch { return undefined; } }
export async function runtimeAliases(registry: ModelRegistry): Promise<string[]> {
  const response = await fetch(new URL("models", registry.baseUrl), { headers: headers(registry), signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`GET /v1/models returned ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: string }> }; return (body.data ?? []).flatMap((model) => model.id ? [model.id] : []);
}
export async function stopLocalModel(root: string, options: { shutdownTimeoutMs?: number; modelUnloadVramThresholdMiB?: number; releaseProbe?: () => Promise<boolean> } = {}): Promise<void> {
  const state = await readModelRuntime(root); if (!state) return;
  try { process.kill(-state.pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  const timeout = options.shutdownTimeoutMs ?? 30_000; const exited = async () => { try { process.kill(state.pid, 0); return false; } catch { return true; } };
  try { await pollUntil(exited, timeout); } catch { try { process.kill(-state.pid, "SIGKILL"); } catch { /* already stopped */ } await pollUntil(exited, timeout); }
  await pollUntil(options.releaseProbe ?? vramReleaseProbe(options.modelUnloadVramThresholdMiB ?? 2048), timeout);
  await unlink(statePath(root)).catch(() => undefined);
}
export async function startLocalModel(root: string, registry: ModelRegistry, alias: string, entryPoint: ServerEntryPoint = { command: "llama", prefix: ["serve"] }, lifecycle: { shutdownTimeoutMs?: number; modelUnloadVramThresholdMiB?: number } = {}): Promise<RuntimeState> {
  requireAlias(registry, alias); const key = process.env[registry.apiKeyEnv]; if (!key) throw new Error(`${registry.apiKeyEnv} is not set`);
  const existing = await readModelRuntime(root); if (existing?.alias === alias && (await runtimeAliases(registry).catch((): string[] => [])).includes(alias)) return existing;
  if (existing) await stopLocalModel(root, lifecycle);
  const directory = path.join(root, ".agent-harness"); await mkdir(directory, { recursive: true }); const log = await open(path.join(directory, "model-server.log"), "a", 0o600);
  const profile = explicitProcessProfile(registry, alias, entryPoint, key); const child = spawn(profile.command, profile.args, { cwd: root, env: process.env, detached: true, shell: false, stdio: ["ignore", log.fd, log.fd] });
  if (!child.pid) throw new Error("llama.cpp process did not return a pid"); child.unref(); await log.close();
  const state = { alias, pid: child.pid, startedAt: new Date().toISOString() }; await writeFile(statePath(root), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try { await pollUntil(async () => (await runtimeAliases(registry).catch((): string[] => [])).includes(alias), 600_000, 500); } catch (error) { await stopLocalModel(root, lifecycle); throw error; }
  return state;
}
export async function smokeModel(registry: ModelRegistry, alias: string): Promise<{ completion: boolean; toolCall: boolean }> {
  requireAlias(registry, alias); const endpoint = new URL("chat/completions", registry.baseUrl); const common = { model: alias, temperature: 0, max_tokens: 256 };
  const request = async (body: object) => { const response = await fetch(endpoint, { method: "POST", headers: headers(registry), body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }); if (!response.ok) throw new Error(`smoke call returned ${response.status}: ${(await response.text()).slice(0, 500)}`); return response.json() as Promise<{ choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }> }>; };
  const completion = await request({ ...common, messages: [{ role: "user", content: "Reply with exactly: ok" }] });
  const tools = await request({ ...common, messages: [{ role: "user", content: "Call the probe tool once." }], tools: [{ type: "function", function: { name: "probe", description: "Capability probe", parameters: { type: "object", properties: {}, additionalProperties: false } } }], tool_choice: "required" });
  return { completion: Boolean(completion.choices?.[0]?.message?.content), toolCall: Boolean(tools.choices?.[0]?.message?.tool_calls?.length) };
}
