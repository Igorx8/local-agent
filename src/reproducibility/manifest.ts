import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessConfig } from "../config.js";
import { assertImmutableArtifacts, type ModelRegistry } from "../models/registry.js";
import { writeArtifact } from "../workflow/artifacts.js";

const execute = promisify(execFile);
async function version(command: string, args: string[]): Promise<{ value?: string; blocked?: string }> { try { const result = await execute(command, args, { timeout: 5000 }); return { value: `${result.stdout}${result.stderr}`.trim().split("\n")[0] }; } catch (error) { return { blocked: error instanceof Error ? error.message : String(error) }; } }
export interface ReproducibilityManifest { schemaVersion: 1; createdAt: string; configSha256: string; runtimes: { node: string; opencode: { value?: string; blocked?: string }; llamaCpp: { value?: string; blocked?: string } }; models: Record<string, { alias: string; hfRef: string; quantization: string; contextSize: number; reasoning: string; paths: string[]; bytes: number[]; sha256: string[]; roles: string[] }>; sampling: { temperature: 0; seed: "runtime-dependent-blocked" }; qualityCommands: Record<string, { command: string; args: string[]; required: boolean } | null>; }

export async function createReproducibilityManifest(directory: string, config: HarnessConfig, registry: ModelRegistry): Promise<string> {
  assertImmutableArtifacts(registry);
  const models = Object.fromEntries(Object.entries(registry.models).map(([alias, model]) => { const artifact = registry.artifacts?.[alias]; if (!artifact) throw new Error(`${alias}: immutable artifact identity is required; run model prepare with fingerprinting`); return [alias, { alias, hfRef: model.hfRef, quantization: model.quantization, contextSize: model.contextSize, reasoning: model.reasoning, paths: artifact.paths, bytes: artifact.bytes, sha256: artifact.sha256, roles: model.roles }]; }));
  const stableConfig = JSON.stringify(config); const manifest: ReproducibilityManifest = { schemaVersion: 1, createdAt: new Date().toISOString(), configSha256: createHash("sha256").update(stableConfig).digest("hex"), runtimes: { node: process.version, opencode: await version("opencode", ["--version"]), llamaCpp: await version("llama", ["--version"]) }, models, sampling: { temperature: 0, seed: "runtime-dependent-blocked" }, qualityCommands: Object.fromEntries(Object.entries(config.quality).map(([name, command]) => [name, command ? { command: command.command, args: command.args, required: command.required } : null])) };
  return writeArtifact(directory, "model-manifest.json", manifest);
}
