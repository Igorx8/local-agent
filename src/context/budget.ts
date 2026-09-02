export type TokenProvenance = "exact" | "estimated";
export interface TokenObservation { latestPromptTokens: number; contextWindow: number; provenance: TokenProvenance; source: "opencode_message_metadata" | "llama_usage" | "local_tokenizer" | "byte_estimate"; }
export type ContextAction = "continue" | "warn" | "prepare_handoff" | "handoff" | "hard_stop";
export interface ContextDecision extends TokenObservation { usage: number; projectedTokens: number; reservedTokens: number; effectiveHandoffThreshold: number; action: ContextAction; reason: "current_usage" | "projected_overflow" | "hard_stop" | "manual" | "below_threshold"; }

export function estimateTokensFromBytes(value: string): TokenObservation { return { latestPromptTokens: Math.ceil(Buffer.byteLength(value, "utf8") / 4), contextWindow: 1, provenance: "estimated", source: "byte_estimate" }; }
export function resolveTokenObservation(input: { contextWindow: number; opencode?: number; llama?: number; localTokenizer?: number; content: string }): TokenObservation {
  if (input.opencode !== undefined) return { latestPromptTokens: input.opencode, contextWindow: input.contextWindow, provenance: "exact", source: "opencode_message_metadata" };
  if (input.llama !== undefined) return { latestPromptTokens: input.llama, contextWindow: input.contextWindow, provenance: "exact", source: "llama_usage" };
  if (input.localTokenizer !== undefined) return { latestPromptTokens: input.localTokenizer, contextWindow: input.contextWindow, provenance: "exact", source: "local_tokenizer" };
  return { latestPromptTokens: Math.ceil(Buffer.byteLength(input.content, "utf8") / 4), contextWindow: input.contextWindow, provenance: "estimated", source: "byte_estimate" };
}
export function decideContext(observation: TokenObservation, options: { warningThreshold: number; prepareHandoffThreshold: number; handoffThreshold: number; hardStopThreshold: number; reservedTokens: number; expectedNextTurnTokens: number }): ContextDecision {
  const usage = observation.latestPromptTokens / observation.contextWindow; const effectiveHandoffThreshold = Math.min(options.handoffThreshold, 1 - options.reservedTokens / observation.contextWindow); const projectedTokens = observation.latestPromptTokens + options.expectedNextTurnTokens + options.reservedTokens;
  let action: ContextAction = "continue"; let reason: ContextDecision["reason"] = "below_threshold";
  if (usage >= options.hardStopThreshold) { action = "hard_stop"; reason = "hard_stop"; }
  else if (usage >= effectiveHandoffThreshold) { action = "handoff"; reason = "current_usage"; }
  else if (projectedTokens >= observation.contextWindow) { action = "handoff"; reason = "projected_overflow"; }
  else if (usage >= options.prepareHandoffThreshold) { action = "prepare_handoff"; reason = "current_usage"; }
  else if (usage >= options.warningThreshold) { action = "warn"; reason = "current_usage"; }
  return { ...observation, usage, projectedTokens, reservedTokens: options.reservedTokens, effectiveHandoffThreshold, action, reason };
}

export class TurnBudgetHistory {
  private readonly values = new Map<string, number[]>();
  constructor(private readonly configured: Record<string, number>) {}
  record(role: string, tokens: number): void { const values = this.values.get(role) ?? []; values.push(tokens); if (values.length > 5) values.shift(); this.values.set(role, values); }
  expected(role: string): number { const configured = this.configured[role]; if (configured) return configured; const values = this.values.get(role) ?? []; return values.length ? Math.ceil(values.reduce((sum, value) => sum + value, 0) / values.length) : 8192; }
}
