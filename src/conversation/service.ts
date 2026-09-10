import { createHash } from "node:crypto";
import path from "node:path";
import type { HarnessConfig } from "../config.js";
import { ensureHarnessIgnored, inspectRepository } from "../git/workspace.js";
import { StateStore } from "../state/store.js";
import type { RunState } from "../state/types.js";
import { appendEvent } from "../telemetry/events.js";
import { startRun, type StartRunOptions } from "../workflow/run.js";
import { appendMemory, conversationPrompt } from "./memory.js";
import { ConversationStore, conversationRoot, latestConversation } from "./store.js";
import type { ConversationState } from "./types.js";
import { referenceProvenance, resolveFileReferences } from "../input/file-references.js";

export interface ContinueConversationOptions { workspace: string; prompt: string; config: HarnessConfig; conversationId?: string; newConversation?: boolean; definitionOfDone?: string; signal?: AbortSignal; onRunCreated?(runId: string, repositoryPath: string, artifactPath: string): Promise<void> | void; runner?: (options: StartRunOptions) => Promise<RunState>; }
export interface ConversationTurnResult { conversation: ConversationState; run: RunState; created: boolean; }
function identifier(): string { return `conv-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`; }

async function loadOrCreate(workspace: string, requested?: string, forceNew = false): Promise<{ store: ConversationStore; state: ConversationState; created: boolean }> {
  const existing = forceNew ? undefined : requested ?? await latestConversation(workspace);
  if (existing) { const store = new ConversationStore(path.join(conversationRoot(workspace), existing)); return { store, state: await store.readState(), created: false }; }
  const id = identifier(); const store = new ConversationStore(path.join(conversationRoot(workspace), id)); const now = new Date().toISOString(); const state: ConversationState = { schemaVersion: 1, id, workspace, status: "active", createdAt: now, updatedAt: now, turns: [] }; await store.initialize(state); return { store, state, created: true };
}

export async function continueConversation(options: ContinueConversationOptions): Promise<ConversationTurnResult> {
  const prompt = options.prompt.trim(); if (!prompt) throw new Error("conversation prompt cannot be empty"); if (Buffer.byteLength(prompt, "utf8") > options.config.conversation.maxMemoryBytes / 2) throw new Error("conversation prompt is too large for bounded memory"); await ensureHarnessIgnored(options.workspace);
  const resolved = await resolveFileReferences(options.workspace, prompt, options.config); const references = referenceProvenance(resolved.references);
  if (options.newConversation && options.conversationId) throw new Error("cannot combine newConversation with conversationId"); const selected = await loadOrCreate(options.workspace, options.conversationId, options.newConversation); const release = await selected.store.acquireLock();
  try {
    let state = await selected.store.readState(); let memory = await selected.store.readMemory(); const identity = await inspectRepository(options.workspace); let baseCommit = identity.commit; const previous = state.turns.at(-1);
    if (previous) {
      if (!previous.runId || !previous.artifactPath) throw new Error("previous conversation turn has no auditable run"); const prior = await new StateStore(previous.artifactPath).read();
      if (prior.status === "succeeded" && previous.status !== "succeeded") { const priorIdentity = await inspectRepository(prior.repositoryPath); previous.status = "succeeded"; previous.finalCommit = priorIdentity.commit; previous.completedAt = prior.updatedAt; state.status = "active"; const remembered = memory.recent.find((entry) => entry.sequence === previous.sequence); if (remembered) { remembered.status = "succeeded"; remembered.finalCommit = priorIdentity.commit; remembered.summary = `stage=${prior.stage}; repairs=${prior.counters.repairIterations}; handoffs=${prior.counters.contextHandoffs}`; await selected.store.writeMemory(memory); } await selected.store.writeState(state); }
      if (previous.status !== "succeeded" || !previous.finalCommit) throw new Error(`conversation ${state.id} is blocked by turn ${previous.sequence}; resume run ${previous.runId} first`);
      const priorIdentity = await inspectRepository(prior.repositoryPath); if (priorIdentity.dirty || priorIdentity.commit !== previous.finalCommit) { state.status = "blocked"; await selected.store.writeState(state); throw new Error(`conversation ${state.id} previous worktree no longer matches ${previous.finalCommit}`); } baseCommit = previous.finalCommit;
    }
    if (state.status === "closed") throw new Error(`conversation ${state.id} is closed`); const sequence = state.turns.length + 1; const startedAt = new Date().toISOString(); state.turns.push({ sequence, promptSha256: createHash("sha256").update(prompt).digest("hex"), promptPreview: prompt.replace(/\s+/g, " ").slice(0, 160), status: "running", baseCommit, startedAt }); state.status = "active"; await selected.store.writeState(state); await appendEvent(selected.store.directory, { type: "conversation.turn.start", message: `Turn ${sequence} started`, data: { sequence, baseCommit } });
    let runId: string | undefined;
    try {
      const run = await (options.runner ?? startRun)({ repository: options.workspace, requirements: conversationPrompt(state.id, resolved.prompt, memory), references, config: options.config, definitionOfDone: options.definitionOfDone, baseRef: baseCommit, conversation: { id: state.id, turn: sequence }, signal: options.signal, async onCreated(id, repositoryPath, artifactPath) { runId = id; state.activeRunId = id; state.turns.at(-1)!.runId = id; await selected.store.writeState(state); await options.onRunCreated?.(id, repositoryPath, artifactPath); } }); const finalIdentity = await inspectRepository(run.repositoryPath); const successful = run.status === "succeeded" && !finalIdentity.dirty; const completed = state.turns.at(-1)!;
      completed.runId = run.runId; completed.status = successful ? "succeeded" : run.status === "paused" ? "paused" : run.status === "escalated" ? "escalated" : "failed"; completed.finalCommit = successful ? finalIdentity.commit : undefined; completed.artifactPath = run.artifactPath; completed.completedAt = new Date().toISOString(); completed.summary = `stage=${run.stage}; repairs=${run.counters.repairIterations}; handoffs=${run.counters.contextHandoffs}`; state.activeRunId = undefined; state.status = successful ? "active" : "blocked";
      memory = appendMemory(memory, sequence, prompt, run, baseCommit, completed.finalCommit, options.config, references); await selected.store.writeMemory(memory); await selected.store.writeState(state); await appendEvent(selected.store.directory, { type: "conversation.turn.end", message: `Turn ${sequence} ${completed.status}`, data: { sequence, runId: run.runId, finalCommit: completed.finalCommit } }); return { conversation: state, run, created: selected.created };
    } catch (error) {
      const completed = state.turns.at(-1)!; completed.runId = runId; completed.status = "failed"; completed.completedAt = new Date().toISOString(); completed.summary = error instanceof Error ? error.message : String(error); state.activeRunId = undefined; state.status = "blocked"; await selected.store.writeState(state); await appendEvent(selected.store.directory, { type: "conversation.turn.error", message: completed.summary, data: { sequence, runId } }).catch(() => undefined); throw error;
    }
  } finally { await release(); }
}

export async function readConversation(workspace: string, id?: string): Promise<{ state: ConversationState; memory: Awaited<ReturnType<ConversationStore["readMemory"]>> }> { const selected = id ?? await latestConversation(workspace); if (!selected) throw new Error("no conversation found in this workspace"); const store = new ConversationStore(path.join(conversationRoot(workspace), selected)); return { state: await store.readState(), memory: await store.readMemory() }; }
