import type { HarnessConfig } from "../config.js";
import { ProcessModelManager, type ProcessManagerOptions } from "./process-adapter.js";
import { RouterModelManager, type RouterOptions } from "./router-adapter.js";
import type { ModelLifecycle } from "./types.js";
import type { ModelRegistry } from "./registry.js";
import { explicitProcessProfile, type ServerEntryPoint } from "./profiles.js";
import { vramReleaseProbe } from "./resources.js";

export function createModelManager(config: HarnessConfig, options: { registry?: ModelRegistry; entryPoint?: ServerEntryPoint; router?: Omit<RouterOptions, "baseUrl">; process?: Omit<ProcessManagerOptions, "baseUrl" | "models"> }): ModelLifecycle {
  const apiKey = process.env[config.apiKeyEnv];
  const expectedPaths = options.registry?.artifacts ? Object.fromEntries(Object.entries(options.registry.artifacts).map(([alias, artifact]) => [alias, artifact.paths])) : undefined;
  const releaseProbe = vramReleaseProbe(config.runtime.modelUnloadVramThresholdMiB);
  if (config.runtime.modelStrategy === "router") return new RouterModelManager({ baseUrl: config.runtime.llamaUrl, apiKey, startupTimeoutMs: config.runtime.modelStartupTimeoutMs, shutdownTimeoutMs: config.runtime.modelShutdownTimeoutMs, releaseProbe, ...(expectedPaths ? { expectedPaths } : {}), ...options.router });
  const models = options.registry && apiKey ? Object.fromEntries(Object.keys(options.registry.models).map((alias) => [alias, explicitProcessProfile(options.registry!, alias, options.entryPoint ?? { command: "llama", prefix: ["serve"] }, apiKey)])) : config.modelProcesses;
  if (!Object.keys(models).length) throw new Error(`explicit process strategy requires a registry and ${config.apiKeyEnv}`);
  return new ProcessModelManager({ baseUrl: config.runtime.llamaUrl, models, apiKey, startupTimeoutMs: config.runtime.modelStartupTimeoutMs, shutdownTimeoutMs: config.runtime.modelShutdownTimeoutMs, restartCooldownMs: config.runtime.modelRestartCooldownMs, releaseProbe, ...options.process });
}
