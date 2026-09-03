import type { z } from "zod";
import type { HarnessConfig } from "../config.js";
import type { ModelLifecycle } from "../models/types.js";
import { parseModelAlias, type OpencodeSessions } from "../opencode/sessions.js";
import type { AgentRole } from "../opencode/agents.js";
import type { TokenObservation } from "../context/budget.js";

export interface RoleInvocation { role: AgentRole; prompt: string; iteration: number; artifactReferences: string[]; freshSession: true; }
export interface RoleResult<T> { value: T; sessionID: string; raw: string; context?: TokenObservation; telemetry?: { alias: string; requestDurationMs: number; tokensPerSecond?: number }; }
export interface RoleRunner { invoke<T>(invocation: RoleInvocation, schema: z.ZodType<T>): Promise<RoleResult<T>>; }

export const agentNames: Record<AgentRole, string> = { supervisor: "supervisor", planner: "planner", testArchitect: "test-architect", implementer: "implementer", repositoryReviewer: "repository-reviewer", requirementsReviewer: "requirements-reviewer", validator: "finding-validator", repair: "repair", adversarialVerifier: "adversarial-verifier", auditor: "final-auditor" };

function jsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse((fenced ?? text).trim());
}

export class OpenCodeRoleRunner implements RoleRunner {
  constructor(private readonly sessions: OpencodeSessions, private readonly models: ModelLifecycle, private readonly config: HarnessConfig, private readonly onSession?: (role: AgentRole, sessionID: string) => Promise<void> | void, private readonly contextWindows: Record<string, number> = {}) {}
  async invoke<T>(invocation: RoleInvocation, schema: z.ZodType<T>): Promise<RoleResult<T>> {
    const configured = this.config.models[invocation.role];
    const selection = parseModelAlias(configured); const alias = selection.modelID;
    await this.models.ensureModel(alias);
    const session = await this.sessions.create(`harness ${invocation.role} iteration ${invocation.iteration}`);
    await this.onSession?.(invocation.role, session.id);
    this.models.beginRequest(alias);
    const startedAt = performance.now();
    try {
      await this.sessions.prompt({ sessionID: session.id, text: invocation.prompt, agent: agentNames[invocation.role], model: selection });
    } finally { this.models.endRequest(alias); }
    const messages = await this.sessions.messages(session.id);
    const response = [...messages].reverse().find((message) => message.info.role === "assistant");
    const raw = response?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
    const exact = this.sessions.latestUsage(messages); const contextWindow = this.contextWindows[alias] ?? 65536;
    const context: TokenObservation = exact ? { latestPromptTokens: exact.input, contextWindow, provenance: "exact", source: exact.provenance } : { latestPromptTokens: Math.ceil(Buffer.byteLength(invocation.prompt, "utf8") / 4), contextWindow, provenance: "estimated", source: "byte_estimate" };
    const requestDurationMs = Math.round(performance.now() - startedAt);
    const tokensPerSecond = exact && requestDurationMs > 0 ? exact.output / (requestDurationMs / 1000) : undefined;
    return { value: schema.parse(jsonFromText(raw)), sessionID: session.id, raw, context, telemetry: { alias, requestDurationMs, tokensPerSecond } };
  }
}
