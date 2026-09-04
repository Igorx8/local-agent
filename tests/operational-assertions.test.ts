import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { assertColdStart, assertMultiTurn, assertPauseResume, assertRunCounter } from "../src/operational/assertions.js";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";

const execute = promisify(execFile);
function state(directory: string): RunState { const now = new Date().toISOString(); return { schemaVersion: 1, runId: "run-1", repositoryPath: directory, artifactPath: directory, stage: "SUCCEEDED", status: "succeeded", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 1, contextHandoffs: 2 }, handoffs: [], checkpoints: [], mutatingActionsBlocked: false, manualHandoffRequested: false, activeModel: { role: "auditor", alias: "qwen", lifecycle: "stopped" } }; }

describe("operational evidence assertions", () => {
  it("proves cumulative commit ancestry and required live counters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "operational-")); const directory = path.join(root, ".agent-harness", "conversations", "conv-1"); await mkdir(directory, { recursive: true }); const now = new Date().toISOString();
    await writeFile(path.join(directory, "conversation.json"), JSON.stringify({ schemaVersion: 1, id: "conv-1", workspace: root, status: "active", createdAt: now, updatedAt: now, turns: [{ sequence: 1, promptSha256: "a".repeat(64), promptPreview: "one", status: "succeeded", baseCommit: "base", finalCommit: "one", startedAt: now }, { sequence: 2, promptSha256: "b".repeat(64), promptPreview: "two", status: "succeeded", baseCommit: "one", finalCommit: "two", startedAt: now }, { sequence: 3, promptSha256: "c".repeat(64), promptPreview: "three", status: "succeeded", baseCommit: "two", finalCommit: "three", startedAt: now }] }));
    expect(await assertMultiTurn(root, "conv-1")).toMatchObject({ passed: true, failures: [] });
    const run = path.join(root, "run"); await new StateStore(run).initialize(state(run)); await mkdir(path.join(run, "repairs")); await writeFile(path.join(run, "repairs", "1-regression-proof.json"), "[]\n"); expect(await assertRunCounter(run, "repairIterations", 1)).toMatchObject({ passed: true });
  });

  it("keeps cold-start evidence blocked until boot identity changes", async () => {
    expect(await assertColdStart("/missing/cold-start-receipt.json")).toMatchObject({ passed: false, blocked: true });
  });

  it("proves a paused run later completed and released its model", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pause-resume-")); const completed = state(root); await new StateStore(root).initialize(completed);
    await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), type: "run.paused", message: "paused" })}\n`);
    expect(await assertPauseResume(root)).toMatchObject({ passed: true, failures: [] });
  });
});
