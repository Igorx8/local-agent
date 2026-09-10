import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const shellHistoryFile = (workspace: string): string => path.join(workspace, ".agent-harness", "shell-history");
export async function readShellHistory(workspace: string, limit = 100): Promise<string[]> { try { return (await readFile(shellHistoryFile(workspace), "utf8")).split("\n").filter(Boolean).slice(-limit); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
export async function writeShellHistory(workspace: string, entries: string[], limit = 100, maxBytes = 16_384): Promise<void> {
  const selected = entries.map((item) => item.replace(/[\r\n]+/g, " ").trim()).filter(Boolean).slice(-limit); while (Buffer.byteLength(`${selected.join("\n")}\n`) > maxBytes && selected.length) selected.shift(); await mkdir(path.dirname(shellHistoryFile(workspace)), { recursive: true }); await writeFile(shellHistoryFile(workspace), `${selected.join("\n")}${selected.length ? "\n" : ""}`, { mode: 0o600 });
}
