import { z } from "zod";

export const conversationTurnSchema = z.object({ sequence: z.number().int().positive(), promptSha256: z.string().regex(/^[a-f0-9]{64}$/), promptPreview: z.string(), runId: z.string().optional(), status: z.enum(["running", "succeeded", "failed", "paused", "escalated"]), baseCommit: z.string(), finalCommit: z.string().optional(), artifactPath: z.string().optional(), startedAt: z.string().datetime(), completedAt: z.string().datetime().optional(), summary: z.string().optional() });
export const conversationStateSchema = z.object({ schemaVersion: z.literal(1), id: z.string().min(1), workspace: z.string().min(1), status: z.enum(["active", "blocked", "closed"]), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), turns: z.array(conversationTurnSchema), activeRunId: z.string().optional() });
export const conversationMemorySchema = z.object({ schemaVersion: z.literal(1), conversationId: z.string(), compacted: z.array(z.string()), recent: z.array(z.object({ sequence: z.number().int().positive(), prompt: z.string(), runId: z.string(), status: z.string(), baseCommit: z.string(), finalCommit: z.string().optional(), summary: z.string(), artifacts: z.array(z.string()) })) });
export type ConversationState = z.infer<typeof conversationStateSchema>;
export type ConversationMemory = z.infer<typeof conversationMemorySchema>;
