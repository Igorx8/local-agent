import { describe, expect, it, vi } from "vitest";
import { assertModelAdmission, parseLlamaDecodedTokens } from "../src/models/resources.js";
import { ProcessModelManager } from "../src/models/process-adapter.js";

const limits = { requiredRamMiB: 20_000, maxSwapUsedMiB: 1024, maxVramUsedMiB: 2048, blockForeignCuda: true };

describe("model resource admission", () => {
  it("accepts a quiet host with sufficient RAM", () => {
    expect(() => assertModelAdmission("coder", { ramAvailableMiB: 24_000, swapUsedMiB: 0, vramUsedMiB: 600, cudaProcesses: [] }, limits)).not.toThrow();
  });

  it.each([
    [{ ramAvailableMiB: 18_000, swapUsedMiB: 0, vramUsedMiB: 600, cudaProcesses: [] }, "RAM available"],
    [{ ramAvailableMiB: 24_000, swapUsedMiB: 3000, vramUsedMiB: 600, cudaProcesses: [] }, "swap used"],
    [{ ramAvailableMiB: 24_000, swapUsedMiB: 0, vramUsedMiB: 4000, cudaProcesses: [] }, "VRAM used"],
    [{ ramAvailableMiB: 24_000, swapUsedMiB: 0, vramUsedMiB: 600, cudaProcesses: [{ pid: 42, name: "python" }] }, "foreign CUDA"]
  ])("blocks unsafe pressure before launch", (snapshot, reason) => {
    expect(() => assertModelAdmission("coder", snapshot, limits)).toThrow(reason);
  });

  it("does not launch a process when admission fails", async () => {
    const launcher = vi.fn();
    const manager = new ProcessModelManager({ baseUrl: "http://127.0.0.1:8080", models: { coder: { command: "llama", args: ["serve"] } }, launcher, admissionProbe: async () => { throw new Error("unsafe host"); } });
    await expect(manager.ensureModel("coder")).rejects.toThrow("unsafe host");
    expect(launcher).not.toHaveBeenCalled();
  });

  it("parses live decoded-token progress from active llama.cpp slots", () => {
    expect(parseLlamaDecodedTokens([{ is_processing: true, next_token: { n_decoded: 2407 } }])).toBe(2407);
    expect(parseLlamaDecodedTokens([{ is_processing: true, next_token: [{ n_decoded: 42 }] }])).toBe(42);
    expect(parseLlamaDecodedTokens([{ is_processing: false, next_token: { n_decoded: 99 } }])).toBeUndefined();
    expect(parseLlamaDecodedTokens({ slots: [] })).toBeUndefined();
  });
});
