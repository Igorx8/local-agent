import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { assertColdStart, assertEndurance, assertHandoff, assertMultiTurn, assertPauseResume, assertRunCounter } from "../src/operational/assertions.js";
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

  it("proves contiguous fresh handoffs and unique mutation checkpoints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-assertion-")); const current = state(root); const now = new Date().toISOString();
    current.handoffs = [1, 2].map((sequence) => ({ sequence, role: "planner", previousSessionId: `old-${sequence}`, newSessionId: `new-${sequence}`, path: path.join(root, `handoff-${sequence}.md`), reason: "threshold", createdAt: now })); current.checkpoints = [{ kind: "implementation", iteration: 0, commit: "abc", treeHash: "tree", changedFiles: ["README.md"], createdAt: now }]; await new StateStore(root).initialize(current);
    for (const handoff of current.handoffs) await writeFile(handoff.path, "handoff\n"); await writeFile(path.join(root, "events.jsonl"), current.handoffs.map((handoff) => JSON.stringify({ schemaVersion: 1, at: now, type: "session.restart", message: "restarted", data: { sequence: handoff.sequence } })).join("\n") + "\n");
    expect(await assertHandoff(root)).toMatchObject({ passed: true, failures: [], evidence: expect.arrayContaining(["sessionRestarts=2", "uniqueCheckpoints=1"]) });
    current.checkpoints.push({ ...current.checkpoints[0]! }); await writeFile(path.join(root, "state.json"), JSON.stringify(current)); expect(await assertHandoff(root)).toMatchObject({ passed: false, failures: expect.arrayContaining(["duplicate mutation checkpoint detected"]) });
  });

  it("proves a paused run later completed and released its model", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pause-resume-")); const completed = state(root); await new StateStore(root).initialize(completed);
    await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), type: "run.paused", message: "paused" })}\n`);
    expect(await assertPauseResume(root)).toMatchObject({ passed: true, failures: [] });
  });

  it("proves incremental endurance with unique runs and released models", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "endurance-assertion-")); const directory = path.join(root, ".agent-harness", "conversations", "conv-1"); await mkdir(directory, { recursive: true }); const now = new Date().toISOString(); const turns = [];
    for (let sequence = 1; sequence <= 2; sequence++) { const run = path.join(root, `run-${sequence}`); await new StateStore(run).initialize({ ...state(run), runId: `run-${sequence}` }); turns.push({ sequence, promptSha256: String(sequence).repeat(64), promptPreview: `turn ${sequence}`, runId: `run-${sequence}`, status: "succeeded", baseCommit: sequence === 1 ? "base" : "one", finalCommit: sequence === 1 ? "one" : "two", artifactPath: run, startedAt: now, completedAt: now }); }
    await writeFile(path.join(directory, "conversation.json"), JSON.stringify({ schemaVersion: 1, id: "conv-1", workspace: root, status: "active", createdAt: now, updatedAt: now, turns }));
    expect(await assertEndurance(root, "conv-1", 2)).toMatchObject({ passed: true, failures: [], evidence: expect.arrayContaining([expect.stringContaining("run=run-2; model=stopped")]) });
  });
});
