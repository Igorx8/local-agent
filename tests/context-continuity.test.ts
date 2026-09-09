import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideContext, estimateTokensFromBytes, resolveTokenObservation, TurnBudgetHistory } from "../src/context/budget.js";
import { applyHandoffAbstraction, renderHandoff, validateHandoff, writeHandoff, type HandoffData } from "../src/continuity/handoff.js";
import { bootstrapSession, validateBootstrap } from "../src/continuity/bootstrap.js";
import type { OpencodeSessions } from "../src/opencode/sessions.js";
import { emergencyCompactionInstruction, opencodeCompactionPlugin } from "../src/continuity/compaction.js";
import { requestManualHandoff } from "../src/workflow/run.js";
import { StateStore } from "../src/state/store.js";

describe("context continuity", () => {
  it("uses the effective threshold and projected overflow without summing history", () => {
    const options = { warningThreshold: .7, prepareHandoffThreshold: .78, handoffThreshold: .9, hardStopThreshold: .95, reservedTokens: 20, expectedNextTurnTokens: 15 };
    const reserved = decideContext({ latestPromptTokens: 79, contextWindow: 100, provenance: "exact", source: "opencode_message_metadata" }, options); expect(reserved.effectiveHandoffThreshold).toBe(.8); expect(reserved.action).toBe("handoff"); expect(reserved.reason).toBe("projected_overflow");
    expect(decideContext({ latestPromptTokens: 96, contextWindow: 100, provenance: "exact", source: "opencode_message_metadata" }, options).action).toBe("hard_stop"); expect(estimateTokensFromBytes("12345678")).toMatchObject({ latestPromptTokens: 2, provenance: "estimated" });
    const history = new TurnBudgetHistory({ repair: 9000 }); history.record("planner", 100); history.record("planner", 200); expect(history.expected("planner")).toBe(150); expect(history.expected("repair")).toBe(9000);
    expect(resolveTokenObservation({ contextWindow: 1000, opencode: 12, llama: 13, localTokenizer: 14, content: "text" }).source).toBe("opencode_message_metadata"); expect(resolveTokenObservation({ contextWindow: 1000, llama: 13, localTokenizer: 14, content: "text" }).source).toBe("llama_usage"); expect(resolveTokenObservation({ contextWindow: 1000, localTokenizer: 14, content: "text" }).source).toBe("local_tokenizer"); expect(resolveTokenObservation({ contextWindow: 1000, content: "12345678" })).toMatchObject({ latestPromptTokens: 2, provenance: "estimated" });
  });

  it("writes and validates a bounded handoff with deterministic fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-")); const reference = path.join(root, "state.json"); await writeFile(reference, "{}");
    const data: HandoffData = { runId: "run-1", previousSessionId: "old", newSessionRole: "repair", stage: "REPAIRING", iteration: 2, objective: "Fix behavior", definitionOfDone: "Tests pass", completed: ["plan"], inProgress: ["repair"], notStarted: ["audit"], acceptanceCriteria: [{ id: "AC-X", requirement: "works", status: "pending", evidence: [] }], decisions: ["minimal fix"], repository: { path: root, branch: "agent/run", baselineCommit: "aaa", currentCommit: "bbb", dirty: false }, runtime: ["model=qwen"], filesChanged: [{ path: "src/x.ts", purpose: "fix" }], gates: ["required test failed"], review: { confirmed: ["REV-1"], rejected: [], unresolved: ["REV-1"] }, constraints: ["local only"], nextActions: ["run focused test"], references: [reference] };
    const file = await writeHandoff(root, 1, "repair", data); await expect(validateHandoff(file, data, { maxTokens: 6000, secretValues: ["actual-secret"] })).resolves.toBeUndefined(); const markdown = renderHandoff(data); expect(markdown).toContain("## Exact next actions"); expect(markdown).not.toContain("actual-secret");
    const abstracted = applyHandoffAbstraction(data, { completed: ["new summary"], inProgress: [], notStarted: [], decisions: [], filePurposes: { "src/x.ts": "semantic purpose" }, nextActions: ["continue safely"] }); expect(abstracted.repository).toEqual(data.repository); expect(abstracted.runId).toBe(data.runId); expect(abstracted.filesChanged[0]?.purpose).toBe("semantic purpose");
    await expect(validateHandoff(file, data, { maxTokens: 10 })).rejects.toThrow(/limit/);
  });

  it("rejects semantic or repository mismatch during bootstrap", () => {
    const expected = { repository: { path: "/repo", branch: "agent/run", commit: "abc", dirty: false }, objective: "task", pendingAcceptanceCriteria: ["AC-X"], allowedFiles: ["src"], prohibitedActions: ["merge"], nextAction: "test" };
    const actual = { ...expected, completed: ["plan"] }; expect(() => validateBootstrap(actual, expected)).not.toThrow(); expect(() => validateBootstrap({ ...actual, nextAction: "guess" }, expected)).toThrow(/semantic/);
  });

  it("accepts reordered deterministic sets and rejects omitted, invented, or altered values", () => {
    const expected = { repository: { path: "/repo", branch: "agent/run", commit: "abc", dirty: false }, objective: "task", pendingAcceptanceCriteria: ["AC-1", "AC-2"], allowedFiles: ["src", "test"], prohibitedActions: ["merge", "push"], nextAction: "test" };
    const actual = { ...expected, completed: [], pendingAcceptanceCriteria: ["AC-2", "AC-1"], allowedFiles: ["test", "src"], prohibitedActions: ["push", "merge"] };
    expect(() => validateBootstrap(actual, expected)).not.toThrow();
    expect(() => validateBootstrap({ ...actual, pendingAcceptanceCriteria: ["AC-1"] }, expected)).toThrow(/pending acceptance/);
    expect(() => validateBootstrap({ ...actual, pendingAcceptanceCriteria: ["AC-1", "AC-2", "AC-X"] }, expected)).toThrow(/pending acceptance/);
    expect(() => validateBootstrap({ ...actual, repository: { ...actual.repository, commit: "changed" } }, expected)).toThrow(/repository/);
  });

  it("retries an invalid bootstrap in a fresh session and aborts the rejected session", async () => {
    const expected = { repository: { path: "/repo", branch: "agent/run", commit: "abc", dirty: false }, objective: "task", pendingAcceptanceCriteria: ["AC-X"], allowedFiles: ["src"], prohibitedActions: ["merge"], nextAction: "test" }; let created = 0; const aborted: string[] = []; const prompts: string[] = [];
    const sessions = { async create() { return { id: `session-${++created}` }; }, async prompt(request: { text: string }) { prompts.push(request.text); }, async messages(id: string) { const value = id === "session-1" ? {} : { continuity: "confirmed", objectiveUnderstood: true, nextActionUnderstood: true, completed: ["verified"], contradictions: [] }; return [{ info: { role: "assistant" }, parts: [{ type: "text", text: JSON.stringify(value) }] }]; }, async abort(id: string) { aborted.push(id); return true; } } as unknown as OpencodeSessions;
    const result = await bootstrapSession(sessions, { previousSessionId: "old", role: "planner", model: { providerID: "llama.cpp", modelID: "qwen" }, handoff: "handoff", expected, retries: 1 });
    expect(result.sessionId).toBe("session-2"); expect(aborted).toEqual(["session-1"]);
    expect(prompts[0]).not.toContain("/repo"); expect(prompts[0]).not.toContain("AC-X"); expect(prompts[0]).toContain("semantic continuity only");
  });

  it("accepts a validated bootstrap JSON object wrapped in explanatory text", async () => {
    const expected = { repository: { path: "/repo", branch: "agent/run", commit: "abc", dirty: false }, objective: "task", pendingAcceptanceCriteria: [], allowedFiles: [], prohibitedActions: ["merge"], nextAction: "test" }; const value = { continuity: "confirmed", objectiveUnderstood: true, nextActionUnderstood: true, completed: ["verified"], contradictions: [] };
    const sessions = { async create() { return { id: "session-1" }; }, async prompt() {}, async messages() { return [{ info: { role: "assistant" }, parts: [{ type: "text", text: `verification follows\n${JSON.stringify(value)}\ncomplete` }] }]; }, async abort() { return true; } } as unknown as OpencodeSessions;
    await expect(bootstrapSession(sessions, { previousSessionId: "old", role: "planner", model: { providerID: "llama.cpp", modelID: "qwen" }, handoff: "handoff", expected })).resolves.toMatchObject({ sessionId: "session-1", verification: { ...expected, completed: ["verified"] } });
  });

  it("fails closed when semantic bootstrap reports a contradiction", async () => {
    const expected = { repository: { path: "/repo", branch: "agent/run", commit: "abc", dirty: false }, objective: "task", pendingAcceptanceCriteria: [], allowedFiles: [], prohibitedActions: ["merge"], nextAction: "test" };
    const sessions = { async create() { return { id: "session-1" }; }, async prompt() {}, async messages() { return [{ info: { role: "assistant" }, parts: [{ type: "text", text: JSON.stringify({ continuity: "confirmed", objectiveUnderstood: true, nextActionUnderstood: true, completed: [], contradictions: ["objective conflicts"] }) }] }]; }, async abort() { return true; } } as unknown as OpencodeSessions;
    await expect(bootstrapSession(sessions, { previousSessionId: "old", role: "planner", model: { providerID: "llama.cpp", modelID: "qwen" }, handoff: "handoff", expected })).rejects.toThrow();
  });

  it("preserves mandatory emergency-compaction fields", () => {
    for (const phrase of ["workflow stage", "acceptance-criteria", "Git commits", "failed gates", "unresolved findings", "exact next action"]) expect(emergencyCompactionInstruction).toContain(phrase); expect(opencodeCompactionPlugin()).toContain("experimental.session.compacting");
  });

  it("queues a manual handoff without rewriting active run state", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "manual-handoff-")); const runDirectory = path.join(repository, ".agent-harness", "runs", "run-1"); const now = new Date().toISOString(); const store = new StateStore(runDirectory); await store.initialize({ schemaVersion: 1, runId: "run-1", repositoryPath: repository, artifactPath: runDirectory, stage: "PLANNING", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], checkpoints: [], mutatingActionsBlocked: false, manualHandoffRequested: false, activeSession: { role: "planner", sessionId: "ses-1" } }); const request = await requestManualHandoff(repository, "run-1"); expect(await readFile(request, "utf8")).toContain("ses-1"); expect((await store.read()).manualHandoffRequested).toBe(false);
  });
});
