import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

export const agentRoles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"] as const;
export type AgentRoleName = typeof agentRoles[number];
const modelSchema = z.object({
  hfRef: z.string().regex(/^[^/]+\/[^:]+:[^:]+$/), quantization: z.string().min(1), approximateArtifactGiB: z.number().positive(),
  contextSize: z.number().int().positive(), parallel: z.literal(1), reasoning: z.enum(["auto", "off"]),
  reasoningBudget: z.number().int().positive().optional(), reasoningPreserve: z.boolean().optional(), roles: z.array(z.enum(agentRoles)).min(1)
}).superRefine((model, context) => {
  if (!model.hfRef.endsWith(`:${model.quantization}`)) context.addIssue({ code: "custom", message: "hfRef quantization must match quantization" });
  if (model.reasoning === "auto" && model.reasoningBudget === undefined) context.addIssue({ code: "custom", message: "reasoning auto requires reasoningBudget" });
  if (model.reasoning === "off" && (model.reasoningBudget !== undefined || model.reasoningPreserve !== undefined)) context.addIssue({ code: "custom", message: "reasoning off cannot define reasoning budget/preservation" });
});
export const modelRegistrySchema = z.object({
  version: z.literal(1), providerId: z.literal("llama.cpp"), baseUrl: z.string().url().refine((url) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), "baseUrl must use loopback"),
  apiKeyEnv: z.literal("LLAMA_API_KEY"), models: z.record(z.string().min(1), modelSchema),
  artifacts: z.record(z.string(), z.object({ paths: z.array(z.string().min(1)).min(1), bytes: z.array(z.number().int().nonnegative()).min(1), sha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1) })).optional(),
  commonServerArgs: z.object({ host: z.literal("127.0.0.1"), port: z.number().int().positive(), noMmproj: z.literal(true), jinja: z.literal(true), flashAttention: z.literal("auto"), cacheTypeK: z.literal("q8_0"), cacheTypeV: z.literal("q8_0"), fit: z.literal("on"), fitTargetMiB: z.number().int().positive() })
}).superRefine((registry, context) => {
  const owners = new Map<string, string>();
  for (const [alias, model] of Object.entries(registry.models)) for (const role of model.roles) {
    if (owners.has(role)) context.addIssue({ code: "custom", message: `role ${role} is assigned to multiple aliases` });
    owners.set(role, alias);
  }
  for (const role of agentRoles) if (!owners.has(role)) context.addIssue({ code: "custom", message: `role ${role} has no model alias` });
});
export type ModelRegistry = z.infer<typeof modelRegistrySchema>;
export type RegisteredModel = z.infer<typeof modelSchema>;

export async function loadModelRegistry(file: string): Promise<ModelRegistry> { return modelRegistrySchema.parse(YAML.parse(await readFile(path.resolve(file), "utf8"))); }
export async function generateLocalRegistry(exampleFile: string, destination: string, cacheRoot: string, hash = false): Promise<{ registry: ModelRegistry; artifacts: Record<string, ResolvedArtifact> }> {
  const registry = await loadModelRegistry(exampleFile); const artifacts: Record<string, ResolvedArtifact> = {};
  for (const [alias, model] of Object.entries(registry.models)) artifacts[alias] = await resolveCachedArtifact(alias, model, cacheRoot, hash);
  const generated = { ...registry, ...(hash ? { artifacts: Object.fromEntries(Object.entries(artifacts).map(([alias, artifact]) => [alias, { paths: artifact.paths, bytes: artifact.bytes, sha256: artifact.sha256! }])) } : {}) };
  await writeAtomic(destination, YAML.stringify(generated));
  return { registry: modelRegistrySchema.parse(generated), artifacts };
}
export function resolveRoleAlias(registry: ModelRegistry, role: AgentRoleName): string {
  const matches = Object.entries(registry.models).filter(([, model]) => model.roles.includes(role)).map(([alias]) => alias);
  if (matches.length !== 1) throw new Error(`role ${role} must resolve to exactly one registry alias`);
  return matches[0]!;
}
export function requireAlias(registry: ModelRegistry, alias: string): RegisteredModel {
  const model = registry.models[alias]; if (!model) throw new Error(`unknown model alias: ${alias}`); return model;
}

function hfCacheDirectory(cacheRoot: string, hfRef: string): string {
  const repository = hfRef.slice(0, hfRef.lastIndexOf(":"));
  return path.join(cacheRoot, `models--${repository.replace("/", "--")}`);
}
export interface ResolvedArtifact { alias: string; hfRef: string; paths: string[]; bytes: number[]; sha256?: string[]; }
export async function resolveCachedArtifact(alias: string, model: RegisteredModel, cacheRoot: string, hash = false): Promise<ResolvedArtifact> {
  const snapshots = path.join(hfCacheDirectory(cacheRoot, model.hfRef), "snapshots");
  const revisions = await readdir(snapshots).catch(() => []);
  const candidates: string[] = [];
  for (const revision of revisions) for (const name of await readdir(path.join(snapshots, revision)).catch(() => [])) {
    if (name.toLowerCase().endsWith(".gguf") && name.toLowerCase().includes(model.quantization.toLowerCase())) candidates.push(path.join(snapshots, revision, name));
  }
  if (!candidates.length) throw new Error(`${alias}: exact quantization ${model.quantization} was not found for ${model.hfRef}`);
  candidates.sort();
  const paths = await Promise.all(candidates.map((candidate) => realpath(candidate)));
  const bytes = await Promise.all(paths.map(async (candidate) => (await stat(candidate)).size));
  let sha256: string[] | undefined;
  if (hash) sha256 = await Promise.all(paths.map(async (candidate) => { const digest = createHash("sha256"); for await (const chunk of createReadStream(candidate)) digest.update(chunk); return digest.digest("hex"); }));
  return { alias, hfRef: model.hfRef, paths, bytes, ...(sha256 ? { sha256 } : {}) };
}

export async function writeAtomic(file: string, contents: string): Promise<void> {
  const target = path.resolve(file); const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 }); await import("node:fs/promises").then(({ rename }) => rename(temporary, target));
}

export function renderRouterPreset(registry: ModelRegistry, artifacts: Record<string, ResolvedArtifact>): string {
  const common = registry.commonServerArgs;
  const lines = ["version = 1", "", "[*]", `ctx-size = ${Object.values(registry.models)[0]?.contextSize ?? 65536}`, "parallel = 1", "no-mmproj = true", "jinja = true", `flash-attn = ${common.flashAttention}`, `cache-type-k = ${common.cacheTypeK}`, `cache-type-v = ${common.cacheTypeV}`, `fit = ${common.fit}`, `fit-target = ${common.fitTargetMiB}`, "metrics = true", "stop-timeout = 30"];
  for (const [alias, model] of Object.entries(registry.models)) {
    const artifact = artifacts[alias]; if (!artifact || artifact.paths.length !== 1) throw new Error(`${alias}: router mode requires exactly one resolved GGUF artifact`);
    lines.push("", `[${alias}]`, `model = ${artifact.paths[0]}`, `reasoning = ${model.reasoning}`);
    if (model.reasoningBudget !== undefined) lines.push(`reasoning-budget = ${model.reasoningBudget}`);
    if (model.reasoningPreserve) lines.push("reasoning-preserve = true");
  }
  return `${lines.join("\n")}\n`;
}
