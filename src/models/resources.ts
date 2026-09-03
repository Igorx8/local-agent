import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
