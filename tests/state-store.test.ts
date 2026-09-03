import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";

function state(directory: string): RunState {
  const now = new Date().toISOString();
  return { schemaVersion: 1, runId: "run-1", repositoryPath: directory, artifactPath: directory, stage: "CREATED", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], checkpoints: [], mutatingActionsBlocked: false, manualHandoffRequested: false };
}

describe("StateStore", () => {
  it("atomically persists and validates state", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "harness-state-"));
    const store = new StateStore(directory);
    await store.initialize(state(directory));
    expect((await store.read()).runId).toBe("run-1");
    expect(JSON.parse(await readFile(store.statePath, "utf8")).schemaVersion).toBe(1);
  });

  it("prevents two active owners", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "harness-lock-"));
    const store = new StateStore(directory);
    const release = await store.acquireLock();
    await expect(store.acquireLock()).rejects.toBeTruthy();
    await release();
    const releaseAgain = await store.acquireLock();
    await releaseAgain();
  });
  it("fills additive state defaults and rejects unknown schema versions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "harness-migration-")); const store = new StateStore(directory); const legacy = state(directory) as unknown as Record<string, unknown>; delete legacy.checkpoints; await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(directory, { recursive: true }).then(() => writeFile(store.statePath, JSON.stringify(legacy)))); expect((await store.read()).checkpoints).toEqual([]); legacy.schemaVersion = 99; await import("node:fs/promises").then(({ writeFile }) => writeFile(store.statePath, JSON.stringify(legacy))); await expect(store.read()).rejects.toThrow(/unsupported run state schema/);
  });
});
