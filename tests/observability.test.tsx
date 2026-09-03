import React from "react";
import { renderToString } from "ink";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { RunState } from "../src/state/types.js";
import { appendEvent, readEvents } from "../src/telemetry/events.js";
import { buildDashboardSnapshot, contextLevel } from "../src/telemetry/snapshot.js";
import { Dashboard } from "../src/ui/dashboard.js";

const run = promisify(execFile);
const gate = { name: "test", required: true, status: "passed", provenance: "pre_existing", command: "npm", args: ["test"], exitCode: 0, signal: null, timedOut: false, durationMs: 42, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false } as const;

async function fixture(): Promise<{ root: string; artifacts: string; state: RunState }> {
  const root = await mkdtemp(path.join(tmpdir(), "harness-observe-")); await run("git", ["init", "-b", "agent/test", root]); await writeFile(path.join(root, "README.md"), "fixture\n"); await run("git", ["-C", root, "add", "README.md"]); await run("git", ["-C", root, "-c", "user.name=Harness", "-c", "user.email=harness@example.invalid", "commit", "-m", "fixture"]);
  const artifacts = path.join(root, ".agent-harness", "runs", "run-7"); await mkdir(path.join(artifacts, "gates"), { recursive: true }); await mkdir(path.join(artifacts, "reviews"), { recursive: true });
  await writeFile(path.join(artifacts, "gates", "iteration-0.json"), JSON.stringify({ gates: [gate], baselineAttribution: { test: "unchanged_pass" } }));
  await writeFile(path.join(artifacts, "reviews", "0-merged.json"), JSON.stringify({ findings: [{ id: "F1", severity: "high" }] })); await writeFile(path.join(artifacts, "reviews", "0-triage.json"), JSON.stringify({ findings: [{ findingId: "F1", classification: "confirmed" }] }));
  const now = new Date().toISOString(); const state: RunState = { schemaVersion: 1, runId: "run-7", repositoryPath: root, artifactPath: artifacts, stage: "GATES_RUNNING", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 1, contextHandoffs: 0 }, handoffs: [], mutatingActionsBlocked: false, manualHandoffRequested: false, context: { latestPromptTokens: 80, contextWindow: 100, usage: .8, provenance: "exact", source: "test" }, activeModel: { role: "implementer", alias: "qwen3-coder-impl", lifecycle: "healthy", requestDurationMs: 1000, tokensPerSecond: 25 } };
  return { root, artifacts, state };
}

describe("Milestone 7 observability", () => {
  it("uses the exact context threshold boundaries", () => {
    expect([.69, .70, .78, .85, .92].map(contextLevel)).toEqual(["green", "yellow", "orange", "red", "critical"]);
  });

  it("persists a bounded structured event feed and ignores malformed tail lines", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "harness-events-"));
    for (let index = 0; index < 4; index++) await appendEvent(directory, { type: "gate.result", message: `gate ${index}`, timestamp: new Date(index).toISOString() });
    await writeFile(path.join(directory, "events.jsonl"), "not-json\n", { flag: "a" });
    expect((await readEvents(directory, 2)).map((event) => event.message)).toEqual(["gate 2", "gate 3"]);
  });

  it("builds and renders stage, model, context, gates, review, GPU/RAM placeholders and events", async () => {
    const { root, artifacts, state } = await fixture(); await appendEvent(artifacts, { type: "checkpoint", message: "checkpoint created" });
    const snapshot = await buildDashboardSnapshot(state, root); const output = renderToString(<Dashboard snapshot={snapshot} />, { columns: 180 });
    expect(snapshot.gates[0]).toMatchObject({ name: "test", baseline: "unchanged_pass" }); expect(snapshot.review).toMatchObject({ total: 1, confirmed: 1, repairIteration: 1 }); expect(snapshot.context?.level).toBe("orange");
    for (const text of ["GATES_RUNNING", "qwen3-coder-impl", "80.0%", "Quality gates", "Review", "Machine", "RAM", "Events", "checkpoint created"]) expect(output).toContain(text);
  });
});
