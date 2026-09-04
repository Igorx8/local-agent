import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";
import { requestPause } from "../src/workflow/run.js";

describe("pause request", () => {
  it("persists the request and explicitly cancels the accepted session", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "pause-request-")); const runId = "run-1"; const directory = path.join(repository, ".agent-harness", "runs", runId); const now = new Date().toISOString();
    const state: RunState = { schemaVersion: 1, runId, repositoryPath: repository, artifactPath: directory, stage: "REPOSITORY_REVIEWING", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], checkpoints: [], mutatingActionsBlocked: false, manualHandoffRequested: false, activeSession: { role: "repositoryReviewer", sessionId: "session-1" } };
    await new StateStore(directory).initialize(state); const abort = vi.fn(async () => true); const request = await requestPause(repository, runId, abort);
    expect(abort).toHaveBeenCalledWith(expect.objectContaining({ activeSession: { role: "repositoryReviewer", sessionId: "session-1" } })); expect(JSON.parse(await readFile(request, "utf8"))).toMatchObject({ sessionId: "session-1" }); expect(JSON.parse(await readFile(path.join(directory, "session-abort.json"), "utf8"))).toMatchObject({ sessionId: "session-1", cancelled: true });
  });
});
