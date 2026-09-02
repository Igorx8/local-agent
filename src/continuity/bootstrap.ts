import { z } from "zod";
import type { OpencodeSessions, ModelSelection } from "../opencode/sessions.js";

export const bootstrapVerificationSchema = z.object({ repository: z.object({ path: z.string(), branch: z.string(), commit: z.string(), dirty: z.boolean() }), objective: z.string().min(1), completed: z.array(z.string()), pendingAcceptanceCriteria: z.array(z.string()), allowedFiles: z.array(z.string()), prohibitedActions: z.array(z.string()), nextAction: z.string().min(1) });
export type BootstrapVerification = z.infer<typeof bootstrapVerificationSchema>;
export interface BootstrapExpected { repository: { path: string; branch: string; commit: string; dirty: boolean }; objective: string; pendingAcceptanceCriteria: string[]; allowedFiles: string[]; prohibitedActions: string[]; nextAction: string; }
export function validateBootstrap(actual: BootstrapVerification, expected: BootstrapExpected): void {
  const exactArrays = (left: string[], right: string[]) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
  if (JSON.stringify(actual.repository) !== JSON.stringify(expected.repository)) throw new Error("bootstrap repository verification mismatch");
  if (actual.objective !== expected.objective || actual.nextAction !== expected.nextAction) throw new Error("bootstrap semantic restatement mismatch");
  for (const [name, left, right] of [["pending acceptance criteria", actual.pendingAcceptanceCriteria, expected.pendingAcceptanceCriteria], ["allowed files", actual.allowedFiles, expected.allowedFiles], ["prohibited actions", actual.prohibitedActions, expected.prohibitedActions]] as const) if (!exactArrays(left, right)) throw new Error(`bootstrap ${name} mismatch`);
}
function extractJson(text: string): unknown { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; return JSON.parse((fenced ?? text).trim()); }
export async function bootstrapSession(sessions: OpencodeSessions, input: { previousSessionId: string; role: string; model: ModelSelection; handoff: string; expected: BootstrapExpected }): Promise<{ sessionId: string; verification: BootstrapVerification }> {
  const session = await sessions.create(`handoff continuation: ${input.role}`, input.previousSessionId);
  await sessions.prompt({ sessionID: session.id, agent: input.role, model: input.model, text: `${input.handoff}\n\nVerify repository state read-only and restate the semantic continuation. Return JSON only. Do not mutate files or run mutating tools.`, tools: { write: false, edit: false } });
  const messages = await sessions.messages(session.id); const response = [...messages].reverse().find((message) => message.info.role === "assistant"); const raw = response?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? ""; const verification = bootstrapVerificationSchema.parse(extractJson(raw)); validateBootstrap(verification, input.expected); return { sessionId: session.id, verification };
}
