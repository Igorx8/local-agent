import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
export interface MachineMetrics { gpu?: { utilizationPercent: number; vramUsedMiB: number; vramTotalMiB: number; temperatureC: number; powerW: number }; ram: { usedMiB: number; totalMiB: number }; swap: { usedMiB: number; totalMiB: number }; modelSwapMiB?: number; llamaPid?: number; modelProcessCount?: number; }

function memoryValue(text: string, key: string): number { return Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) / 1024; }
export function isLlamaServerProcessName(name: string): boolean { return ["llama", "llama-server"].includes(name.trim()); }
async function llamaProcesses(): Promise<{ count: number; swapMiB: number }> {
  try {
    const entries = await readdir("/proc", { withFileTypes: true }); let count = 0; let swapMiB = 0;
    await Promise.all(entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map(async (entry) => {
      try { if (isLlamaServerProcessName(await readFile(`/proc/${entry.name}/comm`, "utf8"))) { count++; swapMiB += memoryValue(await readFile(`/proc/${entry.name}/status`, "utf8"), "VmSwap"); } } catch { /* Process exited while sampled. */ }
    }));
    return { count, swapMiB };
  } catch { return { count: 0, swapMiB: 0 }; }
}
export async function collectMachineMetrics(llamaPid?: number): Promise<MachineMetrics> {
  const memory = await readFile("/proc/meminfo", "utf8"); const total = memoryValue(memory, "MemTotal"); const available = memoryValue(memory, "MemAvailable"); const swapTotal = memoryValue(memory, "SwapTotal"); const swapFree = memoryValue(memory, "SwapFree");
  const processes = await llamaProcesses(); const result: MachineMetrics = { ram: { usedMiB: total - available, totalMiB: total }, swap: { usedMiB: swapTotal - swapFree, totalMiB: swapTotal }, modelSwapMiB: processes.swapMiB, modelProcessCount: processes.count, llamaPid };
  const [gpuQuery] = await Promise.allSettled([executeFile("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"], { timeout: 2000, killSignal: "SIGKILL" })]);
  try {
    if (gpuQuery.status === "rejected") throw gpuQuery.reason; const { stdout } = gpuQuery.value;
    const values = stdout.trim().split("\n")[0]?.split(",").map((value) => Number(value.trim()));
    if (values?.length === 5 && values.every(Number.isFinite)) result.gpu = { utilizationPercent: values[0]!, vramUsedMiB: values[1]!, vramTotalMiB: values[2]!, temperatureC: values[3]!, powerW: values[4]! };
  } catch { /* NVIDIA telemetry is optional and must never affect the workflow. */ }
  return result;
}
