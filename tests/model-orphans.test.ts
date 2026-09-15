import { describe, expect, it, vi } from "vitest";
import { reapOrphanedModel, type OrphanDependencies } from "../src/models/orphans.js";
import type { ModelRegistry } from "../src/models/registry.js";

const registry = { models: { qwen: {} } } as unknown as ModelRegistry;
const processEntry = { pid: 42, ppid: 1, argv: ["llama", "serve", "--port", "8080", "--alias", "qwen"] };

describe("orphaned model recovery", () => {
  it("terminates exactly one verified orphan on the configured endpoint", async () => {
    let alive = true; const terminateGroup = vi.fn(() => { alive = false; });
    const dependencies: OrphanDependencies = { aliases: async () => ["qwen"], processes: async () => [processEntry], terminateGroup, alive: () => alive };
    await expect(reapOrphanedModel(registry, "http://127.0.0.1:8080", dependencies)).resolves.toEqual({ alias: "qwen", pid: 42 }); expect(terminateGroup).toHaveBeenCalledWith(42);
  });

  it("refuses to terminate a model whose owner process is still alive", async () => {
    const dependencies: OrphanDependencies = { aliases: async () => ["qwen"], processes: async () => [{ ...processEntry, ppid: 99 }], terminateGroup: vi.fn(), alive: () => true };
    await expect(reapOrphanedModel(registry, "http://127.0.0.1:8080", dependencies)).rejects.toThrow("owned by active process 99"); expect(dependencies.terminateGroup).not.toHaveBeenCalled();
  });

  it("does nothing when no model endpoint is advertised", async () => {
    const dependencies: OrphanDependencies = { aliases: async () => [], processes: vi.fn(), terminateGroup: vi.fn(), alive: () => false };
    await expect(reapOrphanedModel(registry, "http://127.0.0.1:8080", dependencies)).resolves.toBeUndefined(); expect(dependencies.processes).not.toHaveBeenCalled();
  });
});
