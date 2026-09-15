import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelRegistry } from "./registry.js";
import { runtimeAliases } from "./control.js";
import { pollUntil } from "./http.js";

interface ProcessEntry { pid: number; ppid: number; argv: string[]; }
export interface OrphanDependencies {
  aliases(registry: ModelRegistry): Promise<string[]>;
  processes(): Promise<ProcessEntry[]>;
  terminateGroup(pid: number): void;
  alive(pid: number): boolean;
}

async function processes(): Promise<ProcessEntry[]> {
  const entries = await readdir("/proc", { withFileTypes: true }); const result: ProcessEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const pid = Number(entry.name); const argv = (await readFile(path.join("/proc", entry.name, "cmdline"))).toString("utf8").split("\0").filter(Boolean);
      const status = await readFile(path.join("/proc", entry.name, "status"), "utf8"); const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
      result.push({ pid, ppid, argv });
    } catch { /* process exited or is not readable */ }
  }
  return result;
}

const defaults: OrphanDependencies = {
  aliases: runtimeAliases,
  processes,
  terminateGroup(pid) { process.kill(-pid, "SIGTERM"); },
  alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
};

function argument(argv: string[], name: string): string | undefined {
  const exact = argv.indexOf(name); if (exact >= 0) return argv[exact + 1];
  return argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function reapOrphanedModel(registry: ModelRegistry, llamaUrl: string, dependencies: OrphanDependencies = defaults): Promise<{ alias: string; pid: number } | undefined> {
  if (process.platform !== "linux") return undefined;
  const aliases = await dependencies.aliases(registry).catch((): string[] => []); if (!aliases.length) return undefined;
  const port = new URL(llamaUrl).port || "80"; const registered = new Set(Object.keys(registry.models));
  const candidates = (await dependencies.processes()).filter(({ argv }) => {
    const executable = path.basename(argv[0] ?? ""); const server = executable === "llama-server" || ((executable === "llama" || executable === "llama-cli") && argv[1] === "serve");
    return server && argument(argv, "--port") === port && registered.has(argument(argv, "--alias") ?? "");
  });
  if (candidates.length !== 1) throw new Error(`llama.cpp endpoint advertises ${aliases.join(", ")} but ${candidates.length} matching local process(es) were found; refusing automatic cleanup`);
  const candidate = candidates[0]!; const alias = argument(candidate.argv, "--alias")!;
  if (candidate.ppid !== 1) throw new Error(`model ${alias} is owned by active process ${candidate.ppid} (pid ${candidate.pid}); close the other local-agent shell first`);
  dependencies.terminateGroup(candidate.pid); await pollUntil(async () => !dependencies.alive(candidate.pid), 10_000);
  return { alias, pid: candidate.pid };
}
