import { z } from "zod";
import type { OpencodeSessions, ModelSelection } from "../opencode/sessions.js";

export const bootstrapVerificationSchema = z.object({ repository: z.object({ path: z.string(), branch: z.string(), commit: z.string(), dirty: z.boolean() }), objective: z.string().min(1), completed: z.array(z.string()), pendingAcceptanceCriteria: z.array(z.string()), allowedFiles: z.array(z.string()), prohibitedActions: z.array(z.string()), nextAction: z.string().min(1) });
export const bootstrapSemanticSchema = z.object({ continuity: z.literal("confirmed"), objectiveUnderstood: z.literal(true), nextActionUnderstood: z.literal(true), completed: z.array(z.string()).default([]), contradictions: z.array(z.string()).max(0) }).strict();
export type BootstrapVerification = z.infer<typeof bootstrapVerificationSchema>;
export interface BootstrapExpected { repository: { path: string; branch: string; commit: string; dirty: boolean }; objective: string; pendingAcceptanceCriteria: string[]; allowedFiles: string[]; prohibitedActions: string[]; nextAction: string; }
export function validateBootstrap(actual: BootstrapVerification, expected: BootstrapExpected): void {
  const exactArrays = (left: string[], right: string[]) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
  if (JSON.stringify(actual.repository) !== JSON.stringify(expected.repository)) throw new Error("bootstrap repository verification mismatch");
  if (actual.objective !== expected.objective || actual.nextAction !== expected.nextAction) throw new Error("bootstrap semantic restatement mismatch");
  for (const [name, left, right] of [["pending acceptance criteria", actual.pendingAcceptanceCriteria, expected.pendingAcceptanceCriteria], ["allowed files", actual.allowedFiles, expected.allowedFiles], ["prohibited actions", actual.prohibitedActions, expected.prohibitedActions]] as const) if (!exactArrays(left, right)) throw new Error(`bootstrap ${name} mismatch`);
}
function extractJson(text: string): unknown { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const candidate = (fenced ?? text).trim(); try { return JSON.parse(candidate); } catch { const start = candidate.indexOf("{"); const end = candidate.lastIndexOf("}"); if (start < 0 || end <= start) throw new Error("bootstrap response contains no JSON object"); return JSON.parse(candidate.slice(start, end + 1)); } }
export async function bootstrapSession(sessions: OpencodeSessions, input: { previousSessionId: string; role: string; model: ModelSelection; handoff: string; expected: BootstrapExpected; retries?: number }): Promise<{ sessionId: string; verification: BootstrapVerification }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= (input.retries ?? 0); attempt++) {
    const session = await sessions.create(`handoff continuation: ${input.role}`, input.previousSessionId);
    try {
      await sessions.prompt({ sessionID: session.id, agent: input.role, model: input.model, text: `${input.handoff}\n\nThe harness has already verified repository identity, acceptance IDs, allowed files, prohibited actions, and the exact next action deterministically. Verify semantic continuity only: understand the objective and next action, and report any contradiction. Return JSON only with exactly this shape: {"continuity":"confirmed","objectiveUnderstood":true,"nextActionUnderstood":true,"completed":[],"contradictions":[]}. Never restate deterministic identifiers or paths.`, tools: { write: false, edit: false, bash: false } });
      const messages = await sessions.messages(session.id); const response = [...messages].reverse().find((message) => message.info.role === "assistant"); const raw = response?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? ""; const semantic = bootstrapSemanticSchema.parse(extractJson(raw)); const verification = bootstrapVerificationSchema.parse({ ...input.expected, completed: semantic.completed }); validateBootstrap(verification, input.expected); return { sessionId: session.id, verification };
    } catch (error) { lastError = error; await sessions.abort(session.id).catch(() => false); }
  }
  throw lastError;
}
