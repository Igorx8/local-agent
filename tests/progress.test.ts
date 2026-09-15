import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent } from "../src/telemetry/events.js";
import { formatIdentity, formatProgress, parseProgressMode, ProgressReporter } from "../src/telemetry/progress.js";

describe("bounded CLI progress", () => {
  it("formats immediate human and structured run identity", () => {
    const identity = { runId: "run-1", repositoryPath: "/repo/worktree", artifactPath: "/repo/artifacts" };
    expect(formatIdentity(identity, "human")).toContain("id=run-1 worktree=/repo/worktree"); expect(JSON.parse(formatIdentity(identity, "jsonl")!)).toMatchObject({ type: "run.created", runId: "run-1", worktree: "/repo/worktree" });
  });

  it("allows only concise event fields and excludes prompt-like payloads", () => {
    const line = formatProgress({ timestamp: "2026-09-10T01:02:03.000Z", type: "agent.start", message: "planner started", data: { role: "planner", alias: "qwen", prompt: "secret prompt", response: "secret response" } }, "jsonl")!; const value = JSON.parse(line);
    expect(value).toMatchObject({ type: "run.progress", event: "agent.start", data: { role: "planner", alias: "qwen" } }); expect(line).not.toContain("secret"); expect(formatProgress({ timestamp: new Date().toISOString(), type: "debug", message: "hidden", data: { prompt: "secret" } }, "human")).toBeUndefined();
  });

  it("streams newly persisted visible events and can be disabled", async () => {
    const artifacts = await mkdtemp(path.join(tmpdir(), "harness-progress-")); const output: string[] = []; const reporter = new ProgressReporter({ runId: "run-2", repositoryPath: "/worktree", artifactPath: artifacts }, "human", { write(value) { output.push(value); } }, 60_000); reporter.start(); await appendEvent(artifacts, { type: "workflow.stage", message: "Workflow entered PLANNING", data: { stage: "PLANNING" } }); await appendEvent(artifacts, { type: "debug", message: "verbose model log" }); await reporter.stop(); expect(output.join("")).toContain("run-2"); expect(output.join("")).toContain("PLANNING"); expect(output.join("")).not.toContain("verbose model log"); expect(formatIdentity({ runId: "x", repositoryPath: "x", artifactPath: "x" }, "off")).toBeUndefined();
  });

  it("rejects unknown output modes", () => { expect(parseProgressMode("jsonl")).toBe("jsonl"); expect(() => parseProgressMode("verbose")).toThrow(/invalid progress mode/); });

  it("emits a bounded heartbeat when no visible event is produced", async () => {
    const artifacts = await mkdtemp(path.join(tmpdir(), "harness-heartbeat-")); const output: string[] = [];
    const reporter = new ProgressReporter({ runId: "run-slow", repositoryPath: "/worktree", artifactPath: artifacts }, "human", { write(value) { output.push(value); } }, 60_000, 0);
    reporter.start(); await reporter.flush(); await reporter.stop();
    expect(output.join("")).toContain("Still working"); expect(output.join("")).not.toContain("prompt");
  });
});
