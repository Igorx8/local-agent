import type { HarnessEvent } from "./events.js";
import { readEvents } from "./events.js";

export type ProgressMode = "human" | "jsonl" | "off";
export interface RunIdentity { runId: string; repositoryPath: string; artifactPath: string; }
export interface ProgressSink { write(value: string): unknown; }

const visibleTypes = new Set(["workflow.stage", "agent.start", "agent.end", "inference.retry", "checkpoint", "gate.result", "handoff.start", "session.restart", "run.paused", "model.unloading", "model.stopped", "model.unload_failed", "error"]);
function safeData(event: HarnessEvent): Record<string, unknown> {
  const source = event.data ?? {}; const keys = ["stage", "status", "role", "alias", "iteration", "attempt", "maximum", "name", "durationMs", "exitCode", "sequence", "reason", "commit", "pausedFromStage"];
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

export function formatIdentity(identity: RunIdentity, mode: ProgressMode): string | undefined {
  if (mode === "off") return undefined;
  if (mode === "jsonl") return JSON.stringify({ type: "run.created", runId: identity.runId, worktree: identity.repositoryPath, artifactPath: identity.artifactPath });
  return `[run] id=${identity.runId} worktree=${identity.repositoryPath}`;
}

export function formatProgress(event: HarnessEvent, mode: ProgressMode): string | undefined {
  if (mode === "off" || !visibleTypes.has(event.type)) return undefined; const data = safeData(event);
  if (mode === "jsonl") return JSON.stringify({ type: "run.progress", timestamp: event.timestamp, event: event.type, message: event.message, data });
  const details = Object.entries(data).map(([key, value]) => `${key}=${String(value)}`).join(" "); return `[${event.timestamp.slice(11, 19)}] ${event.message}${details ? ` (${details})` : ""}`;
}

export class ProgressReporter {
  private emitted = 0; private timer?: NodeJS.Timeout; private busy = false;
  constructor(private readonly identity: RunIdentity, private readonly mode: ProgressMode, private readonly sink: ProgressSink, private readonly intervalMs = 500) {}
  start(): void { const identity = formatIdentity(this.identity, this.mode); if (identity) this.sink.write(`${identity}\n`); if (this.mode !== "off") this.timer = setInterval(() => { void this.flush(); }, this.intervalMs); }
  async flush(): Promise<void> { if (this.busy || this.mode === "off") return; this.busy = true; try { const events = await readEvents(this.identity.artifactPath, Number.MAX_SAFE_INTEGER); for (const event of events.slice(this.emitted)) { const line = formatProgress(event, this.mode); if (line) this.sink.write(`${line}\n`); } this.emitted = events.length; } finally { this.busy = false; } }
  async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); await this.flush(); }
}

export function parseProgressMode(value: string | undefined): ProgressMode { if (value === undefined) return "human"; if (value === "human" || value === "jsonl" || value === "off") return value; throw new Error(`invalid progress mode: ${value}; expected human, jsonl, or off`); }
