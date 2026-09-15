import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const executeFile = promisify(execFile);

export async function nvidiaVramUsedMiB(): Promise<number> {
  const { stdout } = await executeFile("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { timeout: 3000 });
  const values = stdout.trim().split("\n").map((value) => Number(value.trim()));
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error("nvidia-smi returned invalid VRAM usage");
  return Math.max(...values);
}

export function vramReleaseProbe(thresholdMiB: number): () => Promise<boolean> {
  return async () => (await nvidiaVramUsedMiB()) <= thresholdMiB;
}

export interface ModelAdmissionSnapshot { ramAvailableMiB: number; swapUsedMiB: number; vramUsedMiB: number; cudaProcesses: Array<{ pid: number; name: string }>; }
export interface ModelAdmissionLimits { requiredRamMiB: number; maxSwapUsedMiB: number; maxVramUsedMiB: number; blockForeignCuda: boolean; }

function meminfoMiB(text: string, key: string): number {
  const value = Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1]);
  if (!Number.isFinite(value)) throw new Error(`/proc/meminfo did not contain ${key}`);
  return value / 1024;
}

export async function collectModelAdmissionSnapshot(): Promise<ModelAdmissionSnapshot> {
  const memory = await readFile("/proc/meminfo", "utf8");
  const swapTotal = meminfoMiB(memory, "SwapTotal"); const swapFree = meminfoMiB(memory, "SwapFree");
  const [{ stdout: gpu }, { stdout: processes }] = await Promise.all([
    executeFile("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { timeout: 3000 }),
    executeFile("nvidia-smi", ["--query-compute-apps=pid,process_name", "--format=csv,noheader,nounits"], { timeout: 3000 })
  ]);
  const vram = gpu.trim().split("\n").filter(Boolean).map(Number); if (!vram.length || vram.some((value) => !Number.isFinite(value))) throw new Error("nvidia-smi returned invalid VRAM admission data");
  const cudaProcesses = processes.trim() ? processes.trim().split("\n").map((line) => { const [pid, ...name] = line.split(","); return { pid: Number(pid?.trim()), name: name.join(",").trim() }; }).filter((item) => Number.isFinite(item.pid)) : [];
  return { ramAvailableMiB: meminfoMiB(memory, "MemAvailable"), swapUsedMiB: swapTotal - swapFree, vramUsedMiB: Math.max(...vram), cudaProcesses };
}

export function assertModelAdmission(alias: string, snapshot: ModelAdmissionSnapshot, limits: ModelAdmissionLimits): void {
  const reasons: string[] = [];
  if (snapshot.ramAvailableMiB < limits.requiredRamMiB) reasons.push(`RAM available ${snapshot.ramAvailableMiB.toFixed(0)} MiB is below required ${limits.requiredRamMiB.toFixed(0)} MiB`);
  if (snapshot.swapUsedMiB > limits.maxSwapUsedMiB) reasons.push(`swap used ${snapshot.swapUsedMiB.toFixed(0)} MiB exceeds ${limits.maxSwapUsedMiB} MiB`);
  if (snapshot.vramUsedMiB > limits.maxVramUsedMiB) reasons.push(`VRAM used ${snapshot.vramUsedMiB.toFixed(0)} MiB exceeds ${limits.maxVramUsedMiB} MiB`);
  const foreign = snapshot.cudaProcesses.filter((item) => !["llama", "llama-server"].includes(item.name.split("/").at(-1) ?? item.name));
  if (limits.blockForeignCuda && foreign.length) reasons.push(`foreign CUDA process(es): ${foreign.map((item) => `${item.name}(${item.pid})`).join(", ")}`);
  if (reasons.length) throw new Error(`model admission blocked for ${alias}: ${reasons.join("; ")}. Stop heavy workloads or adjust explicit runtime thresholds.`);
}
