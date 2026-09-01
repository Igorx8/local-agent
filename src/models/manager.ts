import type { HarnessConfig } from "../config.js";
import { ProcessModelManager, type ProcessManagerOptions } from "./process-adapter.js";
import { RouterModelManager, type RouterOptions } from "./router-adapter.js";
import type { ModelLifecycle } from "./types.js";

export function createModelManager(config: HarnessConfig, options: { router?: Omit<RouterOptions, "baseUrl">; process?: Omit<ProcessManagerOptions, "baseUrl" | "models"> }): ModelLifecycle {
  if (config.runtime.modelStrategy === "router") return new RouterModelManager({ baseUrl: config.runtime.llamaUrl, ...options.router });
  if (!Object.keys(config.modelProcesses).length) throw new Error("explicit process strategy requires modelProcesses configuration");
  return new ProcessModelManager({ baseUrl: config.runtime.llamaUrl, models: config.modelProcesses, ...options.process });
}
