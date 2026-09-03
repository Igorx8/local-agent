import type { HarnessConfig } from "../config.js";
import type { RunState } from "../state/types.js";
import type { StateStore } from "../state/store.js";
import type { GateResult } from "../tools/gates.js";
import { requiredGatesPassed } from "../tools/gates.js";
import { compareGateResults } from "../tools/baseline.js";
import { mergeReviews } from "../review/merge.js";
import { evaluateProgress, type IterationEvidence } from "../review/progress.js";
import { confirmedFindings, requiresHumanDecision, validateRegressionEvidence } from "../review/validate.js";
import { acceptanceMatrixSchema, auditSchema, oracleTestsSchema, planSchema, reviewSchema, triageSchema, workResultSchema, type AcceptanceMatrix, type Finding, type Triage } from "./contracts.js";
import { challengePlanSchema, type AdvancedVerificationResult } from "../verification/types.js";
import { advancedVerificationPassed } from "../verification/suite.js";
import { validateRegressionProofs, type RegressionProof } from "../verification/regression.js";
import { decideContext, TurnBudgetHistory, type ContextDecision } from "../context/budget.js";
import type { AgentRole } from "../opencode/agents.js";
import { assertTransition } from "./transitions.js";
import { writeArtifact } from "./artifacts.js";
import type { RoleInvocation, RoleResult, RoleRunner } from "./role-runner.js";
import { parseModelAlias } from "../opencode/sessions.js";
import { appendEvent } from "../telemetry/events.js";

export interface BaselineResult { commit: string; treeHash: string; gates: GateResult[]; artifactPath: string; }
export interface CheckpointResult { commit: string; treeHash: string; changedFiles: string[]; }
export interface WorkflowDependencies {
  preflight(): Promise<void>;
  baseline(): Promise<BaselineResult>;
  gates(iteration: number, oracleArtifact: string): Promise<GateResult[]>;
  checkpoint(kind: "implementation" | "repair", iteration: number): Promise<CheckpointResult>;
  advancedVerification?(changedFiles: string[], challenge: import("../verification/types.js").ChallengePlan): Promise<AdvancedVerificationResult>;
  regressionProof?(findings: Finding[], triage: Triage, defective: CheckpointResult, repaired: CheckpointResult): Promise<RegressionProof[]>;
  recordHistorical?(result: { success: boolean; firstPassGateSuccess: boolean; repairIterations: number; confirmedFindings: number; invalidFindings: number; verification: AdvancedVerificationResult; durationMs: number }): Promise<string>;
  continuity?(event: { state: RunState; stage: RunState["stage"]; role: AgentRole; previousSessionId: string; decision: ContextDecision; objective: string; definitionOfDone: string; gates: GateResult[]; review: { confirmed: string[]; rejected: string[]; unresolved: string[] } }): Promise<{ path: string; newSessionId: string }>;
  manualHandoffRequested?(): Promise<boolean>;
  clearManualHandoffRequest?(): Promise<void>;
}
export interface WorkflowInput { requirements: string; definitionOfDone: string; publicContracts?: string[]; }

export class WorkflowEngine {
  private state!: RunState;
  private previousEvidence?: IterationEvidence;
  private stagnantRounds = 0;
  private priorConfirmedIds = new Set<string>();
  private rootCauseCounts = new Map<string, number>();
  private sessionIds = new Set<string>();
  private readonly turnBudgets: TurnBudgetHistory;
  private currentInput?: WorkflowInput;
  private latestGates: GateResult[] = [];
  private latestReview = { confirmed: [] as string[], rejected: [] as string[], unresolved: [] as string[] };
  constructor(private readonly config: HarnessConfig, private readonly store: StateStore, private readonly roles: RoleRunner, private readonly dependencies: WorkflowDependencies) { this.turnBudgets = new TurnBudgetHistory(config.context.expectedNextTurnTokens); }

