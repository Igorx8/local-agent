import path from "node:path";
import { readFile } from "node:fs/promises";
import { generateLocalRegistry, renderRouterPreset, writeAtomic } from "./registry.js";

export interface PrepareModelsOptions { exampleFile: string; registryFile: string; presetFile: string; cacheRoot: string; fingerprint?: boolean; }
export async function prepareLocalModels(options: PrepareModelsOptions): Promise<void> {
  const { registry, artifacts } = await generateLocalRegistry(options.exampleFile, options.registryFile, options.cacheRoot, options.fingerprint ?? true);
  await writeAtomic(options.presetFile, renderRouterPreset(registry, artifacts));
}

export async function mergeOpenCodeLocal(exampleFile: string, destination: string): Promise<void> {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(destination, "utf8")) as Record<string, unknown>; } catch { /* generated file may not exist yet */ }
  const required = JSON.parse(await readFile(exampleFile, "utf8")) as Record<string, unknown>;
  const merged = { ...existing, ...required, provider: { ...(existing.provider as object ?? {}), ...(required.provider as object ?? {}) } };
  await writeAtomic(path.resolve(destination), `${JSON.stringify(merged, null, 2)}\n`);
}
