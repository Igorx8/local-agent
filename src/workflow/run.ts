import { access, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { HarnessConfig } from "../config.js";
import { connectOpencode } from "../opencode/client.js";
import { OpencodeSessions, parseModelAlias } from "../opencode/sessions.js";
import { createModelManager } from "../models/manager.js";
import { loadModelRegistry } from "../models/registry.js";
import { changedFiles, createWorktree, inspectRepository, preflight } from "../git/workspace.js";
import { createCheckpoint } from "../git/checkpoints.js";
import { captureBaseline } from "../tools/baseline.js";
import { runGates } from "../tools/gates.js";
import { StateStore } from "../state/store.js";
import type { RunState } from "../state/types.js";
import { agentNames, OpenCodeRoleRunner } from "./role-runner.js";
import { WorkflowEngine, type WorkflowDependencies, type WorkflowInput } from "./engine.js";
import { writeArtifact, writeTextArtifact } from "./artifacts.js";
import { assertChangedPathsAllowed } from "../tools/scope.js";
import { runAdvancedVerification } from "../verification/suite.js";
import { appendHistoricalMetric, verificationProvenance } from "../verification/historical.js";
import { runRegressionProofAdapter } from "../verification/regression.js";
import { applyHandoffAbstraction, handoffAbstractionSchema, validateHandoff, writeHandoff, type HandoffData } from "../continuity/handoff.js";
import { bootstrapSession } from "../continuity/bootstrap.js";
import { redact } from "../telemetry/redact.js";

export interface StartRunOptions { repository: string; requirementsFile: string; config: HarnessConfig; definitionOfDone?: string; }
function runIdentifier(): string { return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`; }
function slug(value: string): string { return path.basename(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "task"; }

export async function startRun(options: StartRunOptions): Promise<RunState> {
  const repository = path.resolve(options.repository); await inspectRepository(repository); const runId = runIdentifier();
  const harnessRoot = path.join(repository, ".agent-harness"); const worktree = path.join(harnessRoot, "worktrees", runId); const branch = `${options.config.git.branchPrefix}${runId}-${slug(options.requirementsFile)}`;
  await preflight({ repository, workspaceRoot: harnessRoot, worktreePath: worktree, targetBranch: branch, allowDirtyWorktree: !options.config.git.requireCleanWorktree, protectedBranches: ["main", "master"] });
  await mkdir(harnessRoot, { recursive: true }); await createWorktree(repository, harnessRoot, worktree, branch);
  const artifacts = path.join(harnessRoot, "runs", runId); const store = new StateStore(artifacts); const now = new Date().toISOString();
  const initial: RunState = { schemaVersion: 1, runId, repositoryPath: worktree, artifactPath: artifacts, stage: "CREATED", status: "active", createdAt: now, updatedAt: now, counters: { inferenceRetries: 0, repairIterations: 0, contextHandoffs: 0 }, handoffs: [], mutatingActionsBlocked: false, manualHandoffRequested: false };
  await store.initialize(initial); const release = await store.acquireLock();
  try {
    await writeArtifact(artifacts, "config.snapshot.json", options.config);
    const requirements = await readFile(path.resolve(options.requirementsFile), "utf8"); await writeArtifact(artifacts, "requirements.json", { source: path.resolve(options.requirementsFile), content: requirements });
    const client = connectOpencode({ baseUrl: options.config.runtime.opencodeUrl, directory: worktree }); const sessions = new OpencodeSessions(client, worktree);
    const registry = await loadModelRegistry(options.config.modelRegistry); const manager = createModelManager(options.config, { registry, router: {}, process: {} });
    const contextWindows = Object.fromEntries(Object.entries(registry.models).map(([alias, model]) => [alias, model.contextSize]));
    const roleRunner = new OpenCodeRoleRunner(sessions, manager, options.config, async (role, sessionID) => { await writeArtifact(artifacts, `sessions/${Date.now()}-${role}-${sessionID}.json`, { role, sessionID, createdAt: new Date().toISOString() }); }, contextWindows);
    const dependencies: WorkflowDependencies = {
      async manualHandoffRequested() { try { await access(path.join(artifacts, "manual-handoff-request.json")); return true; } catch { return false; } },
      async clearManualHandoffRequest() { await unlink(path.join(artifacts, "manual-handoff-request.json")).catch(() => undefined); },
      async preflight() { const current = await inspectRepository(worktree); if (current.dirty) throw new Error("isolated worktree became dirty before baseline"); },
      async baseline() { const evidence = await captureBaseline(options.config, worktree, artifacts); return { commit: evidence.commit, treeHash: evidence.treeHash, gates: evidence.gates, artifactPath: path.join(artifacts, "baseline.json") }; },
      async gates(iteration) { return runGates(options.config, worktree, path.join(artifacts, "gates", `iteration-${iteration}`)); },
      async checkpoint(kind, iteration) { const files = await changedFiles(worktree); assertChangedPathsAllowed(files, options.config.scope.allowedPaths, [...options.config.scope.deniedPaths, ...options.config.security.deniedPathPatterns]); return createCheckpoint(worktree, kind, iteration); },
      async advancedVerification(files, challenge) { return runAdvancedVerification(options.config, worktree, artifacts, files, challenge); },
      async regressionProof(findings, triage, defective, repaired) { return runRegressionProofAdapter(options.config, worktree, path.join(artifacts, "repairs"), findings, triage, defective.commit, repaired.commit); },
      async continuity(event) {
        const identity = await inspectRepository(worktree); let acceptance: { criteria?: HandoffData["acceptanceCriteria"] } = {};
        if (event.state.acceptanceCriteriaArtifact) acceptance = JSON.parse(await readFile(event.state.acceptanceCriteriaArtifact, "utf8")) as typeof acceptance;
        const alias = parseModelAlias(options.config.models[event.role]).modelID; const model = registry.models[alias]; const sequence = event.state.counters.contextHandoffs + 1; const objective = event.objective.replace(/\s+/g, " ").slice(0, 1200);
        const data: HandoffData = { runId, previousSessionId: event.previousSessionId, newSessionRole: event.role, stage: event.stage, iteration: event.state.counters.repairIterations, objective, definitionOfDone: event.definitionOfDone, completed: [`Workflow reached ${event.stage}`], inProgress: [event.decision.reason], notStarted: [], acceptanceCriteria: acceptance.criteria ?? [], decisions: [`Handoff triggered by ${event.decision.reason} at ${(event.decision.usage * 100).toFixed(2)}% context usage`], repository: { path: worktree, branch: identity.branch, baselineCommit: event.state.baseline?.commit ?? identity.commit, currentCommit: identity.commit, dirty: identity.dirty }, runtime: [`model=${alias}`, `quantization=${model?.quantization ?? "unknown"}`, `context=${model?.contextSize ?? event.decision.contextWindow}`, ...(registry.artifacts?.[alias] ? [`sha256=${registry.artifacts[alias]!.sha256.join(",")}`, `bytes=${registry.artifacts[alias]!.bytes.join("+")}`] : [])], filesChanged: (await changedFiles(worktree)).map((file) => ({ path: file, purpose: "active workflow change" })), gates: event.gates.map((gate) => `${gate.required ? "required" : "optional"} ${gate.name} ${gate.status}; command=${gate.command} ${gate.args.join(" ")}; durationMs=${gate.durationMs}`), review: event.review, constraints: ["Local-only execution", "No automatic default-branch merge", "Configured commands remain executable plus argv", `Allowed files: ${options.config.scope.allowedPaths.join(", ") || "repository scope"}`, `Prohibited actions: ${["automatic default-branch merge", ...options.config.scope.deniedPaths].join(", ")}`], nextActions: [`Resume ${event.stage} for role ${event.role}`], references: [store.statePath] };
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt++) try {
          const selection = parseModelAlias(options.config.models[event.role]); await manager.ensureModel(selection.modelID); const summarySession = await sessions.create(`handoff abstraction: ${event.role}`, event.previousSessionId); manager.beginRequest(selection.modelID);
          try { await sessions.prompt({ sessionID: summarySession.id, agent: agentNames[event.role], model: selection, tools: { write: false, edit: false, bash: false }, text: `Summarize only semantic continuation fields from this redacted deterministic snapshot. Do not restate or alter identifiers, commits, paths, gates, findings, runtime identity, or acceptance status. Return JSON with completed, inProgress, notStarted, decisions, filePurposes, and nextActions.\n${JSON.stringify(redact(data))}` }); } finally { manager.endRequest(selection.modelID); }
          const summaryMessages = await sessions.messages(summarySession.id); const summaryResponse = [...summaryMessages].reverse().find((message) => message.info.role === "assistant"); const summaryRaw = summaryResponse?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? ""; const fenced = summaryRaw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const abstraction = handoffAbstractionSchema.parse(JSON.parse((fenced ?? summaryRaw).trim())); const finalData = applyHandoffAbstraction(data, abstraction); await writeArtifact(artifacts, `handoffs/${sequence}-${event.role}-abstraction.json`, { sessionId: summarySession.id, abstraction });
          const handoffPath = await writeHandoff(artifacts, sequence, event.role, finalData); await validateHandoff(handoffPath, finalData, { maxTokens: options.config.context.maxHandoffTokens, secretValues: [process.env[options.config.apiKeyEnv] ?? ""], actualRepository: data.repository, expectedRuntime: data.runtime }); const markdown = await readFile(handoffPath, "utf8");
          manager.beginRequest(selection.modelID); try { const bootstrap = await bootstrapSession(sessions, { previousSessionId: event.previousSessionId, role: agentNames[event.role], model: selection, handoff: markdown, expected: { repository: { path: worktree, branch: identity.branch, commit: identity.commit, dirty: identity.dirty }, objective, pendingAcceptanceCriteria: (acceptance.criteria ?? []).filter((item) => item.status !== "proven").map((item) => item.id), allowedFiles: options.config.scope.allowedPaths, prohibitedActions: ["automatic default-branch merge", ...options.config.scope.deniedPaths], nextAction: finalData.nextActions[0]! } }); return { path: handoffPath, newSessionId: bootstrap.sessionId }; } finally { manager.endRequest(selection.modelID); }
        } catch (error) { lastError = error; }
        throw lastError;
      },
      async recordHistorical(result) { const file = path.join(harnessRoot, "historical-metrics.jsonl"); await appendHistoricalMetric(file, { schemaVersion: 1, recordedAt: new Date().toISOString(), runId, repository, success: result.success, firstPassGateSuccess: result.firstPassGateSuccess, repairIterations: result.repairIterations, confirmedFindings: result.confirmedFindings, invalidFindings: result.invalidFindings, regressions: 0, testProvenance: verificationProvenance(result.verification), mutationScore: result.verification.mutation.score, flakyIncidents: result.verification.flaky.filter((item) => item.classification === "potentially_flaky").length, durationMs: result.durationMs }); return file; }
    };
    const input: WorkflowInput = { requirements, definitionOfDone: options.definitionOfDone ?? "All required gates pass and every acceptance criterion is proven." };
    return await new WorkflowEngine(options.config, store, roleRunner, dependencies).run(input);
  } finally { await release(); }
}

export async function readRun(repository: string, runId: string): Promise<RunState> { return new StateStore(path.join(path.resolve(repository), ".agent-harness", "runs", runId)).read(); }
export async function requestManualHandoff(repository: string, runId: string): Promise<string> { const runDirectory = path.join(path.resolve(repository), ".agent-harness", "runs", runId); const state = await new StateStore(runDirectory).read(); if (state.status !== "active") throw new Error(`run ${runId} is not active`); if (!state.activeSession) throw new Error(`run ${runId} has no active session to hand off`); return writeTextArtifact(runDirectory, "manual-handoff-request.json", `${JSON.stringify({ requestedAt: new Date().toISOString(), sessionId: state.activeSession.sessionId })}\n`); }
