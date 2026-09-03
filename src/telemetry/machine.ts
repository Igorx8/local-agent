import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
export interface MachineMetrics { gpu?: { utilizationPercent: number; vramUsedMiB: number; vramTotalMiB: number; temperatureC: number; powerW: number }; ram: { usedMiB: number; totalMiB: number }; swap: { usedMiB: number; totalMiB: number }; llamaPid?: number; }

function memoryValue(text: string, key: string): number { return Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) / 1024; }
export async function collectMachineMetrics(llamaPid?: number): Promise<MachineMetrics> {
  const memory = await readFile("/proc/meminfo", "utf8"); const total = memoryValue(memory, "MemTotal"); const available = memoryValue(memory, "MemAvailable"); const swapTotal = memoryValue(memory, "SwapTotal"); const swapFree = memoryValue(memory, "SwapFree");
  const result: MachineMetrics = { ram: { usedMiB: total - available, totalMiB: total }, swap: { usedMiB: swapTotal - swapFree, totalMiB: swapTotal }, llamaPid };
  try {
    const { stdout } = await executeFile("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"], { timeout: 3000 });
    const values = stdout.trim().split("\n")[0]?.split(",").map((value) => Number(value.trim()));
    if (values?.length === 5 && values.every(Number.isFinite)) result.gpu = { utilizationPercent: values[0]!, vramUsedMiB: values[1]!, vramTotalMiB: values[2]!, temperatureC: values[3]!, powerW: values[4]! };
  } catch { /* NVIDIA telemetry is optional and must never affect the workflow. */ }
  return result;
}
