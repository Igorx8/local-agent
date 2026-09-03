import type { ModelRegistry } from "./registry.js";
import { requireAlias } from "./registry.js";
import type { ModelProcessCommand } from "./process-adapter.js";

export type ServerEntryPoint = { command: "llama"; prefix: ["serve"] } | { command: "llama-server"; prefix: [] };
export const requiredServerFlags = ["--hf-repo", "--alias", "--no-mmproj", "--host", "--port", "--api-key", "--cors-origins", "--ctx-size", "--parallel", "--jinja", "--load-mode", "--reasoning", "--reasoning-budget", "--reasoning-preserve", "--flash-attn", "--cache-type-k", "--cache-type-v", "--fit", "--fit-target", "--metrics", "--models-preset", "--models-max", "--models-autoload"] as const;

export function explicitProcessProfile(registry: ModelRegistry, alias: string, entryPoint: ServerEntryPoint, apiKey: string): ModelProcessCommand {
  if (!apiKey) throw new Error(`${registry.apiKeyEnv} is not set`);
  const model = requireAlias(registry, alias); const common = registry.commonServerArgs;
  const args: string[] = [...entryPoint.prefix, "-hf", model.hfRef, "--alias", alias, "--no-mmproj", "--host", common.host, "--port", String(common.port), "--api-key", apiKey, "--cors-origins", "localhost", "--ctx-size", String(model.contextSize), "--parallel", String(model.parallel), "--jinja", "--load-mode", common.loadMode, "--reasoning", model.reasoning];
  if (model.reasoningBudget !== undefined) args.push("--reasoning-budget", String(model.reasoningBudget));
  if (model.reasoningPreserve) args.push("--reasoning-preserve");
  args.push("--flash-attn", common.flashAttention, "--cache-type-k", common.cacheTypeK, "--cache-type-v", common.cacheTypeV, "--fit", common.fit, "--fit-target", String(common.fitTargetMiB), "--metrics");
  return { command: entryPoint.command, args };
}

export function unsupportedFlags(help: string): string[] { return requiredServerFlags.filter((flag) => !help.includes(flag)); }