  private async transition(stage: RunState["stage"]): Promise<void> {
    assertTransition(this.state.stage, stage); const terminal = stage === "SUCCEEDED" ? "succeeded" : stage === "FAILED" ? "failed" : stage === "ESCALATED" ? "escalated" : "active";
    this.state = { ...this.state, stage, status: terminal }; await this.store.write(this.state); await this.observe({ type: "workflow.stage", message: `Workflow entered ${stage}`, data: { stage, status: terminal } });
  }
  private async observe(event: Parameters<typeof appendEvent>[1]): Promise<void> { await appendEvent(this.state.artifactPath, event).catch(() => undefined); }
  private async artifact(name: string, value: unknown): Promise<string> { return writeArtifact(this.state.artifactPath, name, value); }
  private async invoke<T>(invocation: RoleInvocation, schema: import("zod").z.ZodType<T>): Promise<T> {
    const persisted = await this.store.read(); const manualBefore = persisted.manualHandoffRequested || await this.dependencies.manualHandoffRequested?.() === true; if (manualBefore) { this.state = persisted; this.state.manualHandoffRequested = true; const prior = persisted.activeSession; if (!prior) throw new Error("manual handoff requested without an active session"); const observation = persisted.context ? { latestPromptTokens: persisted.context.latestPromptTokens, contextWindow: persisted.context.contextWindow, provenance: persisted.context.provenance, source: persisted.context.source as import("../context/budget.js").TokenObservation["source"] } : { latestPromptTokens: 0, contextWindow: 65536, provenance: "estimated" as const, source: "byte_estimate" as const }; await this.performHandoff(invocation.role, prior.sessionId, { ...observation, usage: observation.latestPromptTokens / observation.contextWindow, projectedTokens: observation.latestPromptTokens, reservedTokens: this.config.context.reservedTokens, effectiveHandoffThreshold: this.config.context.handoffThreshold, action: "handoff", reason: "manual" }); }
    if (this.state.mutatingActionsBlocked) throw new Error("new model action refused while context handoff is pending");
    const alias = parseModelAlias(this.config.models[invocation.role]).modelID; this.state.activeModel = { role: invocation.role, alias, lifecycle: "generating" }; await this.store.write(this.state); await this.observe({ type: "agent.start", message: `${invocation.role} started`, data: { role: invocation.role, alias, iteration: invocation.iteration } });
    let result: RoleResult<T> | undefined; let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.workflow.inferenceRetries; attempt++) try { result = await this.roles.invoke(invocation, schema); break; } catch (error) { lastError = error; if (attempt < this.config.workflow.inferenceRetries) { this.state.counters.inferenceRetries++; await this.store.write(this.state); } }
    if (!result) throw lastError; if (this.sessionIds.has(result.sessionID)) throw new Error(`role runner reused session: ${result.sessionID}`); this.sessionIds.add(result.sessionID);
    const external = await this.store.read(); this.state.manualHandoffRequested ||= external.manualHandoffRequested || await this.dependencies.manualHandoffRequested?.() === true; this.state.mutatingActionsBlocked ||= external.mutatingActionsBlocked; this.state.activeSession = { role: invocation.role, sessionId: result.sessionID }; this.state.activeModel = { role: invocation.role, alias: result.telemetry?.alias ?? alias, lifecycle: "healthy", requestDurationMs: result.telemetry?.requestDurationMs, tokensPerSecond: result.telemetry?.tokensPerSecond }; await this.store.write(this.state); await this.observe({ type: "agent.end", message: `${invocation.role} completed`, data: { role: invocation.role, alias, durationMs: result.telemetry?.requestDurationMs } }); await this.artifact(`responses/${invocation.iteration}-${invocation.role}-${result.sessionID}.json`, { sessionID: result.sessionID, role: invocation.role, raw: result.raw, context: result.context, telemetry: result.telemetry });
    if (this.state.manualHandoffRequested) { const observation = result.context ?? { latestPromptTokens: 0, contextWindow: 65536, provenance: "estimated" as const, source: "byte_estimate" as const }; await this.performHandoff(invocation.role, result.sessionID, { ...observation, usage: observation.latestPromptTokens / observation.contextWindow, projectedTokens: observation.latestPromptTokens, reservedTokens: this.config.context.reservedTokens, effectiveHandoffThreshold: this.config.context.handoffThreshold, action: "handoff", reason: "manual" }); } else if (result.context) await this.handleContext(invocation.role, result.sessionID, result.context);
    return result.value;
  }
  private prompt(task: string, data: unknown): string { return `${task}\nReturn JSON only matching the requested contract.\nInput:\n${JSON.stringify(data, null, 2)}`; }

  async run(input: WorkflowInput): Promise<RunState> {
    const startedAt = performance.now();
    this.currentInput = input;
    this.state = await this.store.read();
    try {
      await this.transition("PREFLIGHT"); await this.dependencies.preflight();
      await this.transition("BASELINE_CREATED"); await this.transition("BASELINE_GATES_RUNNING");
      const baseline = await this.dependencies.baseline(); this.state.baseline = { commit: baseline.commit, treeHash: baseline.treeHash, gatesArtifact: baseline.artifactPath }; await this.store.write(this.state); await this.observe({ type: "baseline.result", message: "Baseline captured", data: { commit: baseline.commit, passed: requiredGatesPassed(baseline.gates) } });
      await this.transition("BASELINE_CAPTURED");
      await this.transition("ACCEPTANCE_CRITERIA_GENERATING");
      const acceptance = await this.invoke({ role: "planner", iteration: 0, freshSession: true, artifactReferences: [], prompt: this.prompt("Derive implementation-independent acceptance criteria from the requirements.", input) }, acceptanceMatrixSchema);
      await this.transition("ACCEPTANCE_CRITERIA_VALIDATING"); const acceptancePath = await this.artifact("acceptance-criteria.json", acceptance); this.state.acceptanceCriteriaArtifact = acceptancePath; await this.store.write(this.state);
      await this.transition("ORACLE_DESIGNING");
      const oracle = await this.invoke({ role: "testArchitect", iteration: 0, freshSession: true, artifactReferences: [acceptancePath], prompt: this.prompt("Design independent oracle tests before any implementation exists. Do not inspect an implementation diff.", { requirements: input.requirements, publicContracts: input.publicContracts ?? [], acceptance }) }, oracleTestsSchema);
      await this.transition("ORACLE_VALIDATING"); this.validateOracle(oracle.tests.flatMap((test) => test.acceptanceCriteria), acceptance); const oraclePath = await this.artifact("oracle-tests.json", oracle); this.state.oracleTestsArtifact = oraclePath; await this.store.write(this.state);
      await this.transition("PLANNING");
      const plan = await this.invoke({ role: "planner", iteration: 0, freshSession: true, artifactReferences: [acceptancePath], prompt: this.prompt("Create an implementation plan mapped to acceptance criteria.", { requirements: input.requirements, acceptance }) }, planSchema);
      await this.transition("PLAN_VALIDATION"); this.validateReferences(plan.steps.flatMap((step) => step.acceptanceCriteria), acceptance, "plan"); const planPath = await this.artifact("plan.json", plan);
      await this.transition("IMPLEMENTING");
      const implementation = await this.invoke({ role: "implementer", iteration: 0, freshSession: true, artifactReferences: [acceptancePath, planPath], prompt: this.prompt("Implement the approved plan. The independent oracle tests are intentionally hidden until the first checkpoint.", { requirements: input.requirements, acceptance, plan }) }, workResultSchema);
      await this.artifact("implementation.json", implementation); await this.transition("IMPLEMENTATION_CHECKPOINT"); let checkpoint = await this.dependencies.checkpoint("implementation", 0); await this.observe({ type: "checkpoint", message: "Implementation checkpoint created", data: { commit: checkpoint.commit, iteration: 0 } });

      let iteration = 0; let incremental = false; let firstPassGateSuccess = false; let totalConfirmed = 0; let totalInvalid = 0; const allChangedFiles = new Set(checkpoint.changedFiles);
      while (true) {
        await this.transition("GATES_RUNNING"); const gates = await this.dependencies.gates(iteration, oraclePath); this.latestGates = gates; if (iteration === 0) firstPassGateSuccess = requiredGatesPassed(gates); await this.artifact(`gates/iteration-${iteration}.json`, { gates, baselineAttribution: compareGateResults(baseline.gates, gates) }); for (const gate of gates) await this.observe({ type: "gate.result", message: `${gate.name} ${gate.status}`, data: { name: gate.name, status: gate.status, durationMs: gate.durationMs, exitCode: gate.exitCode, iteration } });
        if (incremental) await this.transition("INCREMENTAL_REVIEW");
        await this.transition("REPOSITORY_REVIEWING");
        const repositoryReview = await this.invoke({ role: "repositoryReviewer", iteration, freshSession: true, artifactReferences: [acceptancePath, planPath], prompt: this.prompt("Review repository integration, regressions, scope, and maintainability. Provide evidence, not preferences.", { requirements: input.requirements, acceptance, plan, gates, iteration }) }, reviewSchema);
        await this.artifact(`reviews/${iteration}-repository.json`, repositoryReview);
        await this.transition("REQUIREMENTS_REVIEWING");
        const requirementsReview = await this.invoke({ role: "requirementsReviewer", iteration, freshSession: true, artifactReferences: [acceptancePath, planPath], prompt: this.prompt("Independently review compliance with requirements and acceptance criteria.", { requirements: input.requirements, acceptance, plan, gates, iteration }) }, reviewSchema);
        await this.artifact(`reviews/${iteration}-requirements.json`, requirementsReview);
        await this.transition("REVIEWS_MERGING"); const merged = mergeReviews(repositoryReview, requirementsReview); await this.artifact(`reviews/${iteration}-merged.json`, { findings: merged });
        await this.transition("FINDINGS_VALIDATION");
        const triage = await this.invoke({ role: "validator", iteration, freshSession: true, artifactReferences: [`reviews/${iteration}-merged.json`], prompt: this.prompt("Validate every finding against its evidence and classify it.", { findings: merged }) }, triageSchema);
        this.validateTriage(merged, triage); await this.artifact(`reviews/${iteration}-triage.json`, triage); const confirmed = confirmedFindings(merged, triage); this.latestReview = { confirmed: confirmed.map((finding) => finding.id), rejected: triage.findings.filter((item) => item.classification === "invalid").map((item) => `${item.findingId}: ${item.evidence}`), unresolved: triage.findings.filter((item) => item.classification === "requires_human_decision").map((item) => item.findingId) }; totalConfirmed += confirmed.length; totalInvalid += triage.findings.filter((item) => item.classification === "invalid").length; validateRegressionEvidence(confirmed, triage);
        if (requiresHumanDecision(merged, triage)) { await this.transition("ESCALATED"); return this.state; }
        await this.transition("PROGRESS_EVALUATION");
        const evidence: IterationEvidence = { gates, confirmed, provenCriteria: acceptance.criteria.filter((criterion) => criterion.status === "proven").length, changedFiles: checkpoint.changedFiles.length };
        const progress = evaluateProgress(this.previousEvidence, evidence); await this.artifact(`reviews/${iteration}-progress.json`, progress);
        const blocking = confirmed.filter((finding) => finding.severity === "critical" || finding.severity === "high");
        if (progress.decision === "escalate" || this.repeatedDefect(blocking, triage)) { await this.transition("ESCALATED"); return this.state; }
        if (!blocking.length && requiredGatesPassed(gates)) break;
        if (progress.decision === "stop_stagnated") this.stagnantRounds++; else this.stagnantRounds = 0;
        if (this.stagnantRounds >= this.config.workflow.stopAfterConsecutiveStagnantIterations || this.state.counters.repairIterations >= this.config.workflow.adaptiveReviewMaximum || (this.state.counters.repairIterations >= this.config.workflow.maxReviewIterations && progress.improvements.length === 0)) { await this.transition("ESCALATED"); return this.state; }
        this.previousEvidence = evidence; this.priorConfirmedIds = new Set(blocking.map((finding) => finding.id));
        await this.transition("REPAIRING");
        const repair = await this.invoke({ role: "repair", iteration: iteration + 1, freshSession: true, artifactReferences: [oraclePath, `reviews/${iteration}-triage.json`], prompt: this.prompt("Repair confirmed findings only. Add a regression test for every testable defect and demonstrate fail-before/pass-after evidence.", { confirmedFindings: blocking, triage: triage.findings.filter((item) => blocking.some((finding) => finding.id === item.findingId)), oracleArtifact: oraclePath }) }, workResultSchema);
        await this.artifact(`repairs/${iteration + 1}.json`, repair); this.state.counters.repairIterations++; await this.store.write(this.state);
        await this.transition("REPAIR_CHECKPOINT"); const defective = checkpoint; checkpoint = await this.dependencies.checkpoint("repair", iteration + 1); await this.observe({ type: "checkpoint", message: "Repair checkpoint created", data: { commit: checkpoint.commit, iteration: iteration + 1 } }); checkpoint.changedFiles.forEach((file) => allChangedFiles.add(file));
        const testable = confirmed.filter((finding) => triage.findings.find((item) => item.findingId === finding.id)?.testable);
        if (testable.length) {
          if (!this.dependencies.regressionProof) throw new Error("testable confirmed findings require a configured deterministic regression-proof adapter");
          const proofs = validateRegressionProofs(testable.map((finding) => finding.id), await this.dependencies.regressionProof(testable, triage, defective, checkpoint)); await this.artifact(`repairs/${iteration + 1}-regression-proof.json`, proofs);
        }
        iteration++; incremental = true;
      }
      await this.transition("ADVERSARIAL_TESTING");
      const changedFiles = [...allChangedFiles].sort(); const challenge = await this.invoke({ role: "adversarialVerifier", iteration, freshSession: true, artifactReferences: [acceptancePath, oraclePath], prompt: this.prompt("Design challenge scenarios for invalid input, boundaries, state failures, partial failures, concurrency, and idempotency where relevant.", { requirements: input.requirements, acceptance, changedFiles }) }, challengePlanSchema);
      this.validateReferences(challenge.scenarios.flatMap((scenario) => scenario.acceptanceCriteria), acceptance, "adversarial challenge plan"); await this.artifact("adversarial/challenge-plan.json", challenge);
      const verification = this.dependencies.advancedVerification ? await this.dependencies.advancedVerification(changedFiles, challenge) : this.skippedVerification(changedFiles);
      this.validateReferences([...verification.adversarial.tests, ...verification.property.tests].flatMap((test) => test.acceptanceCriteria), acceptance, "advanced verification");
      await this.artifact("adversarial/results.json", verification.adversarial); await this.transition("PROPERTY_TESTING"); await this.artifact("property-testing.json", verification.property);
      await this.transition("MUTATION_TESTING"); await this.artifact("mutation/results.json", verification.mutation); await this.transition("FLAKY_ANALYSIS"); await this.artifact("flaky-analysis/results.json", verification.flaky);
      if (!advancedVerificationPassed(verification)) { await this.transition("FAILED"); if (this.dependencies.recordHistorical) { const historical = await this.dependencies.recordHistorical({ success: false, firstPassGateSuccess, repairIterations: this.state.counters.repairIterations, confirmedFindings: totalConfirmed, invalidFindings: totalInvalid, verification, durationMs: Math.round(performance.now() - startedAt) }); this.state.historicalMetricsArtifact = historical; await this.store.write(this.state); } return this.state; }
      await this.transition("FINAL_AUDIT");
      const audit = await this.invoke({ role: "auditor", iteration, freshSession: true, artifactReferences: [acceptancePath, planPath, oraclePath], prompt: this.prompt("Perform a final independent audit against every acceptance criterion.", { requirements: input.requirements, definitionOfDone: input.definitionOfDone, acceptance }) }, auditSchema);
      this.validateReferences(audit.acceptanceCriteria.map((criterion) => criterion.id), acceptance, "audit"); if (new Set(audit.acceptanceCriteria.map((criterion) => criterion.id)).size !== acceptance.criteria.length) throw new Error("audit must address every acceptance criterion"); await this.artifact("audit.json", audit);
      if (audit.decision === "requires_human_decision") await this.transition("ESCALATED");
      else if (audit.decision === "pass" && audit.acceptanceCriteria.every((criterion) => criterion.status === "proven") && !audit.findings.some((finding) => ["critical", "high"].includes(finding.severity))) await this.transition("SUCCEEDED");
      else await this.transition("FAILED");
      if (this.dependencies.recordHistorical) { const historical = await this.dependencies.recordHistorical({ success: this.state.status === "succeeded", firstPassGateSuccess, repairIterations: this.state.counters.repairIterations, confirmedFindings: totalConfirmed, invalidFindings: totalInvalid, verification, durationMs: Math.round(performance.now() - startedAt) }); this.state.historicalMetricsArtifact = historical; await this.store.write(this.state); }
      return this.state;
    } catch (error) {
      await this.artifact("logs/workflow-error.json", { stage: this.state.stage, error: error instanceof Error ? error.message : String(error) }); await this.observe({ type: "error", message: error instanceof Error ? error.message : String(error), data: { stage: this.state.stage } });
      if (!["SUCCEEDED", "FAILED", "ESCALATED"].includes(this.state.stage)) { const target = this.state.stage === "PREFLIGHT" || this.state.stage === "BASELINE_GATES_RUNNING" || this.state.stage === "IMPLEMENTATION_CHECKPOINT" || this.state.stage === "REPAIR_CHECKPOINT" ? "FAILED" : "ESCALATED"; await this.transition(target); }
      return this.state;
    }
  }
  private validateOracle(references: string[], acceptance: AcceptanceMatrix): void { this.validateReferences(references, acceptance, "oracle"); }
  private validateReferences(references: string[], acceptance: AcceptanceMatrix, artifact: string): void { const ids = new Set(acceptance.criteria.map((criterion) => criterion.id)); for (const id of references) if (!ids.has(id)) throw new Error(`${artifact} references unknown acceptance criterion: ${id}`); }
  private validateTriage(findings: Finding[], triage: Triage): void { const expected = new Set(findings.map((finding) => finding.id)); const actual = new Set(triage.findings.map((item) => item.findingId)); if (triage.findings.length !== expected.size || expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) throw new Error("triage must classify every merged finding exactly once"); }
  private repeatedDefect(blocking: Finding[], triage: Triage): boolean {
    if (blocking.some((finding) => this.priorConfirmedIds.has(finding.id))) return true;
    for (const item of triage.findings.filter((entry) => blocking.some((finding) => finding.id === entry.findingId))) { const count = (this.rootCauseCounts.get(item.rootCause) ?? 0) + 1; this.rootCauseCounts.set(item.rootCause, count); if (count >= 2) return true; }
    return false;
  }
  private async handleContext(role: AgentRole, previousSessionId: string, observation: import("../context/budget.js").TokenObservation): Promise<void> {
    this.turnBudgets.record(role, observation.latestPromptTokens); const decision = decideContext(observation, { ...this.config.context, expectedNextTurnTokens: this.turnBudgets.expected(role) });
    this.state.context = { latestPromptTokens: decision.latestPromptTokens, contextWindow: decision.contextWindow, usage: decision.usage, provenance: decision.provenance, source: decision.source, reason: decision.reason, projectedTokens: decision.projectedTokens, reservedTokens: decision.reservedTokens, effectiveHandoffThreshold: decision.effectiveHandoffThreshold }; await this.store.write(this.state);
    if (decision.action !== "handoff" && decision.action !== "hard_stop") return;
    await this.performHandoff(role, previousSessionId, decision);
  }
  private async performHandoff(role: AgentRole, previousSessionId: string, decision: ContextDecision): Promise<void> {
    this.state.mutatingActionsBlocked = true; this.state.manualHandoffRequested = false; await this.store.write(this.state); if (!this.dependencies.continuity || !this.currentInput) throw new Error(`context ${decision.action} requires continuity adapter`);
    const resumeStage = this.state.stage; await this.transition("HANDOFF_GENERATING"); await this.observe({ type: "handoff.start", message: `Generating handoff for ${role}`, data: { reason: decision.reason, previousSessionId } }); const result = await this.dependencies.continuity({ state: this.state, stage: resumeStage, role, previousSessionId, decision, objective: this.currentInput.requirements, definitionOfDone: this.currentInput.definitionOfDone, gates: this.latestGates, review: this.latestReview });
    await this.transition("HANDOFF_VALIDATING"); await this.transition("SESSION_RESTARTING"); const sequence = this.state.counters.contextHandoffs + 1; this.state.counters.contextHandoffs = sequence; this.state.handoffs.push({ sequence, role, previousSessionId, newSessionId: result.newSessionId, path: result.path, reason: decision.reason, createdAt: new Date().toISOString() }); this.state.activeSession = { role, sessionId: result.newSessionId }; this.state.mutatingActionsBlocked = false; this.state.stage = resumeStage; await this.dependencies.clearManualHandoffRequest?.(); await this.store.write(this.state); await this.observe({ type: "session.restart", message: `Session restarted for ${role}`, data: { sequence, previousSessionId, newSessionId: result.newSessionId } });
  }
  private skippedVerification(changedFiles: string[]): AdvancedVerificationResult { return { adversarial: { kind: "adversarial", status: "skipped", required: false, tests: [], detail: "no adapter supplied", durationMs: 0 }, property: { kind: "property", status: "skipped", required: false, tests: [], detail: "no adapter supplied", durationMs: 0 }, mutation: { kind: "mutation", status: "skipped", required: false, changedFiles, killed: 0, survived: 0, timedOut: 0, skipped: 0, relevantSurvivors: [], score: null, detail: "no adapter supplied", durationMs: 0 }, flaky: [] }; }
}
