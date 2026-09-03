import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelLifecycle, ModelStatus } from "../src/models/types.js";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";
import { stopRunModel } from "../src/workflow/run.js";

function state(directory: string): RunState { const now = new Date().toISOString(); return { schemaVersion: 1, runId: "run-cleanup", repositoryPath: directory, artifactPath: directory, stage: "SUCCEEDED", status: "succeeded", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], checkpoints: [], mutatingActionsBlocked: false, manualHandoffRequested: false, activeModel: { role: "auditor", alias: "qwen36-main", lifecycle: "healthy" } }; }
function manager(stop: () => Promise<ModelStatus>): ModelLifecycle { return { status: () => ({ alias: "qwen36-main", state: "healthy" }), ensureModel: async () => ({ state: "healthy" }), beginRequest() {}, endRequest() {}, stop }; }

describe("workflow model cleanup", () => {
  it("persists stopped state after resources are confirmed released", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "model-cleanup-")); const store = new StateStore(directory); await store.initialize(state(directory));
    await stopRunModel(manager(async () => ({ state: "stopped" })), store, directory);
    expect((await store.read()).activeModel?.lifecycle).toBe("stopped");
  });

  it("fails and blocks a run when final resource release cannot be confirmed", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "model-cleanup-")); const store = new StateStore(directory); await store.initialize(state(directory));
    await expect(stopRunModel(manager(async () => { throw new Error("VRAM still occupied"); }), store, directory)).rejects.toThrow(/VRAM/);
    expect(await store.read()).toMatchObject({ stage: "FAILED", status: "failed", mutatingActionsBlocked: true, activeModel: { lifecycle: "error" } });
  });
});
