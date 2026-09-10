import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { harnessConfigSchema, type HarnessConfig } from "../src/config.js";
import { appendMemory } from "../src/conversation/memory.js";
import { continueConversation, readConversation } from "../src/conversation/service.js";
import { StateStore } from "../src/state/store.js";
import type { RunState } from "../src/state/types.js";
import type { StartRunOptions } from "../src/workflow/run.js";
import type { ConversationMemory } from "../src/conversation/types.js";

const execute = promisify(execFile); const roles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"];
function config(overrides: { maxRecentTurns?: number; maxMemoryBytes?: number } = {}): HarnessConfig { return harnessConfigSchema.parse({ version: 1, runtime: {}, models: Object.fromEntries(roles.map((role) => [role, `llama.cpp/${role}`])), workflow: { autoMerge: false }, context: {}, conversation: overrides }); }
async function repository(): Promise<string> { const root = await mkdtemp(path.join(tmpdir(), "harness-conversation-")); await execute("git", ["init", "-b", "main", root]); await writeFile(path.join(root, "README.md"), "initial\n"); await execute("git", ["-C", root, "add", "README.md"]); await execute("git", ["-C", root, "-c", "user.name=Harness", "-c", "user.email=harness@example.invalid", "commit", "-m", "initial"]); return root; }
function state(runId: string, repositoryPath: string, artifactPath: string, status: RunState["status"]): RunState { const now = new Date().toISOString(); return { schemaVersion: 1, runId, repositoryPath, artifactPath, stage: status === "succeeded" ? "SUCCEEDED" : "FAILED", status, createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], checkpoints: [], mutatingActionsBlocked: false, manualHandoffRequested: false }; }

function gitRunner(root: string, received: StartRunOptions[], status: RunState["status"] = "succeeded") { return async (options: StartRunOptions): Promise<RunState> => { received.push(options); const sequence = received.length; const runId = `run-${sequence}`; const worktree = path.join(root, ".agent-harness", "fake-worktrees", runId); await mkdir(path.dirname(worktree), { recursive: true }); await execute("git", ["-C", root, "worktree", "add", "-b", `agent/fake-${sequence}`, worktree, options.baseRef!]); await writeFile(path.join(worktree, `turn-${sequence}.txt`), options.requirements!); await execute("git", ["-C", worktree, "add", `turn-${sequence}.txt`]); await execute("git", ["-C", worktree, "-c", "user.name=Harness", "-c", "user.email=harness@example.invalid", "commit", "-m", `turn ${sequence}`]); const artifacts = path.join(root, ".agent-harness", "runs", runId); const result = state(runId, worktree, artifacts, status); await new StateStore(artifacts).initialize(result); return result; }; }

describe("workspace conversations", () => {
  it("creates auditable turns and bases the next turn on the prior successful commit", async () => {
    const root = await repository(); const received: StartRunOptions[] = []; const runner = gitRunner(root, received); const first = await continueConversation({ workspace: root, prompt: "create feature", config: config(), runner }); const second = await continueConversation({ workspace: root, prompt: "now add validation", config: config(), conversationId: first.conversation.id, runner });
    const firstCommit = (await execute("git", ["-C", received[0]!.repository, "rev-parse", received[0]!.baseRef!])).stdout.trim(); expect(received[1]!.baseRef).not.toBe(firstCommit); expect(received[1]!.baseRef).toBe(first.conversation.turns[0]!.finalCommit); expect(second.conversation.turns).toHaveLength(2); expect(second.conversation.turns[1]!.baseCommit).toBe(second.conversation.turns[0]!.finalCommit); expect(received[1]!.requirements).toContain("create feature"); expect(received[1]!.requirements).toContain("now add validation"); const persisted = await readConversation(root, first.conversation.id); expect(persisted.memory.recent.map((turn) => turn.prompt)).toEqual(["create feature", "now add validation"]); expect(persisted.state.turns.every((turn) => !Object.hasOwn(turn, "prompt"))).toBe(true);
  });

  it("blocks a new mutating turn after a failed run", async () => {
    const root = await repository(); const received: StartRunOptions[] = []; const failed = await continueConversation({ workspace: root, prompt: "broken turn", config: config(), runner: gitRunner(root, received, "failed") }); expect(failed.conversation.status).toBe("blocked"); await expect(continueConversation({ workspace: root, prompt: "must not run", config: config(), conversationId: failed.conversation.id, runner: gitRunner(root, received) })).rejects.toThrow(/resume run run-1 first/); expect(received).toHaveLength(1);
  });

  it("persists the active run relationship as soon as the runner creates it", async () => {
    const root = await repository(); let observedRunId: string | undefined;
    const runner = async (options: StartRunOptions): Promise<RunState> => {
      await options.onCreated?.("run-active");
      observedRunId = (await readConversation(root)).state.activeRunId;
      return gitRunner(root, [])({ ...options, onCreated: undefined });
    };
    await continueConversation({ workspace: root, prompt: "persist recovery identity", config: config(), runner });
    expect(observedRunId).toBe("run-active");
  });

  it("compacts old facts deterministically within configured bounds", () => {
    const configured = config({ maxRecentTurns: 2, maxMemoryBytes: 4096 }); let memory: ConversationMemory = { schemaVersion: 1, conversationId: "conv-test", compacted: [], recent: [] }; const sample = state("run", "/repo", "/artifacts", "succeeded"); for (let sequence = 1; sequence <= 5; sequence++) memory = appendMemory(memory, sequence, `prompt ${sequence}`, { ...sample, runId: `run-${sequence}` }, `base-${sequence}`, `final-${sequence}`, configured); expect(memory.recent.map((turn) => turn.sequence)).toEqual([4, 5]); expect(memory.compacted).toHaveLength(3); expect(Buffer.byteLength(JSON.stringify(memory))).toBeLessThanOrEqual(4096);
  });

  it("attaches referenced content for the current run but retains only bounded provenance", async () => {
    const root = await repository(); await writeFile(path.join(root, "design.md"), "private design text\n"); const received: StartRunOptions[] = [];
    const result = await continueConversation({ workspace: root, prompt: "implement @design.md", config: config(), runner: gitRunner(root, received) });
    expect(received[0]!.requirements).toContain("private design text"); expect(received[0]!.references).toMatchObject([{ path: "design.md", bytes: 20 }]);
    const memory = (await readConversation(root, result.conversation.id)).memory; expect(memory.recent[0]!.prompt).toBe("implement @design.md"); expect(JSON.stringify(memory)).not.toContain("private design text"); expect(memory.recent[0]!.references[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid references before creating a conversation turn or invoking a runner", async () => {
    const root = await repository(); const received: StartRunOptions[] = [];
    await expect(continueConversation({ workspace: root, prompt: "read @missing.md", config: config(), runner: gitRunner(root, received) })).rejects.toThrow(/file reference validation failed/); expect(received).toHaveLength(0); await expect(readConversation(root)).rejects.toThrow(/no conversation found/);
  });
});
