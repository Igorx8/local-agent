import type { AssistantMessage, Event, FileDiff, OpencodeClient, Part, Session, SessionStatus, Todo } from "@opencode-ai/sdk";
import { setTimeout as delay } from "node:timers/promises";
import { responseData } from "./client.js";

export interface ModelSelection { providerID: string; modelID: string; }
export interface PromptRequest { sessionID: string; text: string; agent: string; model: ModelSelection; system?: string; tools?: Record<string, boolean>; asynchronous?: boolean; signal?: AbortSignal; }
export interface TokenUsage { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; provenance: "opencode_message_metadata"; }
export type SessionActivity = { type: "tool"; tool: string; status: string } | { type: "files"; files: string[] } | { type: "step"; inputTokens: number; outputTokens: number; reasoningTokens: number };

export function parseModelAlias(value: string): ModelSelection {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) throw new Error(`model must be provider/model: ${value}`);
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
}

export class OpencodeSessions {
  constructor(private readonly client: OpencodeClient, private readonly directory: string) {}

  async create(title: string, parentID?: string): Promise<Session> {
    return responseData(await this.client.session.create({ body: { title, parentID }, query: { directory: this.directory } }));
  }

  async prompt(request: PromptRequest): Promise<unknown> {
    const options = { path: { id: request.sessionID }, query: { directory: this.directory }, body: { agent: request.agent, model: request.model, system: request.system, tools: request.tools, parts: [{ type: "text" as const, text: request.text }] }, signal: request.signal };
    if (request.asynchronous) {
      const result = await this.client.session.promptAsync(options);
      if (result.error !== undefined) throw new Error(`OpenCode request failed: ${JSON.stringify(result.error)}`);
      return undefined;
    }
    return responseData(await this.client.session.prompt(options));
  }

  async abort(sessionID: string): Promise<boolean> { return responseData(await this.client.session.abort({ path: { id: sessionID }, query: { directory: this.directory } })); }
  async statuses(signal?: AbortSignal): Promise<Record<string, SessionStatus>> { return responseData(await this.client.session.status({ query: { directory: this.directory }, signal })); }
  async waitUntilIdle(sessionID: string, timeoutMs: number, signal?: AbortSignal, onActivity?: (activity: SessionActivity) => Promise<void> | void): Promise<void> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let observedActive = false;
    const observedParts = new Map<string, string>();
    try {
      while (true) {
        combined.throwIfAborted();
        const status = (await this.statuses(combined))[sessionID];
        if (onActivity) {
          const messages = await this.messages(sessionID);
          for (const part of messages.flatMap((message) => message.parts)) {
            if (part.sessionID !== sessionID) continue;
            if (part.type === "tool") { const value = part.state.status; if (observedParts.get(part.id) !== value) { observedParts.set(part.id, value); await onActivity({ type: "tool", tool: part.tool, status: value }); } }
            else if (part.type === "patch" && !observedParts.has(part.id)) { observedParts.set(part.id, "seen"); await onActivity({ type: "files", files: part.files }); }
            else if (part.type === "step-finish" && !observedParts.has(part.id)) { observedParts.set(part.id, "seen"); await onActivity({ type: "step", inputTokens: part.tokens.input, outputTokens: part.tokens.output, reasoningTokens: part.tokens.reasoning }); }
          }
        }
        if (status?.type === "busy" || status?.type === "retry") observedActive = true;
        else if (status?.type === "idle" || (observedActive && status === undefined)) return;
        else if (status === undefined) {
          const messages = await this.messages(sessionID);
          if (messages.some((message) => message.info.role === "assistant")) return;
        }
        await delay(500, undefined, { signal: combined });
      }
    } catch (error) {
      if (timeout.aborted && !signal?.aborted) throw new Error(`OpenCode session ${sessionID} did not become idle within ${timeoutMs}ms`, { cause: error });
      throw error;
    }
  }
  async children(sessionID: string): Promise<Session[]> { return responseData(await this.client.session.children({ path: { id: sessionID }, query: { directory: this.directory } })); }
  async todos(sessionID: string): Promise<Todo[]> { return responseData(await this.client.session.todo({ path: { id: sessionID }, query: { directory: this.directory } })); }
  async diffs(sessionID: string, messageID?: string): Promise<FileDiff[]> { return responseData(await this.client.session.diff({ path: { id: sessionID }, query: { directory: this.directory, messageID } })); }
  async messages(sessionID: string): Promise<Array<{ info: import("@opencode-ai/sdk").Message; parts: Part[] }>> { return responseData(await this.client.session.messages({ path: { id: sessionID }, query: { directory: this.directory } })); }
  async notify(message: string, variant: "info" | "success" | "warning" | "error" = "info"): Promise<boolean> { return responseData(await this.client.tui.showToast({ body: { title: "Local Agent Harness", message, variant }, query: { directory: this.directory } })); }

  latestUsage(messages: Array<{ info: import("@opencode-ai/sdk").Message }>): TokenUsage | undefined {
    const assistant = [...messages].reverse().map((message) => message.info).find((message): message is AssistantMessage => message.role === "assistant");
    if (!assistant) return undefined;
    return { input: assistant.tokens.input, output: assistant.tokens.output, reasoning: assistant.tokens.reasoning, cacheRead: assistant.tokens.cache.read, cacheWrite: assistant.tokens.cache.write, provenance: "opencode_message_metadata" };
  }

  async *events(signal?: AbortSignal): AsyncGenerator<Event> {
    const subscription = await this.client.event.subscribe({ query: { directory: this.directory }, signal });
    for await (const event of subscription.stream) yield event;
  }
}
