import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

export interface HarnessEvent { timestamp: string; type: string; message: string; data?: Record<string, unknown>; }
export const eventFile = (runDirectory: string): string => path.join(runDirectory, "events.jsonl");

export async function appendEvent(runDirectory: string, event: Omit<HarnessEvent, "timestamp"> & { timestamp?: string }): Promise<void> {
  await appendFile(eventFile(runDirectory), `${JSON.stringify({ ...event, timestamp: event.timestamp ?? new Date().toISOString() })}\n`, { mode: 0o600 });
}

export async function readEvents(runDirectory: string, limit = 20): Promise<HarnessEvent[]> {
  try {
    const lines = (await readFile(eventFile(runDirectory), "utf8")).trim().split("\n").filter(Boolean);
    return lines.flatMap((line) => { try { return [JSON.parse(line) as HarnessEvent]; } catch { return []; } }).slice(-Math.max(0, limit));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
